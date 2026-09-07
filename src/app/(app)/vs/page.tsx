import { loadArena, mine, rival, type PlayerView } from "@/lib/data";
import { EmptyState, PageHeader, SectionTitle, StatTile } from "@/components/ui";
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

  if (!them) {
    return (
      <div className="rise">
        <PageHeader title="Versus" subtitle="Nobody to beat yet" />
        <EmptyState
          icon="🥊"
          title="Your rival hasn't joined"
          body="Share the invite code from the Me tab. Once they're in, every day becomes a fixture."
        />
      </div>
    );
  }

  const days = [...arena.days].reverse();
  const challengeLabel = arena.challenge
    ? `${arena.challenge.name} · ends ${new Date(arena.challenge.end_date + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`
    : "Last 30 days";

  return (
    <div className="rise space-y-6">
      <PageHeader title="Versus" subtitle={challengeLabel} />

      {/* ---------------- Standings ---------------- */}
      <section className="card-raised divide-y divide-ink-700">
        {[me, them].map((p, i) => (
          <div key={p.profile.id} className="flex items-center gap-3 px-4 py-3.5">
            <span className="text-2xl" aria-hidden="true">{p.profile.avatar_emoji}</span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate font-semibold">
                  {p.isMe ? "You" : p.profile.display_name}
                </span>
                {p.streak > 0 && (
                  <span className="tnum shrink-0 text-[0.7rem] text-gold">🔥{p.streak}</span>
                )}
              </div>
              <div className="tnum mt-0.5 text-[0.7rem] text-mist-500">
                {p.wins}W · {p.losses}L · {p.ties}D
              </div>
            </div>
            <div className="text-right">
              <div className="tnum text-xl font-bold" style={{ color: i === 0 ? YOU : THEM }}>
                {Math.round(p.points)}
              </div>
              <div className="text-[0.62rem] uppercase tracking-wide text-mist-500">points</div>
            </div>
          </div>
        ))}
      </section>

      {/* ---------------- Aggregate stats ---------------- */}
      <section>
        <SectionTitle>Head to head, last 30 days</SectionTitle>
        <div className="grid grid-cols-2 gap-2.5">
          <Compare label="Calories burned" me={sum(me, "kcal_out")} them={sum(them, "kcal_out")} unit="kcal" />
          <Compare label="Protein total" me={sum(me, "protein_g")} them={sum(them, "protein_g")} unit="g" />
          <Compare label="Active minutes" me={sum(me, "active_minutes")} them={sum(them, "active_minutes")} unit="min" />
          <Compare label="Days trained" me={trainedDays(me)} them={trainedDays(them)} unit="days" />
        </div>
      </section>

      {/* ---------------- Day by day ---------------- */}
      <section>
        <SectionTitle>Day by day</SectionTitle>
        <ul className="card divide-y divide-ink-700">
          {days.map((day) => {
            const a = me.scores.get(day)!;
            const b = them.scores.get(day)!;
            if (!a.logged && !b.logged) return null;
            return <DayRow key={day} day={day} a={a} b={b} isToday={day === arena.today} />;
          })}
          {days.every((d) => !me.scores.get(d)!.logged && !them.scores.get(d)!.logged) && (
            <li className="px-4 py-6 text-center text-sm text-mist-500">
              Nothing logged yet. First one to log takes the lead.
            </li>
          )}
        </ul>
      </section>
    </div>
  );
}

function sum(p: PlayerView, key: "kcal_out" | "protein_g" | "active_minutes"): number {
  return Math.round([...p.totals.values()].reduce((a, t) => a + t[key], 0));
}

function trainedDays(p: PlayerView): number {
  return [...p.totals.values()].filter((t) => t.sessions > 0).length;
}

function Compare({ label, me, them, unit }: { label: string; me: number; them: number; unit: string }) {
  const winning = me > them;
  const total = me + them;
  const share = total > 0 ? (me / total) * 100 : 50;
  return (
    <div className="card px-3.5 py-3">
      <div className="text-[0.68rem] font-semibold uppercase tracking-wider text-mist-500">{label}</div>
      <div className="mt-1.5 flex items-baseline justify-between">
        <span className="tnum text-lg font-bold" style={{ color: winning ? YOU : "var(--color-mist-100)" }}>
          {me.toLocaleString()}
        </span>
        <span className="tnum text-sm font-semibold text-mist-500">{them.toLocaleString()}</span>
      </div>
      <div className="mt-2 flex h-1.5 overflow-hidden rounded-full bg-ink-800">
        <div style={{ width: `${share}%`, background: YOU }} />
        <div className="flex-1" style={{ background: THEM }} />
      </div>
      <div className="mt-1 text-[0.62rem] text-mist-500">{unit}</div>
    </div>
  );
}

function DayRow({ day, a, b, isToday }: { day: string; a: DayScore; b: DayScore; isToday: boolean }) {
  const label = isToday
    ? "Today"
    : new Date(day + "T00:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });

  const diff = a.total - b.total;
  const result = Math.abs(diff) < 0.05 ? "draw" : diff > 0 ? "won" : "lost";

  return (
    <li className="flex items-center gap-3 px-4 py-2.5">
      <span className="w-24 shrink-0 text-xs text-mist-500">{label}</span>
      <span className="tnum w-10 text-right text-sm font-bold" style={{ color: YOU }}>
        {Math.round(a.total)}
      </span>
      <div className="flex h-1.5 flex-1 overflow-hidden rounded-full bg-ink-800">
        <div
          style={{ width: `${a.total + b.total > 0 ? (a.total / (a.total + b.total)) * 100 : 50}%`, background: YOU }}
        />
        <div className="flex-1" style={{ background: THEM }} />
      </div>
      <span className="tnum w-10 text-sm font-bold" style={{ color: THEM }}>
        {Math.round(b.total)}
      </span>
      <span
        className={`w-9 shrink-0 text-right text-[0.65rem] font-bold uppercase ${
          result === "won" ? "text-lime-glow" : result === "lost" ? "text-flame" : "text-mist-500"
        }`}
      >
        {result === "won" ? "Win" : result === "lost" ? "Loss" : "Draw"}
      </span>
    </li>
  );
}
