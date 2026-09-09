import type { GapLine } from "@/lib/scoring";

const YOU = "var(--color-lime-glow)";
const THEM = "var(--color-flame)";

/**
 * One metric, both sides: the points each of you took, the split between
 * them, and the raw figures underneath.
 *
 * Shared by the Today card and by every day-by-day row on Versus, so the
 * same comparison can never render one way on one screen and another way on
 * the next. `dense` only tightens the spacing for the nested day rows — the
 * numbers and their arrangement stay identical.
 */
export default function GapLineRow({
  line,
  dense = false,
}: {
  line: GapLine;
  dense?: boolean;
}) {
  const ahead = line.delta > 0;
  const level = line.delta === 0;
  const share =
    line.mine + line.theirs > 0 ? (line.mine / (line.mine + line.theirs)) * 100 : 50;

  return (
    <div className={dense ? "py-2" : "py-3"}>
      <div className="flex items-baseline justify-between gap-3">
        <span className={dense ? "text-[0.72rem] text-mist-200" : "text-sm text-mist-200"}>
          {line.label}
        </span>
        <span
          className="tnum text-xs font-bold"
          style={{ color: level ? "var(--color-mist-600)" : ahead ? YOU : THEM }}
        >
          {level ? "level" : `${ahead ? "+" : ""}${line.delta}`}
        </span>
      </div>

      <div className="mt-1.5 flex items-center gap-2">
        <span className="tnum w-10 shrink-0 text-right text-[0.68rem]" style={{ color: YOU }}>
          {line.mine}
        </span>
        <div className="flex h-[3px] flex-1 overflow-hidden rounded-full bg-ink-800">
          <div style={{ width: `${share}%`, background: YOU }} />
          <div className="flex-1" style={{ background: THEM }} />
        </div>
        <span className="tnum w-10 shrink-0 text-[0.68rem]" style={{ color: THEM }}>
          {line.theirs}
        </span>
      </div>

      <div className="mt-1 flex justify-between gap-3 text-[0.62rem] text-mist-600">
        <span>{line.mineDetail}</span>
        <span>{line.theirsDetail}</span>
      </div>
    </div>
  );
}
