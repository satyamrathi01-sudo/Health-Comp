import type { DailyTotals, MonthlyGoal } from "./types.ts";

/* =====================================================================
 * How far along a monthly goal actually is.
 *
 * Shared by the Goals board and the dashboard's own-progress panel, so the
 * same goal can never read 12 of 20 on one screen and 14 of 20 on another.
 * ===================================================================== */

export interface GoalProgressInput {
  metric: MonthlyGoal["metric"];
  totals: DailyTotals[];
  /** Daily scores for the same days, already filtered to logged ones. */
  scores: number[];
  /** Latest weigh-in. Null for anyone but yourself — weight is private. */
  latestWeight: number | null;
}

/** The value achieved so far, or null when the metric has no number. */
export function goalProgress(input: GoalProgressInput): number | null {
  const withFood = input.totals.filter((t) => t.meals > 0);
  switch (input.metric) {
    case "weight_kg":
      return input.latestWeight;
    case "avg_protein_g":
      return withFood.length
        ? Math.round(withFood.reduce((a, t) => a + t.protein_g, 0) / withFood.length)
        : 0;
    case "total_kcal_burned":
      return Math.round(input.totals.reduce((a, t) => a + t.kcal_out, 0));
    case "workout_days":
      return input.totals.filter((t) => t.sessions > 0).length;
    case "avg_score":
      return input.scores.length
        ? Math.round((input.scores.reduce((a, s) => a + s, 0) / input.scores.length) * 10) / 10
        : 0;
    default:
      return null;
  }
}

export const GOAL_UNITS: Record<MonthlyGoal["metric"], string> = {
  weight_kg: "kg",
  avg_protein_g: "g/day",
  total_kcal_burned: "kcal",
  workout_days: "days",
  avg_score: "pts",
  custom: "",
};

/** 0–1, or null when the goal carries no target to measure against. */
export function goalFraction(goal: MonthlyGoal, achieved: number | null): number | null {
  if (goal.target_value === null || achieved === null) return null;
  const target = Number(goal.target_value);
  if (!(target > 0)) return null;
  return Math.max(0, Math.min(1, achieved / target));
}
