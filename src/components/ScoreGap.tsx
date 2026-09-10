import { compareScores, type DayScore } from "@/lib/scoring";
import GapLineRow from "./GapLine";

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
      ? "Tied"
      : gap.leader === "me"
        ? `You're ahead by ${Math.abs(gap.delta)}`
        : `${theirName} is ahead by ${Math.abs(gap.delta)}`;

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
                : "Same on every line."}
          </p>
        )}
      </div>

      <div className="px-5">
        {(compact ? gap.lines.filter((l) => l.delta !== 0) : gap.lines).map((line, i) => (
          <div key={line.key} className={i > 0 ? "hair" : ""}>
            <GapLineRow line={line} />
          </div>
        ))}
      </div>

      {behindLine?.toClose && (
        <div className="hair px-5 py-3.5">
          <p className="eyebrow mb-1.5">How to catch up</p>
          <p className="text-[0.8rem] leading-relaxed text-mist-200">
            {behindLine.toClose}
          </p>
        </div>
      )}
    </div>
  );
}
