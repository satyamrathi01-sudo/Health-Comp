import type { DailyTotals } from "./types.ts";

/* =====================================================================
 * SCORING — every knob lives in this file. Change a number here and the
 * whole app (today card, history, leaderboard) re-scores on next load.
 * No migration needed: scores are derived from raw logs at read time.
 *
 * Two modes, chosen per call:
 *
 *   RELATIVE (default whenever the player's profile is complete enough)
 *     Every effort component is judged against that person's own target,
 *     derived from their height, weight, age, activity and goal. Burning
 *     600 kcal against a 400 target beats burning 600 against an 800 one.
 *     This is what makes a head-to-head between different bodies mean
 *     anything.
 *
 *   RAW (fallback when targets are unknown)
 *     Absolute numbers. Kept because a half-filled profile should still
 *     produce a score rather than nothing.
 *
 * Only the logging and streak points stay absolute, and they are not targets
 * at all — they reward an event. There is nothing about a body that could
 * scale "did you log today"; every actual target here is that person's own.
 * ===================================================================== */

export const SCORING = {

  // Burn and minutes were 35 and 12. They came down because they were the
  // two lines that saturated: against your own target, anyone who trains at
  // all tends to max both, so 47 points routinely decided nothing between
  // two people who had both been to the gym. The 12 points freed pay for the
  // three nutrition lines below, which actually separate two logged days.
  burn: { kcalPerPoint: 10, max: 25 },
  activeMinutes: { minutesPerPoint: 5, max: 10 },
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
    /**
     * Relative mode instead scores how close intake landed to that person's
     * own calorie target, over and under alike — a 1200 kcal day is not a win
     * for someone maintaining on 2900, and neither is 3000.
     *
     * Full marks only within `fullWithin` of the target, a small allowance
     * because the food estimates themselves are rough, then a straight line
     * down to nothing at `zeroAt`. This used to be steps: anything within 10%
     * scored full, so 135 kcal over an aim of 2,391 lost nothing at all, and a
     * single spoonful at a band edge could cost five points. A line costs a
     * little for a little and a lot for a lot, and there is no floor.
     */
    adherence: { fullWithin: 0.02, zeroAt: 0.3 },
  },

  /**
   * Going past a nutrition aim — protein, fibre, and the vitamin and mineral
   * aims.
   *
   * Reaching the target is full marks, and so is beating it by up to half
   * again: a protein-heavy lunch should never cost points. Past that the line
   * falls to nothing at double the target, so no line can be farmed with
   * 300 g of protein. Ceilings (sugar, saturated fat) work the other way
   * round; see `limits`.
   *
   * Burn and active minutes are deliberately NOT here. The app exists to keep
   * you moving, so training past your target is never marked down — a full
   * line simply stops earning more.
   */
  overshoot: { freeUpTo: 1.5, zeroAt: 2 },

  /**
   * Against your own fibre aim — 14 g per 1,000 kcal you aim to eat. The
   * per-gram rate is the raw-mode fallback, on the same footing as burn's
   * kcalPerPoint: 30 g of fibre is full marks when no target is known.
   */
  fibre: { gramsPerPoint: 6, max: 5 },

  /**
   * Added sugar and saturated fat, each capped at 10% of your own calories.
   * Full marks for staying under both; nothing once you are double either.
   * Sodium is tracked but not scored here — its ceiling scales with
   * bodyweight, which a rival does not publish, and a line that can only be
   * computed for one of the two people is worse than no line.
   */
  limits: { max: 4 },

  /**
   * The nine "eat enough of this" micronutrients, each against an aim scaled
   * to that person and to what they sweated out today.
   *
   * Deliberately the smallest line on the board. These figures are estimated
   * per meal by a language model rather than measured, so they are the least
   * trustworthy numbers the app holds; scoring them at all is a judgement
   * that eating a varied day should count for something, not a claim that
   * the iron figure is accurate to the milligram.
   */
  micros: { max: 3 },

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
  SCORING.fibre.max +
  SCORING.limits.max +
  SCORING.micros.max +
  SCORING.logging.food +
  SCORING.logging.training; // === 100

