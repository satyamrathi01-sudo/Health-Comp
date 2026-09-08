import type { DailyTotals } from "./types";

/* =====================================================================
 * SCORING — every knob lives in this file. Change a number here and the
 * whole app (today card, history, leaderboard) re-scores on next load.
 * No migration needed: scores are derived from raw logs at read time.
 *
 * MODE: "raw" — absolute numbers, nobody's body stats enter the maths.
 * Burn more, eat more protein, keep net calories low, log every day.
 *
 * The known trade-off: a heavier person burns more kcal for identical
 * work, so raw burn slightly favours them. If that starts to bite, add a
 * "relative" branch here — the shape of the breakdown stays identical, so
 * nothing downstream needs to change.
 * ===================================================================== */

export const SCORING = {
  mode: "raw" as const,

  burn: { kcalPerPoint: 10, max: 35 }, // 350 kcal burned = full marks
  activeMinutes: { minutesPerPoint: 5, max: 12 }, // 60 min = full marks
  protein: { gramsPerPoint: 5, max: 25 }, // 125 g = full marks

  /** net = kcal eaten − kcal burned. Only scores once food is logged. */
  netCalories: {
    max: 18,
    bands: [
      { upTo: 0, points: 18 },
      { upTo: 300, points: 14 },
      { upTo: 600, points: 10 },
      { upTo: 900, points: 5 },
    ] as { upTo: number; points: number }[],
  },

  /** Showing up at all. Split so a rest day still earns the training half. */
  logging: { food: 5, training: 5 },

  /** +1 per consecutive logged day, capped. Sits on top of the 100. */
  streak: { pointsPerDay: 1, max: 10 },
} as const;

export const MAX_BASE_SCORE =
  SCORING.burn.max +
  SCORING.activeMinutes.max +
  SCORING.protein.max +
  SCORING.netCalories.max +
  SCORING.logging.food +
  SCORING.logging.training; // === 100

export interface ScoreLine {
  key: "burn" | "minutes" | "protein" | "net" | "logging" | "streak";
  label: string;
  detail: string;
  points: number;
  max: number;
}

