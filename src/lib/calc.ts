import type { ActivityLevel, Exercise, Goal, PlayerCard, Profile, Sex } from "./types.ts";

/** Multipliers applied to BMR to get maintenance calories. */
const ACTIVITY_FACTOR: Record<ActivityLevel, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  very_active: 1.9,
};

const GOAL_KCAL_DELTA: Record<Goal, number> = {
  cut: -500,
  maintain: 0,
  bulk: 300,
};

/** Grams of protein per kg of bodyweight. */
const GOAL_PROTEIN_PER_KG: Record<Goal, number> = {
  cut: 2.0, // higher while in a deficit, to hold on to muscle
  maintain: 1.6,
  bulk: 1.8,
};

/**
 * Share of the calorie target that comes from fat.
 *
 * Protein is fixed first (per kg, by goal), fat takes this share, and carbs
 * are whatever is left — so the three always add up to the calories you are
 * actually being scored against rather than to a generic 2,000.
 *
 * Bulking leans lower so more of a bigger intake is left for the carbohydrate
 * that fuels the training the surplus exists for.
 */
const GOAL_FAT_SHARE: Record<Goal, number> = {
  cut: 0.25,
  maintain: 0.28,
  bulk: 0.24,
};

/**
 * Fat has a floor that has nothing to do with calories: go far below roughly
 * 0.6 g/kg for any length of time and hormones follow it down. On an
 * aggressive cut this floor, not the share, is what sets the number.
 */
const MIN_FAT_PER_KG = 0.6;

/** Fibre is set per calorie eaten — the standard 14 g per 1,000 kcal. */
const FIBER_PER_1000_KCAL = 14;
const FIBER_RANGE = { min: 20, max: 50 } as const;

export function ageFrom(birthDate: string | null): number | null {
  if (!birthDate) return null;
  const b = new Date(birthDate);
  if (Number.isNaN(b.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - b.getFullYear();
  const m = now.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < b.getDate())) age--;
  return age;
}

/**
 * Mifflin–St Jeor — the equation with the best track record for
 * resting metabolic rate in non-athlete adults.
 */
export function bmr(opts: {
  sex: Sex;
  weightKg: number;
  heightCm: number;
  age: number;
}): number {
  const base = 10 * opts.weightKg + 6.25 * opts.heightCm - 5 * opts.age;
  return Math.round(base + (opts.sex === "male" ? 5 : -161));
}

/** Body mass index, or null when height and weight are not both known. */
export function bmi(heightCm: number | null, weightKg: number | null): number | null {
  if (!heightCm || !weightKg || heightCm <= 0) return null;
  const m = heightCm / 100;
  return Math.round((weightKg / (m * m)) * 10) / 10;
}

export type BmiBand = "under" | "healthy" | "over" | "obese";

/** WHO Asian cut-offs, which is the right reference for this app's users. */
export function bmiBand(value: number): BmiBand {
  if (value < 18.5) return "under";
  if (value < 23) return "healthy";
  if (value < 27.5) return "over";
  return "obese";
}

/**
 * Energy in a kilogram of body mass. 7,700 kcal is the standard planning
 * figure — real life is messier (water, glycogen, adaptation), which is why
 * the plan below is presented as a pace to aim at rather than a promise.
 */
export const KCAL_PER_KG = 7700;

/**
 * Safety rails on how aggressive a plan is allowed to be.
 *
 * Someone typing "lose 5 kg in two weeks" is asking for a 2,700 kcal daily
 * deficit, which is not a diet. Rather than refuse, the plan is clamped to
 * something survivable and told plainly when it will actually land.
 */
export const PLAN_LIMITS = {
  maxDeficitKcal: 1000,
  /** Never take more than this share of maintenance away. */
  maxDeficitShareOfTdee: 0.25,
  maxSurplusKcal: 700,
  /** Intake floor, whatever the arithmetic says. */
  absoluteFloorKcal: 1200,
  /** ...and never below this multiple of resting burn. */
  floorShareOfBmr: 1.1,
} as const;

