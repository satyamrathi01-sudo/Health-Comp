import { bmiBand, prettyDate, type DerivedTargets, type WeightPlan } from "@/lib/calc";
import type { ActivityLevel, Goal, Profile } from "@/lib/types";
import { Section } from "./ui";

const GOAL_WORD: Record<Goal, string> = {
  cut: "lose fat",
  maintain: "stay the same",
  bulk: "build muscle",
};

const BMI_WORD = {
  under: "below the healthy range",
  healthy: "in the healthy range",
  over: "above the healthy range",
  obese: "well above the healthy range",
} as const;

const fmt = (n: number) => n.toLocaleString("en-GB");

const signed = (n: number) => (n === 0 ? "±0" : `${n > 0 ? "+" : "−"}${fmt(Math.abs(n))}`);

const activityWord = (level: ActivityLevel) => {
  const words = level.replace("_", " ");
  return words[0].toUpperCase() + words.slice(1);
};

const setByYou = (manual: boolean, otherwise: string) => (manual ? "set by you" : otherwise);

/**
 * Your targets as tiles, grouped the way people think about them: where you
 * are heading, what to do each day, how the calories split, and your body's
 * own numbers.
 *
 * Every tile says in a few words where its number comes from, so a figure you
 * typed in is never mistaken for one the app worked out. They are the same
 * numbers the score uses.
 */
export default function TargetKpis({
  targets: t,
  profile,
  avgSleep,
}: {
  targets: DerivedTargets;
  profile: Profile;
  /** Across the nights logged in the loaded window, or null. */
  avgSleep: number | null;
}) {
  const weight = Number(profile.weight_kg);
  const delta = t.kcalTarget - t.tdee;
  const perKg = weight > 0 ? (t.proteinTarget / weight).toFixed(1) : null;
  const fatShare = t.kcalTarget > 0 ? Math.round(((t.fatTarget * 9) / t.kcalTarget) * 100) : 0;

  const eat =
    t.basis.kcal === "manual"
      ? "set by you"
      : t.plan
        ? `${signed(delta)} a day to reach ${t.plan.targetKg} kg`
        : delta === 0
          ? "what your body uses, to stay the same"
          : `${signed(delta)} a day to ${GOAL_WORD[profile.goal]}`;

  return (
    <div className="space-y-8">
      <WeightGoal plan={t.plan} profile={profile} />

      <Section title="Every day">
        <dl className="grid grid-cols-2 gap-2">
          <Kpi label="Eat" value={fmt(t.kcalTarget)} unit="kcal" sub={eat} />
          <Kpi
            label="Protein"
            value={fmt(t.proteinTarget)}
            unit="g"
            sub={setByYou(t.basis.protein === "manual", perKg ? `${perKg} g per kg you weigh` : "a day")}
          />
          <Kpi
            label="Burn"
            value={fmt(t.burnTarget)}
            unit="kcal"
            sub={setByYou(t.basis.burn === "manual", "through exercise")}
          />
          <Kpi
            label="Exercise"
            value={t.minutesTarget > 0 ? fmt(t.minutesTarget) : "—"}
            unit="min"
            sub={setByYou(t.basis.minutes === "manual", "at a moderate pace")}
          />
        </dl>
      </Section>

      <Section title="How your calories split">
        <dl className="grid grid-cols-3 gap-2">
          <Kpi
            label="Carbs"
            value={fmt(t.carbsTarget)}
            unit="g"
            sub={setByYou(Number(profile.carbs_target_g) > 0, "the rest")}
          />
          <Kpi
            label="Fat"
            value={fmt(t.fatTarget)}
            unit="g"
            sub={setByYou(Number(profile.fat_target_g) > 0, `${fatShare}% of calories`)}
          />
          <Kpi
            label="Fibre"
            value={fmt(t.fiberTarget)}
            unit="g"
            sub={setByYou(Number(profile.fiber_target_g) > 0, "14 g per 1,000 kcal")}
          />
        </dl>
      </Section>

      <Section title="Your body">
        <dl className="grid grid-cols-2 gap-2">
          <Kpi
            label="Calories at rest"
            value={fmt(t.bmr)}
            unit="kcal"
            sub={t.basis.bmr === "manual" ? "BMR, set by you" : "BMR, from your height, weight and age"}
          />
          <Kpi
            label="Activity"
            value={activityWord(profile.activity_level)}
            sub={`you use about ${fmt(t.tdee)} kcal a day`}
          />
          {t.bmi !== null && (
            <Kpi label="BMI" value={String(t.bmi)} sub={BMI_WORD[bmiBand(t.bmi)]} />
          )}
          {avgSleep !== null && (
            <Kpi label="Sleep" value={String(avgSleep)} unit="h" sub="on an average night" />
          )}
        </dl>
      </Section>
    </div>
  );
}

function WeightGoal({ plan, profile }: { plan: WeightPlan | null; profile: Profile }) {
  const goalKg = Number(profile.weight_goal_kg);
  const aim = GOAL_WORD[profile.goal];

  // weightPlan() returns null for three different reasons, and each gets its
  // own sentence rather than a blanket "not set".
  let value: string;
  let unit: string | undefined;
  let sub: string;

  if (plan) {
    value = String(plan.targetKg);
    unit = `kg by ${prettyDate(plan.targetDate)}`;
    sub =
      `${plan.kgToGo} kg to ${plan.direction}, about ${plan.kgPerWeek} kg a week · ` +
      `${plan.daysLeft} ${plan.daysLeft === 1 ? "day" : "days"} left`;
  } else if (goalKg > 0 && !profile.weight_goal_date) {
    value = String(goalKg);
    unit = "kg, no date yet";
    sub = "Add a date in Edit to turn this into a daily plan.";
  } else if (goalKg > 0) {
    value = String(goalKg);
    unit = "kg · reached";
    sub = "You got there. Set a new goal in Edit to keep going.";
  } else {
    value = "Not set";
    sub = `Your targets are set to ${aim}. Add a target weight and a date in Edit for a plan.`;
  }

  return (
    <section className="surface px-5 py-4">
      <h2 className="eyebrow">Weight goal</h2>
      <p className="mt-2 flex flex-wrap items-baseline gap-x-1.5">
        <span className="text-[1.7rem] font-semibold leading-none tracking-tight text-white">{value}</span>
        {unit && <span className="text-xs font-medium text-mist-600">{unit}</span>}
      </p>
      <p className="mt-2 text-[0.7rem] leading-relaxed text-mist-400">{sub}</p>
      {plan?.note && (
        <p className="mt-1.5 text-[0.7rem] leading-relaxed text-gold">{plan.note}</p>
      )}
    </section>
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
