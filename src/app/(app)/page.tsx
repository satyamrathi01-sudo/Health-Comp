import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { loadArena, mine, rival } from "@/lib/data";
import { deriveTargets } from "@/lib/calc";
import { MAX_BASE_SCORE } from "@/lib/scoring";
import { Bar, EmptyState, PageHeader, ScoreDial, SectionTitle, StatTile } from "@/components/ui";
import TodayTimeline from "@/components/TodayTimeline";
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
  const today = arena.today;

  const [{ data: foods }, { data: workouts }] = await Promise.all([
    supabase.from("food_logs").select("*").eq("user_id", arena.me.id)
      .eq("local_date", today).order("logged_at", { ascending: true }),
    supabase.from("workout_logs").select("*").eq("user_id", arena.me.id)
      .eq("local_date", today).order("logged_at", { ascending: true }),
  ]);

  const score = me.scores.get(today)!;
  const totals = me.totals.get(today);
  const theirScore = them?.scores.get(today);
  const targets = deriveTargets(arena.me);

  const kcalIn = Math.round(totals?.kcal_in ?? 0);
  const kcalOut = Math.round(totals?.kcal_out ?? 0);
  const protein = Math.round(totals?.protein_g ?? 0);
  const net = kcalIn - kcalOut;

  const prettyDate = new Date(today + "T00:00:00").toLocaleDateString("en-GB", {
    weekday: "long", day: "numeric", month: "long",
  });

  const lead = theirScore ? Math.round((score.total - theirScore.total) * 10) / 10 : null;

  return (
    <div className="rise space-y-6">
      <PageHeader
        title={`Hi, ${arena.me.display_name.split(" ")[0]}`}
        subtitle={prettyDate}
        right={
          me.streak > 0 ? (
            <div className="flex items-center gap-1 rounded-full border border-gold/40 bg-gold/10 px-2.5 py-1">
              <span className="text-sm">🔥</span>
              <span className="tnum text-sm font-bold text-gold">{me.streak}</span>
            </div>
          ) : undefined
        }
      />

      {/* ---------------- Today's score ---------------- */}
      <section className="card-raised flex flex-col items-center px-5 py-6">
        <ScoreDial
          score={score.total}
          max={MAX_BASE_SCORE}
          caption="today's score"
          sub={score.bonus > 0 ? `${score.base} + ${score.bonus} streak` : undefined}
        />

        {them && theirScore && (
          <div className="mt-5 w-full">
            <div className="mb-2 flex items-center justify-between text-sm">
              <span className="font-semibold" style={{ color: YOU }}>
                {arena.me.avatar_emoji} You
              </span>
              <span className="tnum text-xs font-semibold text-mist-500">
                {lead === 0
                  ? "dead level"
                  : lead! > 0
                    ? `you lead by ${Math.abs(lead!)}`
                    : `behind by ${Math.abs(lead!)}`}
              </span>
              <span className="font-semibold" style={{ color: THEM }}>
                {them.profile.display_name.split(" ")[0]} {them.profile.avatar_emoji}
              </span>
            </div>
            <VersusBar mine={score.total} theirs={theirScore.total} />
          </div>
        )}
      </section>

      {/* ---------------- Numbers ---------------- */}
      <section>
        <SectionTitle>Today</SectionTitle>
        <div className="grid grid-cols-2 gap-2.5">
          <StatTile
            label="Eaten" value={kcalIn} unit="kcal"
            hint={targets ? `maintenance ≈ ${targets.tdee}` : undefined}
          />
          <StatTile label="Burned" value={kcalOut} unit="kcal" accent={YOU}
            hint={`${Math.round(totals?.active_minutes ?? 0)} active min`} />
          <StatTile
            label="Protein" value={protein} unit="g"
            hint={targets ? `aim ~${targets.proteinTarget} g` : undefined}
          />
          <StatTile
            label="Net" value={net > 0 ? `+${net}` : net} unit="kcal"
            accent={net <= 0 ? YOU : undefined}
            hint={net <= 0 ? "in deficit" : "in surplus"}
          />
        </div>
      </section>

      {/* ---------------- Score breakdown ---------------- */}
      <section>
        <SectionTitle>Where the points came from</SectionTitle>
        <div className="card space-y-3 p-4">
          {score.lines.map((line) => (
            <div key={line.key}>
              <div className="mb-1 flex items-baseline justify-between gap-2">
                <span className="text-sm font-medium">{line.label}</span>
                <span className="tnum text-xs text-mist-500">
                  {line.detail} · <span className="font-semibold text-mist-300">{line.points}</span>
                  /{line.max}
                </span>
              </div>
              <Bar
                value={line.points}
                max={line.max}
                color={line.key === "streak" ? "var(--color-gold)" : YOU}
                height={5}
              />
            </div>
          ))}
        </div>
      </section>

      {/* ---------------- Timeline ---------------- */}
      <section>
        <SectionTitle
          action={
            <Link href="/log" className="text-xs font-semibold text-lime-glow">
              Add +
            </Link>
          }
        >
          Logged today
        </SectionTitle>

        {(foods?.length ?? 0) + (workouts?.length ?? 0) === 0 ? (
          <EmptyState
            icon="🍽️"
            title="Nothing logged yet"
            body="Tap the + button and describe your meal or workout in plain English."
          />
        ) : (
          <TodayTimeline
            foods={(foods ?? []) as FoodLog[]}
            workouts={(workouts ?? []) as WorkoutLog[]}
          />
        )}
      </section>

      {!them && (
        <section className="card border-dashed p-4 text-center">
          <p className="text-sm font-semibold">No rival yet</p>
          <p className="mt-1 text-xs leading-relaxed text-mist-500">
            Send your friend the invite code from the Me tab — the scoreboard needs two.
          </p>
          <Link href="/me" className="btn btn-ghost mt-3 w-full">Get invite code</Link>
        </section>
      )}
    </div>
  );
}

function VersusBar({ mine, theirs }: { mine: number; theirs: number }) {
  const total = mine + theirs;
  const mineShare = total > 0 ? (mine / total) * 100 : 50;
  return (
    <div className="flex h-8 w-full overflow-hidden rounded-lg bg-ink-800">
      <div
        className="flex items-center justify-start px-2.5 text-xs font-bold text-ink-950"
        style={{ width: `${mineShare}%`, background: YOU, transition: "width 0.5s ease" }}
      >
        <span className="tnum">{mine}</span>
      </div>
      <div
        className="flex flex-1 items-center justify-end px-2.5 text-xs font-bold text-ink-950"
        style={{ background: THEM }}
      >
        <span className="tnum">{theirs}</span>
      </div>
    </div>
  );
}
