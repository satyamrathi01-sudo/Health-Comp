export type Sex = "male" | "female";
export type ActivityLevel = "sedentary" | "light" | "moderate" | "active" | "very_active";
export type Goal = "cut" | "maintain" | "bulk";
export type MealSlot = "breakfast" | "lunch" | "dinner" | "snack";
export type Confidence = "low" | "medium" | "high";

export interface Profile {
  id: string;
  display_name: string;
  avatar_emoji: string;
  sex: Sex | null;
  birth_date: string | null;
  height_cm: number | null;
  weight_kg: number | null;
  activity_level: ActivityLevel;
  goal: Goal;
  timezone: string;
  onboarded: boolean;
  active_challenge_id: string | null;
  created_at: string;

  /* --- manual overrides. Null means "work it out for me". --- */
  bmr_override: number | null;
  kcal_target_override: number | null;
  protein_target_g: number | null;
  carbs_target_g: number | null;
  fat_target_g: number | null;
  fiber_target_g: number | null;
  burn_target_override: number | null;
  minutes_target_override: number | null;
  /** Daily water aim in ml. Null derives it from bodyweight and training. */
  water_target_ml: number | null;

  /* --- "I want to be 70 kg by 30 November" --- */
  weight_goal_kg: number | null;
  weight_goal_date: string | null;
  /** Frozen when the plan was set, so pace is measured from where you began. */
  weight_goal_start_kg: number | null;
  weight_goal_set_on: string | null;

  /* --- the published copy of the derived targets --- */
  target_kcal: number | null;
  target_protein_g: number | null;
  target_burn_kcal: number | null;
  target_active_minutes: number | null;
  target_micros: Record<string, number> | null;
}

/**
 * A competitor, as you are allowed to see them.
 *
 * Name, emoji and the three targets their score is judged against — and
 * nothing about their body. This mirrors the `player_cards` view, which is
 * where the line is actually enforced; see the v8 note in schema.sql for why
 * the targets are publishable and the body is not.
 */
export interface PlayerCard {
  id: string;
  display_name: string;
  avatar_emoji: string;
  created_at: string;
  target_kcal: number | null;
  target_protein_g: number | null;
  target_burn_kcal: number | null;
  target_active_minutes: number | null;
  /**
   * Rest-state micronutrient aims, keyed by column name.
   *
   * Published because the micros line is scored, and scoring a rival needs
   * their aims — which depend on sex and weight, neither of which leaves the
   * database. This is the same trade the other targets already make: the aim
   * is published, the body behind it is not.
   */
  target_micros: Record<string, number> | null;
}

/** Every profile is also a valid card — this is the narrowing. */
export function toPlayerCard(p: Profile | PlayerCard): PlayerCard {
  return {
    id: p.id,
    display_name: p.display_name,
    avatar_emoji: p.avatar_emoji,
    created_at: p.created_at,
    target_micros: p.target_micros ?? null,
    target_kcal: p.target_kcal,
    target_protein_g: p.target_protein_g,
    target_burn_kcal: p.target_burn_kcal,
    target_active_minutes: p.target_active_minutes,
  };
}

/**
 * One food, on one day, for one person — summed across every meal it
 * appeared in. The unit the Versus protein breakdown reasons over.
 */
export interface FoodItemRow {
  user_id: string;
  date: string;
  name: string;
  protein_g: number;
  kcal: number;
}

export interface FoodItem {
  name: string;
  qty: number;
  unit: string;
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fiber_g: number;
}

/** Meal-level micronutrient totals. Informational — none of this is scored. */
export interface Micros {
  sodium_mg: number;
  potassium_mg: number;
  calcium_mg: number;
  iron_mg: number;
  magnesium_mg: number;
  zinc_mg: number;
  vitamin_c_mg: number;
  vitamin_d_ug: number;
  vitamin_b12_ug: number;
  folate_ug: number;
  sugar_g: number;
  satfat_g: number;
}

export const MICRO_KEYS: (keyof Micros)[] = [
  "sodium_mg", "potassium_mg", "calcium_mg", "iron_mg", "magnesium_mg", "zinc_mg",
  "vitamin_c_mg", "vitamin_d_ug", "vitamin_b12_ug", "folate_ug", "sugar_g", "satfat_g",
];

