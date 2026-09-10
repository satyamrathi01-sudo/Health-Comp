import "server-only";
import { after } from "next/server";
import { redirect } from "next/navigation";
import { createClient, supabaseConfigured } from "./supabase/server.ts";
import {
  addDays, cardTargets, dateRange, daysInMonthOf, deriveTargets,
  publishedTargets, publishedTargetsMatch, scoreTargetsFrom, type DerivedTargets,
} from "./calc.ts";
import { dayOutcome, scoreDay, streakEndingAt, type DayScore, type ScoreTargets } from "./scoring.ts";
import { computeRecovery, type Recovery } from "./recovery.ts";
import {
  emptyDailyTotals, MICRO_KEYS, toPlayerCard,
  type Challenge, type ChallengeSummary, type DailyTotals, type DayDetail, type FoodItemRow,
  type FoodLog, type MonthlyGoal, type PlayerCard, type Profile, type SleepQuality,
  type WorkoutLog,
} from "./types.ts";

export interface PlayerView {
  /**
   * Name, emoji and published targets. Deliberately NOT a Profile: a rival's
   * height, weight, age and sex never leave the database, so there is nothing
   * here to leak. Your own full profile is on `Arena.me`.
   */
  profile: PlayerCard;
  isMe: boolean;
  /** Readiness to train today. Estimated, not measured — see recovery.ts. */
  recovery: Recovery;
  /** date -> score, for every day in the requested window */
  scores: Map<string, DayScore>;
  totals: Map<string, DailyTotals>;
  /** The targets every day here was scored against. */
  targets: ScoreTargets | null;
  streak: number;
  /** days won across the window (only counting days somebody logged) */
  wins: number;
  losses: number;
  ties: number;
  points: number;
}

export interface Arena {
  me: Profile;
  /** My own targets, in full — including the parts nobody else may see. */
  myTargets: DerivedTargets | null;
  challenge: Challenge | null;
  players: PlayerView[];
  days: string[];
  today: string;
  /**
   * My own goals this month, and nobody else's. A rival's goals stopped being
   * readable in v11; what they do to that rival's targets is on their card.
   */
  goals: MonthlyGoal[];
  /**
   * People in a running challenge anywhere in the app, not only in mine.
   * Null against a database that predates v11.
   */
  playersEnrolled: number | null;
  /** My own entries for today, so the dashboard needs no follow-up query. */
  todayFood: FoodLog[];
  todayWorkouts: WorkoutLog[];
  /** Per-food protein rollups, when the page asked for them. */
  foodItems: FoodItemRow[];
  /** My own weigh-ins, newest first. Nobody else's are readable. */
  myWeighIns: WeighIn[];
  /** Every challenge I belong to, for the switcher. */
  myChallenges: ChallengeSummary[];
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
    water_ml: num(r.water_ml),
    ...Object.fromEntries(MICRO_KEYS.map((k) => [k, num(r[k])])) as Record<string, number>,
  } as DailyTotals;
}

function coerceCard(r: Record<string, unknown>): PlayerCard {
  const int = (v: unknown) => (v === null || v === undefined ? null : Math.round(num(v)));
  return {
    id: String(r.id),
    display_name: String(r.display_name ?? "Player"),
    avatar_emoji: String(r.avatar_emoji ?? "🔥"),
    created_at: String(r.created_at ?? ""),
    target_kcal: int(r.target_kcal),
    target_protein_g: int(r.target_protein_g),
    target_burn_kcal: int(r.target_burn_kcal),
    target_active_minutes: int(r.target_active_minutes),
    target_micros: coerceMicroAims(r.target_micros),
  };
}

/** A published aims object, kept only if it is actually a bag of numbers. */
function coerceMicroAims(v: unknown): Record<string, number> | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const out: Record<string, number> = {};
  for (const [k, raw] of Object.entries(v as Record<string, unknown>)) {
    const n = num(raw);
    if (n > 0) out[k] = n;
  }
  return Object.keys(out).length > 0 ? out : null;
}

export interface WeighIn {
  local_date: string;
  weight_kg: number;
}

