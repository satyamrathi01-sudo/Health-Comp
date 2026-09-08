import { compareScores, type DayScore } from "@/lib/scoring";

const YOU = "var(--color-lime-glow)";
const THEM = "var(--color-flame)";

/**
 * Why the scores differ, line by line. Pure arithmetic over the same weights
 * that produced the scores, so it is exact rather than an interpretation.
 */
export default function ScoreGap({
  mine,
  theirs,
  theirName,
  compact = false,
}: {
  mine: DayScore;
  theirs: DayScore;
  theirName: string;
  compact?: boolean;
}) {
  const gap = compareScores(mine, theirs);

  if (!mine.logged && !theirs.logged) {
    return (
      <p className="px-1 py-3 text-xs text-mist-600">
        Neither of you has logged anything yet.
      </p>
    );
  }

  const headline =
    gap.leader === "level"
      ? "Dead level"
      : gap.leader === "me"
        ? `You lead by ${Math.abs(gap.delta)}`
        : `${theirName} leads by ${Math.abs(gap.delta)}`;

  // The single biggest thing costing the trailing side.
  const biggestDrop = gap.leader === "them" ? gap.drops[0] : gap.gains[0];
  const behindLine =
    gap.leader === "them" ? gap.drops[0] : gap.leader === "me" ? gap.drops[0] : null;

  return (
    <div className="surface overflow-hidden">
      <div className="hair-b px-5 py-4">
        <p className="text-base font-semibold text-white">{headline}</p>
        {biggestDrop && (
          <p className="mt-1 text-xs leading-relaxed text-mist-600">
            {gap.leader === "me"
              ? `Mostly on ${biggestDrop.label.toLowerCase()}.`
              : gap.leader === "them"
                ? `Mostly on ${biggestDrop.label.toLowerCase()}.`
                : "Identical across the board."}
          </p>
        )}
      </div>

      <div className="px-5">
        {(compact ? gap.lines.filter((l) => l.delta !== 0) : gap.lines).map((line, i) => {
          const ahead = line.delta > 0;
          const level = line.delta === 0;
          return (
            <div key={line.key} className={i > 0 ? "hair py-3" : "py-3"}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm text-mist-200">{line.label}</span>
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
                  <div
                    style={{
                      width: `${line.mine + line.theirs > 0 ? (line.mine / (line.mine + line.theirs)) * 100 : 50}%`,
                      background: YOU,
                    }}
                  />
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
        })}
      </div>

      {behindLine?.toClose && (
        <div className="hair px-5 py-3.5">
          <p className="eyebrow mb-1.5">To close the gap</p>
          <p className="text-[0.8rem] leading-relaxed text-mist-200">
            {behindLine.toClose}
          </p>
        </div>
      )}
    </div>
  );
}
