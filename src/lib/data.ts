import "server-only";
import { createClient, supabaseConfigured } from "./supabase/server";
import { addDays, dateRange, localDate } from "./calc";
import { dayOutcome, scoreDay, streakEndingAt, type DayScore } from "./scoring";
import { emptyDailyTotals, MICRO_KEYS, type Challenge, type DailyTotals, type Profile, type SleepQuality } from "./types";

export interface PlayerView {
  profile: Profile;
  isMe: boolean;
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

  return {
    today,
    from_date: fromDate,
    me,
    challenge,
    players,
    totals: (totalRows ?? []) as Record<string, unknown>[],
  };
}

interface ArenaPayload {
  today: string;
  from_date: string;
  me: Profile;
  challenge: Challenge | null;
  players: Profile[];
  totals: Record<string, unknown>[];
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

  // First pass: score every day for every player.
  const drafts = profiles.map((profile) => {
    const mine = byUser.get(profile.id) ?? new Map<string, DailyTotals>();
    const loggedDates = new Set(
      [...mine.values()].filter((t) => t.meals > 0 || t.sessions > 0 || t.is_rest_day)
        .map((t) => t.local_date),
    );
    const scores = new Map<string, DayScore>();
    for (const d of days) {
      const t = mine.get(d) ?? emptyDailyTotals(profile.id, d);
      // Streak as of that day, so history shows the bonus actually earned.
      scores.set(d, scoreDay(t, d, streakEndingAt(loggedDates, d)));
    }
    return {
      profile,
      isMe: profile.id === me.id,
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

  return { me, challenge: payload.challenge ?? null, players, days, today };
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
