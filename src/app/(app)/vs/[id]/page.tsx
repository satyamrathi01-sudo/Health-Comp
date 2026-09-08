import Link from "next/link";
import { notFound } from "next/navigation";
import { loadArena, mine } from "@/lib/data";
import { dayOutcome } from "@/lib/scoring";
import { EmptyState, PageHeader, Section } from "@/components/ui";
import ScoreGap from "@/components/ScoreGap";

export const dynamic = "force-dynamic";

const YOU = "var(--color-lime-glow)";
const THEM = "var(--color-flame)";

export default async function OneOnOnePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const arena = await loadArena(30);
  if (!arena) return null;

  const me = mine(arena);
  // RLS decides who is even loadable, so an unreachable rival is a genuine 404
  // rather than something to explain.
  const them = arena.players.find((p) => p.profile.id === id && !p.isMe);
  if (!them) notFound();

  const firstName = them.profile.display_name.split(" ")[0];

  // Head-to-head between exactly these two, not "best rival that day".
  const firstDay = arena.challenge
    ? [arena.challenge.start_date, arena.days[0]].sort().reverse()[0]
    : arena.days[0];

  let wins = 0, losses = 0, draws = 0;
  const fixtures: { day: string; a: number; b: number; outcome: string; played: boolean }[] = [];
  for (const day of arena.days) {
    if (day < firstDay) continue;
    const a = me.scores.get(day)!;
    const b = them.scores.get(day)!;
    const played = a.logged || b.logged;
    if (played) {
      const outcome = dayOutcome(a, b);
      if (outcome === "win") wins++;
      else if (outcome === "loss") losses++;
      else if (outcome === "tie") draws++;
      fixtures.push({ day, a: a.total, b: b.total, outcome, played });
    } else {
      // Kept, dimmed: a missed day is information, not an absence.
      fixtures.push({ day, a: 0, b: 0, outcome: "none", played });
    }
  }
  fixtures.reverse();

  const todayMine = me.scores.get(arena.today)!;
  const todayTheirs = them.scores.get(arena.today)!;

  return (
    <div className="rise space-y-8">
      <PageHeader
        title={`You vs ${firstName}`}
        subtitle="Head to head, last 30 days"
        right={
          <Link href="/vs" className="text-xs font-semibold text-lime-glow">
            All
          </Link>
        }
      />

      <section className="flex items-center justify-center gap-6">
        <div className="text-center">
          <div className="text-3xl" aria-hidden="true">{arena.me.avatar_emoji}</div>
          <div className="mt-2 text-xs text-mist-600">You</div>
        </div>
        <div className="text-center">
          <div className="eyebrow">record</div>
          <div className="mt-2 flex items-baseline gap-1.5">
            <span className="hero-num tnum text-3xl" style={{ color: YOU }}>{wins}</span>
            <span className="text-mist-600">–</span>
            <span className="hero-num tnum text-3xl" style={{ color: THEM }}>{losses}</span>
          </div>
          {draws > 0 && <div className="tnum mt-1 text-[0.65rem] text-mist-600">{draws} drawn</div>}
        </div>
        <div className="text-center">
          <div className="text-3xl" aria-hidden="true">{them.profile.avatar_emoji}</div>
          <div className="mt-2 text-xs text-mist-600">{firstName}</div>
        </div>
      </section>

      {/* ---------- today, explained ---------- */}
      <Section title="Today, line by line">
        <ScoreGap mine={todayMine} theirs={todayTheirs} theirName={firstName} />
      </Section>

      {/* ---------- fixtures ---------- */}
      <Section title="Every day">
        {fixtures.length === 0 ? (
          <EmptyState icon="○" title="No logged days yet" />
        ) : (
          <div className="surface px-5">
            {fixtures.map((f, i) => (
              <div key={f.day}
                className={`flex items-center gap-3 ${i > 0 ? "hair py-3" : "py-3"} ${f.played ? "" : "opacity-40"}`}>
                <span className="w-[5.5rem] shrink-0 text-[0.7rem] text-mist-600">
                  {f.day === arena.today
                    ? "Today"
                    : new Date(f.day + "T00:00:00").toLocaleDateString("en-GB", {
                        weekday: "short", day: "numeric", month: "short",
                      })}
                </span>
                {!f.played && (
                  <span className="flex-1 text-center text-[0.7rem] text-mist-600">not logged</span>
                )}
                {f.played && (
                <span className="tnum w-8 text-right text-sm font-bold" style={{ color: YOU }}>
                  {Math.round(f.a)}
                </span>)}
                {f.played && (<>
                <div className="flex h-[3px] flex-1 overflow-hidden rounded-full bg-ink-800">
                  <div style={{ width: `${f.a + f.b > 0 ? (f.a / (f.a + f.b)) * 100 : 50}%`, background: YOU }} />
                  <div className="flex-1" style={{ background: THEM }} />
                </div>
                <span className="tnum w-8 text-sm font-bold" style={{ color: THEM }}>
                  {Math.round(f.b)}
                </span>
                <span
                  className="w-5 shrink-0 text-right text-[0.65rem] font-bold uppercase"
                  style={{
                    color: f.outcome === "win" ? YOU : f.outcome === "loss" ? THEM : "var(--color-mist-600)",
                  }}
                >
                  {f.outcome === "win" ? "W" : f.outcome === "loss" ? "L" : "D"}
                </span></>)}
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}
