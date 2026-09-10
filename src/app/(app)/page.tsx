import Link from "next/link";
import { mine, requireArena } from "@/lib/data";
import { MAX_BASE_SCORE } from "@/lib/scoring";
import { breachedLimits } from "@/lib/limits";
import { buildPace } from "@/lib/progress";
import { waterCeilingMl, waterTarget } from "@/lib/hydration";
import { localHour } from "@/lib/calc";
import { DataRow, EmptyState, Metric, PageHeader, Ring, Section, StreakBadge } from "@/components/ui";
import Disclosure from "@/components/Disclosure";
import SubTabs from "@/components/SubTabs";
import AdviceCard from "@/components/AdviceCard";
import SleepCard from "@/components/SleepCard";
import RecoveryCard from "@/components/RecoveryCard";
import MicroPanel from "@/components/MicroPanel";
import TodayTimeline from "@/components/TodayTimeline";
import LimitAlerts from "@/components/LimitAlerts";
import PlanProgress from "@/components/PlanProgress";
import WaterBottle from "@/components/WaterBottle";

export const dynamic = "force-dynamic";

const YOU = "var(--color-lime-glow)";

/**
 * Today is yours alone.
 *
 * No rival appears on this screen — not their score, not the gap, not a
 * leaderboard. Comparison lives on Versus, where you go when you want it.
 * A dashboard that opens with someone else's number is a dashboard about
 * someone else.
 *
 * Three tabs rather than one long scroll: Score (the number and what made
 * it), Log (what went in today) and Body (plan, recovery, sleep). Anything
 * already over a limit sits above the tabs — a warning you have to go
 * looking for is not a warning.
 *
 * No challenge switcher: nothing here depends on which challenge you are
 * looking at. It lives on Versus.
 */
export default async function TodayPage() {
  const arena = await requireArena({ days: 30 });
  const me = mine(arena);
  const today = arena.today;

  const score = me.scores.get(today)!;
  const totals = me.totals.get(today) ?? null;
  const targets = arena.myTargets;

  const kcalIn = Math.round(totals?.kcal_in ?? 0);
  const kcalOut = Math.round(totals?.kcal_out ?? 0);
  const protein = Math.round(totals?.protein_g ?? 0);
  const hasData = (totals?.meals ?? 0) > 0 || (totals?.sessions ?? 0) > 0;

  // Today's water aim moves with bodyweight and with what was actually
  // trained, so it is derived here alongside everything else.
  const water = waterTarget(arena.me, totals);
  const hour = localHour(arena.me.timezone);

  // Every ceiling and every micronutrient aim is scaled to this person and
  // this day, not to a reference adult: see microTarget() in calc.ts.
  const microContext = targets
    ? {
        kcalTarget: targets.kcalTarget,
        weightKg: arena.me.weight_kg,
        exerciseKcal: totals?.kcal_out ?? 0,
      }
    : undefined;

  // Anything already past its ceiling, worst first. Straight to the top.
  const limits = breachedLimits(totals, arena.me.sex,
    targets
      ? { ...targets, weightKg: arena.me.weight_kg, waterCeilingMl: waterCeilingMl(water) }
      : null);

  const pace = targets ? buildPace({ days: arena.days, totals: me.totals, targets, today }) : null;

  const prettyToday = new Date(today + "T00:00:00").toLocaleDateString("en-GB", {
    weekday: "long", day: "numeric", month: "long",
  });

  /* ---------------- Score: the number, and what made it ---------------- */
  const scoreTab = (
    <>
      <section className="flex flex-col items-center">
        <Ring value={score.total} max={MAX_BASE_SCORE} label="today's score" />

        <div className="mt-8 grid w-full grid-cols-3 gap-2">
          <Metric value={kcalIn} unit="kcal" label="eaten"
            hint={targets ? `of ${targets.kcalTarget}` : undefined} />
          <Metric value={protein} unit="g" label="protein" color={YOU}
            hint={targets ? `of ${targets.proteinTarget}` : undefined} />
          <Metric value={kcalOut} unit="kcal" label="burned"
            hint={targets ? `of ${targets.burnTarget}` : `${Math.round(totals?.active_minutes ?? 0)} min`} />
        </div>
      </section>

      <Section title="How you scored">
        <div className="surface px-5">
          {score.lines.map((line, i) => (
            <div key={line.key} className={i > 0 ? "hair" : ""}>
              <DataRow
                label={line.label}
                value={`${line.points}/${line.max}`}
                sub={line.detail}
                color={line.points > 0 ? (line.key === "streak" ? "var(--color-gold)" : YOU) : undefined}
                bar={line.max > 0 ? line.points / line.max : 0}
              />
            </div>
          ))}
        </div>
      </Section>

      <Section title="Tips for tomorrow">
        <AdviceCard hasData={hasData} />
      </Section>
    </>
  );

  /* ---------------- Log: what went in today ---------------- */
  const logTab = (
    <>
      <Section
        title="Logged today"
        action={<Link href="/log" className="text-xs font-semibold text-lime-glow">Add</Link>}
      >
        {arena.todayFood.length + arena.todayWorkouts.length === 0 ? (
          <EmptyState icon="○" title="Nothing logged yet" body="Tap + to add a meal or a workout." />
        ) : (
          <TodayTimeline foods={arena.todayFood} workouts={arena.todayWorkouts} />
        )}
      </Section>

      <Section title="Water">
        <WaterBottle target={water} drankMl={totals?.water_ml ?? 0} hour={hour} today={today} />
      </Section>

      <section className="surface px-5">
        <Disclosure label="Vitamins & minerals">
          <div className="pb-2">
            <MicroPanel totals={totals} sex={arena.me.sex} context={microContext} />
          </div>
        </Disclosure>
      </section>
    </>
  );

  /* ---------------- Body: plan, recovery, sleep ---------------- */
  const bodyTab = (
    <>
      {pace && (
        <Section
          title={pace.hasPlan ? "Weight plan" : "Last two weeks"}
          action={
            !pace.hasPlan ? (
              <Link href="/goals?tab=edit" className="text-xs font-semibold text-lime-glow">
                Set a goal
              </Link>
            ) : undefined
          }
        >
          <PlanProgress pace={pace} plan={targets?.plan ?? null} today={today} />
        </Section>
      )}

      <Section title="Recovery">
        <RecoveryCard recovery={me.recovery} />
      </Section>

      <Section title="Sleep">
        <SleepCard
          userId={arena.me.id}
          date={today}
          hours={totals?.sleep_hours ?? null}
          quality={totals?.sleep_quality ?? null}
        />
      </Section>
    </>
  );

  return (
    <div className="rise space-y-6">
      <PageHeader title="Today" subtitle={prettyToday} right={<StreakBadge days={me.streak} />} />

      {/* ---------- what you have already gone over ---------- */}
      <LimitAlerts limits={limits} />

      <SubTabs
        label="Today"
        tabs={[
          { id: "score", label: "Score", content: scoreTab },
          { id: "log", label: "Log", content: logTab },
          { id: "body", label: "Body", content: bodyTab },
        ]}
      />
    </div>
  );
}
