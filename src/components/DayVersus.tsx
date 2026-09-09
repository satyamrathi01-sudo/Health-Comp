import { compareScores, type DayScore, type ScoreLine } from "@/lib/scoring";
import GapLineRow from "./GapLine";

const YOU = "var(--color-lime-glow)";
const THEM = "var(--color-flame)";

/**
 * The order the lines are ALWAYS listed in, rather than compareScores'
 * biggest-gap-first. Over a month of stacked days a shifting order is
 * unreadable: you cannot follow protein down the list if it moves rows every
 * day. Fixed order turns the expanded days into a column you can scan.
 */
const ORDER: ScoreLine["key"][] = ["burn", "protein", "net", "minutes", "logging", "streak"];
const RANK = new Map(ORDER.map((k, i) => [k, i]));

function label(day: string, isToday: boolean): string {
  if (isToday) return "Today";
  return new Date(day + "T00:00:00").toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

/**
 * One fixture, openable.
 *
 * Closed it is the result — who took the day and by how much. Open it is
 * every metric that produced that result, each side against their own
 * target. The lines sum to exactly the totals in the summary row, streak
 * bonus included, so the breakdown always reconciles with the score above
 * it rather than approximating it.
 *
 * A native <details>, so this stays a server component: no hydration, no
 * client bundle, and it opens before JavaScript has loaded.
 */
export default function DayVersus({
  day,
  mine,
  theirs,
  isToday,
  first,
}: {
  day: string;
  mine: DayScore;
  theirs: DayScore;
  isToday: boolean;
  first: boolean;
}) {
  const played = mine.logged || theirs.logged;
  const edge = first ? "" : "hair";

  // A day nobody logged has no metrics worth opening — every line would read
  // zero against zero. It stays a flat, dimmed row.
  if (!played) {
    return (
      <div className={`flex items-center gap-3 py-3 opacity-40 ${edge}`}>
        <span className="w-[5.5rem] shrink-0 text-[0.7rem] text-mist-600">
          {label(day, isToday)}
        </span>
        <span className="flex-1 text-center text-[0.7rem] text-mist-600">not logged</span>
      </div>
    );
  }

  const diff = mine.total - theirs.total;
  const result = Math.abs(diff) < 0.05 ? "draw" : diff > 0 ? "won" : "lost";
  const lines = [...compareScores(mine, theirs).lines].sort(
    (a, b) => (RANK.get(a.key) ?? 99) - (RANK.get(b.key) ?? 99),
  );
  const share =
    mine.total + theirs.total > 0 ? (mine.total / (mine.total + theirs.total)) * 100 : 50;

  return (
    <details className={`day-versus ${edge}`}>
      <summary className="py-3">
        <div className="flex items-center gap-3">
          <span className="w-[5.5rem] shrink-0 text-[0.7rem] text-mist-600">
            {label(day, isToday)}
          </span>
          <span className="tnum w-8 text-right text-sm font-bold" style={{ color: YOU }}>
            {Math.round(mine.total)}
          </span>
          <div className="flex h-[3px] flex-1 overflow-hidden rounded-full bg-ink-800">
            <div style={{ width: `${share}%`, background: YOU }} />
            <div className="flex-1" style={{ background: THEM }} />
          </div>
          <span className="tnum w-8 text-sm font-bold" style={{ color: THEM }}>
            {Math.round(theirs.total)}
          </span>
          <span
            className="w-5 shrink-0 text-right text-[0.65rem] font-bold uppercase"
            style={{
              color: result === "won" ? YOU : result === "lost" ? THEM : "var(--color-mist-600)",
            }}
          >
            {result === "won" ? "W" : result === "lost" ? "L" : "D"}
          </span>
          <svg
            width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
            className="chev shrink-0 text-mist-600" aria-hidden="true"
          >
            <path d="m9 18 6-6-6-6" />
          </svg>
        </div>
      </summary>

      <div className="pb-1 pl-[5.5rem] pr-1">
        {lines.map((line) => (
          <GapLineRow key={line.key} line={line} dense />
        ))}
      </div>
    </details>
  );
}
