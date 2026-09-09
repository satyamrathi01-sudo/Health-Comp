import { KCAL_PER_KG, type DerivedTargets } from "./calc.ts";
import type { DailyTotals } from "./types.ts";

/* =====================================================================
 * A step forward, or a step back.
 *
 * One cell per day. Did what you ate and what you burned move you toward
 * the weight you said you wanted, or away from it?
 *
 * The arithmetic, once, so the picture cannot lie:
 *
 *   deficit = TDEE − eaten + (burned − burn target)
 *
 * TDEE already contains the exercise the app expects of you — that is what
 * the activity multiplier and the 15%-of-maintenance burn target are for —
 * so only training BEYOND that target counts again. Adding all of today's
 * burn on top would pay you twice for the same run.
 *
 * A positive deficit is progress when you are cutting and a step back when
 * you are bulking, so it is signed toward whatever the plan is before it
 * ever reaches the screen.
 *
 * Days with nothing logged score zero movement rather than being skipped.
 * A blank day genuinely is a blank day: pace is measured against the
 * calendar, not against the days you felt like recording.
 * ===================================================================== */

/** Below this, a day is flat rather than a step in either direction. */
const FLAT_KCAL = 100;

export type StepDirection = "forward" | "back" | "flat";

export interface DayStep {
  date: string;
  logged: boolean;
  /** kcal moved toward the goal. Negative means away from it. */
  kcal: number;
  /** The same, in kg. */
  kg: number;
  direction: StepDirection;
}

