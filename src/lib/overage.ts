import type { FoodItem, FoodLog, MealSlot } from "./types.ts";
import type { TrackedLimit } from "./limits.ts";

/* =====================================================================
 * What pushed a limit over, and the least that would have kept you under.
 *
 * The warning at the top of Today says THAT a limit went over. This says
 * which of today's foods did it, biggest first, and the fewest cuts that
 * would have kept you inside it. Arithmetic over what was logged, so it is
 * exact, instant and free — the same reasoning as the protein breakdown in
 * versus.ts.
 *
 * Calories, carbs and fat are recorded on every food item, so the answer
 * names foods. Sodium, sugar and saturated fat are only estimated for a meal
 * as a whole (see FOOD_SCHEMA in gemini.ts), so for those the honest answer
 * names meals. The swap ideas — the one part that needs food knowledge —
 * come from Gemini and fill that gap: it knows the papad was the salty bit.
 * ===================================================================== */

/** Limits whose amount is on every food item, and the field that holds it. */
const PER_ITEM: Record<string, keyof FoodItem> = {
  kcal: "kcal",
  carbs_g: "carbs_g",
  fat_g: "fat_g",
};

/** Limits that exist only as a total for the whole meal. */
const PER_MEAL = new Set(["sodium_mg", "sugar_g", "satfat_g"]);

const SLOT_LABEL: Record<MealSlot, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
  snack: "Snacks",
};
const SLOT_ORDER: MealSlot[] = ["breakfast", "lunch", "dinner", "snack"];

export interface Contributor {
  /** A food, or a meal ("Lunch") when only meal totals exist. */
  name: string;
  /** "2 piece" for a food eaten in one unit; empty for a meal or mixed units. */
  portion: string;
  /** How much of the limit's nutrient it supplied, in the limit's unit. */
  amount: number;
  /** Its part of today's total, 0–1. */
  share: number;
  /** The meals it appeared in. */
  meals: MealSlot[];
  /** For a meal, the foods in it. For a food, just its own name. */
  foods: string[];
}

export interface Cut {
  name: string;
  action: "skip" | "halve";
  /** How much it takes off, in the limit's unit. */
  saves: number;
}

export interface Overage {
  limit: TrackedLimit;
  /** "item" when foods can be named, "meal" when only meals can, "none" for water. */
  granularity: "item" | "meal" | "none";
  contributors: Contributor[];
  /** How far over the limit, in its unit. Zero when only close. */
  overBy: number;
  /** The fewest cuts that get back under. Food-level limits only. */
  cuts: Cut[];
  /** Still over after every proposed cut. Normally zero. */
  stillOver: number;
}

/** Grams keep a decimal; kcal, mg and ml read better whole. */
const tidy = (n: number, unit: string) =>
  unit === "g" ? Math.round(n * 10) / 10 : Math.round(n);

const tidyQty = (n: number) => String(Math.round(n * 100) / 100);

/** Today's foods (or meals) behind one limit, biggest first. */
export function contributorsFor(
  key: string,
  unit: string,
  foods: FoodLog[],
): { granularity: Overage["granularity"]; contributors: Contributor[] } {
  const field = PER_ITEM[key];

  if (field) {
    // Folded by name, so three cups of chai across the day read as one line
    // worth cutting rather than three small ones that each look harmless.
    const folded = new Map<string, {
      name: string;
      qty: number;
      unit: string;
      sameUnit: boolean;
      amount: number;
      meals: Set<MealSlot>;
    }>();

    for (const log of foods) {
      for (const item of log.items ?? []) {
        const amount = Number(item[field]) || 0;
        const name = String(item.name ?? "").trim();
        if (!(amount > 0) || !name) continue;

        const itemUnit = String(item.unit ?? "");
        const prev = folded.get(name.toLowerCase());
        if (!prev) {
          folded.set(name.toLowerCase(), {
            name,
            qty: Number(item.qty) || 0,
            unit: itemUnit,
            sameUnit: true,
            amount,
            meals: new Set([log.meal_slot]),
          });
        } else {
          prev.amount += amount;
          prev.meals.add(log.meal_slot);
          if (prev.unit === itemUnit) prev.qty += Number(item.qty) || 0;
          else prev.sameUnit = false;
        }
      }
    }

    return {
      granularity: "item",
      contributors: rank(
        [...folded.values()].map((f) => ({
          name: f.name,
          portion: f.sameUnit && f.qty > 0 ? `${tidyQty(f.qty)} ${f.unit}`.trim() : "",
          amount: f.amount,
          meals: SLOT_ORDER.filter((s) => f.meals.has(s)),
          foods: [f.name],
        })),
        unit,
      ),
    };
  }

  if (PER_MEAL.has(key)) {
    const bySlot = new Map<MealSlot, { amount: number; foods: string[] }>();

    for (const log of foods) {
      const amount = Number((log as unknown as Record<string, unknown>)[key]) || 0;
      if (!(amount > 0)) continue;

      const slot = bySlot.get(log.meal_slot) ?? { amount: 0, foods: [] };
      slot.amount += amount;
      for (const item of log.items ?? []) {
        const name = String(item.name ?? "").trim();
        if (name && !slot.foods.includes(name)) slot.foods.push(name);
      }
      bySlot.set(log.meal_slot, slot);
    }

    return {
      granularity: "meal",
      contributors: rank(
        [...bySlot.entries()].map(([slot, m]) => ({
          name: SLOT_LABEL[slot],
          portion: "",
          amount: m.amount,
          meals: [slot],
          foods: m.foods,
        })),
        unit,
      ),
    };
  }

  // Water, and anything else with no food behind it.
  return { granularity: "none", contributors: [] };
}

