import Link from "next/link";
import { itemsFor, mine, requireArena, rival, rivals, type PlayerView } from "@/lib/data";
import { compareProtein } from "@/lib/versus";
import { EmptyState, PageHeader, Section } from "@/components/ui";
import ChallengeSwitcher from "@/components/ChallengeSwitcher";
import ProteinVersus from "@/components/ProteinVersus";
import ScoreGap from "@/components/ScoreGap";
import DayVersus from "@/components/DayVersus";

export const dynamic = "force-dynamic";
export const metadata = { title: "Versus · FitClash" };

const YOU = "var(--color-lime-glow)";
const THEM = "var(--color-flame)";

/** How far back the food breakdown looks when today is thin. */
const FOOD_WINDOW = 14;

export default async function VersusPage() {
  const arena = await requireArena({ days: 30, foodDays: FOOD_WINDOW });

  const me = mine(arena);
  const them = rival(arena);
  const others = rivals(arena);

  if (!them) {
    return (
      <div className="rise">
        <PageHeader title="Versus" subtitle="Nobody to beat yet" />
        {arena.myChallenges.length > 1 && (
          <div className="mb-6">
            <ChallengeSwitcher challenges={arena.myChallenges} activeId={arena.challenge?.id ?? null} />
          </div>
        )}
        <EmptyState
          icon="○"
          title="Your rival hasn't joined"
          body="Share the invite code from the Me tab. Once they're in, every day becomes a fixture."
        />
      </div>
    );
  }

  const firstName = them.profile.display_name.split(" ")[0];

  // Every day since the challenge began (bounded by the loaded window), so
  // missed days show as gaps rather than vanishing. A calendar you can see
  // holes in is more useful than a list that hides them.
  const firstDay = arena.challenge
    ? [arena.challenge.start_date, arena.days[0]].sort().reverse()[0]
    : arena.days[0];
  const days = [...arena.days].filter((d) => d >= firstDay).reverse();

  const todayMine = me.scores.get(arena.today)!;
  const todayTheirs = them.scores.get(arena.today)!;

  // Today when there is a today worth reading; otherwise the fortnight. The
  // point of this card is to name a food, and one thin morning names nothing.
  const bothLoggedToday =
    itemsFor(arena, arena.me.id, arena.today).length > 0 &&
    itemsFor(arena, them.profile.id, arena.today).length > 0;

  const scope = bothLoggedToday ? "today" : `the last ${FOOD_WINDOW} days`;
  const date = bothLoggedToday ? arena.today : undefined;

  const protein = compareProtein({
    mineItems: itemsFor(arena, arena.me.id, date),
    theirItems: itemsFor(arena, them.profile.id, date),
    // Each side against their own target, which is the whole basis of the
    // score. Their target is published; their body is not.
    mineTarget: me.targets?.proteinTarget ?? 0,
    theirTarget: them.targets?.proteinTarget ?? 0,
    theirName: firstName,
  });

  const subtitle = arena.challenge ? arena.challenge.name : "Last 30 days";

  return (
    <div className="rise space-y-8">
      <PageHeader title="Versus" subtitle={subtitle} />

      {arena.myChallenges.length > 1 && (
        <ChallengeSwitcher challenges={arena.myChallenges} activeId={arena.challenge?.id ?? null} />
      )}

      {/* ---------- the standing ---------- */}
      {others.length === 1 ? (
        <section className="flex items-start justify-between">
          <Side player={me} color={YOU} align="left" label="You" />
          <div className="pt-6 text-center">
            <div className="eyebrow">days won</div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="hero-num tnum text-4xl" style={{ color: YOU }}>{me.wins}</span>
              <span className="text-lg text-mist-600">–</span>
              <span className="hero-num tnum text-4xl" style={{ color: THEM }}>{them.wins}</span>
            </div>
            {me.ties > 0 && (
              <div className="tnum mt-1.5 text-[0.65rem] text-mist-600">{me.ties} drawn</div>
            )}
          </div>
          <Link href={`/vs/${them.profile.id}`}>
            <Side player={them} color={THEM} align="right" label={firstName} />
          </Link>
        </section>
      ) : (
        <Section title="Standings">
          <div className="surface px-5">
            {[me, ...others]
              .slice()
              .sort((a, b) => b.points - a.points)
              .map((p, i) => {
                const row = (
                  <>
                    <span className="tnum w-4 text-xs text-mist-600">{i + 1}</span>
                    <span className="text-xl" aria-hidden="true">{p.profile.avatar_emoji}</span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold text-white">
                        {p.isMe ? "You" : p.profile.display_name}
                      </div>
                      <div className="tnum mt-0.5 text-[0.65rem] text-mist-600">
                        {p.wins}W · {p.losses}L · {p.ties}D
                        {p.streak > 0 && ` · 🔥${p.streak}`}
                      </div>
                    </div>
                    <span className="tnum text-lg font-bold" style={{ color: p.isMe ? YOU : THEM }}>
                      {Math.round(p.points)}
                    </span>
                    {!p.isMe && (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                        strokeWidth="2.5" strokeLinecap="round" className="shrink-0 text-mist-600"
                        aria-hidden="true">
                        <path d="m9 18 6-6-6-6" />
                      </svg>
                    )}
                  </>
                );
                const cls = `flex items-center gap-3 py-3.5 ${i > 0 ? "hair" : ""}`;
                return p.isMe ? (
                  <div key={p.profile.id} className={cls}>{row}</div>
                ) : (
                  <Link key={p.profile.id} href={`/vs/${p.profile.id}`} className={cls}>{row}</Link>
                );
              })}
          </div>
          <p className="mt-2 px-1 text-[0.65rem] leading-relaxed text-mist-600">
            Tap anyone for the head-to-head. You created this challenge, so you see
            everyone — each of them sees only their own numbers against yours.
          </p>
        </Section>
      )}

      {/* ---------- the point of the whole screen ---------- */}
      <Section
        title={`Protein · you vs ${firstName}`}
        action={
          <Link href={`/vs/${them.profile.id}`} className="text-xs font-semibold text-lime-glow">
            Full analysis
          </Link>
        }
      >
        <ProteinVersus comparison={protein} theirName={firstName} scope={scope} />
      </Section>

      {/* ---------- why today looks the way it does ---------- */}
      {(todayMine.logged || todayTheirs.logged) && (
        <Section title="Today, line by line">
          <ScoreGap mine={todayMine} theirs={todayTheirs} theirName={firstName} compact />
        </Section>
      )}

      {/* ---------- fixtures ---------- */}
      <Section
        title={others.length > 1 ? `Day by day · vs ${firstName}` : "Day by day"}
        action={<span className="text-[0.65rem] text-mist-600">tap a day</span>}
      >
        {days.length === 0 ? (
          <EmptyState icon="○" title="Nothing logged yet" body="First one to log takes the lead." />
        ) : (
          <div className="surface px-5">
            {days.map((day, i) => (
              <DayVersus
                key={day}
                day={day}
                mine={me.scores.get(day)!}
                theirs={them.scores.get(day)!}
                isToday={day === arena.today}
                first={i === 0}
              />
            ))}
          </div>
        )}
      </Section>

      <p className="px-1 text-[0.62rem] leading-relaxed text-mist-600">
        Everyone is scored against their own targets, so these numbers compare effort
        rather than bodies. Height, weight and age stay private to each player.
      </p>
    </div>
  );
}

function Side({
  player, color, align, label,
}: { player: PlayerView; color: string; align: "left" | "right"; label: string }) {
  return (
    <div className={align === "right" ? "text-right" : "text-left"}>
      <div className="text-3xl" aria-hidden="true">{player.profile.avatar_emoji}</div>
      <div className="mt-2 text-sm font-semibold text-white">{label}</div>
      <div className="tnum mt-1 text-[0.65rem]" style={{ color }}>
        {Math.round(player.points)} pts
      </div>
      {player.streak > 0 && (
        <div className="tnum mt-0.5 text-[0.65rem] text-gold">🔥 {player.streak}</div>
      )}
    </div>
  );
}