export interface DayScore {
  date: string;
  total: number;
  base: number;
  bonus: number;
  lines: ScoreLine[];
  logged: boolean;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

function capped(value: number, per: number, max: number): number {
  if (!(value > 0) || !(per > 0)) return 0;
  return Math.min(max, round1(value / per));
}

export function scoreDay(t: DailyTotals | null, date: string, streakDays = 0): DayScore {
  // Read fields defensively rather than materialising a zeroed DailyTotals:
  // that would need a runtime import and cost this module its purity.
  const kcalIn = t?.kcal_in ?? 0;
  const kcalOut = t?.kcal_out ?? 0;
  const proteinG = t?.protein_g ?? 0;
  const activeMinutes = t?.active_minutes ?? 0;
  const meals = t?.meals ?? 0;
  const sessions = t?.sessions ?? 0;
  const isRestDay = t?.is_rest_day ?? false;

  const hasFood = meals > 0;
  const trained = sessions > 0;

  const burn = capped(kcalOut, SCORING.burn.kcalPerPoint, SCORING.burn.max);
  const minutes = capped(activeMinutes, SCORING.activeMinutes.minutesPerPoint, SCORING.activeMinutes.max);
  const protein = capped(proteinG, SCORING.protein.gramsPerPoint, SCORING.protein.max);

  // Guard: without a food log, "net" would be a big negative number and
  // hand out full marks for logging nothing. No food, no net points.
  const net = kcalIn - kcalOut;
  let netPoints = 0;
  if (hasFood) {
    const band = SCORING.netCalories.bands.find((b) => net <= b.upTo);
    netPoints = band ? band.points : 0;
  }

  const loggingPoints =
    (hasFood ? SCORING.logging.food : 0) +
    (trained || isRestDay ? SCORING.logging.training : 0);

  const bonus = Math.min(SCORING.streak.max, streakDays * SCORING.streak.pointsPerDay);

  const lines: ScoreLine[] = [
    {
      key: "burn",
      label: "Calories burned",
      detail: `${Math.round(kcalOut)} kcal`,
      points: burn,
      max: SCORING.burn.max,
    },
    {
      key: "protein",
      label: "Protein",
      detail: `${Math.round(proteinG)} g`,
      points: protein,
      max: SCORING.protein.max,
    },
    {
      key: "net",
      label: "Net calories",
      detail: hasFood ? `${net > 0 ? "+" : ""}${Math.round(net)} kcal` : "no food logged",
      points: netPoints,
      max: SCORING.netCalories.max,
    },
    {
      key: "minutes",
      label: "Active minutes",
      detail: `${Math.round(activeMinutes)} min`,
      points: minutes,
      max: SCORING.activeMinutes.max,
    },
    {
      key: "logging",
      label: "Logged the day",
      detail: [hasFood ? "food" : null, trained ? "training" : isRestDay ? "rest day" : null]
        .filter(Boolean)
        .join(" + ") || "nothing yet",
      points: loggingPoints,
      max: SCORING.logging.food + SCORING.logging.training,
    },
    {
      key: "streak",
      label: "Streak bonus",
      detail: streakDays > 0 ? `${streakDays} day${streakDays === 1 ? "" : "s"}` : "no streak",
      points: bonus,
      max: SCORING.streak.max,
    },
  ];

  const base = round1(burn + minutes + protein + netPoints + loggingPoints);

  return {
    date,
    base,
    bonus,
    total: round1(base + bonus),
    lines,
    logged: hasFood || trained || isRestDay,
  };
}

/**
 * Consecutive logged days ending at (and including) `upTo`.
 * A day counts as logged if it has food, training, or an explicit rest day.
 */
export function streakEndingAt(loggedDates: Set<string>, upTo: string): number {
  let streak = 0;
  const cur = new Date(upTo + "T00:00:00Z");
  for (let i = 0; i < 400; i++) {
    const key = cur.toISOString().slice(0, 10);
    if (!loggedDates.has(key)) break;
    streak++;
    cur.setUTCDate(cur.getUTCDate() - 1);
  }
  return streak;
}

export interface PlayerDay {
  userId: string;
  score: DayScore;
}

export type DayOutcome = "win" | "loss" | "tie" | "none";

/** Who took the day. `none` when nobody logged anything. */
export function dayOutcome(mine: DayScore, theirs: DayScore | null): DayOutcome {
  if (!theirs) return mine.logged ? "win" : "none";
  if (!mine.logged && !theirs.logged) return "none";
  if (Math.abs(mine.total - theirs.total) < 0.05) return "tie";
  return mine.total > theirs.total ? "win" : "loss";
}

/* =====================================================================
 * Why one of you beat the other.
 *
 * Deterministic on purpose: the score is arithmetic, so the explanation can
 * be exact rather than a language model's guess. Every gap also carries the
 * concrete amount needed to close it, derived from the same weights above.
 * ===================================================================== */

export interface GapLine {
  key: ScoreLine["key"];
  label: string;
  mine: number;
  theirs: number;
  /** mine − theirs, in points */
  delta: number;
  mineDetail: string;
  theirsDetail: string;
  /** What the trailing side would have had to do. Null when level. */
  toClose: string | null;
}

export interface ScoreGap {
  delta: number;
  leader: "me" | "them" | "level";
  lines: GapLine[];
  /** Where I gained ground, biggest first. */
  gains: GapLine[];
  /** Where I lost ground, biggest first. */
  drops: GapLine[];
}

/** Roughly 5.3 kcal/min for brisk walking at 70 kg (MET 4.3). */
const KCAL_PER_WALK_MIN = 5.3;

function closeHint(key: ScoreLine["key"], pointsBehind: number): string | null {
  if (pointsBehind <= 0) return null;
  const p = pointsBehind;

  switch (key) {
    case "burn": {
      const kcal = Math.round(p * SCORING.burn.kcalPerPoint);
      const mins = Math.round(kcal / KCAL_PER_WALK_MIN);
      return `${kcal} kcal more — about a ${mins}-minute brisk walk`;
    }
    case "protein": {
      const grams = Math.round(p * SCORING.protein.gramsPerPoint);
      return `${grams} g more protein — roughly ${Math.max(1, Math.round(grams / 18))} eggs, or ${Math.round(grams / 18) * 100} g of paneer`;
    }
    case "minutes":
      return `${Math.round(p * SCORING.activeMinutes.minutesPerPoint)} more active minutes`;
    case "net":
      return "eat a little less, or train a little more, to close the calorie gap";
    case "logging":
      return "log both food and training — a rest day counts";
    case "streak":
      return "log something every day to build the streak back";
    default:
      return null;
  }
}

export function compareScores(mine: DayScore, theirs: DayScore): ScoreGap {
  const byKey = new Map(theirs.lines.map((l) => [l.key, l]));

  const lines: GapLine[] = mine.lines.map((line) => {
    const other = byKey.get(line.key);
    const theirPoints = other?.points ?? 0;
    const delta = round1(line.points - theirPoints);
    return {
      key: line.key,
      label: line.label,
      mine: line.points,
      theirs: theirPoints,
      delta,
      mineDetail: line.detail,
      theirsDetail: other?.detail ?? "—",
      // The hint is addressed to whoever is behind on this line.
      toClose: closeHint(line.key, Math.abs(delta)),
    };
  });

  const ordered = [...lines].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  const delta = round1(mine.total - theirs.total);

  return {
    delta,
    leader: Math.abs(delta) < 0.05 ? "level" : delta > 0 ? "me" : "them",
    lines: ordered,
    gains: ordered.filter((l) => l.delta > 0),
    drops: ordered.filter((l) => l.delta < 0),
  };
}
