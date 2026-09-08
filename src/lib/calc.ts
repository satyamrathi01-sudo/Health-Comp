import type { ActivityLevel, Exercise, Goal, Profile, Sex } from "./types";

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

export interface DerivedTargets {
  bmr: number;
  tdee: number;
  kcalTarget: number;
  proteinTarget: number;
  /** Expected daily burn from deliberate exercise. */
  burnTarget: number;
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
 * Reference numbers for the dashboard. In raw scoring mode these are shown
 * as context ("your maintenance is ~2400") but do not feed the score.
 */
export function deriveTargets(p: Profile): DerivedTargets | null {
  const age = ageFrom(p.birth_date);
  if (!p.sex || !p.weight_kg || !p.height_cm || age === null) return null;

  const b = bmr({ sex: p.sex, weightKg: p.weight_kg, heightCm: p.height_cm, age });
  const tdee = Math.round(b * ACTIVITY_FACTOR[p.activity_level]);
  return {
    bmr: b,
    tdee,
    kcalTarget: Math.max(1200, Math.round(tdee + GOAL_KCAL_DELTA[p.goal])),
    proteinTarget: Math.round(p.weight_kg * GOAL_PROTEIN_PER_KG[p.goal]),
    burnTarget: Math.max(MIN_BURN_TARGET, Math.round(tdee * BURN_TARGET_SHARE_OF_TDEE)),
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

import type { Micros, Sex as SexT } from "./types";

export interface MicroRef {
  key: keyof Micros;
  label: string;
  unit: string;
  mode: "aim" | "limit";
  male: number;
  female: number;
  /** A short reason, shown when the value is off — this is what makes it useful. */
  why: string;
}

export const MICRO_REFS: MicroRef[] = [
  { key: "iron_mg", label: "Iron", unit: "mg", mode: "aim", male: 19, female: 29,
    why: "Carries oxygen to working muscle" },
  { key: "calcium_mg", label: "Calcium", unit: "mg", mode: "aim", male: 1000, female: 1000,
    why: "Bone load tolerance under training" },
  { key: "potassium_mg", label: "Potassium", unit: "mg", mode: "aim", male: 3500, female: 3500,
    why: "Offsets sodium, helps cramping" },
  { key: "magnesium_mg", label: "Magnesium", unit: "mg", mode: "aim", male: 440, female: 370,
    why: "Muscle relaxation and sleep quality" },
  { key: "zinc_mg", label: "Zinc", unit: "mg", mode: "aim", male: 17, female: 13.2,
    why: "Recovery and immune function" },
  { key: "vitamin_c_mg", label: "Vitamin C", unit: "mg", mode: "aim", male: 80, female: 65,
    why: "Iron absorption, connective tissue" },
  { key: "vitamin_d_ug", label: "Vitamin D", unit: "µg", mode: "aim", male: 15, female: 15,
    why: "Widely low in India; strength and mood" },
  { key: "vitamin_b12_ug", label: "Vitamin B12", unit: "µg", mode: "aim", male: 2.4, female: 2.4,
    why: "Easy to miss on a vegetarian diet" },
  { key: "folate_ug", label: "Folate", unit: "µg", mode: "aim", male: 300, female: 300,
    why: "Red blood cell production" },
  { key: "sodium_mg", label: "Sodium", unit: "mg", mode: "limit", male: 2300, female: 2300,
    why: "Indian cooking runs salty" },
  { key: "sugar_g", label: "Added sugar", unit: "g", mode: "limit", male: 50, female: 50,
    why: "Cheap calories that crowd out protein" },
  { key: "satfat_g", label: "Saturated fat", unit: "g", mode: "limit", male: 22, female: 22,
    why: "Ghee and fried food add up fast" },
];

export function microTarget(ref: MicroRef, sex: SexT | null): number {
  return sex === "female" ? ref.female : ref.male;
}

/** 0–1 progress toward an "aim", or fraction of a "limit" consumed. */
export function microRatio(value: number, ref: MicroRef, sex: SexT | null): number {
  const target = microTarget(ref, sex);
  return target > 0 ? value / target : 0;
}

export type MicroVerdict = "low" | "good" | "over";

export function microVerdict(value: number, ref: MicroRef, sex: SexT | null): MicroVerdict {
  const r = microRatio(value, ref, sex);
  if (ref.mode === "limit") return r > 1 ? "over" : "good";
  if (r < 0.6) return "low";
  return "good";
}
