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


export default async function VersusPage({
  searchParams,
}: {
  searchParams: Promise<{ vs?: string }>;
}) {
  const { vs } = await searchParams;
  // foodDays: 1 — this screen compares today and only today, so there is no
  // reason to ship a fortnight of items it will never read. The full
  // fortnight lives one tap away on /vs/[id].
  const arena = await requireArena({ days: 30, foodDays: 1 });

  const me = mine(arena);
  const others = rivals(arena);
  // Whoever the ?vs= chip selected, falling back to the rival currently
  // ahead. In a challenge with several people this screen used to be stuck
  // on the leader, which is the one person you can already see is winning.
  const them = others.find((p) => p.profile.id === vs) ?? rival(arena);

  if (!them) {
    return (
      <div className="rise">
        <PageHeader
          title="Versus"
          subtitle="Nobody to beat yet"
          right={<PlayingCount count={arena.playersEnrolled} />}
        />
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

  // Always today, including when today is empty.
  //
  // This used to widen to a fortnight whenever the two of you had not BOTH
  // logged, which meant every morning opened on a two-week total under a
  // headline that read like a live standing — and logging your own breakfast
  // did not clear it, because it was still waiting on the other person. A
  // card about today should start the day empty and fill as you eat.
  const protein = compareProtein({
    mineItems: itemsFor(arena, arena.me.id, arena.today),
    theirItems: itemsFor(arena, them.profile.id, arena.today),
    // Each side against their own target, which is the whole basis of the
    // score. Their target is published; their body is not.
    mineTarget: me.targets?.proteinTarget ?? 0,
    theirTarget: them.targets?.proteinTarget ?? 0,
    theirName: firstName,
  });

  const subtitle = arena.challenge ? arena.challenge.name : "Last 30 days";

  return (
    <div className="rise space-y-8">
      <PageHeader
        title="Versus"
        subtitle={subtitle}
        right={<PlayingCount count={arena.playersEnrolled} />}
      />

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

      {others.length > 1 && (
        <nav className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
          {others.map((p) => {
            const active = p.profile.id === them.profile.id;
            return (
              <Link
                key={p.profile.id}
                href={active ? "/vs" : `/vs?vs=${p.profile.id}`}
                scroll={false}
                aria-current={active ? "true" : undefined}
                className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold ${
                  active ? "bg-lime-glow text-ink-900" : "surface text-mist-200"
                }`}
              >
                <span aria-hidden="true">{p.profile.avatar_emoji}</span>
                {p.profile.display_name.split(" ")[0]}
              </Link>
            );
          })}
        </nav>
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
        <ProteinVersus comparison={protein} theirName={firstName} scope="Today" />
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
                rivalId={them.profile.id}
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

/**
 * Everyone in a running challenge anywhere in the app — not just this one.
 *
 * A bare count on purpose. It comes from a definer function that returns a
 * single integer (players_in_challenges in schema.sql), so it says how busy
 * the place is without saying who is in it. Hub and spoke still decides
 * every name on the rest of this screen.
 */
function PlayingCount({ count }: { count: number | null }) {
  // Null until schema.sql v11 has been run; there is nothing honest to show.
  if (count === null) return null;
  return (
    <div
      className="flex shrink-0 items-center gap-1.5 rounded-full border border-hair px-3 py-1.5"
      title="People in a running challenge anywhere on FitClash"
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
        className="shrink-0 text-mist-600" aria-hidden="true">
        <path d="M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM2 21a7 7 0 0 1 14 0M16 3.1a4 4 0 0 1 0 7.8M22 21a7 7 0 0 0-4-6.3" />
      </svg>
      <span className="tnum text-sm font-bold text-white">{count.toLocaleString("en-GB")}</span>
      <span className="text-[0.62rem] text-mist-600">in challenges</span>
    </div>
  );
}