function rank(rows: Omit<Contributor, "share">[], unit: string): Contributor[] {
  const total = rows.reduce((a, r) => a + r.amount, 0);
  return rows
    .map((r) => ({ ...r, amount: tidy(r.amount, unit), share: total > 0 ? r.amount / total : 0 }))
    .sort((a, b) => b.amount - a.amount);
}

/**
 * The fewest changes that would have kept you under, biggest source first.
 *
 * Halving is offered only when half is enough on its own; otherwise the
 * whole food goes and the next one is looked at. People act on "skip the
 * butter chicken" — six foods each trimmed by a fifth is accurate and
 * useless.
 */
export function cutPlan(
  contributors: Contributor[],
  overBy: number,
  unit: string,
): { cuts: Cut[]; stillOver: number } {
  let remaining = overBy;
  const cuts: Cut[] = [];

  for (const c of contributors) {
    if (remaining <= 0) break;
    const half = c.amount / 2;
    if (half >= remaining) {
      cuts.push({ name: c.name, action: "halve", saves: tidy(half, unit) });
      remaining -= half;
    } else {
      cuts.push({ name: c.name, action: "skip", saves: tidy(c.amount, unit) });
      remaining -= c.amount;
    }
  }

  return { cuts, stillOver: Math.max(0, tidy(remaining, unit)) };
}

/** Every warning of the day, with the foods behind it and a way back under. */
export function explainLimits(limits: TrackedLimit[], foods: FoodLog[]): Overage[] {
  return limits.map((limit) => {
    const { granularity, contributors } = contributorsFor(limit.key, limit.unit, foods);
    const overBy = limit.state === "over" ? limit.over : 0;
    const plan = granularity === "item" && overBy > 0
      ? cutPlan(contributors, overBy, limit.unit)
      : { cuts: [], stillOver: overBy };
    return { limit, granularity, contributors, overBy, ...plan };
  });
}

/**
 * The foods behind each limit that went over, as plain text for the swap
 * ideas prompt — and the cache key for those ideas.
 *
 * Food only: names, portions and what each supplied. No limit, no target and
 * no "how far over", because those follow from a body and ai_cache, where
 * this text is stored, is readable by every signed-in user. How much of the
 * overshoot a swap covers is worked out on the page, from numbers that never
 * leave it.
 */
export function swapBrief(overages: Overage[]): string {
  const lines: string[] = [];
  for (const o of overages) {
    if (o.overBy <= 0 || o.granularity === "none" || o.contributors.length === 0) continue;
    lines.push(`${o.limit.key} — ${o.limit.label} (${o.limit.unit}):`);
    for (const c of o.contributors.slice(0, 6)) {
      lines.push(
        o.granularity === "item"
          ? `- ${c.name}${c.portion ? `, ${c.portion}` : ""}: ${c.amount} ${o.limit.unit}`
          : `- ${c.name} as a whole (${c.foods.join(", ")}): ${c.amount} ${o.limit.unit}`,
      );
    }
  }
  return lines.join("\n");
}
