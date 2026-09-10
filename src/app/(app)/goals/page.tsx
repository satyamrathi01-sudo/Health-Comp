import { latestWeight, mine, requireArena } from "@/lib/data";
import { applyGoalsToTargets, bmiBand, daysInMonthOf } from "@/lib/calc";
import { goalProgress } from "@/lib/goals";
import { DataRow, PageHeader, Section } from "@/components/ui";
import Disclosure from "@/components/Disclosure";
import GoalsBoard, { type GoalSuggestion } from "@/components/GoalsBoard";
import TargetKpis from "@/components/TargetKpis";
import TargetsEditor from "@/components/TargetsEditor";

export const dynamic = "force-dynamic";
export const metadata = { title: "Goals · FitClash" };

const BMI_WORD = {
  under: "below the healthy range",
  healthy: "in the healthy range",
  over: "above the healthy range",
  obese: "well above the healthy range",
} as const;

/**
 * What you are measured against, and what you said you wanted. Yours alone.
 *
 * This tab used to set your month beside your rival's. The rival half is gone
 * and the targets moved in from Me: the numbers the score judges you on and
 * the goals that move those numbers are one subject, and none of it is a
 * competitor's business. v11 in schema.sql is where that is enforced — hiding
 * it here alone would hide nothing.
 *
 * No challenge switcher either. Nothing on this screen changes with the
 * challenge you are looking at, and a control that changes nothing you can
 * see is worse than no control at all.
 */
export default async function GoalsPage() {
  const arena = await requireArena({ days: 31 });
  const me = mine(arena);
  const goals = arena.goals;

  // Calendar month, not a rolling window — "what I want to achieve this month".
  const monthStart = arena.today.slice(0, 8) + "01";
  const monthDays = arena.days.filter((d) => d >= monthStart);
  const monthTotals = monthDays
    .map((d) => me.totals.get(d))
    .filter((t): t is NonNullable<typeof t> => Boolean(t));
  const monthScores = monthDays
    .map((d) => me.scores.get(d))
    .filter((s) => s?.logged)
    .map((s) => s!.total);

  const progressByGoal: Record<string, number | null> = {};
  for (const goal of goals) {
    progressByGoal[goal.id] = goalProgress({
      metric: goal.metric,
      totals: monthTotals,
      scores: monthScores,
      latestWeight: latestWeight(arena),
    });
  }

  // The body's targets, then whatever a goal overrides: exactly what the score
  // applies, so nothing on this screen can disagree with a scored line.
  const base = arena.myTargets;
  const daysThisMonth = daysInMonthOf(arena.today);
  const targets = base ? applyGoalsToTargets(base, goals, daysThisMonth) : null;

  // Anchored to their own numbers, so a suggestion is a real stretch rather
  // than a round number pulled out of the air.
  const suggestions: GoalSuggestion[] = base
    ? [
        {
          title: `Average ${base.proteinTarget + 10} g protein a day`,
          metric: "avg_protein_g",
          target_value: base.proteinTarget + 10,
        },
        {
          title: `Train on ${Math.round(daysThisMonth * 0.6)} days this month`,
          metric: "workout_days",
          target_value: Math.round(daysThisMonth * 0.6),
        },
        {
          title: `Burn ${(base.burnTarget * daysThisMonth).toLocaleString()} kcal this month`,
          metric: "total_kcal_burned",
          target_value: base.burnTarget * daysThisMonth,
        },
        {
          title: "Average 75 points a day",
          metric: "avg_score",
          target_value: 75,
        },
        ...(arena.me.weight_kg && arena.me.goal === "cut"
          ? [{
              title: `Reach ${Math.round((Number(arena.me.weight_kg) - 2) * 10) / 10} kg`,
              metric: "weight_kg" as const,
              target_value: Math.round((Number(arena.me.weight_kg) - 2) * 10) / 10,
            }]
          : []),
      ]
    : [];

  const sleepNights = [...me.totals.values()].filter((t) => t.sleep_hours != null);
  const avgSleep = sleepNights.length
    ? Math.round((sleepNights.reduce((a, t) => a + Number(t.sleep_hours), 0) / sleepNights.length) * 10) / 10
    : null;

  return (
    <div className="rise space-y-8">
      <PageHeader title="Goals" subtitle="What your score is measured against" />

      {/* ---------- the numbers, at a glance ---------- */}
      {targets && <TargetKpis targets={targets} profile={arena.me} />}

      {/* ---------- change them ---------- */}
      <Section title="Targets">
        <TargetsEditor profile={arena.me} today={arena.today} goals={goals} />
      </Section>

      {targets && (
        <section className="surface px-5">
          <Disclosure label="Reference numbers">
            <div className="pb-2">
              <DataRow label="Carbs" value={`${targets.carbsTarget} g`}
                sub={arena.me.carbs_target_g
                  ? "you set this by hand"
                  : "what is left after protein and fat"} />
              <div className="hair" />
              <DataRow label="Fat" value={`${targets.fatTarget} g`}
                sub={arena.me.fat_target_g
                  ? "you set this by hand"
                  : `${Math.round((targets.fatTarget * 9 / targets.kcalTarget) * 100)}% of your calories, for ${arena.me.goal}`} />
              <div className="hair" />
              <DataRow label="Fibre" value={`${targets.fiberTarget} g`}
                sub={arena.me.fiber_target_g ? "you set this by hand" : "14 g per 1,000 kcal you eat"} />
              {targets.bmi !== null && (<>
                <div className="hair" />
                <DataRow label="BMI" value={String(targets.bmi)} sub={BMI_WORD[bmiBand(targets.bmi)]} />
              </>)}
              {avgSleep !== null && (<>
                <div className="hair" />
                <DataRow label="Average sleep" value={`${avgSleep} h`} sub="across the nights you logged" />
              </>)}
              <p className="hair pt-3 text-[0.65rem] leading-relaxed text-mist-600">
                Every one of these follows from your body and your goal — the macro split
                divides <em>your</em> calorie target, and the micronutrient figures on Today
                scale with your weight, what you eat and what you burn. Nothing here is a
                generic adult&apos;s number.
              </p>
            </div>
          </Disclosure>
        </section>
      )}

      {/* ---------- what you said you wanted ---------- */}
      <GoalsBoard
        userId={arena.me.id}
        month={monthStart}
        goals={goals}
        progress={progressByGoal}
        suggestions={suggestions}
      />

      <p className="px-1 text-[0.62rem] leading-relaxed text-mist-600">
        Nobody you compete against can see any of this. Your resting burn, activity
        level, weight plan, macro split and monthly goals stay in your account — the
        database will not hand them to anyone else. A rival&apos;s screen gets only the
        daily aims your score is measured on, already adjusted for your goals, because
        it cannot score your day without them. That is also why a bigger body has to
        do more to earn the same points.
      </p>
    </div>
  );
}
