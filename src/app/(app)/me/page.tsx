import { loadArena, mine, rival } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import { ageFrom, applyGoalsToTargets, daysInMonthOf, deriveTargets } from "@/lib/calc";
import { DataRow, Metric, PageHeader, Section } from "@/components/ui";
import Disclosure from "@/components/Disclosure";
import InviteCard from "@/components/InviteCard";
import WeighIn from "@/components/WeighIn";
import SignOut from "@/components/SignOut";

export const dynamic = "force-dynamic";
export const metadata = { title: "Me · FitClash" };

export default async function MePage() {
  const arena = await loadArena(30);
  if (!arena) return null;

  const supabase = await createClient();
  const me = mine(arena);
  const them = rival(arena);
  const base = deriveTargets(arena.me);
  const myGoals = arena.goals.filter((g) => g.user_id === arena.me.id);
  const targets = base
    ? applyGoalsToTargets(base, myGoals, arena.me.weight_kg, daysInMonthOf(arena.today))
    : null;
  const fromGoal = (k: "protein" | "burn" | "kcal") =>
    targets?.source[k] === "goal" ? "from your goal" : undefined;

  const { data: weighIns } = await supabase
    .from("weigh_ins").select("local_date, weight_kg")
    .eq("user_id", arena.me.id).order("local_date", { ascending: false }).limit(30);

  const latest = weighIns?.[0];
  const oldest = weighIns?.[weighIns.length - 1];
  const delta =
    latest && oldest && weighIns!.length > 1
      ? Math.round((Number(latest.weight_kg) - Number(oldest.weight_kg)) * 10) / 10
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
        <Metric value={avgSleep ?? "—"} label="avg sleep" unit={avgSleep ? "h" : undefined} />
      </section>

      <Section title="Weight">
        <WeighIn
          userId={arena.me.id}
          today={arena.today}
          current={latest ? Number(latest.weight_kg) : Number(arena.me.weight_kg) || 0}
          delta={delta}
        />
      </Section>

      <Section title="Your challenge">
        <InviteCard
          challenge={arena.challenge}
          rivalName={them?.profile.display_name ?? null}
          hasRival={Boolean(them)}
        />
      </Section>

      {targets && (
        <section className="surface px-5">
          <Disclosure label="Reference numbers">
            <div className="pb-2">
              <DataRow label="Resting burn (BMR)" value={`${targets.bmr} kcal`} sub="Mifflin–St Jeor" />
              <div className="hair" />
              <DataRow label="Maintenance" value={`${targets.tdee} kcal`} sub="with your activity level" />
              <div className="hair" />
              <DataRow label="Intake aim" value={`${targets.kcalTarget} kcal`}
                sub={fromGoal("kcal") ?? `for ${arena.me.goal}`} />
              <div className="hair" />
              <DataRow label="Protein aim" value={`${targets.proteinTarget} g`}
                sub={fromGoal("protein") ?? "per day"} />
              <div className="hair" />
              <DataRow label="Burn aim" value={`${targets.burnTarget} kcal`}
                sub={fromGoal("burn") ?? "from exercise, per day"} />
              <p className="hair pt-3 text-[0.65rem] leading-relaxed text-mist-600">
                Your score is measured against these, not against your rival&apos;s raw
                numbers — so a bigger body has to do more to earn the same points.
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
