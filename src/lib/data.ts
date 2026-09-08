import "server-only";
import { createClient, supabaseConfigured } from "./supabase/server";
import { addDays, applyGoalsToTargets, dateRange, daysInMonthOf, deriveTargets, localDate } from "./calc";
import { dayOutcome, scoreDay, streakEndingAt, type DayScore } from "./scoring";
import { computeRecovery, type Recovery } from "./recovery";
import { emptyDailyTotals, MICRO_KEYS, type Challenge, type DailyTotals, type MonthlyGoal, type Profile, type SleepQuality } from "./types";

export interface PlayerView {
  profile: Profile;
  isMe: boolean;
  /** Readiness to train today. Estimated, not measured — see recovery.ts. */
  recovery: Recovery;
  /** date -> score, for every day in the requested window */
  scores: Map<string, DayScore>;
  totals: Map<string, DailyTotals>;
  streak: number;
  /** days won across the window (only counting days somebody logged) */
  wins: number;
  losses: number;
  ties: number;
  points: number;
}

export interface Arena {
  me: Profile;
  challenge: Challenge | null;
  players: PlayerView[];
  days: string[];
  today: string;
  /** This month's goals for everyone visible. */
  goals: MonthlyGoal[];
}

function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Postgres numerics come back as strings over PostgREST. */
function coerceTotals(r: Record<string, unknown>): DailyTotals {
  return {
    user_id: String(r.user_id),
    local_date: String(r.local_date),
    kcal_in: num(r.kcal_in),
    protein_g: num(r.protein_g),
    carbs_g: num(r.carbs_g),
    fat_g: num(r.fat_g),
    fiber_g: num(r.fiber_g),
    meals: num(r.meals),
    kcal_out: num(r.kcal_out),
    active_minutes: num(r.active_minutes),
    sessions: num(r.sessions),
    is_rest_day: Boolean(r.is_rest_day),
    sleep_hours: r.sleep_hours === null || r.sleep_hours === undefined ? null : num(r.sleep_hours),
    sleep_quality: (r.sleep_quality as SleepQuality) ?? null,
    ...Object.fromEntries(MICRO_KEYS.map((k) => [k, num(r[k])])) as Record<keyof typeof EMPTY, number>,
  } as DailyTotals;
}

const EMPTY = {} as Record<string, number>;

export async function getMyProfile(): Promise<Profile | null> {
  if (!supabaseConfigured()) return null;
  try {
    const supabase = await createClient();
    // One round trip: the function reads auth.uid() straight from the JWT, so
    // no separate "who am I" call is needed, and RLS still restricts the row.
    const { data, error } = await supabase.rpc("get_my_profile");
    if (error) {
      if (error.code === "PGRST202" || /get_my_profile/.test(error.message)) {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return null;
        const { data: row } = await supabase
          .from("profiles").select("*").eq("id", user.id).single();
        return (row as Profile) ?? null;
      }
      console.error("getMyProfile failed —", error.message);
      return null;
    }
    return (data as Profile) ?? null;
  } catch (err) {
    console.error("getMyProfile threw —", (err as Error).message);
    return null;
  }
}

/**
 * The pre-v4 path: six sequential round trips. Kept only so a deploy that
 * reaches production before the migration does still works.
 */
async function loadArenaLegacy(windowDays: number): Promise<ArenaPayload | null> {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: meRow } = await supabase.from("profiles").select("*").eq("id", user.id).single();
  if (!meRow) return null;
  const me = meRow as Profile;

  const today = localDate(me.timezone);
  const fromDate = addDays(today, -(windowDays - 1));

  const { data: memberships } = await supabase
    .from("challenge_members")
    .select("challenge_id, challenges(*)")
    .order("joined_at", { ascending: false })
    .limit(1);

  const raw = (memberships?.[0] as Record<string, unknown> | undefined)?.challenges;
  const challenge = (Array.isArray(raw) ? raw[0] : raw) as Challenge | null;

  let players: Profile[] = [me];
  if (challenge) {
    const { data: memberRows } = await supabase
      .from("challenge_members").select("user_id").eq("challenge_id", challenge.id);
    const ids = (memberRows ?? []).map((r) => String(r.user_id));
    if (ids.length) {
      const { data: profileRows } = await supabase.from("profiles").select("*").in("id", ids);
      const found = (profileRows ?? []) as Profile[];
      if (found.length) players = found.some((p) => p.id === me.id) ? found : [me, ...found];
    }
  }

  const { data: totalRows } = await supabase
    .from("daily_totals").select("*")
    .in("user_id", players.map((p) => p.id))
    .gte("local_date", fromDate).lte("local_date", today);

  const { data: goalRows } = await supabase
    .from("monthly_goals").select("*")
    .in("user_id", players.map((p) => p.id))
    .eq("month", today.slice(0, 8) + "01");

  return {
    today,
    from_date: fromDate,
    me,
    challenge,
    players,
    totals: (totalRows ?? []) as Record<string, unknown>[],
    goals: (goalRows ?? []) as MonthlyGoal[],
  };
}

interface ArenaPayload {
  today: string;
  from_date: string;
  me: Profile;
  challenge: Challenge | null;
  players: Profile[];
  totals: Record<string, unknown>[];
  goals?: MonthlyGoal[];
}

/**
 * Everything the dashboard, versus board and history need — in ONE database
 * round trip.
 *
 * This used to be six sequential queries (whoami, my profile, my challenge,
 * its members, their profiles, the totals). With the Vercel function running
 * in us-east and Supabase elsewhere, every one of those was a cross-region
 * hop and the page took seconds to render.
 *
 * Scores are still derived here rather than stored, so tuning
 * src/lib/scoring.ts re-scores all history instantly.
 */
