import { ACTIVITY_FACTOR, prettyDate, type GoalAdjustedTargets, type WeightPlan } from "@/lib/calc";
import type { ActivityLevel, Goal, Profile } from "@/lib/types";

const GOAL_WORD: Record<Goal, string> = {
  cut: "lose fat",
  maintain: "hold steady",
  bulk: "build muscle",
};

const fmt = (n: number) => n.toLocaleString("en-GB");

const signed = (n: number) => (n === 0 ? "±0" : `${n > 0 ? "+" : "−"}${fmt(Math.abs(n))}`);

const activityWord = (level: ActivityLevel) => {
  const words = level.replace("_", " ");
  return words[0].toUpperCase() + words.slice(1);
};

/** Where a number came from, in the words a tile can afford. */
const origin = (from: "goal" | "manual" | "formula", otherwise: string) =>
  from === "goal" ? "from this month's goal" : from === "manual" ? "set by you" : otherwise;

/**
 * The numbers your score is measured against, as tiles.
 *
 * Laid out in the order they are derived, so reading across and down is
 * reading the calculation: resting burn, times activity, is maintenance;
 * training is asked for on top of it; intake is maintenance moved by the
 * weight plan; protein is set per kilo. The weight goal sits above the lot
 * because it is what moves most of them.
 *
 * Every tile says where its number came from. A resting burn typed in from a
 * metabolic test and one an equation produced deserve different trust, and a
 * monthly goal quietly overriding the formula should never be a surprise.
 *
 * Values arrive goal-adjusted — the same applyGoalsToTargets() the score runs
 * — so no tile can disagree with a scored line.
 */
export default function TargetKpis({
  targets: t,
  profile,
}: {
  targets: GoalAdjustedTargets;
  profile: Profile;
}) {
  const weight = Number(profile.weight_kg);
  const delta = t.kcalTarget - t.tdee;
  const perKg = weight > 0 ? (t.proteinTarget / weight).toFixed(1) : null;

  const eat =
    t.basis.kcal === "manual"
      ? "set by you"
      : t.plan
        ? `${signed(delta)} a day to reach ${t.plan.targetKg} kg`
        : delta === 0
          ? "maintenance, to hold steady"
          : `${signed(delta)} vs maintenance, to ${GOAL_WORD[profile.goal]}`;

  const proteinFrom = t.source.protein === "goal" ? "goal" : t.basis.protein;

  return (
    <dl className="grid grid-cols-2 gap-2">
      <WeightGoal plan={t.plan} profile={profile} />

      <Kpi
        label="Resting burn"
        value={fmt(t.bmr)}
        unit="kcal"
        sub={t.basis.bmr === "manual" ? "measured, set by you" : "Mifflin–St Jeor, from your body"}
      />
      <Kpi
        label="Activity"
        value={activityWord(profile.activity_level)}
        sub={`×${ACTIVITY_FACTOR[profile.activity_level]} · ${fmt(t.tdee)} kcal to maintain`}
      />

      <Kpi
        label="Exercise"
        value={t.minutesTarget > 0 ? fmt(t.minutesTarget) : "—"}
        unit="min a day"
        sub={origin(t.basis.minutes, "your burn aim at a moderate pace")}
      />
      <Kpi
        label="Burn"
        value={fmt(t.burnTarget)}
        unit="kcal a day"
        sub={origin(t.source.burn === "goal" ? "goal" : t.basis.burn, "from training")}
      />

      <Kpi label="Eat" value={fmt(t.kcalTarget)} unit="kcal a day" sub={eat} />
      <Kpi
        label="Protein"
        value={fmt(t.proteinTarget)}
        unit="g a day"
        sub={[perKg && `${perKg} g per kg`, proteinFrom !== "formula" && origin(proteinFrom, "")]
          .filter(Boolean)
          .join(" · ")}
      />
    </dl>
  );
}

function WeightGoal({ plan, profile }: { plan: WeightPlan | null; profile: Profile }) {
  const goalKg = Number(profile.weight_goal_kg);
  const preset = GOAL_WORD[profile.goal];

  // weightPlan() returns null for three different reasons, and each deserves
  // its own sentence rather than a blanket "not set".
  let value: string;
  let unit: string | undefined;
  let sub: string;

  if (plan) {
    value = String(plan.targetKg);
    unit = `kg by ${prettyDate(plan.targetDate)}`;
    sub =
      `${plan.kgToGo} kg to ${plan.direction} at ${plan.kgPerWeek} kg a week · ` +
      `${plan.daysLeft} ${plan.daysLeft === 1 ? "day" : "days"} left`;
  } else if (goalKg > 0 && !profile.weight_goal_date) {
    value = String(goalKg);
    unit = "kg, no date";
    sub = `A weight without a date sets no pace, so targets still follow your goal to ${preset}. Add a date below.`;
  } else if (goalKg > 0) {
    value = String(goalKg);
    unit = "kg · reached";
    sub = `Targets are back on your goal to ${preset}. Set a new weight and date below to keep going.`;
  } else {
    value = "Not set";
    sub = `Targets follow your goal to ${preset}. Add a target weight and a date below and every tile recalculates for it.`;
  }

  return (
    <div className="surface col-span-2 px-5 py-4">
      <dt className="eyebrow">Weight goal</dt>
      <dd className="mt-2 flex flex-wrap items-baseline gap-x-1.5">
        <span className="text-[1.7rem] font-semibold leading-none tracking-tight text-white">{value}</span>
        {unit && <span className="text-xs font-medium text-mist-600">{unit}</span>}
      </dd>
      <dd className="mt-2 text-[0.7rem] leading-relaxed text-mist-400">{sub}</dd>
      {plan?.note && (
        <dd className="mt-1.5 text-[0.7rem] leading-relaxed text-gold">{plan.note}</dd>
      )}
    </div>
  );
}

function Kpi({
  label, value, unit, sub,
}: { label: string; value: string; unit?: string; sub: string }) {
  return (
    <div className="surface px-4 py-3.5">
      <dt className="eyebrow">{label}</dt>
      {/* Proportional figures, not tnum: a lone value in a tile aligns with
          nothing, and tabular digits make a number like 111 look gappy. */}
      <dd className="mt-2 flex flex-wrap items-baseline gap-x-1">
        <span className="text-[1.45rem] font-semibold leading-none tracking-tight text-white">{value}</span>
        {unit && <span className="text-[0.62rem] font-medium text-mist-600">{unit}</span>}
      </dd>
      {sub && <dd className="mt-1.5 text-[0.65rem] leading-snug text-mist-600">{sub}</dd>}
    </div>
  );
}
