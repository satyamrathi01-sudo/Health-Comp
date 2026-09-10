import { mine, requireArena } from "@/lib/data";
import { ageFrom } from "@/lib/calc";
import { Metric, PageHeader, Section } from "@/components/ui";
import ChallengeManager from "@/components/ChallengeManager";
import WeighIn from "@/components/WeighIn";
import SignOut from "@/components/SignOut";

export const dynamic = "force-dynamic";
export const metadata = { title: "Me · FitClash" };

export default async function MePage() {
  const arena = await requireArena({ days: 30 });

  const me = mine(arena);

  const weighIns = arena.myWeighIns;
  const latest = weighIns[0];
  const oldest = weighIns[weighIns.length - 1];
  const delta =
    latest && oldest && weighIns.length > 1
      ? Math.round((latest.weight_kg - oldest.weight_kg) * 10) / 10
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
        <Metric value={arena.myTargets?.bmi ?? "—"} label="BMI" />
      </section>

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

      <div className="pt-2">
        <SignOut />
      </div>
    </div>
  );
}