function coerceWeighIns(rows: Record<string, unknown>[]): WeighIn[] {
  return rows.map((r) => ({ local_date: String(r.local_date), weight_kg: num(r.weight_kg) }));
}

function coerceItems(rows: Record<string, unknown>[]): FoodItemRow[] {
  return rows.map((r) => ({
    user_id: String(r.user_id),
    date: String(r.date),
    name: String(r.name ?? "").trim(),
    protein_g: num(r.protein_g),
    kcal: num(r.kcal),
  }));
}

/** Numerics arrive as strings; the profile is full of them. */
function coerceProfile(raw: Record<string, unknown>): Profile {
  const n = (v: unknown) => (v === null || v === undefined || v === "" ? null : num(v));
  return {
    ...(raw as unknown as Profile),
    height_cm: n(raw.height_cm),
    weight_kg: n(raw.weight_kg),
    bmr_override: n(raw.bmr_override),
    kcal_target_override: n(raw.kcal_target_override),
    protein_target_g: n(raw.protein_target_g),
    carbs_target_g: n(raw.carbs_target_g),
    fat_target_g: n(raw.fat_target_g),
    fiber_target_g: n(raw.fiber_target_g),
    burn_target_override: n(raw.burn_target_override),
    minutes_target_override: n(raw.minutes_target_override),
    water_target_ml: n(raw.water_target_ml),
    weight_goal_kg: n(raw.weight_goal_kg),
    weight_goal_start_kg: n(raw.weight_goal_start_kg),
    target_kcal: n(raw.target_kcal),
    target_protein_g: n(raw.target_protein_g),
    target_burn_kcal: n(raw.target_burn_kcal),
    target_active_minutes: n(raw.target_active_minutes),
    target_micros: coerceMicroAims(raw.target_micros),
  };
}

export async function getMyProfile(): Promise<Profile | null> {
  if (!supabaseConfigured()) return null;
  try {
    const supabase = await createClient();
    // One round trip: the function reads auth.uid() straight from the JWT, so
    // no separate "who am I" call is needed, and RLS still restricts the row.
    const { data, error } = await supabase.rpc("get_my_profile");
    if (error) {
      console.error("getMyProfile failed —", error.message);
      return null;
    }
    return data ? coerceProfile(data as Record<string, unknown>) : null;
  } catch (err) {
    console.error("getMyProfile threw —", (err as Error).message);
    return null;
  }
}

interface ArenaPayload {
  today: string;
  from_date: string;
  me: Record<string, unknown>;
  challenge: Challenge | null;
  players: Record<string, unknown>[];
  totals: Record<string, unknown>[];
  goals: MonthlyGoal[];
  today_food: FoodLog[];
  today_workouts: WorkoutLog[];
  food_items: Record<string, unknown>[];
  my_weigh_ins: Record<string, unknown>[];
  my_challenges: ChallengeSummary[];
  /** Absent before v11. */
  players_enrolled?: number | null;
}

export class SchemaOutOfDateError extends Error {
  constructor() {
    super(
      "FitClash's database is behind this build: get_arena(days, challenge_id, food_days) " +
        "is missing. Paste supabase/schema.sql into the Supabase SQL editor and run it.",
    );
    this.name = "SchemaOutOfDateError";
  }
}

export interface ArenaOptions {
  /** Days of history to score. */
  days?: number;
  /**
   * Days of per-food protein data to fetch for everyone visible. Only the
   * Versus screens need it, and it is the one part of the payload that grows
   * with how much people log, so every other page asks for none.
   */
  foodDays?: number;
}

/**
 * Everything a screen needs — in ONE database round trip.
 *
 * Scores are derived here rather than stored, so tuning src/lib/scoring.ts
 * re-scores all history instantly.
 *
 * There is no longer a query-by-query fallback. It existed so a deploy that
 * landed before the SQL still worked, but from v8 the schema is what enforces
 * the privacy line: the old path read `select * from profiles` for every
 * member, which the database now refuses and which would have handed out
 * exactly the numbers this release exists to keep private. A loud error
 * pointing at schema.sql is the better failure.
 */