/** A ceiling worth points for staying under. Limit is in the field's own unit. */
export interface ScoredCeiling {
  key: string;
  label: string;
  limit: number;
}

/**
 * One micronutrient aim, in the two parts it is actually made of.
 *
 * `atRest` is what gets published on a card; the sweat term is added back
 * here from the burn the day actually recorded. Splitting it this way is
 * what lets a rival's aim be reconstructed exactly for any day without
 * their body ever being published — see publishedMicroAims() in calc.ts.
 */
export interface ScoredMicroAim {
  key: string;
  label: string;
  atRest: number;
  /** Added per kcal burned, up to maxSweatAdd. */
  perSweat: number;
  maxSweatAdd: number;
}

/**
 * One player's personal targets, from deriveTargets() in calc.ts.
 *
 * The nutrition entries arrive prepared rather than derived here on purpose:
 * this module stays pure arithmetic with no runtime imports, so every table
 * of nutrition constants lives in calc.ts where the rest of them are.
 */
export interface ScoreTargets {
  burnTarget: number;
  proteinTarget: number;
  kcalTarget: number;
  /**
   * How long this person's own burn target takes at a moderate effort.
   * Optional: a card published before this existed has none, and that line
   * falls back to absolute scoring rather than to zero.
   */
  minutesTarget?: number;
  /** Grams of fibre. Derived from the calorie target, so always knowable. */
  fibreTarget?: number;
  /** Ceilings worth points for staying under. Empty means the line is skipped. */
  ceilings?: ScoredCeiling[];
  /** Aims worth points for reaching. Empty means the line is skipped. */
  microAims?: ScoredMicroAim[];
}

export interface ScoreLine {
  key: "burn" | "minutes" | "protein" | "net" | "fibre" | "limits" | "micros" | "logging" | "streak";
  label: string;
  detail: string;
  points: number;
  max: number;
  /**
   * True when the line lost points by going too far rather than not far
   * enough — well past an aim, or over the calorie target — so an
   * explanation can say "less" instead of "more". Only on the lines where
   * going over can cost: protein, calories, fibre, and vitamins and minerals.
   */
  over?: boolean;
}

