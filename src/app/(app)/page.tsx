import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { loadArena, mine, rival, rivals } from "@/lib/data";
import { deriveTargets } from "@/lib/calc";
import { MAX_BASE_SCORE } from "@/lib/scoring";
import { DataRow, EmptyState, Metric, PageHeader, Ring, Section, StreakBadge } from "@/components/ui";
import Disclosure from "@/components/Disclosure";
import AdviceCard from "@/components/AdviceCard";
import SleepCard from "@/components/SleepCard";
import MicroPanel from "@/components/MicroPanel";
import TodayTimeline from "@/components/TodayTimeline";
import ScoreGap from "@/components/ScoreGap";
import type { FoodLog, WorkoutLog } from "@/lib/types";

export const dynamic = "force-dynamic";

const YOU = "var(--color-lime-glow)";
const THEM = "var(--color-flame)";

export default async function TodayPage() {
  const arena = await loadArena(30);
  if (!arena) return null;

  const supabase = await createClient();
  const me = mine(arena);
  const them = rival(arena);
  const others = rivals(arena);
  const today = arena.today;

  const [{ data: foods }, { data: workouts }] = await Promise.all([
    supabase.from("food_logs").select("*").eq("user_id", arena.me.id)
      .eq("local_date", today).order("logged_at", { ascending: true }),
    supabase.from("workout_logs").select("*").eq("user_id", arena.me.id)
      .eq("local_date", today).order("logged_at", { ascending: true }),
  ]);

  const score = me.scores.get(today)!;
  const totals = me.totals.get(today) ?? null;
  const theirScore = them?.scores.get(today);
  const targets = deriveTargets(arena.me);

  const kcalIn = Math.round(totals?.kcal_in ?? 0);
  const kcalOut = Math.round(totals?.kcal_out ?? 0);
  const protein = Math.round(totals?.protein_g ?? 0);
  const hasData = (totals?.meals ?? 0) > 0 || (totals?.sessions ?? 0) > 0;
  const todayScoreLogged = score.logged;

  const prettyDate = new Date(today + "T00:00:00").toLocaleDateString("en-GB", {
    weekday: "long", day: "numeric", month: "long",
  });

  const lead = theirScore ? Math.round((score.total - theirScore.total) * 10) / 10 : null;

  return (
    <div className="rise space-y-8">
      <PageHeader
        title="Today"
        subtitle={prettyDate}
        right={<StreakBadge days={me.streak} />}
      />

      {/* ---------- the one number that matters ---------- */}
      <section className="flex flex-col items-center">
        <Ring value={score.total} max={MAX_BASE_SCORE} label="today's score" />

        {them && theirScore && (
          <div className="mt-7 w-full">
            <div className="flex items-center justify-between">
              <span className="tnum text-lg font-bold" style={{ color: YOU }}>
                {Math.round(score.total)}
              </span>
              <span className="eyebrow">
                {lead === 0 ? "level" : lead! > 0 ? `you +${Math.abs(lead!)}` : `${them.profile.display_name.split(" ")[0]} +${Math.abs(lead!)}`}
              </span>
              <span className="tnum text-lg font-bold" style={{ color: THEM }}>
                {Math.round(theirScore.total)}
              </span>
            </div>
            <div className="mt-2 flex h-1 overflow-hidden rounded-full bg-ink-800">
              <div
                style={{
                  width: `${score.total + theirScore.total > 0 ? (score.total / (score.total + theirScore.total)) * 100 : 50}%`,
                  background: YOU,
                  transition: "width 0.6s ease",
                }}
              />
              <div className="flex-1" style={{ background: THEM }} />
            </div>
            <div className="mt-1.5 flex justify-between">
              <span className="text-[0.65rem] text-mist-600">You</span>
              <span className="text-[0.65rem] text-mist-600">
                {them.profile.display_name.split(" ")[0]}
                {others.length > 1 && ` · leading ${others.length - 1} other${others.length === 2 ? "" : "s"}`}
              </span>
            </div>
          </div>
        )}

        <div className="mt-8 grid w-full grid-cols-3 gap-2">
          <Metric value={kcalIn} unit="kcal" label="eaten"
            hint={targets ? `of ~${targets.tdee}` : undefined} />
          <Metric value={protein} unit="g" label="protein" color={YOU}
            hint={targets ? `of ~${targets.proteinTarget}` : undefined} />
          <Metric value={kcalOut} unit="kcal" label="burned"
            hint={`${Math.round(totals?.active_minutes ?? 0)} min`} />
        </div>
      </section>

      {/* ---------- why the gap ---------- */}
      {them && theirScore && (todayScoreLogged || theirScore.logged) && (
        <Section
          title="Why the gap"
          action={
            <Link href={`/vs/${them.profile.id}`} className="text-xs font-semibold text-lime-glow">
              Details
            </Link>
          }
        >
          <ScoreGap
            mine={score}
            theirs={theirScore}
            theirName={them.profile.display_name.split(" ")[0]}
            compact
          />
        </Section>
      )}

      {/* ---------- what to do about it ---------- */}
      <Section title="For tomorrow">
        <AdviceCard hasData={hasData} />
      </Section>

      {/* ---------- sleep ---------- */}
      <SleepCard
        userId={arena.me.id}
        date={today}
        hours={totals?.sleep_hours ?? null}
        quality={totals?.sleep_quality ?? null}
      />

      {/* ---------- detail, folded away ---------- */}
      <section className="surface px-5">
        <Disclosure label="How the score broke down">
          <div className="pb-2">
            {score.lines.map((line) => (
              <DataRow
                key={line.key}
                label={line.label}
                value={`${line.points}/${line.max}`}
                sub={line.detail}
                color={line.points > 0 ? (line.key === "streak" ? "var(--color-gold)" : YOU) : undefined}
                bar={line.max > 0 ? line.points / line.max : 0}
              />
            ))}
          </div>
        </Disclosure>
        <div className="hair">
          <Disclosure label="Micronutrients">
            <div className="pb-2">
              <MicroPanel totals={totals} sex={arena.me.sex} />
            </div>
          </Disclosure>
        </div>
      </section>

      {/* ---------- the log ---------- */}
      <Section
        title="Logged today"
        action={<Link href="/log" className="text-xs font-semibold text-lime-glow">Add</Link>}
      >
        {(foods?.length ?? 0) + (workouts?.length ?? 0) === 0 ? (
          <EmptyState
            icon="○"
            title="Nothing logged yet"
            body="Tap + and describe your meal or workout in plain English."
          />
        ) : (
          <TodayTimeline
            foods={(foods ?? []) as FoodLog[]}
            workouts={(workouts ?? []) as WorkoutLog[]}
          />
        )}
      </Section>

      {!them && (
        <div className="surface px-5 py-6 text-center">
          <p className="text-sm font-semibold text-white">No rival yet</p>
          <p className="mt-1.5 text-xs leading-relaxed text-mist-600">
            Send your friend the invite code from the Me tab.
          </p>
          <Link href="/me" className="btn btn-ghost mt-4 w-full">Get invite code</Link>
        </div>
      )}
    </div>
  );
}
