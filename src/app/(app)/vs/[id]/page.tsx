import Link from "next/link";
import { notFound } from "next/navigation";
import { itemsFor, mine, requireArena } from "@/lib/data";
import { dayOutcome, type DayScore } from "@/lib/scoring";
import { compareProtein } from "@/lib/versus";
import { EmptyState, PageHeader, Section } from "@/components/ui";
import ScoreGap from "@/components/ScoreGap";
import ProteinVersus from "@/components/ProteinVersus";
import DayVersus from "@/components/DayVersus";

export const dynamic = "force-dynamic";

const YOU = "var(--color-lime-glow)";
const THEM = "var(--color-flame)";

const FOOD_WINDOW = 14;

export default async function OneOnOnePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const arena = await requireArena({ days: 30, foodDays: FOOD_WINDOW });

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
  // The whole DayScore is kept, not just its total: each row opens into the
  // metrics behind it, and those live on the score itself.
  const fixtures: { day: string; a: DayScore; b: DayScore }[] = [];
  for (const day of arena.days) {
    if (day < firstDay) continue;
    const a = me.scores.get(day)!;
    const b = them.scores.get(day)!;
    if (a.logged || b.logged) {
      const outcome = dayOutcome(a, b);
      if (outcome === "win") wins++;
      else if (outcome === "loss") losses++;
      else if (outcome === "tie") draws++;
    }
    // Missed days are kept and dimmed: a gap is information, not an absence.
    fixtures.push({ day, a, b });
  }
  fixtures.reverse();

  const todayMine = me.scores.get(arena.today)!;
  const todayTheirs = them.scores.get(arena.today)!;

  const proteinArgs = {
    mineTarget: me.targets?.proteinTarget ?? 0,
    theirTarget: them.targets?.proteinTarget ?? 0,
    theirName: firstName,
  };

  // Both scopes here, because they answer different questions: today is what
  // you can still act on, the fortnight is where the pattern lives. Today is
  // shown even when it is empty — a day that has not started yet is a fact,
  // and hiding the card would leave the fortnight looking like today.
  const todayProtein = compareProtein({
    ...proteinArgs,
    mineItems: itemsFor(arena, arena.me.id, arena.today),
    theirItems: itemsFor(arena, them.profile.id, arena.today),
  });
  const windowProtein = compareProtein({
    ...proteinArgs,
    mineItems: itemsFor(arena, arena.me.id),
    theirItems: itemsFor(arena, them.profile.id),
  });

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

      {/* ---------- what actually made the protein gap ---------- */}
      <Section title="Protein, food by food">
        <ProteinVersus comparison={todayProtein} theirName={firstName} scope="Today" />
      </Section>

      <Section title="The pattern">
        <ProteinVersus
          comparison={windowProtein}
          theirName={firstName}
          scope={`Last ${FOOD_WINDOW} days`}
        />
      </Section>

      {/* ---------- today, explained ---------- */}
      <Section title="Today, line by line">
        <ScoreGap mine={todayMine} theirs={todayTheirs} theirName={firstName} />
      </Section>

      {/* ---------- fixtures ---------- */}
      <Section
        title="Every day"
        action={<span className="text-[0.65rem] text-mist-600">tap a day</span>}
      >
        {fixtures.length === 0 ? (
          <EmptyState icon="○" title="No logged days yet" />
        ) : (
          <div className="surface px-5">
            {fixtures.map((f, i) => (
              <DayVersus
                key={f.day}
                day={f.day}
                mine={f.a}
                theirs={f.b}
                isToday={f.day === arena.today}
                first={i === 0}
              />
            ))}
          </div>
        )}
      </Section>

      <p className="px-1 text-[0.62rem] leading-relaxed text-mist-600">
        {firstName} is scored against {firstName}&apos;s own targets and you against yours, so
        this is a comparison of effort. Neither of you can see the other&apos;s height, weight,
        age or weigh-ins.
      </p>
    </div>
  );
}
