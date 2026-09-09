import Link from "next/link";
import { notFound } from "next/navigation";
import { loadDayDetail, mine, requireArena } from "@/lib/data";
import { compareItems } from "@/lib/breakdown";
import { PageHeader, Section } from "@/components/ui";
import ItemBreakdown from "@/components/ItemBreakdown";
import { compareScores } from "@/lib/scoring";
import type { DailyTotals } from "@/lib/types";

export const dynamic = "force-dynamic";

const YOU = "var(--color-lime-glow)";
const THEM = "var(--color-flame)";

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * One day of one head-to-head, with the evidence behind every line.
 *
 * Two round trips rather than the usual one, and deliberately so — see the
 * note on loadDayDetail. This page is opened on purpose to answer "what did
 * they actually DO", which is per-item data no other screen needs.
 */
export default async function DayDetailPage({
  params,
}: {
  params: Promise<{ id: string; day: string }>;
}) {
  const { id, day } = await params;
  if (!ISO.test(day)) notFound();

  const arena = await requireArena({ days: 30, foodDays: 0 });
  const me = mine(arena);
  const them = arena.players.find((p) => p.profile.id === id && !p.isMe);
  if (!them) notFound();

  const myScore = me.scores.get(day);
  const theirScore = them.scores.get(day);
  if (!myScore || !theirScore) notFound();

  const firstName = them.profile.display_name.split(" ")[0];
  const detail = await loadDayDetail(id, day);

  const myTotals = me.totals.get(day) ?? null;
  const theirTotals = them.totals.get(day) ?? null;

  const foods = detail?.foods ?? [];
  const workouts = detail?.workouts ?? [];
  const byField = (v: (r: (typeof foods)[number]) => number) =>
    compareItems(foods, arena.me.id, id, v);

  const label = new Date(day + "T00:00:00").toLocaleDateString("en-GB", {
    weekday: "long", day: "numeric", month: "long",
  });

  const gap = compareScores(myScore, theirScore);
  // Points from the gap, the line's ceiling from the score itself — a line
  // that could not be judged reports max 0 and is worth saying so.
  const lineFor = (key: string) => {
    const g = gap.lines.find((l) => l.key === key);
    const own = myScore.lines.find((l) => l.key === key);
    if (!g || !own) return undefined;
    return { mine: g.mine, theirs: g.theirs, max: own.max };
  };

  // Nothing to open when the schema has not caught up. The score above is
  // still correct — it comes from the daily totals, not from these rows.
  const noDetail = detail === null;

  return (
    <div className="rise space-y-8">
      <PageHeader
        title={label}
        subtitle={`You vs ${firstName}`}
        right={
          <Link href={`/vs/${id}`} className="text-xs font-semibold text-lime-glow">
            Back
          </Link>
        }
      />

      <section className="flex items-center justify-center gap-6">
        <div className="text-center">
          <div className="text-3xl" aria-hidden="true">{arena.me.avatar_emoji}</div>
          <div className="tnum mt-1.5 text-2xl font-bold" style={{ color: YOU }}>
            {Math.round(myScore.total)}
          </div>
        </div>
        <div className="pt-3 text-xs text-mist-600">vs</div>
        <div className="text-center">
          <div className="text-3xl" aria-hidden="true">{them.profile.avatar_emoji}</div>
          <div className="tnum mt-1.5 text-2xl font-bold" style={{ color: THEM }}>
            {Math.round(theirScore.total)}
          </div>
        </div>
      </section>

      {noDetail && (
        <p className="surface px-5 py-4 text-xs leading-relaxed text-mist-600">
          The item-by-item breakdown needs get_day_detail, which this database
          does not have yet. Run supabase/schema.sql to turn it on. The scores
          below are unaffected — they come from the daily totals.
        </p>
      )}

      <Anchored id="burn" title="Calories burned" line={lineFor("burn")}>
        <ItemBreakdown
          breakdown={compareItems(workouts, arena.me.id, id, (w) => w.kcal)}
          unit=" kcal"
          theirName={firstName}
          emptyText="Neither of you logged a session on this day."
        />
      </Anchored>

      <Anchored id="minutes" title="Active minutes" line={lineFor("minutes")}>
        <ItemBreakdown
          breakdown={compareItems(workouts, arena.me.id, id, (w) => w.minutes)}
          unit=" min"
          theirName={firstName}
          emptyText="No training logged by either of you."
        />
      </Anchored>

      <Anchored id="protein" title="Protein" line={lineFor("protein")}>
        <ItemBreakdown
          breakdown={byField((f) => f.protein_g)}
          unit=" g"
          theirName={firstName}
          emptyText="No food logged by either of you."
        />
      </Anchored>

      <Anchored id="net" title="Calories eaten" line={lineFor("net")}>
        <ItemBreakdown
          breakdown={byField((f) => f.kcal)}
          unit=" kcal"
          theirName={firstName}
          emptyText="No food logged by either of you."
        />
      </Anchored>

      <Anchored id="fibre" title="Fibre" line={lineFor("fibre")}>
        <ItemBreakdown
          breakdown={byField((f) => f.fiber_g)}
          unit=" g"
          theirName={firstName}
          emptyText="No food logged by either of you."
        />
      </Anchored>

      <Anchored id="limits" title="Sugar & saturated fat" line={lineFor("limits")}>
        <CeilingTable
          mine={myTotals}
          theirs={theirTotals}
          myCeilings={me.targets?.ceilings ?? []}
          theirCeilings={them.targets?.ceilings ?? []}
          theirName={firstName}
        />
      </Anchored>

      <Anchored id="micros" title="Micronutrients" line={lineFor("micros")}>
        <MicroTable
          mine={myTotals}
          theirs={theirTotals}
          myAims={me.targets?.microAims ?? []}
          theirAims={them.targets?.microAims ?? []}
          theirName={firstName}
        />
      </Anchored>

      {/* Tracked and shown, but not scored — the score already prices the
          calories these make up, and pricing them again would double count. */}
      <Section title="Carbs and fat · not scored">
        <div className="space-y-3">
          <ItemBreakdown
            breakdown={byField((f) => f.carbs_g)}
            unit=" g carbs"
            theirName={firstName}
            emptyText="No food logged by either of you."
          />
          <ItemBreakdown
            breakdown={byField((f) => f.fat_g)}
            unit=" g fat"
            theirName={firstName}
            emptyText="No food logged by either of you."
          />
        </div>
      </Section>

      <p className="px-1 text-[0.62rem] leading-relaxed text-mist-600">
        Every line is each of you against your own target. {firstName}&apos;s height,
        weight, age and weigh-ins stay private — what you see here is what they ate
        and did, not the body it was measured against.
      </p>
    </div>
  );
}

