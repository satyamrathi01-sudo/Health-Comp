import Link from "next/link";
import { loadArena, mine, rival, rivals, type PlayerView } from "@/lib/data";
import { EmptyState, PageHeader, Section } from "@/components/ui";
import type { DayScore } from "@/lib/scoring";

export const dynamic = "force-dynamic";
export const metadata = { title: "Versus · FitClash" };

const YOU = "var(--color-lime-glow)";
const THEM = "var(--color-flame)";

export default async function VersusPage() {
  const arena = await loadArena(30);
  if (!arena) return null;

  const me = mine(arena);
  const them = rival(arena);
  const others = rivals(arena);

  if (!them) {
    return (
      <div className="rise">
        <PageHeader title="Versus" subtitle="Nobody to beat yet" />
        <EmptyState
          icon="○"
          title="Your rival hasn't joined"
          body="Share the invite code from the Me tab. Once they're in, every day becomes a fixture."
        />
      </div>
    );
  }

  const days = [...arena.days].reverse().filter(
    (d) => me.scores.get(d)!.logged || them.scores.get(d)!.logged,
  );

  const subtitle = arena.challenge
    ? arena.challenge.name
    : "Last 30 days";

  return (
    <div className="rise space-y-8">
      <PageHeader title="Versus" subtitle={subtitle} />

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
            <Side player={them} color={THEM} align="right" label={them.profile.display_name.split(" ")[0]} />
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

      {/* ---------- fixtures ---------- */}
      <Section title={others.length > 1 ? `Day by day · vs ${them.profile.display_name.split(" ")[0]}` : "Day by day"}>
        {days.length === 0 ? (
          <EmptyState icon="○" title="Nothing logged yet" body="First one to log takes the lead." />
        ) : (
          <div className="surface px-5">
            {days.map((day, i) => (
              <DayRow
                key={day}
                day={day}
                a={me.scores.get(day)!}
                b={them.scores.get(day)!}
                isToday={day === arena.today}
                first={i === 0}
              />
            ))}
          </div>
        )}
      </Section>
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

function DayRow({
  day, a, b, isToday, first,
}: { day: string; a: DayScore; b: DayScore; isToday: boolean; first: boolean }) {
  const label = isToday
    ? "Today"
    : new Date(day + "T00:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });

  const diff = a.total - b.total;
  const result = Math.abs(diff) < 0.05 ? "draw" : diff > 0 ? "won" : "lost";

  return (
    <div className={`flex items-center gap-3 ${first ? "py-3" : "hair py-3"}`}>
      <span className="w-[5.5rem] shrink-0 text-[0.7rem] text-mist-600">{label}</span>
      <span className="tnum w-8 text-right text-sm font-bold" style={{ color: YOU }}>
        {Math.round(a.total)}
      </span>
      <div className="flex h-[3px] flex-1 overflow-hidden rounded-full bg-ink-800">
        <div
          style={{
            width: `${a.total + b.total > 0 ? (a.total / (a.total + b.total)) * 100 : 50}%`,
            background: YOU,
          }}
        />
        <div className="flex-1" style={{ background: THEM }} />
      </div>
      <span className="tnum w-8 text-sm font-bold" style={{ color: THEM }}>
        {Math.round(b.total)}
      </span>
      <span
        className="w-6 shrink-0 text-right text-[0.65rem] font-bold uppercase"
        style={{
          color: result === "won" ? YOU : result === "lost" ? THEM : "var(--color-mist-600)",
        }}
      >
        {result === "won" ? "W" : result === "lost" ? "L" : "D"}
      </span>
    </div>
  );
}
