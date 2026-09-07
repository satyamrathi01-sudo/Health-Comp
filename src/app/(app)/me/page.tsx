import { loadArena, mine, rival } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import { deriveTargets, ageFrom } from "@/lib/calc";
import { PageHeader, SectionTitle, StatTile } from "@/components/ui";
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
  const targets = deriveTargets(arena.me);

  const { data: weighIns } = await supabase
    .from("weigh_ins").select("local_date, weight_kg")
    .eq("user_id", arena.me.id).order("local_date", { ascending: false }).limit(30);

  const latest = weighIns?.[0];
  const oldest = weighIns?.[weighIns.length - 1];
  const delta =
    latest && oldest && weighIns!.length > 1
      ? Math.round((Number(latest.weight_kg) - Number(oldest.weight_kg)) * 10) / 10
      : null;

  return (
    <div className="rise space-y-6">
      <PageHeader title="Me" subtitle={arena.me.display_name} />

      <section className="card-raised flex items-center gap-4 px-4 py-4">
        <span className="text-4xl" aria-hidden="true">{arena.me.avatar_emoji}</span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{arena.me.display_name}</p>
          <p className="tnum mt-0.5 text-xs text-mist-500">
            {ageFrom(arena.me.birth_date)} yrs · {arena.me.height_cm} cm ·{" "}
            {arena.me.goal === "cut" ? "losing fat" : arena.me.goal === "bulk" ? "building" : "maintaining"}
          </p>
        </div>
        <div className="text-right">
          <div className="tnum text-lg font-bold text-lime-glow">{me.streak}</div>
          <div className="text-[0.6rem] uppercase tracking-wide text-mist-500">day streak</div>
        </div>
      </section>

      <section>
        <SectionTitle>Weight</SectionTitle>
        <WeighIn
          userId={arena.me.id}
          today={arena.today}
          current={latest ? Number(latest.weight_kg) : Number(arena.me.weight_kg) || 0}
          delta={delta}
        />
      </section>

      {targets && (
        <section>
          <SectionTitle>Your reference numbers</SectionTitle>
          <div className="grid grid-cols-2 gap-2.5">
            <StatTile label="Resting burn" value={targets.bmr} unit="kcal" hint="BMR, Mifflin–St Jeor" />
            <StatTile label="Maintenance" value={targets.tdee} unit="kcal" hint="with your activity level" />
            <StatTile label="Intake aim" value={targets.kcalTarget} unit="kcal" hint={`for ${arena.me.goal}`} />
            <StatTile label="Protein aim" value={targets.proteinTarget} unit="g" hint="per day" />
          </div>
          <p className="mt-2 px-1 text-[0.68rem] leading-relaxed text-mist-500">
            These are guidance only. Scoring is on raw numbers — burn, protein, net calories —
            so nobody gets an easier target than anyone else.
          </p>
        </section>
      )}

      <section>
        <SectionTitle>Your challenge</SectionTitle>
        <InviteCard
          challenge={arena.challenge}
          rivalName={them?.profile.display_name ?? null}
          hasRival={Boolean(them)}
        />
      </section>

      <section className="pt-2">
        <SignOut />
      </section>
    </div>
  );
}