export async function loadArena(windowDays = 30): Promise<Arena | null> {
  if (!supabaseConfigured()) return null;

  let payload: ArenaPayload | null = null;
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("get_arena", { days: windowDays });

    if (error) {
      // PGRST202 = the function is not in the schema cache, i.e. this database
      // has not had the v4 migration applied yet. Fall back to the original
      // query-by-query path so a deploy that lands before the SQL does not
      // take the app down; it is slower, not broken.
      if (error.code === "PGRST202" || /get_arena/.test(error.message)) {
        console.warn(
          "loadArena: get_arena() missing — using the slow multi-query path. " +
            "Run supabase/schema.sql to restore one-round-trip loading.",
        );
        payload = await loadArenaLegacy(windowDays);
      } else {
        console.error("loadArena: get_arena failed —", error.message);
        return null;
      }
    } else {
      payload = data as ArenaPayload | null;
    }
  } catch (err) {
    console.error("loadArena threw —", (err as Error).message);
    return null;
  }

  if (!payload?.me) return null;

  const me = payload.me;
  const today = payload.today;
  const days = dateRange(payload.from_date, today);

  const profiles = payload.players?.length ? payload.players : [me];
  const totals = (payload.totals ?? []).map(coerceTotals);

  const byUser = new Map<string, Map<string, DailyTotals>>();
  profiles.forEach((p) => byUser.set(p.id, new Map()));
  totals.forEach((t) => byUser.get(t.user_id)?.set(t.local_date, t));

  // First pass: score every day for every player, each against their OWN
  // targets. This is what makes the head-to-head fair across different
  // bodies — see the mode note in src/lib/scoring.ts.
  const drafts = profiles.map((profile) => {
    // A stated goal outranks the formula: if they have said they want 150 g
    // of protein a day, that is what they should be scored against.
    const derived = deriveTargets(profile);
    const theirGoals = (payload!.goals ?? []).filter((g) => g.user_id === profile.id);
    const adjusted = derived
      ? applyGoalsToTargets(derived, theirGoals, profile.weight_kg, daysInMonthOf(today))
      : null;
    const targets = adjusted
      ? {
          burnTarget: adjusted.burnTarget,
          proteinTarget: adjusted.proteinTarget,
          kcalTarget: adjusted.kcalTarget,
        }
      : null;
    const mine = byUser.get(profile.id) ?? new Map<string, DailyTotals>();
    const loggedDates = new Set(
      [...mine.values()].filter((t) => t.meals > 0 || t.sessions > 0 || t.is_rest_day)
        .map((t) => t.local_date),
    );
    const scores = new Map<string, DayScore>();
    for (const d of days) {
      const t = mine.get(d) ?? emptyDailyTotals(profile.id, d);
      // Streak as of that day, so history shows the bonus actually earned.
      scores.set(d, scoreDay(t, d, streakEndingAt(loggedDates, d), targets));
    }
    // Recovery looks backwards: last night's sleep (filed under today) and
    // what yesterday's training and eating did to them.
    const todayTotals = mine.get(today) ?? null;
    const yesterday = mine.get(addDays(today, -1)) ?? null;

    let consecutiveTrainingDays = 0;
    for (let i = 1; i < 30; i++) {
      const t = mine.get(addDays(today, -i));
      if (!t || t.sessions === 0) break;
      consecutiveTrainingDays++;
    }

    const recovery = computeRecovery({
      sleepHours: todayTotals?.sleep_hours ?? null,
      sleepQuality: todayTotals?.sleep_quality ?? null,
      yesterdayBurn: yesterday?.kcal_out ?? 0,
      yesterdayKcalIn: yesterday?.kcal_in ?? 0,
      yesterdayProtein: yesterday?.protein_g ?? 0,
      yesterdayLoggedFood: (yesterday?.meals ?? 0) > 0,
      consecutiveTrainingDays,
      targets,
    });

    return {
      profile,
      isMe: profile.id === me.id,
      recovery,
      scores,
      totals: mine,
      // Today's streak: if today isn't logged yet, show yesterday's run.
      streak: loggedDates.has(today)
        ? streakEndingAt(loggedDates, today)
        : streakEndingAt(loggedDates, addDays(today, -1)),
    };
  });

  // Second pass: head-to-head record needs every player's scores in hand.
  const players: PlayerView[] = drafts.map((d) => {
    let wins = 0, losses = 0, ties = 0, points = 0;
    for (const day of days) {
      const mineScore = d.scores.get(day)!;
      points += mineScore.total;
      const others = drafts.filter((o) => o.profile.id !== d.profile.id);
      if (!others.length) continue;
      const best = others.reduce<DayScore | null>((acc, r) => {
        const sc = r.scores.get(day)!;
        return !acc || sc.total > acc.total ? sc : acc;
      }, null);
      const outcome = dayOutcome(mineScore, best);
      if (outcome === "win") wins++;
      else if (outcome === "loss") losses++;
      else if (outcome === "tie") ties++;
    }
    return { ...d, wins, losses, ties, points: Math.round(points * 10) / 10 };
  });

  players.sort((a, b) => (b.isMe ? 1 : 0) - (a.isMe ? 1 : 0) || b.points - a.points);

  return { me, challenge: payload.challenge ?? null, players, days, today, goals: payload.goals ?? [] };
}

export function rivals(arena: Arena): PlayerView[] {
  return arena.players.filter((p) => !p.isMe);
}

/** The rival currently ahead — the one worth showing on the dashboard. */
export function rival(arena: Arena): PlayerView | null {
  return rivals(arena).reduce<PlayerView | null>(
    (best, p) => (!best || p.points > best.points ? p : best),
    null,
  );
}

export function mine(arena: Arena): PlayerView {
  return arena.players.find((p) => p.isMe)!;
}