/** A section that a metric line can link straight to, with its points on it. */
function Anchored({
  id, title, line, children,
}: {
  id: string;
  title: string;
  line: { mine: number; theirs: number; max: number } | undefined;
  children: React.ReactNode;
}) {
  return (
    <div id={id} className="anchor-target">
      <Section
        title={title}
        action={
          line ? (
            <span className="tnum text-[0.65rem] text-mist-600">
              <span style={{ color: YOU }}>{line.mine}</span>
              {" – "}
              <span style={{ color: THEM }}>{line.theirs}</span>
              {` of ${line.max}`}
            </span>
          ) : undefined
        }
      >
        {children}
      </Section>
    </div>
  );
}

function CeilingTable({
  mine, theirs, myCeilings, theirCeilings, theirName,
}: {
  mine: DailyTotals | null;
  theirs: DailyTotals | null;
  myCeilings: { key: string; label: string; limit: number }[];
  theirCeilings: { key: string; label: string; limit: number }[];
  theirName: string;
}) {
  if (myCeilings.length === 0 && theirCeilings.length === 0) {
    return <Empty>Ceilings need a published calorie target.</Empty>;
  }
  const value = (t: DailyTotals | null, key: string) =>
    t ? Number((t as unknown as Record<string, unknown>)[key] ?? 0) : 0;

  return (
    <div className="surface px-5">
      {myCeilings.map((c, i) => {
        const theirC = theirCeilings.find((x) => x.key === c.key);
        return (
          <TwoSided
            key={c.key}
            label={c.label}
            first={i === 0}
            mineText={`${Math.round(value(mine, c.key))} / ${c.limit} g`}
            theirsText={
              theirC ? `${Math.round(value(theirs, c.key))} / ${theirC.limit} g` : "—"
            }
            mineOver={value(mine, c.key) > c.limit}
            theirsOver={!!theirC && value(theirs, c.key) > theirC.limit}
            theirName={theirName}
          />
        );
      })}
    </div>
  );
}

