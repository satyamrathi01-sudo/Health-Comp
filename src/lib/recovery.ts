import type { SleepQuality } from "./types";
import type { ScoreTargets } from "./scoring";

/* =====================================================================
 * Recovery — how ready you are to train hard today.
 *
 * Whoop derives this from heart-rate variability and resting heart rate,
 * measured overnight. We have no wearable, so this is INFERRED from what
 * is actually logged: how you slept, how hard you went yesterday, how many
 * days you have gone without a rest day, and whether you fuelled.
 *
 * That is a genuinely weaker signal than HRV and the UI says so. It is
 * still useful — sleep debt and back-to-back hard days are the two things
 * that most reliably blunt performance — but it is an estimate, not a
 * physiological measurement, and it should never be presented as one.
 *
 * Recovery deliberately does NOT feed the daily score. It describes your
 * state; the score measures your effort. Mixing them would mean a bad
 * night's sleep costs you the day against your rival, which is neither
 * fair nor motivating.
 * ===================================================================== */

export const RECOVERY = {
  /** Sleep dominates: it is the strongest signal we have. */
  weights: { sleep: 0.55, load: 0.3, fuel: 0.15 },
  sleepNeedHours: 8,
  /**
   * Sleep debt is not linear — six hours is far worse than three-quarters of
   * eight. This exponent bends the curve so short nights bite properly.
   */
  sleepCurve: 1.8,
  /**
   * Sleep can veto the whole score. Without this, being fresh and well fed
   * held a four-hour night at "train, but controlled", which is bad advice.
   */
  sleepCeiling: { floor: 0.15, span: 0.85 },
  /** No driver this weak can be called "ready to go hard". */
  weakDriverCeiling: 0.35,
  qualityAdjustment: { poor: -0.12, ok: 0, good: 0.06 } as Record<SleepQuality, number>,
  /** Consecutive training days tolerated before fatigue starts accumulating. */
  restFreeDaysTolerated: 2,
  bands: { high: 67, moderate: 34 },
  defaultBurnTarget: 350,
  defaultKcalTarget: 2000,
} as const;

export type RecoveryBand = "high" | "moderate" | "low";

export interface RecoveryDriver {
  label: string;
  /** 0–1, where 1 is fully recovered on this axis. */
  value: number;
  detail: string;
}

export interface Recovery {
  /** null when sleep has not been logged — the input it leans on most. */
  score: number | null;
  band: RecoveryBand | null;
  drivers: RecoveryDriver[];
  headline: string;
  guidance: string;
}

export interface RecoveryInput {
  sleepHours: number | null;
  sleepQuality: SleepQuality | null;
  /** Yesterday's training, which is what today has to recover from. */
  yesterdayBurn: number;
  yesterdayKcalIn: number;
  yesterdayProtein: number;
  yesterdayLoggedFood: boolean;
  /** Consecutive days trained without a rest day, ending yesterday. */
  consecutiveTrainingDays: number;
  targets: ScoreTargets | null;
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const round1 = (n: number) => Math.round(n * 10) / 10;

export function computeRecovery(input: RecoveryInput): Recovery {
  // Without sleep the estimate would rest almost entirely on training load,
  // which is not enough to be worth showing a number for.
  if (input.sleepHours === null || input.sleepHours <= 0) {
    return {
      score: null,
      band: null,
      drivers: [],
      headline: "Log your sleep",
      guidance: "Recovery is mostly about how you slept, so it needs last night's hours.",
    };
  }

  const burnTarget = input.targets?.burnTarget || RECOVERY.defaultBurnTarget;
  const kcalTarget = input.targets?.kcalTarget || RECOVERY.defaultKcalTarget;
  const proteinTarget = input.targets?.proteinTarget || 100;

  /* ---- sleep ---- */
  const sleepBase = clamp01(
    Math.pow(clamp01(input.sleepHours / RECOVERY.sleepNeedHours), RECOVERY.sleepCurve),
  );
  const qualityAdj = input.sleepQuality ? RECOVERY.qualityAdjustment[input.sleepQuality] : 0;
  const sleep = clamp01(sleepBase + qualityAdj);

  /* ---- load: yesterday's strain, plus days without a rest ---- */
  const strain = input.yesterdayBurn / burnTarget;
  const overreach = Math.max(0, strain - 1);
  const restDebt = Math.max(0, input.consecutiveTrainingDays - RECOVERY.restFreeDaysTolerated);
  const load = clamp01(1 - 0.35 * overreach - 0.06 * restDebt);

  /* ---- fuel: you cannot recover from training you did not eat for ---- */
  let fuel: number;
  let fuelDetail: string;
  if (!input.yesterdayLoggedFood) {
    fuel = 0.6;
    fuelDetail = "yesterday's food not logged";
  } else {
    const kcalRatio = input.yesterdayKcalIn / kcalTarget;
    // Under-eating hurts recovery; eating a bit over does not.
    const kcalPart = kcalRatio >= 0.9 ? 1 : clamp01(kcalRatio / 0.9);
    const proteinPart = clamp01(input.yesterdayProtein / proteinTarget);
    fuel = clamp01(0.6 * kcalPart + 0.4 * proteinPart);
    fuelDetail = `${Math.round(input.yesterdayKcalIn)} kcal, ${Math.round(input.yesterdayProtein)} g protein`;
  }

  const weighted =
    100 * (RECOVERY.weights.sleep * sleep + RECOVERY.weights.load * load + RECOVERY.weights.fuel * fuel);

  // Being fresh and fed cannot rescue a night you did not sleep.
  const sleepCap = 100 * (RECOVERY.sleepCeiling.floor + RECOVERY.sleepCeiling.span * sleep);
  const score = Math.round(Math.min(weighted, sleepCap));

  const drivers: RecoveryDriver[] = [
    {
      label: "Sleep",
      value: round1(sleep),
      detail: `${input.sleepHours} h${input.sleepQuality ? `, ${input.sleepQuality}` : ""}`,
    },
    {
      label: "Yesterday's load",
      value: round1(load),
      detail:
        input.yesterdayBurn > 0
          ? `${Math.round(input.yesterdayBurn)} kcal burned${restDebt > 0 ? `, ${input.consecutiveTrainingDays} days straight` : ""}`
          : "rested",
    },
    { label: "Fuelling", value: round1(fuel), detail: fuelDetail },
  ];

  // Name the weakest link rather than giving generic advice.
  const weakest = [...drivers].sort((a, b) => a.value - b.value)[0];

  let band: RecoveryBand =
    score >= RECOVERY.bands.high ? "high" : score >= RECOVERY.bands.moderate ? "moderate" : "low";

  // A collapsed driver disqualifies "go hard" even when the blend looks fine:
  // seven days straight without rest is not a green light.
  if (band === "high" && weakest.value < RECOVERY.weakDriverCeiling) {
    band = "moderate";
  }

  const headline =
    band === "high" ? "Ready to go hard" : band === "moderate" ? "Train, but controlled" : "Back off today";

  const guidance =
    band === "high"
      ? "Good window for a hard session or a personal best."
      : weakest.label === "Sleep"
        ? "Sleep is the limiter. Keep today moderate and get to bed earlier."
        : weakest.label === "Yesterday's load"
          ? "You are carrying fatigue. Something easy today, or take the rest day."
          : "Under-fuelled. Eat properly today before training hard again.";

  return { score, band, drivers, headline, guidance };
}
