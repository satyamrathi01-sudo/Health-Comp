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

/**
 * PostgREST returns an embedded relation as either an object or a one-element
 * array depending on how it infers cardinality. Normalise both to one value.
 */
function embedded<T>(value: unknown): T | null {
  if (Array.isArray(value)) return (value[0] as T) ?? null;
  return (value as T) ?? null;
}

export async function getMyProfile(): Promise<Profile | null> {
  if (!supabaseConfigured()) return null;
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;
    const { data } = await supabase.from("profiles").select("*").eq("id", user.id).single();
    return (data as Profile) ?? null;
  } catch (err) {
    // A bad URL or an unreachable Supabase must not take the page down; the
    // caller treats null as "signed out" and shows the login screen.
    console.error("getMyProfile failed —", (err as Error).message);
    return null;
  }
}

/**
 * Everything the dashboard, versus board and history need, in three queries.
 *
 * `windowDays` is how far back to load. Scores are derived here (not stored)
 * so tuning src/lib/scoring.ts re-scores all history instantly.
 */
export async function loadArena(windowDays = 30): Promise<Arena | null> {
  if (!supabaseConfigured()) return null;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: meRow } = await supabase.from("profiles").select("*").eq("id", user.id).single();
  if (!meRow) return null;
  const me = meRow as Profile;

  const today = localDate(me.timezone);
  const from = addDays(today, -(windowDays - 1));
  const days = dateRange(from, today);

  // The challenge I'm in (most recent, if somehow several).
  const { data: memberships } = await supabase
    .from("challenge_members")
    .select("challenge_id, challenges(*)")
    .order("joined_at", { ascending: false })
    .limit(1);

  const challenge = embedded<Challenge>(
    (memberships?.[0] as Record<string, unknown> | undefined)?.challenges,
  );

  // Everyone in it (RLS lets challenge-mates read each other's profiles).
  let profiles: Profile[] = [me];
  if (challenge) {
    const { data: rows } = await supabase
      .from("challenge_members")
      .select("user_id, profiles(*)")
      .eq("challenge_id", challenge.id);
    const found = (rows ?? [])
      .map((r) => embedded<Profile>((r as Record<string, unknown>).profiles))
      .filter((p): p is Profile => Boolean(p));
    if (found.length) profiles = found;
  }

  const userIds = profiles.map((p) => p.id);

  const { data: totalRows } = await supabase
    .from("daily_totals")
    .select("*")
    .in("user_id", userIds)
    .gte("local_date", from)
    .lte("local_date", today);

  const totals = (totalRows ?? []).map((r) => coerceTotals(r as Record<string, unknown>));

  // Group totals by player.
  const byUser = new Map<string, Map<string, DailyTotals>>();
  userIds.forEach((id) => byUser.set(id, new Map()));
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
      const mine = d.scores.get(day)!;
      points += mine.total;
      const rivals = drafts.filter((o) => o.profile.id !== d.profile.id);
      if (!rivals.length) continue;
      // Best rival score that day decides the day.
      const best = rivals.reduce<DayScore | null>((acc, r) => {
        const s = r.scores.get(day)!;
        return !acc || s.total > acc.total ? s : acc;
      }, null);
      const outcome = dayOutcome(mine, best);
      if (outcome === "win") wins++;
      else if (outcome === "loss") losses++;
      else if (outcome === "tie") ties++;
    }
    return { ...d, wins, losses, ties, points: Math.round(points * 10) / 10 };
  });

  // Me first, then by points.
  players.sort((a, b) => (b.isMe ? 1 : 0) - (a.isMe ? 1 : 0) || b.points - a.points);

  return { me, challenge, players, days, today };
}

/**
 * Every rival visible to me. As the challenge owner that is all of them; as a
 * rival it is only the owner, because RLS never returns the others.
 */
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