export interface WeightPlan {
  /** Where the plan started from, frozen when it was set. */
  startKg: number;
  /** The day it was set, which is where pace is measured from. */
  startedOn: string;
  targetKg: number;
  targetDate: string;
  direction: "lose" | "gain";
  daysTotal: number;
  daysLeft: number;
  /** Still to go from the CURRENT weight, always positive. */
  kgToGo: number;
  kgPerWeek: number;
  /** kcal/day away from maintenance. Negative is a deficit. */
  dailyDelta: number;
  /** What the requested date actually needed, before the safety clamp. */
  requestedDailyDelta: number;
  clamped: boolean;
  /** Realistic finish date once clamped. Same as targetDate when it is not. */
  arrivesOn: string;
  note: string | null;
}

/**
 * Turn "I want to be 70 kg by 30 November" into a daily calorie number.
 *
 * Returns null when there is no plan, when it has already been reached, or
 * when the date has passed — in each case the ordinary goal preset applies.
 */
export function weightPlan(
  p: Pick<Profile, "weight_goal_kg" | "weight_goal_date" | "weight_goal_start_kg" | "weight_goal_set_on" | "weight_kg">,
  today: string,
  tdee: number,
  bmrValue: number,
): WeightPlan | null {
  const target = Number(p.weight_goal_kg);
  const current = Number(p.weight_kg);
  const date = p.weight_goal_date;
  if (!(target > 0) || !(current > 0) || !date) return null;

  const start = Number(p.weight_goal_start_kg) > 0 ? Number(p.weight_goal_start_kg) : current;
  const setOn = p.weight_goal_set_on ?? today;

  const daysTotal = Math.max(1, daysBetween(setOn, date));
  // A plan whose date has passed still deserves a sane answer: give it one
  // more day rather than dividing by zero and reporting an infinite deficit.
  const daysLeft = Math.max(1, daysBetween(today, date));

  const kgToGo = Math.round((target - current) * 100) / 100;
  if (Math.abs(kgToGo) < 0.1) return null;

  const direction: "lose" | "gain" = kgToGo < 0 ? "lose" : "gain";
  const requested = Math.round((kgToGo * KCAL_PER_KG) / daysLeft);

  // Clamp, then say so.
  const maxDeficit = Math.min(PLAN_LIMITS.maxDeficitKcal, Math.round(tdee * PLAN_LIMITS.maxDeficitShareOfTdee));
  const floor = Math.max(PLAN_LIMITS.absoluteFloorKcal, Math.round(bmrValue * PLAN_LIMITS.floorShareOfBmr));
  const deficitAllowedByFloor = Math.max(0, tdee - floor);

  const dailyDelta =
    requested < 0
      ? -Math.min(Math.abs(requested), maxDeficit, deficitAllowedByFloor)
      : Math.min(requested, PLAN_LIMITS.maxSurplusKcal);

  const clamped = dailyDelta !== requested;
  const effective = Math.abs(dailyDelta) < 1 ? 1 : Math.abs(dailyDelta);
  const daysNeeded = Math.ceil((Math.abs(kgToGo) * KCAL_PER_KG) / effective);
  const arrivesOn = clamped ? addDays(today, daysNeeded) : date;

  return {
    startKg: start,
    startedOn: setOn,
    targetKg: target,
    targetDate: date,
    direction,
    daysTotal,
    daysLeft,
    kgToGo: Math.abs(kgToGo),
    kgPerWeek: Math.round(((Math.abs(kgToGo) / daysLeft) * 7) * 100) / 100,
    dailyDelta,
    requestedDailyDelta: requested,
    clamped,
    arrivesOn,
    note: clamped
      ? `${Math.abs(requested).toLocaleString()} kcal a day off maintenance is not a safe pace. ` +
        `Held at ${Math.abs(dailyDelta).toLocaleString()}, which reaches ${target} kg around ` +
        `${prettyDate(arrivesOn)}.`
      : null,
  };
}

/** Whole days from a to b. Negative when b is before a. */
export function daysBetween(a: string, b: string): number {
  const ms = Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z");
  if (!Number.isFinite(ms)) return 0;
  return Math.round(ms / 86_400_000);
}

