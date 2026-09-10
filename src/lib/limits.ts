import { MICRO_REFS, microTarget, type DerivedTargets, type MicroContext } from "./calc.ts";
import { waterCeilingMl, waterTarget } from "./hydration.ts";
import type { DailyTotals, Profile, Sex } from "./types.ts";

/* =====================================================================
 * Ceilings.
 *
 * Everything the app tracks that has an upper bound, checked in one place
 * so a new tracked factor cannot quietly go unwatched. The dashboard puts
 * whatever is over the line at the very top in red: a limit you have
 * already blown is the one number worth interrupting someone for, and it
 * is useless three screens down.
 *
 * Aims (protein, fibre, iron, and the rest of the "eat more of this"
 * family) deliberately do not appear here. Falling short of an aim is
 * ordinary and is already shown against its target; passing a ceiling is
 * an event.
 * ===================================================================== */

/** Fraction of a limit at which it is worth a warning rather than an alarm. */
export const CLOSE_TO_LIMIT = 0.9;

export type LimitState = "over" | "close" | "ok";

export interface TrackedLimit {
  key: string;
  label: string;
  unit: string;
  value: number;
  limit: number;
  /** value / limit */
  pct: number;
  /** How far past, in the factor's own unit. Zero when still inside. */
  over: number;
  state: LimitState;
  why: string;
}

export interface LimitTargets {
  kcalTarget: number;
  /** Derived from the calorie target by goal, or set by hand. Always present. */
  carbsTarget: number;
  fatTarget: number;
  /**
   * A safety ceiling on water, not the daily aim — see waterCeilingMl().
   * Passing the aim is the goal; this only fires well beyond it.
   */
  waterCeilingMl?: number | null;
  /** Scales the per-kg nutrients. Null falls back to the reference body. */
  weightKg?: number | null;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

function row(
  key: string,
  label: string,
  unit: string,
  value: number,
  limit: number,
  why: string,
): TrackedLimit | null {
  if (!(limit > 0)) return null;
  const pct = value / limit;
  return {
    key,
    label,
    unit,
    value: round1(value),
    limit: round1(limit),
    pct,
    over: pct > 1 ? round1(value - limit) : 0,
    state: pct > 1 ? "over" : pct >= CLOSE_TO_LIMIT ? "close" : "ok",
    why,
  };
}

/**
 * Every ceiling this person has today, whether or not they are near it.
 *
 * Calories come first because it is the limit most days are actually lost
 * on, then the manual macro ceilings, then the micronutrients that have a
 * ceiling rather than an aim.
 */
export function trackedLimits(
  totals: DailyTotals | null,
  sex: Sex | null,
  targets: LimitTargets | null,
): TrackedLimit[] {
  const out: (TrackedLimit | null)[] = [];
  const n = (v: number | null | undefined) => Number(v ?? 0);

  if (targets) {
    out.push(
      row("kcal", "Calories", "kcal", n(totals?.kcal_in), targets.kcalTarget,
        "Set from your body and your weight goal"),
    );
    out.push(
      row("carbs_g", "Carbs", "g", n(totals?.carbs_g), targets.carbsTarget,
        "What's left of your calories after protein and fat"),
    );
    out.push(
      row("fat_g", "Fat", "g", n(totals?.fat_g), targets.fatTarget,
        "A set share of your calories for your goal"),
    );
    out.push(
      row("water_ml", "Water", "ml", n(totals?.water_ml), targets.waterCeilingMl ?? 0,
        "Much more than your body needs"),
    );
  }

  // Every ceiling here is scaled to this person and this day: added sugar and
  // saturated fat as a share of the calories they are actually eating, sodium
  // with what they sweated out. A flat gram figure is only ever right for one
  // body on one kind of day.
  const ctx: MicroContext | undefined = targets
    ? {
        kcalTarget: targets.kcalTarget,
        weightKg: targets.weightKg ?? null,
        exerciseKcal: n(totals?.kcal_out),
      }
    : undefined;

  for (const ref of MICRO_REFS.filter((r) => r.mode === "limit")) {
    out.push(
      row(ref.key, ref.label, ref.unit, n(totals?.[ref.key]), microTarget(ref, sex, ctx), ref.why),
    );
  }

  return out.filter((r): r is TrackedLimit => r !== null);
}

/** Only the ones worth putting in front of someone, worst first. */
export function breachedLimits(
  totals: DailyTotals | null,
  sex: Sex | null,
  targets: LimitTargets | null,
): TrackedLimit[] {
  // Nothing consumed, nothing to blow. Without this a zeroed day would report
  // every ceiling as comfortably fine, which is noise rather than news. Water
  // counts here on its own: you can drink far too much without eating at all.
  if (!totals || (totals.meals === 0 && totals.water_ml === 0)) return [];
  return trackedLimits(totals, sex, targets)
    .filter((r) => r.state !== "ok")
    // A day with no food must not report every food ceiling as "close".
    .filter((r) => totals.meals > 0 || r.key === "water_ml")
    .sort((a, b) => b.pct - a.pct);
}

/**
 * Today's warnings for one person, computed the one way every screen uses.
 *
 * The banner on Today, the /limits page and the swap ideas all go through
 * this, so the banner can never flag something the page cannot explain.
 */
export function todaysBreaches(
  totals: DailyTotals | null,
  profile: Pick<Profile, "sex" | "weight_kg" | "water_target_ml">,
  targets: DerivedTargets | null,
): TrackedLimit[] {
  return breachedLimits(totals, profile.sex,
    targets
      ? {
          ...targets,
          weightKg: profile.weight_kg,
          waterCeilingMl: waterCeilingMl(waterTarget(profile, totals)),
        }
      : null);
}
