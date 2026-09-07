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
  created_at: string;
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

export interface FoodLog {
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

export interface DailyTotals {
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