export interface PaceReport {
  steps: DayStep[];
  from: string;
  to: string;
  /** Days elapsed in the window, including today. */
  daysElapsed: number;
  forwardDays: number;
  backDays: number;
  /** kg moved toward the goal so far, from what was logged. */
  achievedKg: number;
  /** kg the plan says you should have moved by now. */
  expectedKg: number;
  /** The whole journey the plan describes, start weight to target. */
  totalKg: number;
  /** achieved − expected. Positive is ahead. */
  aheadKg: number;
  /** kg/day the plan asks for. */
  paceKgPerDay: number;
  direction: "lose" | "gain" | "hold";
  /** True when this is following a real weight-and-date plan. */
  hasPlan: boolean;
  headline: string;
  detail: string;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * How much this day moved you, in kcal, signed toward the goal.
 * Exported so the same number can be shown on a single day's card.
 */
export function dayMovement(
  totals: DailyTotals | null,
  targets: DerivedTargets,
  direction: "lose" | "gain" | "hold",
): number {
  const eaten = Number(totals?.kcal_in ?? 0);
  const burned = Number(totals?.kcal_out ?? 0);
  const deficit = targets.tdee - eaten + (burned - targets.burnTarget);

  if (direction === "gain") return -deficit;
  if (direction === "hold") return -Math.abs(deficit);
  return deficit;
}

export interface PaceInput {
  days: string[];
  totals: Map<string, DailyTotals>;
  targets: DerivedTargets;
  today: string;
  /** How far back to look when there is no dated plan. */
  fallbackWindowDays?: number;
}

export function buildPace(input: PaceInput): PaceReport | null {
  const { targets, today } = input;
  const plan = targets.plan;

  // Which way is "forward"? A plan states it outright; otherwise the daily
  // calorie aim relative to maintenance does.
  const planned = targets.kcalTarget - targets.tdee; // negative = deficit
  const direction: "lose" | "gain" | "hold" = plan
    ? plan.direction
    : planned < -100
      ? "lose"
      : planned > 100
        ? "gain"
        : "hold";

  const windowDays = input.fallbackWindowDays ?? 14;
  const available = input.days.filter((d) => d <= today);
  if (!available.length) return null;

  // A plan is measured from the day it was set; anything else from a
  // rolling two weeks, which is the horizon people actually feel.
  const earliest = available[0];
  const start = plan
    ? [earliest, plan.startedOn].sort().reverse()[0]
    : available[Math.max(0, available.length - windowDays)];

  const window = available.filter((d) => d >= start);
  if (!window.length) return null;

  const steps: DayStep[] = window.map((date) => {
    const t = input.totals.get(date) ?? null;
    const logged = Boolean(t && (t.meals > 0 || t.sessions > 0 || t.is_rest_day));
    const kcal = logged ? Math.round(dayMovement(t, targets, direction)) : 0;
    return {
      date,
      logged,
      kcal,
      kg: round2(kcal / KCAL_PER_KG),
      direction: !logged || Math.abs(kcal) < FLAT_KCAL ? "flat" : kcal > 0 ? "forward" : "back",
    };
  });

  // Converted once from the total rather than summing rounded per-day
  // kilograms, which drifts by a few grams a day across a fortnight.
  const achievedKg = round2(steps.reduce((a, s) => a + s.kcal, 0) / KCAL_PER_KG);

  // The pace the plan asked for on the day it was set — start weight to
  // target, over the whole span. Deliberately NOT "what is left, over the
  // days that remain": that number steepens every time you fall behind, so
  // the marker would chase you and always show you roughly on pace.
  const totalKg = plan ? Math.abs(plan.targetKg - plan.startKg) : 0;
  const paceKgPerDay = plan
    ? round2(totalKg / Math.max(1, plan.daysTotal))
    : round2(Math.abs(planned) / KCAL_PER_KG);

  const daysElapsed = steps.length;
  const expectedKg = round2(paceKgPerDay * daysElapsed);
  const aheadKg = round2(achievedKg - expectedKg);

  const forwardDays = steps.filter((s) => s.direction === "forward").length;
  const backDays = steps.filter((s) => s.direction === "back").length;

  return {
    steps,
    from: window[0],
    to: window[window.length - 1],
    daysElapsed,
    forwardDays,
    backDays,
    achievedKg,
    expectedKg,
    totalKg,
    aheadKg,
    paceKgPerDay,
    direction,
    hasPlan: Boolean(plan),
    headline: headline(direction, achievedKg, aheadKg),
    detail: detail(steps, forwardDays, backDays, direction),
  };
}

function headline(
  direction: "lose" | "gain" | "hold",
  achievedKg: number,
  aheadKg: number,
): string {
  const verb = direction === "gain" ? "gained" : "lost";
  if (direction === "hold") {
    // Maintenance has no "forward": movement in either direction is drift.
    return Math.abs(achievedKg) < 0.3
      ? "Holding steady"
      : `Drifting by ${Math.abs(achievedKg)} kg`;
  }
  if (achievedKg <= 0) {
    return `No ground ${verb} yet`;
  }
  const pace =
    Math.abs(aheadKg) < 0.1
      ? "bang on pace"
      : aheadKg > 0
        ? `${aheadKg} kg ahead of pace`
        : `${Math.abs(aheadKg)} kg behind pace`;
  return `${achievedKg} kg ${verb} — ${pace}`;
}

function detail(
  steps: DayStep[],
  forwardDays: number,
  backDays: number,
  direction: "lose" | "gain" | "hold",
): string {
  const unlogged = steps.filter((s) => !s.logged).length;
  const logged = steps.length - unlogged;

  if (direction === "hold") {
    const parts = [`${logged - backDays} held`, `${backDays} drifted`];
    if (unlogged) parts.push(`${unlogged} not logged`);
    return `${parts.join(" · ")} — a step appears on any day you landed more than ` +
      `${FLAT_KCAL} kcal either side of maintenance.`;
  }

  const parts = [`${forwardDays} forward`, `${backDays} back`];
  if (unlogged) parts.push(`${unlogged} not logged`);
  const goal = direction === "gain" ? "surplus" : "deficit";
  return `${parts.join(" · ")} — each step is that day's ${goal} against what you ate and burned.`;
}