export function prettyDate(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

/** Where each number came from, so the UI can say so honestly. */
export interface TargetBasis {
  bmr: "formula" | "manual";
  kcal: "goal" | "manual" | "plan";
  protein: "formula" | "manual";
  burn: "formula" | "manual";
  minutes: "formula" | "manual";
}

export interface DerivedTargets {
  bmr: number;
  tdee: number;
  kcalTarget: number;
  proteinTarget: number;
  /** Expected daily burn from deliberate exercise. */
  burnTarget: number;
  /** How long that burn takes at a moderate effort. Zero when unknown. */
  minutesTarget: number;
  /**
   * Split out of the calorie target by goal, or typed in by hand. Tracked and
   * shown, but not scored — the score prices calories and protein, and adding
   * two more lines for the same food twice over would just be double counting.
   */
  carbsTarget: number;
  fatTarget: number;
  fiberTarget: number;
  bmi: number | null;
  plan: WeightPlan | null;
  basis: TargetBasis;
}

/**
 * Exercise burn expected in a day, as a share of maintenance.
 *
 * Scaling by TDEE is what makes the head-to-head fair: a 95 kg man maintaining
 * on 2900 kcal has to do meaningfully more work than a 55 kg woman on 1700 to
 * earn the same score, which is the whole point of judging people against
 * their own body rather than against each other's raw totals.
 */
const BURN_TARGET_SHARE_OF_TDEE = 0.15;
const MIN_BURN_TARGET = 200;

/**
 * The intensity active minutes are costed at — brisk walking, light cardio,
 * a gym session that is not all rest between sets.
 */
const MODERATE_MET = 5;
const MINUTES_RANGE = { min: 25, max: 90 } as const;

/**
 * How long your own burn target takes at a moderate effort.
 *
 * This lands near an hour for most people, and the reason is worth stating:
 * a heavier body burns proportionally more per minute, and its burn target is
 * proportionally larger, so the two scale together and largely cancel. What
 * does move it is the part that is genuinely yours — activity level, goal, or
 * a burn target you set by hand.
 */
export function activeMinutesTarget(burnTarget: number, weightKg: number | null): number {
  const weight = Number(weightKg);
  if (!(burnTarget > 0) || !(weight > 0)) return 0;
  const kcalPerMinute = burnKcal(MODERATE_MET, 1, weight);
  if (!(kcalPerMinute > 0)) return 0;
  return Math.round(clamp(burnTarget / kcalPerMinute, MINUTES_RANGE.min, MINUTES_RANGE.max));
}

const positive = (v: number | null | undefined): number | null => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/**
 * Every daily number this person is measured against.
 *
 * Precedence, highest first:
 *   1. what they typed in by hand
 *   2. what their weight-and-date plan needs
 *   3. the preset for their stated goal
 *
 * A manual BMR replaces Mifflin–St Jeor entirely, which is the point of
 * offering it: someone with a real metabolic-cart or DEXA number knows their
 * resting burn better than an equation fitted to a population does.
 */
export function deriveTargets(p: Profile, today?: string): DerivedTargets | null {
  const age = ageFrom(p.birth_date);
  const manualBmr = positive(p.bmr_override);
  const weight = positive(p.weight_kg);

  const formulaBmr =
    p.sex && weight && p.height_cm && age !== null
      ? bmr({ sex: p.sex, weightKg: weight, heightCm: p.height_cm, age })
      : null;

  const b = manualBmr ?? formulaBmr;
  // Without a resting burn there is nothing to scale, and a manual protein
  // target alone is not enough to score a day fairly.
  if (!b || !weight) return null;

  const tdee = Math.round(b * ACTIVITY_FACTOR[p.activity_level]);
  const plan = weightPlan(p, today ?? localDate(p.timezone), tdee, b);

  const manualKcal = positive(p.kcal_target_override);
  const kcalTarget = manualKcal
    ? Math.round(manualKcal)
    : plan
      ? Math.max(1200, Math.round(tdee + plan.dailyDelta))
      : Math.max(1200, Math.round(tdee + GOAL_KCAL_DELTA[p.goal]));

  const manualProtein = positive(p.protein_target_g);
  const manualBurn = positive(p.burn_target_override);
  const manualMinutes = positive(p.minutes_target_override);

  const proteinTarget = manualProtein
    ? Math.round(manualProtein)
    : Math.round(weight * GOAL_PROTEIN_PER_KG[p.goal]);

  // Fat, then carbs from what is left. Both follow the calorie target, so a
  // weight plan or a manual calorie figure moves them with it.
  const fatFromShare = (kcalTarget * GOAL_FAT_SHARE[p.goal]) / 9;
  const fatTarget = positive(p.fat_target_g)
    ?? Math.round(Math.max(fatFromShare, weight * MIN_FAT_PER_KG));

  const carbKcal = kcalTarget - proteinTarget * 4 - fatTarget * 9;
  const carbsTarget = positive(p.carbs_target_g) ?? Math.max(0, Math.round(carbKcal / 4));

  const fiberTarget = positive(p.fiber_target_g)
    ?? clamp(
      Math.round((kcalTarget / 1000) * FIBER_PER_1000_KCAL),
      FIBER_RANGE.min,
      FIBER_RANGE.max,
    );

  const burnTarget = manualBurn
    ? Math.round(manualBurn)
    : Math.max(MIN_BURN_TARGET, Math.round(tdee * BURN_TARGET_SHARE_OF_TDEE));

  return {
    bmr: Math.round(b),
    tdee,
    kcalTarget,
    proteinTarget,
    burnTarget,
    minutesTarget: manualMinutes
      ? Math.round(manualMinutes)
      : activeMinutesTarget(burnTarget, weight),
    carbsTarget,
    fatTarget,
    fiberTarget,
    bmi: bmi(p.height_cm, weight),
    plan,
    basis: {
      bmr: manualBmr ? "manual" : "formula",
      kcal: manualKcal ? "manual" : plan ? "plan" : "goal",
      protein: manualProtein ? "manual" : "formula",
      burn: manualBurn ? "manual" : "formula",
      minutes: manualMinutes ? "manual" : "formula",
    },
  };
}

/**
 * The three numbers a rival is allowed to see, ready to write to the
 * profile's published columns.
 *
 * Keeping this next to deriveTargets is the point: the formula exists once,
 * in TypeScript, and the database stores its output rather than reimplementing
 * it. See the v8 note in supabase/schema.sql.
 */
export interface PublishedTargets {
  target_kcal: number | null;
  target_protein_g: number | null;
  target_burn_kcal: number | null;
  target_active_minutes: number | null;
}

export function publishedTargets(p: Profile, today?: string): PublishedTargets {
  const t = deriveTargets(p, today);
  if (!t) {
    return {
      target_kcal: null, target_protein_g: null,
      target_burn_kcal: null, target_active_minutes: null,
    };
  }
  return {
    target_kcal: t.kcalTarget,
    target_protein_g: t.proteinTarget,
    target_burn_kcal: t.burnTarget,
    target_active_minutes: t.minutesTarget || null,
  };
}

export function publishedTargetsMatch(p: Profile, published: PublishedTargets): boolean {
  return (
    p.target_kcal === published.target_kcal &&
    p.target_protein_g === published.target_protein_g &&
    p.target_burn_kcal === published.target_burn_kcal &&
    p.target_active_minutes === published.target_active_minutes
  );
}

/**
 * A competitor's targets, read from their card rather than derived.
 *
 * Their body never reaches this process, so there is nothing to derive from —
 * which is the intended shape, not a limitation. Null when they have not been
 * through onboarding, in which case they fall back to raw scoring exactly as
 * an incomplete profile always has.
 */
export function cardTargets(card: PlayerCard): DerivedTargets | null {
  const kcal = positive(card.target_kcal);
  const protein = positive(card.target_protein_g);
  const burn = positive(card.target_burn_kcal);
  if (!kcal || !protein || !burn) return null;

  return {
    bmr: 0,
    tdee: 0,
    kcalTarget: kcal,
    proteinTarget: protein,
    burnTarget: burn,
    // Published alongside the others, so a rival's minutes line is scored
    // against their target rather than a flat hour. Older cards have none,
    // and that line falls back to absolute scoring for them.
    minutesTarget: positive(card.target_active_minutes) ?? 0,
    // A competitor's macro split is not published and cannot be derived from a
    // card, so there is nothing honest to put here. Nothing reads it either:
    // the split is shown only on your own screens.
    carbsTarget: 0,
    fatTarget: 0,
    fiberTarget: 0,
    bmi: null,
    plan: null,
    basis: { bmr: "formula", kcal: "goal", protein: "formula", burn: "formula", minutes: "formula" },
  };
}

/**
 * The standard MET formula:  kcal/min = MET × 3.5 × kg / 200
 *
 * We compute burn here rather than letting the model guess it, so the same
 * workout always yields the same number and heavier people correctly burn
 * more for identical work.
 */
export function burnKcal(met: number, minutes: number, bodyWeightKg: number): number {
  if (!(met > 0) || !(minutes > 0) || !(bodyWeightKg > 0)) return 0;
  return Math.round((met * 3.5 * bodyWeightKg) / 200 * minutes);
}

/** Recompute every exercise's kcal from MET + minutes + bodyweight. */
export function priceExercises(exercises: Exercise[], bodyWeightKg: number): Exercise[] {
  return exercises.map((e) => ({
    ...e,
    met: clamp(e.met, 1, 23),
    minutes: clamp(e.minutes, 0, 600),
    kcal: burnKcal(clamp(e.met, 1, 23), clamp(e.minutes, 0, 600), bodyWeightKg),
  }));
}

export function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

/** Today's date in a given IANA timezone, as YYYY-MM-DD. */
export function localDate(timezone = "Asia/Kolkata", d = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/** Current hour (0–23) in a timezone — used to guess the meal slot. */
export function localHour(timezone = "Asia/Kolkata", d = new Date()): number {
  return Number(
    new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", hour12: false }).format(d),
  );
}

export function guessMealSlot(hour: number): "breakfast" | "lunch" | "dinner" | "snack" {
  if (hour >= 4 && hour < 11) return "breakfast";
  if (hour >= 11 && hour < 16) return "lunch";
  if (hour >= 18 && hour < 23) return "dinner";
  return "snack";
}

export function addDays(isoDate: string, days: number): string {
  const d = new Date(isoDate + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function dateRange(from: string, to: string): string[] {
  const out: string[] = [];
  let cur = from;
  let guard = 0;
  while (cur <= to && guard++ < 400) {
    out.push(cur);
    cur = addDays(cur, 1);
  }
  return out;
}

/* =====================================================================
 * Micronutrient reference values.
 *
 * Indian (ICMR-2020) RDAs where they differ meaningfully from Western
 * figures — iron and zinc especially, which ICMR sets considerably higher.
 * `limit` entries are ceilings to stay under; `aim` entries are floors.
 * ===================================================================== */

import type { Micros, MonthlyGoal, Sex as SexT } from "./types.ts";

/**
 * Reference bodyweights the ICMR-2020 RDAs are set for. The per-kg nutrients
 * below are stated for these bodies, so a 95 kg man needs proportionally more
 * than the table says and a 48 kg woman needs less.
 */
/**
 * Reference bodyweights the ICMR-2020 RDAs are set for. The per-kg nutrients
 * below are stated for these bodies, so a 95 kg man needs proportionally more
 * than the table says and a 48 kg woman needs less.
 */
export const REFERENCE_WEIGHT_KG = { male: 65, female: 55 } as const;

/** The intake the flat reference figures are quoted at. */
export const REFERENCE_KCAL = 2000;

/* ---------------------------------------------------------------------
 * Every micronutrient responds to the person. None of them is a flat
 * number any more.
 *
 * Three things can move a target, and each nutrient blends them with its
 * own strength rather than picking one:
 *
 *   perKg      how much of the requirement tracks body size. 1.0 is fully
 *              proportional (iron, zinc and magnesium are all derived from
 *              bodyweight in the source tables); 0.2 is a gentle nudge.
 *   perEnergy  how much it tracks the calories you actually eat. B-vitamins
 *              are cofactors in energy metabolism, and the ceilings on
 *              added sugar and saturated fat are literally "10% of energy".
 *   perSweat   what you lost training today, added per kcal burned.
 *
 * The coefficients are deliberately not all 1.0. Iron scaling with body
 * mass rests on much firmer ground than vitamin D doing so, and B12 is
 * genuinely close to fixed — absorption, not body size, is what limits it.
 * Encoding that as a small coefficient and a tight clamp is more honest
 * than either pretending the evidence is equally strong everywhere or
 * leaving those nutrients frozen at a reference adult's figure.
 * ------------------------------------------------------------------- */

export interface MicroRef {
  key: keyof Micros;
  label: string;
  unit: string;
  mode: "aim" | "limit";
  /** The reference figure: reference body, 2,000 kcal, no training. */
  male: number;
  female: number;
  /** If set, the target IS this share of energy and nothing else applies. */
  energyShare?: number;
  /** kcal per gram, to turn that share into grams. */
  kcalPerGram?: number;
  /** 0–1: how strongly the requirement tracks bodyweight. */
  perKg: number;
  /** 0–1: how strongly it tracks what you eat. */
  perEnergy: number;
  /** Added per kcal of exercise burn. */
  perSweat: number;
  /** Cap on the training add-on. */
  maxSweatAdd: number;
  /** Bounds on the combined multiplier, before the sweat add-on. */
  range: { min: number; max: number };
  /** A short reason, shown when the value is off — this is what makes it useful. */
  why: string;
  /** What moves this one, in a few words, for the panel. */
  moves: string;
}

export const MICRO_REFS: MicroRef[] = [
  { key: "iron_mg", label: "Iron", unit: "mg", mode: "aim", male: 19, female: 29,
    perKg: 1.0, perEnergy: 0, perSweat: 0.0005, maxSweatAdd: 3,
    range: { min: 0.7, max: 1.6 },
    why: "Carries oxygen to working muscle",
    moves: "your bodyweight, and a little for what you sweat out" },

  { key: "calcium_mg", label: "Calcium", unit: "mg", mode: "aim", male: 1000, female: 1000,
    perKg: 0.5, perEnergy: 0, perSweat: 0.15, maxSweatAdd: 200,
    range: { min: 0.85, max: 1.3 },
    why: "Bone load tolerance under training",
    moves: "your frame, plus sweat losses on a training day" },

  { key: "potassium_mg", label: "Potassium", unit: "mg", mode: "aim", male: 3500, female: 3500,
    perKg: 0.4, perEnergy: 0.2, perSweat: 0.45, maxSweatAdd: 900,
    range: { min: 0.85, max: 1.35 },
    why: "Offsets sodium, helps cramping",
    moves: "mostly what you sweat out" },

  { key: "magnesium_mg", label: "Magnesium", unit: "mg", mode: "aim", male: 440, female: 370,
    perKg: 1.0, perEnergy: 0, perSweat: 0.002, maxSweatAdd: 60,
    range: { min: 0.7, max: 1.6 },
    why: "Muscle relaxation and sleep quality",
    moves: "your bodyweight and your training" },

  { key: "zinc_mg", label: "Zinc", unit: "mg", mode: "aim", male: 17, female: 13.2,
    perKg: 1.0, perEnergy: 0, perSweat: 0.0008, maxSweatAdd: 4,
    range: { min: 0.7, max: 1.6 },
    why: "Recovery and immune function",
    moves: "your bodyweight and your training" },

  { key: "vitamin_c_mg", label: "Vitamin C", unit: "mg", mode: "aim", male: 80, female: 65,
    perKg: 0.3, perEnergy: 0.15, perSweat: 0.03, maxSweatAdd: 45,
    range: { min: 0.85, max: 1.3 },
    why: "Iron absorption, connective tissue",
    moves: "training load, which raises oxidative stress" },

  { key: "vitamin_d_ug", label: "Vitamin D", unit: "µg", mode: "aim", male: 15, female: 15,
    perKg: 0.6, perEnergy: 0, perSweat: 0, maxSweatAdd: 0,
    range: { min: 0.85, max: 1.4 },
    why: "Widely low in India; strength and mood",
    moves: "your size — a bigger body distributes the same dose more thinly" },

  { key: "vitamin_b12_ug", label: "Vitamin B12", unit: "µg", mode: "aim", male: 2.4, female: 2.4,
    perKg: 0.2, perEnergy: 0.2, perSweat: 0, maxSweatAdd: 0,
    range: { min: 0.9, max: 1.25 },
    why: "Easy to miss on a vegetarian diet",
    moves: "gently with your size and intake — absorption is the real limit" },

  { key: "folate_ug", label: "Folate", unit: "µg", mode: "aim", male: 300, female: 300,
    perKg: 0.3, perEnergy: 0.5, perSweat: 0, maxSweatAdd: 0,
    range: { min: 0.85, max: 1.4 },
    why: "Red blood cell production",
    moves: "your energy throughput and cell turnover" },

  { key: "sodium_mg", label: "Sodium", unit: "mg", mode: "limit", male: 2300, female: 2300,
    perKg: 0.2, perEnergy: 0, perSweat: 0.6, maxSweatAdd: 1200,
    range: { min: 0.9, max: 1.2 },
    why: "Indian cooking runs salty",
    moves: "what you sweat out — a hard session earns you more" },

  { key: "sugar_g", label: "Added sugar", unit: "g", mode: "limit", male: 50, female: 50,
    energyShare: 0.10, kcalPerGram: 4,
    perKg: 0, perEnergy: 1, perSweat: 0, maxSweatAdd: 0,
    range: { min: 0, max: 10 },
    why: "Cheap calories that crowd out protein",
    moves: "10% of your calorie target" },

  { key: "satfat_g", label: "Saturated fat", unit: "g", mode: "limit", male: 22, female: 22,
    energyShare: 0.10, kcalPerGram: 9,
    perKg: 0, perEnergy: 1, perSweat: 0, maxSweatAdd: 0,
    range: { min: 0, max: 10 },
    why: "Ghee and fried food add up fast",
    moves: "10% of your calorie target" },
];

/**
 * What today asks of this person, for scaling the reference values.
 *
 * Optional everywhere it is used: without it every nutrient falls back to the
 * flat reference figure, which is the old behaviour and still better than
 * nothing for a half-filled profile.
 */
export interface MicroContext {
  /** The calorie target the day is actually being scored against. */
  kcalTarget: number;
  weightKg: number | null;
  /** Calories burned training today. */
  exerciseKcal: number;
}

export function microTarget(ref: MicroRef, sex: SexT | null, ctx?: MicroContext): number {
  const base = sex === "female" ? ref.female : ref.male;
  if (!ctx) return base;

  // A ceiling that IS a share of energy is computed, not scaled.
  if (ref.energyShare && ref.kcalPerGram && ctx.kcalTarget > 0) {
    return Math.round((ctx.kcalTarget * ref.energyShare) / ref.kcalPerGram);
  }

  const weight = Number(ctx.weightKg);
  const reference = REFERENCE_WEIGHT_KG[sex === "female" ? "female" : "male"];
  const bodyRatio = weight > 0 ? weight / reference : 1;
  const energyRatio = ctx.kcalTarget > 0 ? ctx.kcalTarget / REFERENCE_KCAL : 1;

  // Each factor pulls the multiplier away from 1 by its own strength.
  const multiplier = clamp(
    (1 + ref.perKg * (bodyRatio - 1)) * (1 + ref.perEnergy * (energyRatio - 1)),
    ref.range.min,
    ref.range.max,
  );

  const burned = Math.max(0, Number(ctx.exerciseKcal) || 0);
  const sweat = Math.min(ref.maxSweatAdd, burned * ref.perSweat);

  const target = base * multiplier + sweat;
  // Small-magnitude nutrients keep a decimal — zinc's 13.2 mg and B12's
  // 2.4 µg lose real precision when rounded whole. Larger ones read better
  // as round numbers.
  return base < 20 ? Math.round(target * 10) / 10 : Math.round(target);
}

/** 0–1 progress toward an "aim", or fraction of a "limit" consumed. */
export function microRatio(
  value: number, ref: MicroRef, sex: SexT | null, ctx?: MicroContext,
): number {
  const target = microTarget(ref, sex, ctx);
  return target > 0 ? value / target : 0;
}

export type MicroVerdict = "low" | "good" | "over";

export function microVerdict(
  value: number, ref: MicroRef, sex: SexT | null, ctx?: MicroContext,
): MicroVerdict {
  const r = microRatio(value, ref, sex, ctx);
  if (ref.mode === "limit") return r > 1 ? "over" : "good";
  if (r < 0.6) return "low";
  return "good";
}

/* =====================================================================
 * Goals steer the targets.
 *
 * A monthly goal is a statement of intent, so where one overlaps a derived
 * target it wins: if you have said you want 150 g of protein a day, that is
 * what you should be scored against, not the 1.8 g/kg the formula produced.
 * Goals that do not map onto a daily number (workout days, average score,
 * free-text promises) steer the coach instead — see /api/coach.
 * ===================================================================== */

export interface GoalLike {
  metric: MonthlyGoal["metric"];
  target_value: number | null;
  done?: boolean;
}

export interface TargetSource {
  protein: "profile" | "goal";
  burn: "profile" | "goal";
  kcal: "profile" | "goal";
}

export interface GoalAdjustedTargets extends DerivedTargets {
  source: TargetSource;
}

export function applyGoalsToTargets(
  base: DerivedTargets,
  goals: GoalLike[],
  daysInMonth = 30,
): GoalAdjustedTargets {
  const out: GoalAdjustedTargets = {
    ...base,
    source: { protein: "profile", burn: "profile", kcal: "profile" },
  };

  for (const goal of goals) {
    const value = Number(goal.target_value);
    if (!Number.isFinite(value) || value <= 0) continue;

    switch (goal.metric) {
      case "avg_protein_g":
        out.proteinTarget = Math.round(value);
        out.source.protein = "goal";
        break;

      case "total_kcal_burned":
        // A month-long total only means anything per day.
        out.burnTarget = Math.max(100, Math.round(value / Math.max(1, daysInMonth)));
        out.source.burn = "goal";
        break;

      // weight_kg used to nudge the calorie aim here, guessing a direction
      // from the gap to today's weight. The profile now carries a real plan —
      // a target weight AND a date — which produces an exact daily number in
      // deriveTargets(), so this had nothing left to add and needed a
      // competitor's bodyweight to compute, which is no longer knowable.
      //
      // workout_days, avg_score and custom have no daily equivalent; they are
      // passed to the coach as intent instead.
      default:
        break;
    }
  }

  return out;
}

/**
 * Both layers at once: what the body (or the manual override) says, then what
 * a stated monthly goal overrides.
 *
 * Everyone goes through this — me from my full profile, a competitor from
 * their published card — so the same day scores identically on both our
 * screens.
 */
export function scoreTargetsFrom(
  base: DerivedTargets | null,
  goals: GoalLike[],
  daysInMonth: number,
): { burnTarget: number; proteinTarget: number; kcalTarget: number; minutesTarget: number } | null {
  if (!base) return null;
  const t = applyGoalsToTargets(base, goals, daysInMonth);
  return {
    burnTarget: t.burnTarget,
    proteinTarget: t.proteinTarget,
    kcalTarget: t.kcalTarget,
    minutesTarget: t.minutesTarget,
  };
}

export function daysInMonthOf(isoDate: string): number {
  const d = new Date(isoDate + "T00:00:00Z");
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
}
