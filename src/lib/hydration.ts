import type { DailyTotals, Profile } from "./types.ts";

/* =====================================================================
 * Water.
 *
 * Two numbers rather than one. "How much should I drink today" is a
 * function of the body doing the drinking and the training it did — the
 * same logic the rest of the app uses, so a 95 kg man who ran is not held
 * to the same litre as a 55 kg woman who rested.
 *
 * "How am I doing" is a function of the clock as well. Two litres by nine
 * in the morning and two litres by eleven at night are not the same day,
 * and a bare percentage cannot tell them apart. Everything here is paced
 * against the waking hours you have actually used up.
 *
 * Deliberately UNSCORED, like sleep and micronutrients. Adding it to the
 * hundred points would re-score every day anyone ever logged before water
 * existed, marking a year of good days down for missing a field that was
 * not there — see the mode note in scoring.ts.
 * ===================================================================== */

export const HYDRATION = {
  /** Millilitres per kg of bodyweight. The usual 30–35 ml/kg guidance. */
  mlPerKg: 33,
  minTargetMl: 1500,
  maxTargetMl: 4500,
  /**
   * Sweat replacement: roughly a litre for every 700 kcal of exercise.
   * Keyed on burn rather than minutes because burn already carries
   * bodyweight and intensity — an hour is not an hour here.
   */
  mlPerExerciseKcal: 1000 / 700,
  maxExerciseAddMl: 1500,
  /** The window people actually drink in, in local hours. */
  wakingStart: 7,
  wakingEnd: 23,
  /** Within this fraction of the pace counts as on track. */
  onTrackSlack: 0.1,
  behindSlack: 0.25,
  /**
   * Past this multiple of the target, more is not better. Well clear of a
   * good day so hitting the goal is never scolded; low enough to notice a
   * genuinely excessive one.
   */
  excessMultiple: 1.75,
  /** What one tap adds. */
  quickAddMl: [250, 500, 1000] as const,
  glassMl: 250,
} as const;

export interface WaterTarget {
  /** From bodyweight alone. */
  baseMl: number;
  /** Added for today's training. Zero on a rest day. */
  exerciseMl: number;
  totalMl: number;
  source: "derived" | "manual";
}

const round50 = (n: number) => Math.round(n / 50) * 50;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/**
 * How much to drink today.
 *
 * A manual target is taken exactly as given — including on a training day.
 * Someone who has typed a number has decided; quietly adding half a litre
 * on top of it would make their own setting mean something other than what
 * it says.
 */
export function waterTarget(
  profile: Pick<Profile, "weight_kg" | "water_target_ml">,
  totals: DailyTotals | null,
): WaterTarget {
  const manual = Number(profile.water_target_ml);
  if (Number.isFinite(manual) && manual > 0) {
    const ml = clamp(Math.round(manual), 500, 8000);
    return { baseMl: ml, exerciseMl: 0, totalMl: ml, source: "manual" };
  }

  const weight = Number(profile.weight_kg);
  const baseMl = weight > 0
    ? clamp(round50(weight * HYDRATION.mlPerKg), HYDRATION.minTargetMl, HYDRATION.maxTargetMl)
    : 2000;

  const burned = Number(totals?.kcal_out ?? 0);
  const exerciseMl = burned > 0
    ? Math.min(HYDRATION.maxExerciseAddMl, round50(burned * HYDRATION.mlPerExerciseKcal))
    : 0;

  return {
    baseMl,
    exerciseMl,
    totalMl: Math.min(HYDRATION.maxTargetMl + HYDRATION.maxExerciseAddMl, baseMl + exerciseMl),
    source: "derived",
  };
}

export type HydrationStatus = "low" | "behind" | "on-track" | "ahead" | "met" | "over";

export interface Hydration {
  drankMl: number;
  targetMl: number;
  /** 0–1+, drank over target. The bottle fills on this. */
  fraction: number;
  /** What the pace says you should have had by this hour. */
  expectedMl: number;
  /** drank − expected. Negative is behind. */
  aheadMl: number;
  /** Still to go today, never negative. */
  remainingMl: number;
  glassesLeft: number;
  status: HydrationStatus;
  headline: string;
  guidance: string;
}

