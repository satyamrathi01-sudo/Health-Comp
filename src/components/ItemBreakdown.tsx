import type { Breakdown } from "@/lib/breakdown";

const YOU = "var(--color-lime-glow)";
const THEM = "var(--color-flame)";

/**
 * What each of you actually did, item by item.
 *
 * Rows are the union of both sides, so something only one person ate or did
 * still appears — with a zero against the other. That absence is usually the
 * whole story, and hiding it would leave the totals unexplained.
 */
export default function ItemBreakdown({
  breakdown,
  unit,
  theirName,
  emptyText,
}: {
  breakdown: Breakdown;
  unit: string;
  theirName: string;
  emptyText: string;
}) {
  const b = breakdown;

  if (b.empty) {
    return (
      <div className="surface px-5 py-6 text-center">
        <p className="text-xs leading-relaxed text-mist-600">{emptyText}</p>
      </div>
    );
  }

  const fmt = (n: number) => `${Math.round(n * 10) / 10}${unit}`;

  return (
    <div className="surface overflow-hidden">
      <div className="hair-b flex items-baseline justify-between gap-3 px-5 py-3.5">
        <span className="tnum text-sm font-bold" style={{ color: YOU }}>
          {fmt(b.mineTotal)}
          <span className="ml-1.5 text-[0.65rem] font-normal text-mist-600">you</span>
        </span>
        <span className="tnum text-sm font-bold" style={{ color: THEM }}>
          <span className="mr-1.5 text-[0.65rem] font-normal text-mist-600">{theirName}</span>
          {fmt(b.theirsTotal)}
        </span>
      </div>

      <div className="px-5">
        {b.rows.map((row, i) => {
          const total = row.mine + row.theirs;
          const share = total > 0 ? (row.mine / total) * 100 : 50;
          const onlyTheirs = row.mine === 0;
          const onlyMine = row.theirs === 0;

          return (
            <div key={row.name} className={i > 0 ? "hair py-2.5" : "py-2.5"}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 flex-1 truncate text-sm capitalize text-mist-200">
                  {row.name}
                </span>
                {Math.abs(row.delta) > 0 && (
                  <span
                    className="tnum shrink-0 text-xs font-bold"
                    style={{ color: row.delta > 0 ? THEM : YOU }}
                  >
                    {row.delta > 0 ? "+" : "−"}
                    {fmt(Math.abs(row.delta))}
                  </span>
                )}
              </div>

              <div className="mt-1.5 flex items-center gap-2">
                <span className="tnum w-12 shrink-0 text-right text-[0.62rem]" style={{ color: YOU }}>
                  {fmt(row.mine)}
                </span>
                <div className="flex h-[3px] flex-1 overflow-hidden rounded-full bg-ink-800">
                  <div style={{ width: `${share}%`, background: YOU }} />
                  <div className="flex-1" style={{ background: THEM }} />
                </div>
                <span className="tnum w-12 shrink-0 text-[0.62rem]" style={{ color: THEM }}>
                  {fmt(row.theirs)}
                </span>
              </div>

              {(onlyTheirs || onlyMine) && (
                <p className="mt-1 text-[0.62rem] text-mist-600">
                  {onlyTheirs ? `Only ${theirName}.` : "Only you."}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
