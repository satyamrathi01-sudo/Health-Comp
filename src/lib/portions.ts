import { MICRO_KEYS, type FoodItem, type Micros } from "./types.ts";

/* =====================================================================
 * Re-pricing an edited meal.
 *
 * Quantity is a multiplier over everything a food carries. Change one
 * katori to two and the calories, protein, carbs, fat and fibre all have
 * to follow, or the log quietly holds a doubled portion at a single
 * portion's nutrition — which then feeds the score, the ceilings and the
 * head-to-head as if nothing had changed.
 *
 * The workout side has always re-priced on edit (burn is recomputed from
 * MET, minutes and bodyweight). This is the same rule for food.
 * ===================================================================== */

/** Fields that describe how much you ate, rather than what it was. */
export const SCALES_WITH_QTY = ["kcal", "protein_g", "carbs_g", "fat_g", "fiber_g"] as const;

const round1 = (n: number) => (Number.isFinite(n) ? Math.round(n * 10) / 10 : 0);

/**
 * The item at a new quantity.
 *
 * A zero or missing starting quantity carries no ratio to scale by, so the
 * new figure is taken on its own rather than multiplied by infinity.
 */
export function scaleItemToQty(item: FoodItem, nextQty: number): FoodItem {
  const from = Number(item.qty);
  const to = Number(nextQty);
  if (!(from > 0) || !(to > 0) || to === from) {
    return { ...item, qty: Number.isFinite(to) ? to : item.qty };
  }

  const ratio = to / from;
  const out: FoodItem = { ...item, qty: to };
  for (const key of SCALES_WITH_QTY) {
    out[key] = round1(Number(item[key] ?? 0) * ratio);
  }
  return out;
}

export const mealKcal = (items: FoodItem[]): number =>
  items.reduce((a, i) => a + (Number(i.kcal) || 0), 0);

/**
 * Micronutrients follow the meal's calories.
 *
 * They are stored for the whole meal rather than per item, so there is no
 * breakdown to re-sum when one portion changes — the meal's calorie total is
 * the only handle available. Worth being honest that this is an
 * approximation: doubling the rice lifts the iron that really came from the
 * dal. It is still far closer than the alternative, which is a doubled meal
 * reporting a single portion's micronutrients.
 */
export function rescaleMicros(micros: Micros, fromKcal: number, toKcal: number): Micros {
  if (!(fromKcal > 0) || !(toKcal >= 0) || fromKcal === toKcal) return micros;

  const ratio = toKcal / fromKcal;
  const out = { ...micros };
  for (const key of MICRO_KEYS) out[key] = round1(Number(micros[key] ?? 0) * ratio);
  return out;
}