/** Share of the drinking day used up by this hour. */
export function dayElapsed(hour: number): number {
  const span = HYDRATION.wakingEnd - HYDRATION.wakingStart;
  return clamp((hour - HYDRATION.wakingStart) / span, 0, 1);
}

export function hydration(drankMl: number, target: WaterTarget, hour: number): Hydration {
  const targetMl = Math.max(1, target.totalMl);
  const drank = Math.max(0, Math.round(drankMl));
  const fraction = drank / targetMl;

  const expectedMl = round50(targetMl * dayElapsed(hour));
  const aheadMl = drank - expectedMl;
  const remainingMl = Math.max(0, targetMl - drank);
  const glassesLeft = Math.ceil(remainingMl / HYDRATION.glassMl);

  const status: HydrationStatus =
    fraction >= HYDRATION.excessMultiple
      ? "over"
      : drank >= targetMl
        ? "met"
        // Slack applies in both directions, so landing exactly on the pace is
        // "on track" rather than "ahead". Being level is the common case and
        // should read as the calm one.
        : aheadMl > targetMl * HYDRATION.onTrackSlack
          ? "ahead"
          : aheadMl >= -targetMl * HYDRATION.onTrackSlack
            ? "on-track"
            : aheadMl >= -targetMl * HYDRATION.behindSlack
              ? "behind"
              : "low";

  return {
    drankMl: drank,
    targetMl,
    fraction,
    expectedMl,
    aheadMl,
    remainingMl,
    glassesLeft,
    status,
    headline: HEADLINE[status],
    guidance: guidanceFor(status, remainingMl, glassesLeft, aheadMl, drank, targetMl),
  };
}

const HEADLINE: Record<HydrationStatus, string> = {
  over: "That's a lot of water",
  met: "Goal reached",
  ahead: "Ahead of schedule",
  "on-track": "On track",
  behind: "A little behind",
  low: "Well behind",
};

function guidanceFor(
  status: HydrationStatus,
  remainingMl: number,
  glassesLeft: number,
  aheadMl: number,
  drank: number,
  targetMl: number,
): string {
  const glasses = `${glassesLeft} glass${glassesLeft === 1 ? "" : "es"}`;

  switch (status) {
    case "over":
      return `${litres(drank)} so far, and your goal was ${litres(targetMl)}. ` +
        `More water won't help past this point.`;
    case "met":
      return remainingMl === 0 && drank > targetMl
        ? `${litres(drank)} so far, ${litres(drank - targetMl)} over your goal.`
        : "Done for today. Keep sipping if you're still training.";
    case "ahead":
      return `${litres(remainingMl)} to go (${glasses}). You're ${litres(aheadMl)} ahead.`;
    case "on-track":
      return `${litres(remainingMl)} to go, about ${glasses}.`;
    case "behind":
      return `${litres(Math.abs(aheadMl))} behind for this time of day. Have a glass now.`;
    case "low":
      return `${litres(Math.abs(aheadMl))} behind, ${litres(remainingMl)} to go. ` +
        `Have a glass now rather than catching up at night.`;
  }
}

/** 1750 -> "1.75 L", 400 -> "400 ml". Small amounts read better in ml. */
export function litres(ml: number): string {
  const v = Math.abs(Math.round(ml));
  if (v < 1000) return `${v} ml`;
  return `${(Math.round(v / 10) / 100).toFixed(2).replace(/\.?0+$/, "")} L`;
}

/**
 * A safety ceiling, not a goal. Only meaningful well past the target — the
 * point is to catch a genuinely excessive day, never to greet someone who
 * hit their aim with a red banner.
 */
export function waterCeilingMl(target: WaterTarget): number {
  return round50(target.totalMl * HYDRATION.excessMultiple);
}