export async function loadArena(options: ArenaOptions = {}): Promise<Arena | null> {
  if (!supabaseConfigured()) return null;

  const windowDays = options.days ?? 30;
  const foodDays = options.foodDays ?? 0;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_arena", {
    days: windowDays,
    challenge_id: null,
    food_days: foodDays,
  });

  if (error) {
    // PGRST202 = not in the schema cache, i.e. the migration has not been run.
    if (error.code === "PGRST202" || /get_arena/.test(error.message)) {
      throw new SchemaOutOfDateError();
    }
    console.error("loadArena: get_arena failed —", error.message);
    return null;
  }

  const payload = data as ArenaPayload | null;
  if (!payload?.me) return null;

  const me = coerceProfile(payload.me);
  const today = payload.today;
  const days = dateRange(payload.from_date, today);
  const daysThisMonth = daysInMonthOf(today);

  const cards = (payload.players ?? []).map(coerceCard);
  const players: PlayerCard[] = cards.length ? cards : [toPlayerCard(me)];
  const totals = (payload.totals ?? []).map(coerceTotals);

  // My own targets come from my own profile, always freshly derived. A rival's
  // come from the card they published, because their body is not mine to see.
  const myTargets = deriveTargets(me, today);
  // Filtered even though get_arena returns only mine from v11: a database
  // still on v10 returns everyone's, and a rival's goals must not reach a
  // screen whichever schema is live.
  const myGoals = (payload.goals ?? []).filter((g) => g.user_id === me.id);
  keepPublishedTargetsFresh(supabase, me, myTargets ? publishedTargets(me, today, myGoals) : null);

  const byUser = new Map<string, Map<string, DailyTotals>>();
  players.forEach((p) => byUser.set(p.id, new Map()));
  totals.forEach((t) => byUser.get(t.user_id)?.set(t.local_date, t));

  // First pass: score every day for every player, each against their OWN
  // targets. This is what makes the head-to-head fair across different
  // bodies — see the mode note in src/lib/scoring.ts.
  const drafts = players.map((card) => {
    const isMe = card.id === me.id;
    // A stated goal outranks the formula: if I have said I want 150 g of
    // protein a day, that is what I am scored against. Mine are applied here.
    // A rival's arrive already folded into their card, because their goals
    // themselves are not readable from this side (v11).
    const targets = isMe
      ? scoreTargetsFrom(myTargets, myGoals, daysThisMonth, { sex: me.sex, weightKg: me.weight_kg })
      : scoreTargetsFrom(cardTargets(card), [], daysThisMonth, { published: card.target_micros });

    const mine = byUser.get(card.id) ?? new Map<string, DailyTotals>();
    const loggedDates = new Set(
      [...mine.values()].filter((t) => t.meals > 0 || t.sessions > 0 || t.is_rest_day)
        .map((t) => t.local_date),
    );
    const scores = new Map<string, DayScore>();
    for (const d of days) {
      const t = mine.get(d) ?? emptyDailyTotals(card.id, d);
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
      profile: card,
      isMe,
      recovery,
      scores,
      totals: mine,
      targets,
      // Today's streak: if today isn't logged yet, show yesterday's run.
      streak: loggedDates.has(today)
        ? streakEndingAt(loggedDates, today)
        : streakEndingAt(loggedDates, addDays(today, -1)),
    };
  });

  // Second pass: head-to-head record needs every player's scores in hand.
  const scored: PlayerView[] = drafts.map((d) => {
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

  scored.sort((a, b) => (b.isMe ? 1 : 0) - (a.isMe ? 1 : 0) || b.points - a.points);

  return {
    me,
    myTargets,
    challenge: payload.challenge ?? null,
    players: scored,
    days,
    today,
    goals: myGoals,
    todayFood: payload.today_food ?? [],
    todayWorkouts: payload.today_workouts ?? [],
    foodItems: coerceItems(payload.food_items ?? []),
    myWeighIns: coerceWeighIns(payload.my_weigh_ins ?? []),
    myChallenges: payload.my_challenges ?? [],
    playersEnrolled: payload.players_enrolled == null ? null : num(payload.players_enrolled),
  };
}

/**
 * Keep the published copy of my targets in step with my profile.
 *
 * The writers (onboarding, the targets editor, a weigh-in) all publish as
 * they save, so this normally finds nothing to do and costs one comparison.
 * Adding or removing a monthly goal is the one change that leans on it: the
 * Goals board refreshes the page as it saves, and this republishes the card
 * with the goal folded in on that very load.
 * It exists because a rival scores my days from these three numbers: if a
 * write path is ever missed, their scoreboard quietly drifts from mine, and
 * a self-healing read is a much better answer than a discrepancy nobody can
 * explain.
 *
 * Runs after the response is sent, so it never adds latency.
 */
function keepPublishedTargetsFresh(
  supabase: Awaited<ReturnType<typeof createClient>>,
  me: Profile,
  fresh: ReturnType<typeof publishedTargets> | null,
): void {
  if (!fresh || publishedTargetsMatch(me, fresh)) return;
  after(async () => {
    const { error } = await supabase.from("profiles").update(fresh).eq("id", me.id);
    if (error) console.warn("could not republish targets —", error.message);
  });
}

export function rivals(arena: Arena): PlayerView[] {
  return arena.players.filter((p) => !p.isMe);
}

/** The rival currently ahead — the one worth showing on the versus board. */
export function rival(arena: Arena): PlayerView | null {
  return rivals(arena).reduce<PlayerView | null>(
    (best, p) => (!best || p.points > best.points ? p : best),
    null,
  );
}

export function mine(arena: Arena): PlayerView {
  return arena.players.find((p) => p.isMe)!;
}

/** The most recent weigh-in, or null. */
export function latestWeight(arena: Arena): number | null {
  return arena.myWeighIns[0]?.weight_kg ?? null;
}

/** Per-food rows for one person, on one day or across the whole window. */
export function itemsFor(arena: Arena, userId: string, date?: string): FoodItemRow[] {
  return arena.foodItems.filter(
    (r) => r.user_id === userId && (date === undefined || r.date === date),
  );
}

/**
 * Load the arena and enforce the gates in one go.
 *
 * The (app) layout used to fetch the profile purely to check `onboarded`,
 * which cost a whole round trip before the page even started its own. The
 * arena already carries that flag, so the check is free here.
 */
export async function requireArena(options: ArenaOptions = {}): Promise<Arena> {
  const arena = await loadArena(options);
  if (!arena) redirect("/login");
  if (!arena.me.onboarded) redirect("/onboarding");
  return arena;
}

/**
 * The per-item evidence behind one day of one head-to-head.
 *
 * A second round trip, which the rest of the app goes out of its way to
 * avoid — see the note on loadArena. It is deliberate here: this is a page
 * somebody opened on purpose to see one day in detail, not a tab switch,
 * and folding two people's per-item rows into the payload every screen
 * already loads would make every navigation pay for a page most of them
 * never visit.
 *
 * Null rather than throwing when the schema is behind: the drill-down is an
 * enhancement, and a day that cannot show its evidence should say so rather
 * than take the page down with it.
 */
export async function loadDayDetail(otherId: string, day: string): Promise<DayDetail | null> {
  if (!supabaseConfigured()) return null;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_day_detail", {
    other_id: otherId,
    day,
  });

  if (error) {
    console.warn("loadDayDetail: get_day_detail failed —", error.message);
    return null;
  }

  const payload = data as Record<string, unknown> | null;
  if (!payload) return null;

  const foods = Array.isArray(payload.foods) ? payload.foods : [];
  const workouts = Array.isArray(payload.workouts) ? payload.workouts : [];

  return {
    day: String(payload.day ?? day),
    foods: foods.map((r) => {
      const o = r as Record<string, unknown>;
      return {
        user_id: String(o.user_id),
        name: String(o.name ?? "").trim(),
        kcal: num(o.kcal),
        protein_g: num(o.protein_g),
        carbs_g: num(o.carbs_g),
        fat_g: num(o.fat_g),
        fiber_g: num(o.fiber_g),
      };
    }),
    workouts: workouts.map((r) => {
      const o = r as Record<string, unknown>;
      return {
        user_id: String(o.user_id),
        name: String(o.name ?? "").trim(),
        kind: String(o.kind ?? "other"),
        minutes: num(o.minutes),
        kcal: num(o.kcal),
      };
    }),
  };
}