export interface DayScore {
  date: string;
  total: number;
  base: number;
  bonus: number;
  lines: ScoreLine[];
  logged: boolean;
  /** Null when the profile was too incomplete and raw scoring was used. */
  targets: ScoreTargets | null;
  relative: boolean;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** A numeric column of the totals row by name, for the table-driven lines. */
function field(t: DailyTotals | null, key: string): number {
  if (!t) return 0;
  const v = (t as unknown as Record<string, unknown>)[key];
  const n = typeof v === "number" ? v : Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function capped(value: number, per: number, max: number): number {
  if (!(value > 0) || !(per > 0)) return 0;
  return Math.min(max, round1(value / per));
}

/**
 * Credit for a nutrition aim, 0–1: in proportion up to the target, full from
 * there to `freeUpTo` times it, then down to nothing at `zeroAt` times it.
 *
 * Exported because the protein card on Versus prices protein with it, so the
 * card and the score can never disagree.
 */
export function aimCredit(value: number, target: number): number {
  if (!(target > 0) || !(value > 0)) return 0;
  const ratio = value / target;
  if (ratio <= 1) return ratio;
  const { freeUpTo, zeroAt } = SCORING.overshoot;
  if (ratio <= freeUpTo) return 1;
  return Math.max(0, 1 - (ratio - freeUpTo) / (zeroAt - freeUpTo));
}

/** Whether an aim is far enough past its target to be costing points. */
function pastAim(value: number, target: number): boolean {
  return target > 0 && value / target > SCORING.overshoot.freeUpTo;
}

/** Credit for landing near a target from either side, 0–1. */
function adherenceCredit(value: number, target: number): number {
  if (!(target > 0)) return 0;
  const off = Math.abs(value - target) / target;
  const { fullWithin, zeroAt } = SCORING.netCalories.adherence;
  if (off <= fullWithin) return 1;
  return Math.max(0, 1 - (off - fullWithin) / (zeroAt - fullWithin));
}

/** Appended to a line's detail when it is losing points for going too far. */
const wayOver = (over: boolean) => (over ? " · way over" : "");

export function scoreDay(
  t: DailyTotals | null,
  date: string,
  streakDays = 0,
  targets: ScoreTargets | null = null,
): DayScore {
  // Read fields defensively rather than materialising a zeroed DailyTotals:
  // that would need a runtime import and cost this module its purity.
  const kcalIn = t?.kcal_in ?? 0;
  const kcalOut = t?.kcal_out ?? 0;
  const proteinG = t?.protein_g ?? 0;
  const activeMinutes = t?.active_minutes ?? 0;
  const meals = t?.meals ?? 0;
  const sessions = t?.sessions ?? 0;
  const isRestDay = t?.is_rest_day ?? false;
  const fibreG = t?.fiber_g ?? 0;

  const hasFood = meals > 0;
  const trained = sessions > 0;

  // Targets are only usable if they are actually populated.
  const rel =
    targets && targets.burnTarget > 0 && targets.proteinTarget > 0 && targets.kcalTarget > 0
      ? targets
      : null;

  /* ---------------- burn ---------------- */
  // Full at the target and capped there — never marked down past it, because
  // training more is the point. See the note on `overshoot`.
  const burn = rel
    ? round1(Math.min(1, kcalOut / rel.burnTarget) * SCORING.burn.max)
    : capped(kcalOut, SCORING.burn.kcalPerPoint, SCORING.burn.max);

  /* ---------------- protein ---------------- */
  const protein = rel
    ? round1(aimCredit(proteinG, rel.proteinTarget) * SCORING.protein.max)
    : capped(proteinG, SCORING.protein.gramsPerPoint, SCORING.protein.max);
  const proteinOver = rel !== null && pastAim(proteinG, rel.proteinTarget);

  /* ---------------- active minutes ---------------- */
  // Judged against how long YOUR burn target takes at a moderate effort, so
  // an active person chasing 600 kcal is asked for more minutes than a
  // sedentary one chasing 250. Falls back to the flat hour when no target has
  // been published — an older card, or a half-filled profile. Capped like
  // burn, never marked down: more movement is never worse.
  const minutesTarget = rel?.minutesTarget ?? 0;
  const minutes = minutesTarget > 0
    ? round1(Math.min(1, activeMinutes / minutesTarget) * SCORING.activeMinutes.max)
    : capped(activeMinutes, SCORING.activeMinutes.minutesPerPoint, SCORING.activeMinutes.max);

  /* ---------------- calories ---------------- */
  // Guard: without a food log this would hand out full marks for logging
  // nothing at all.
  const net = kcalIn - kcalOut;
  let netPoints = 0;
  let netDetail = "no food logged";
  let netOver = false;

  if (hasFood && rel) {
    netPoints = round1(adherenceCredit(kcalIn, rel.kcalTarget) * SCORING.netCalories.max);
    const delta = Math.round(kcalIn - rel.kcalTarget);
    netDetail = `${Math.round(kcalIn)} vs ${rel.kcalTarget} aim (${delta > 0 ? "+" : ""}${delta})`;
    // Over the target, and far enough over to have cost something.
    netOver = kcalIn > rel.kcalTarget && netPoints < SCORING.netCalories.max;
  } else if (hasFood) {
    const band = SCORING.netCalories.bands.find((b) => net <= b.upTo);
    netPoints = band ? band.points : 0;
    netDetail = `${net > 0 ? "+" : ""}${Math.round(net)} kcal`;
  }

  /* ---------------- fibre ---------------- */
  const fibreTarget = rel?.fibreTarget ?? 0;
  let fibrePoints = 0;
  let fibreDetail = "no food logged";
  let fibreOver = false;

  if (hasFood && fibreTarget > 0) {
    fibrePoints = round1(aimCredit(fibreG, fibreTarget) * SCORING.fibre.max);
    fibreOver = pastAim(fibreG, fibreTarget);
    fibreDetail = `${Math.round(fibreG)} / ${fibreTarget} g${wayOver(fibreOver)}`;
  } else if (hasFood) {
    fibrePoints = capped(fibreG, SCORING.fibre.gramsPerPoint, SCORING.fibre.max);
    fibreDetail = `${Math.round(fibreG)} g`;
  }

  /* ---------------- ceilings ---------------- */
  // Staying under is worth full marks; the credit falls away linearly and is
  // gone once you are at double. A cliff at exactly the limit would make one
  // extra spoonful cost as much as an entire second helping.
  const ceilings = rel?.ceilings ?? [];
  let limitPoints = 0;
  let limitDetail = "no food logged";

  if (hasFood && ceilings.length > 0) {
    let credit = 0;
    const breached: string[] = [];
    for (const c of ceilings) {
      const value = field(t, c.key);
      const ratio = c.limit > 0 ? value / c.limit : 0;
      credit += ratio <= 1 ? 1 : Math.max(0, 2 - ratio);
      if (ratio > 1) {
        breached.push(`${c.label.toLowerCase()} +${Math.round(value - c.limit)}`);
      }
    }
    limitPoints = round1((credit / ceilings.length) * SCORING.limits.max);
    limitDetail = breached.length > 0 ? breached.join(" · ") : "all under";
  }

  /* ---------------- micronutrients ---------------- */
  // Scored on the mean credit rather than a count of aims hit, so missing
  // one nutrient badly reads differently from missing three narrowly. Each
  // aim follows the same rule as protein: full up to half again past it,
  // nothing at double. The detail still reports the counts, which are what a
  // person can act on.
  const microAims = rel?.microAims ?? [];
  let microPoints = 0;
  let microDetail = "no food logged";
  let microOver = false;

  if (hasFood && microAims.length > 0) {
    let sum = 0;
    let met = 0;
    let tooMuch = 0;
    for (const a of microAims) {
      const aim = a.atRest + Math.min(a.maxSweatAdd, Math.max(0, kcalOut) * a.perSweat);
      const value = field(t, a.key);
      sum += aimCredit(value, aim);
      if (pastAim(value, aim)) tooMuch++;
      else if (aim > 0 && value >= aim) met++;
    }
    microPoints = round1((sum / microAims.length) * SCORING.micros.max);
    microDetail = `${met} of ${microAims.length} aims met${tooMuch ? ` · ${tooMuch} way over` : ""}`;
    microOver = tooMuch > 0;
  }

  /* ---------------- showing up ---------------- */
  const loggingPoints =
    (hasFood ? SCORING.logging.food : 0) +
    (trained || isRestDay ? SCORING.logging.training : 0);

  const bonus = Math.min(SCORING.streak.max, streakDays * SCORING.streak.pointsPerDay);

  const lines: ScoreLine[] = [
    {
      key: "burn",
      label: "Calories burned",
      detail: rel
        ? `${Math.round(kcalOut)} / ${rel.burnTarget} kcal`
        : `${Math.round(kcalOut)} kcal`,
      points: burn,
      max: SCORING.burn.max,
    },
    {
      key: "protein",
      label: "Protein",
      detail: rel
        ? `${Math.round(proteinG)} / ${rel.proteinTarget} g${wayOver(proteinOver)}`
        : `${Math.round(proteinG)} g`,
      points: protein,
      max: SCORING.protein.max,
      over: proteinOver,
    },
    {
      key: "net",
      label: rel ? "Calorie target" : "Net calories",
      detail: netDetail,
      points: netPoints,
      max: SCORING.netCalories.max,
      over: netOver,
    },
    {
      key: "fibre",
      label: "Fibre",
      detail: fibreDetail,
      points: fibrePoints,
      max: SCORING.fibre.max,
      over: fibreOver,
    },
    {
      key: "limits",
      label: "Sugar & sat fat",
      detail: ceilings.length > 0 ? limitDetail : "needs a calorie target",
      points: limitPoints,
      // No ceilings means no target was published, and a line showing 0 / 4
      // would report a shortfall against points that were never on offer.
      max: ceilings.length > 0 ? SCORING.limits.max : 0,
    },
    {
      key: "micros",
      label: "Vitamins & minerals",
      detail: microAims.length > 0 ? microDetail : "no targets yet",
      points: microPoints,
      max: microAims.length > 0 ? SCORING.micros.max : 0,
      over: microOver,
    },
    {
      key: "minutes",
      label: "Active minutes",
      detail: minutesTarget > 0
        ? `${Math.round(activeMinutes)} / ${minutesTarget} min`
        : `${Math.round(activeMinutes)} min`,
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

  const base = round1(
    burn + minutes + protein + netPoints + fibrePoints + limitPoints + microPoints + loggingPoints,
  );

  return {
    date,
    base,
    bonus,
    total: round1(base + bonus),
    lines,
    logged: hasFood || trained || isRestDay,
    targets: rel,
    relative: rel !== null,
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

/**
 * What the trailing side would have had to do to close one line.
 *
 * `over` says which way. A line lost by going too far is won back by doing
 * LESS, at the rate the line falls past its free zone — not by the "more"
 * the same number of points would take from below. Burn and minutes never
 * lose points that way, so their hints only ever ask for more.
 */
function closeHint(
  key: ScoreLine["key"],
  pointsBehind: number,
  targets: ScoreTargets | null,
  over = false,
): string | null {
  if (pointsBehind <= 0) return null;
  const p = pointsBehind;
  // Units of an aim per point on the falling side, past the free zone.
  const pastPerPoint = (target: number, max: number) =>
    ((SCORING.overshoot.zeroAt - SCORING.overshoot.freeUpTo) * target) / max;

  switch (key) {
    case "burn": {
      // In relative mode a point is worth a share of that person's own burn
      // target, so the advice is in their units rather than a global constant.
      const kcalPerPoint = targets
        ? targets.burnTarget / SCORING.burn.max
        : SCORING.burn.kcalPerPoint;
      const kcal = Math.round(p * kcalPerPoint);
      const mins = Math.round(kcal / KCAL_PER_WALK_MIN);
      return `${kcal} kcal more — about a ${mins}-minute brisk walk`;
    }
    case "protein": {
      if (over && targets) {
        return `${Math.round(p * pastPerPoint(targets.proteinTarget, SCORING.protein.max))} g less protein — ` +
          "far past your target costs points";
      }
      const gramsPerPoint = targets
        ? targets.proteinTarget / SCORING.protein.max
        : SCORING.protein.gramsPerPoint;
      const grams = Math.round(p * gramsPerPoint);
      const eggs = Math.max(1, Math.round(grams / 18));
      return `${grams} g more protein — roughly ${eggs} eggs, or ${eggs * 100} g of paneer`;
    }
    case "minutes": {
      const perPoint = targets?.minutesTarget
        ? targets.minutesTarget / SCORING.activeMinutes.max
        : SCORING.activeMinutes.minutesPerPoint;
      return `${Math.round(p * perPoint)} more active minutes`;
    }
    case "net": {
      if (!targets) return "eat a little less or move a little more";
      if (!over) return `get closer to your ${targets.kcalTarget} kcal target`;
      const { fullWithin, zeroAt } = SCORING.netCalories.adherence;
      const kcalPerPoint = ((zeroAt - fullWithin) * targets.kcalTarget) / SCORING.netCalories.max;
      return `about ${Math.round(p * kcalPerPoint)} kcal less — closer to your ${targets.kcalTarget} kcal target`;
    }
    case "fibre":
      if (over && targets?.fibreTarget) {
        return `${Math.round(p * pastPerPoint(targets.fibreTarget, SCORING.fibre.max))} g less fibre — ` +
          "far past your aim costs points";
      }
      return targets?.fibreTarget
        ? `${Math.round(p * (targets.fibreTarget / SCORING.fibre.max))} g more fibre — a katori of dal, or a guava`
        : "more fibre — dal, whole fruit, or a millet roti";
    case "limits":
      return "keep added sugar and saturated fat under their limits";
    case "micros":
      return over
        ? "ease off whatever pushed a vitamin or mineral far past its aim"
        : "eat a wider mix of foods — see Vitamins & minerals on Today";
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
      // Addressed to whoever is behind on this line, in THEIR units: their
      // targets are what decide how much work a point actually represents,
      // and their line says whether they fell short or went too far.
      toClose: closeHint(
        line.key,
        Math.abs(delta),
        delta < 0 ? mine.targets : theirs.targets,
        delta < 0 ? line.over : other?.over,
      ),
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

/* =====================================================================
 * What a suggestion is actually worth.
 *
 * Rather than estimating, this re-scores the day with the change applied
 * and takes the difference. That way every cap, guard and band is honoured
 * automatically: adding 300 kcal of burn is worth nothing if you already
 * maxed that line, adding protein far past its target is worth less than
 * nothing, and the number shown can never contradict the score.
 * ===================================================================== */

export type ImpactComponent =
  | "burn" | "protein" | "calories" | "minutes" | "fibre" | "logging" | "sleep" | "water" | "micros" | "none";

export interface Impact {
  component: ImpactComponent;
  /** In the component's own unit; may be negative (e.g. eat 300 kcal less). */
  amount: number;
}

/** The fields scoreDay actually reads, so no zeroed row needs constructing. */
function readable(t: DailyTotals | null): DailyTotals {
  return {
    ...(t ?? {}),
    kcal_in: t?.kcal_in ?? 0,
    kcal_out: t?.kcal_out ?? 0,
    protein_g: t?.protein_g ?? 0,
    fiber_g: t?.fiber_g ?? 0,
    active_minutes: t?.active_minutes ?? 0,
    meals: t?.meals ?? 0,
    sessions: t?.sessions ?? 0,
    is_rest_day: t?.is_rest_day ?? false,
  } as DailyTotals;
}

function withImpact(t: DailyTotals | null, impact: Impact): DailyTotals {
  const base = readable(t);
  const amount = Number.isFinite(impact.amount) ? impact.amount : 0;

  switch (impact.component) {
    case "burn":
      return { ...base, kcal_out: Math.max(0, base.kcal_out + amount), sessions: Math.max(1, base.sessions) };
    case "minutes":
      return { ...base, active_minutes: Math.max(0, base.active_minutes + amount), sessions: Math.max(1, base.sessions) };
    case "protein":
      return { ...base, protein_g: Math.max(0, base.protein_g + amount), meals: Math.max(1, base.meals) };
    case "calories":
      return { ...base, kcal_in: Math.max(0, base.kcal_in + amount), meals: Math.max(1, base.meals) };
    case "fibre":
      return { ...base, fiber_g: Math.max(0, base.fiber_g + amount), meals: Math.max(1, base.meals) };
    case "logging":
      return { ...base, meals: Math.max(1, base.meals), sessions: Math.max(1, base.sessions) };
    // Sleep and water are tracked but not scored, so they are worth zero by
    // construction. Micronutrients ARE scored now, but a suggestion to "eat
    // more micros" names no nutrient and carries no number, so there is
    // nothing to re-score — saying zero is still more honest than inventing
    // a figure. A suggestion naming a specific nutrient should come through
    // as that nutrient, not as this catch-all.
    default:
      return base;
  }
}

export function projectedGain(
  impact: Impact,
  totals: DailyTotals | null,
  streakDays: number,
  targets: ScoreTargets | null,
): number {
  if (
    impact.component === "sleep" ||
    impact.component === "water" ||
    impact.component === "micros" ||
    impact.component === "none"
  ) {
    return 0;
  }
  const before = scoreDay(readable(totals), "projection", streakDays, targets);
  const after = scoreDay(withImpact(totals, impact), "projection", streakDays, targets);
  return round1(after.total - before.total);
}
