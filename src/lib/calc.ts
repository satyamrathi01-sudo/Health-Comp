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
}

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
