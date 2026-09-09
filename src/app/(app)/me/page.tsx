import { mine, requireArena } from "@/lib/data";
import { ageFrom, applyGoalsToTargets, bmiBand, daysInMonthOf, prettyDate } from "@/lib/calc";
import { DataRow, Metric, PageHeader, Section } from "@/components/ui";
import Disclosure from "@/components/Disclosure";
import ChallengeManager from "@/components/ChallengeManager";
import TargetsEditor from "@/components/TargetsEditor";
import WeighIn from "@/components/WeighIn";
import SignOut from "@/components/SignOut";

export const dynamic = "force-dynamic";
export const metadata = { title: "Me · FitClash" };

const BMI_WORD = {
  under: "below the healthy range",
  healthy: "in the healthy range",
  over: "above the healthy range",
  obese: "well above the healthy range",
} as const;

export default async function MePage() {
  const arena = await requireArena({ days: 30 });

  const me = mine(arena);
  const base = arena.myTargets;
  const myGoals = arena.goals.filter((g) => g.user_id === arena.me.id);
  const targets = base
    ? applyGoalsToTargets(base, myGoals, daysInMonthOf(arena.today))
    : null;
  const fromGoal = (k: "protein" | "burn" | "kcal") =>
    targets?.source[k] === "goal" ? "from your goal" : undefined;

  const weighIns = arena.myWeighIns;
  const latest = weighIns[0];
  const oldest = weighIns[weighIns.length - 1];
  const delta =
    latest && oldest && weighIns.length > 1
      ? Math.round((latest.weight_kg - oldest.weight_kg) * 10) / 10
      : null;

  const sleepNights = [...me.totals.values()].filter((t) => t.sleep_hours != null);
  const avgSleep = sleepNights.length
    ? Math.round((sleepNights.reduce((a, t) => a + Number(t.sleep_hours), 0) / sleepNights.length) * 10) / 10
    : null;

  const loggedDays = [...me.totals.values()].filter((t) => t.meals > 0 || t.sessions > 0).length;

  return (
    <div className="rise space-y-8">
      <PageHeader title="Me" subtitle={arena.me.display_name} />

      <section className="flex items-center gap-4">
        <span className="text-4xl" aria-hidden="true">{arena.me.avatar_emoji}</span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-white">{arena.me.display_name}</p>
          <p className="tnum mt-0.5 text-xs text-mist-600">
            {ageFrom(arena.me.birth_date)} · {arena.me.height_cm} cm ·{" "}
            {arena.me.goal === "cut" ? "losing fat" : arena.me.goal === "bulk" ? "building" : "maintaining"}
          </p>
        </div>
      </section>

      <section className="grid grid-cols-3 gap-2">
        <Metric value={me.streak} label="streak" color="var(--color-gold)" unit="d" />
        <Metric value={loggedDays} label="days logged" unit="/30" />
        <Metric value={base?.bmi ?? "—"} label="BMI" />
      </section>

      {/* ---------- what you're scored against ---------- */}
      <Section title="Targets">
        <TargetsEditor profile={arena.me} today={arena.today} />
      </Section>

      <Section title="Weight">
        <WeighIn
          userId={arena.me.id}
          today={arena.today}
          profile={arena.me}
          current={latest ? latest.weight_kg : Number(arena.me.weight_kg) || 0}
          delta={delta}
        />
      </Section>

      <Section title={`Your challenges (${arena.myChallenges.length})`}>
        <ChallengeManager
          userId={arena.me.id}
          timezone={arena.me.timezone}
          challenges={arena.myChallenges}
          activeId={arena.challenge?.id ?? null}
        />
      </Section>

      {targets && (
        <section className="surface px-5">
          <Disclosure label="Reference numbers">
            <div className="pb-2">
              <DataRow label="Resting burn (BMR)" value={`${targets.bmr} kcal`}
                sub={targets.basis.bmr === "manual" ? "you set this by hand" : "Mifflin–St Jeor"} />
              <div className="hair" />
              <DataRow label="Maintenance" value={`${targets.tdee} kcal`} sub="with your activity level" />
              <div className="hair" />
              <DataRow label="Intake aim" value={`${targets.kcalTarget} kcal`}
                sub={
                  fromGoal("kcal") ??
                  (targets.basis.kcal === "manual"
                    ? "you set this by hand"
                    : targets.plan
                      ? `to reach ${targets.plan.targetKg} kg by ${prettyDate(targets.plan.targetDate)}`
                      : `for ${arena.me.goal}`)
                } />
              <div className="hair" />
              <DataRow label="Protein aim" value={`${targets.proteinTarget} g`}
                sub={fromGoal("protein") ?? (targets.basis.protein === "manual" ? "you set this by hand" : "per day")} />
              <div className="hair" />
              <DataRow label="Burn aim" value={`${targets.burnTarget} kcal`}
                sub={fromGoal("burn") ?? (targets.basis.burn === "manual" ? "you set this by hand" : "from exercise, per day")} />
              <div className="hair" />
              <DataRow label="Active minutes" value={`${targets.minutesTarget} min`}
                sub={targets.basis.minutes === "manual"
                  ? "you set this by hand"
                  : "how long your burn aim takes at a moderate effort"} />
              <div className="hair" />
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
              <p className="pt-2 text-[0.65rem] leading-relaxed text-mist-600">
                Your score is measured against these, not against your rival&apos;s raw
                numbers — so a bigger body has to do more to earn the same points. Your
                competitors see the intake, protein and burn aims and nothing else: not
                your height, weight, age, BMI or weigh-ins.
              </p>
            </div>
          </Disclosure>
        </section>
      )}

      <div className="pt-2">
        <SignOut />
      </div>
    </div>
  );
}