function MicroTable({
  mine, theirs, myAims, theirAims, theirName,
}: {
  mine: DailyTotals | null;
  theirs: DailyTotals | null;
  myAims: { key: string; label: string; atRest: number; perSweat: number; maxSweatAdd: number }[];
  theirAims: { key: string; label: string; atRest: number; perSweat: number; maxSweatAdd: number }[];
  theirName: string;
}) {
  if (myAims.length === 0) return <Empty>Micronutrient aims have not been published yet.</Empty>;

  const value = (t: DailyTotals | null, key: string) =>
    t ? Number((t as unknown as Record<string, unknown>)[key] ?? 0) : 0;
  // The published aim is at rest; the sweat term is added back from the burn
  // this particular day recorded. Same arithmetic the score itself uses.
  const aimFor = (
    a: { atRest: number; perSweat: number; maxSweatAdd: number },
    t: DailyTotals | null,
  ) => a.atRest + Math.min(a.maxSweatAdd, Math.max(0, value(t, "kcal_out")) * a.perSweat);

  return (
    <div className="surface px-5">
      {myAims.map((a, i) => {
        const theirA = theirAims.find((x) => x.key === a.key);
        const myAim = aimFor(a, mine);
        const theirAim = theirA ? aimFor(theirA, theirs) : 0;
        return (
          <TwoSided
            key={a.key}
            label={a.label}
            first={i === 0}
            mineText={`${round(value(mine, a.key))} / ${round(myAim)}`}
            theirsText={theirA ? `${round(value(theirs, a.key))} / ${round(theirAim)}` : "—"}
            mineHit={value(mine, a.key) >= myAim}
            theirsHit={!!theirA && value(theirs, a.key) >= theirAim}
            theirName={theirName}
          />
        );
      })}
    </div>
  );
}

const round = (n: number) => (n < 20 ? Math.round(n * 10) / 10 : Math.round(n));

function TwoSided({
  label, first, mineText, theirsText, mineOver, theirsOver, mineHit, theirsHit,
}: {
  label: string;
  first: boolean;
  mineText: string;
  theirsText: string;
  mineOver?: boolean;
  theirsOver?: boolean;
  mineHit?: boolean;
  theirsHit?: boolean;
  theirName: string;
}) {
  // Over a ceiling is bad, hitting an aim is good — so the two tables ask for
  // opposite colouring off the same row.
  const myColor = mineOver ? THEM : mineHit ? YOU : "var(--color-mist-600)";
  const theirColor = theirsOver ? THEM : theirsHit ? YOU : "var(--color-mist-600)";

  return (
    <div className={first ? "py-2.5" : "hair py-2.5"}>
      <div className="text-[0.72rem] text-mist-200">{label}</div>
      <div className="mt-1 flex items-baseline justify-between gap-3">
        <span className="tnum text-[0.68rem]" style={{ color: myColor }}>{mineText}</span>
        <span className="tnum text-[0.68rem]" style={{ color: theirColor }}>{theirsText}</span>
      </div>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="surface px-5 py-6 text-center">
      <p className="text-xs leading-relaxed text-mist-600">{children}</p>
    </div>
  );
}