export const EMPTY_MICROS: Micros = {
  sodium_mg: 0, potassium_mg: 0, calcium_mg: 0, iron_mg: 0, magnesium_mg: 0, zinc_mg: 0,
  vitamin_c_mg: 0, vitamin_d_ug: 0, vitamin_b12_ug: 0, folate_ug: 0, sugar_g: 0, satfat_g: 0,
};

export interface FoodLog extends Micros {
  id: string;
  user_id: string;
  local_date: string;
  logged_at: string;
  meal_slot: MealSlot;
  raw_text: string;
  items: FoodItem[];
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fiber_g: number;
  confidence: Confidence;
  source: "ai" | "manual" | "edited";
  note: string | null;
}

/** kind drives how burn is computed: `cardio` and `strength` both use MET. */
export type ExerciseKind = "cardio" | "strength" | "sport" | "mobility" | "other";

export interface Exercise {
  name: string;
  kind: ExerciseKind;
  /** Metabolic equivalent of task — the multiplier over resting burn. */
  met: number;
  minutes: number;
  sets?: number | null;
  reps?: number | null;
  weight_kg?: number | null;
  distance_km?: number | null;
  /** Computed in calc.ts from met + minutes + body weight. Never from the LLM. */
  kcal: number;
}

export interface WorkoutLog {
  id: string;
  user_id: string;
  local_date: string;
  logged_at: string;
  raw_text: string;
  exercises: Exercise[];
  minutes: number;
  kcal: number;
  body_weight_kg: number | null;
  confidence: Confidence;
  source: "ai" | "manual" | "edited";
  note: string | null;
}

export type SleepQuality = "poor" | "ok" | "good";

export interface SleepLog {
  user_id: string;
  local_date: string;
  hours: number;
  quality: SleepQuality | null;
  note: string | null;
}

export interface AdvicePoint {
  /** add | reduce | keep | train | rest — drives the icon and tone */
  kind: "add" | "reduce" | "keep" | "train" | "rest";
  text: string;
  /** Which part of the score this would move. */
  component?: "burn" | "protein" | "calories" | "minutes" | "logging" | "sleep" | "water" | "micros" | "none";
  /** Size of the change, in that component's unit. Negative means "less". */
  amount?: number;
  /** Points this would add, computed by the server. */
  points?: number;
}

export interface DailyAdvice {
  user_id: string;
  local_date: string;
  basis_hash: string;
  headline: string | null;
  points: AdvicePoint[];
  created_at: string;
}

export interface DailyTotals extends Micros {
  user_id: string;
  local_date: string;
  kcal_in: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fiber_g: number;
  meals: number;
  kcal_out: number;
  active_minutes: number;
  sessions: number;
  is_rest_day: boolean;
  sleep_hours: number | null;
  sleep_quality: SleepQuality | null;
  water_ml: number;
}

/** A challenge as it appears in the switcher: named by whoever created it. */
export interface ChallengeSummary {
  id: string;
  name: string;
  invite_code: string;
  start_date: string;
  end_date: string;
  created_by: string;
  is_mine: boolean;
  owner_name: string;
  owner_emoji: string;
  member_count: number;
}

export interface Challenge {
  id: string;
  name: string;
  invite_code: string;
  start_date: string;
  end_date: string;
  created_by: string;
  created_at: string;
}

export interface MonthlyGoal {
  id: string;
  user_id: string;
  month: string;
  title: string;
  metric: "weight_kg" | "avg_protein_g" | "total_kcal_burned" | "workout_days" | "avg_score" | "custom";
  target_value: number | null;
  done: boolean;
}

/** A fully-zeroed day. One definition, so widening DailyTotals cannot
 *  silently leave a hand-written literal behind. */
export function emptyDailyTotals(user_id: string, local_date: string): DailyTotals {
  return {
    user_id, local_date,
    kcal_in: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0, meals: 0,
    kcal_out: 0, active_minutes: 0, sessions: 0, is_rest_day: false,
    sleep_hours: null, sleep_quality: null, water_ml: 0,
    ...EMPTY_MICROS,
  };
}
