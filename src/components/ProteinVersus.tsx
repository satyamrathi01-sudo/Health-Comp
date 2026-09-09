import type { ProteinComparison, SourceGap } from "@/lib/versus";

const YOU = "var(--color-lime-glow)";
const THEM = "var(--color-flame)";

/**
 * Why they are ahead of you on protein, food by food.
 *
 * The bars are each side against their OWN target, not against each other's
 * grams — 130 g means different things to a 60 kg runner and a 95 kg lifter,
 * and the score already knows that.
 */
export default function ProteinVersus({
  comparison,
  theirName,
  scope,
}: {
  comparison: ProteinComparison;
  theirName: string;
  /** What the numbers cover, e.g. "today" or "the last 14 days". */
  scope: string;
}) {
  const c = comparison;

  if (c.empty) {
    return (
      <div className="surface px-5 py-6 text-center">
        <p className="text-xs leading-relaxed text-mist-600">{c.explain}</p>
      </div>
    );
  }

  const behind = c.gapG > 0;

  return (
    <div className="surface overflow-hidden">
      <div className="hair-b px-5 py-4">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-base font-semibold leading-snug text-white">{c.headline}</p>
          {Math.abs(c.pointsGap) >= 0.1 && (
            <span
              className="tnum shrink-0 text-xs font-bold"
              style={{ color: behind ? THEM : YOU }}
            >
              {behind ? "−" : "+"}
              {Math.abs(c.pointsGap)} pts
            </span>
          )}
        </div>
        <p className="mt-1 text-[0.65rem] text-mist-600">Protein, {scope}</p>
      </div>

      {/* ---- each side against their own target ---- */}
      <div className="px-5 py-4">
        <TargetBar label="You" grams={c.mineG} target={c.mineTarget} pct={c.minePct} color={YOU} />
        <div className="mt-3">
          <TargetBar
            label={theirName}
            grams={c.theirsG}
            target={c.theirsTarget}
            pct={c.theirsPct}
            color={THEM}
          />
        </div>
      </div>

      {/* ---- the foods that made the difference ---- */}
      {c.theirEdge.length > 0 && (
        <div className="hair px-5 py-4">
          <p className="eyebrow mb-2.5">Where their protein came from</p>
          {c.theirEdge.slice(0, 4).map((line, i) => (
            <FoodRow key={line.name} line={line} theirName={theirName} first={i === 0} />
          ))}
        </div>
      )}

      {c.myEdge.length > 0 && behind && (
        <div className="hair px-5 py-3">
          <p className="eyebrow mb-2">Where you were ahead</p>
          <p className="text-[0.72rem] leading-relaxed text-mist-400">
            {c.myEdge
              .slice(0, 3)
              .map((l) => `${l.name.toLowerCase()} (+${Math.abs(l.delta)} g)`)
              .join(", ")}
          </p>
        </div>
      )}

      {/* ---- the one thing to change ---- */}
      <div className="hair px-5 py-4">
        <p className="eyebrow mb-1.5">{behind ? "The swap" : "What is working"}</p>
        <p className="text-[0.8rem] leading-relaxed text-mist-200">{c.explain}</p>
      </div>
    </div>
  );
}

function TargetBar({
  label, grams, target, pct, color,
}: { label: string; grams: number; target: number; pct: number; color: string }) {
  const width = Math.max(0, Math.min(100, pct * 100));
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm text-mist-200">{label}</span>
        <span className="tnum text-xs" style={{ color }}>
          {Math.round(pct * 100)}%
          <span className="text-mist-600">
            {" "}
            of their own aim
          </span>
        </span>
      </div>
      <div className="mt-1.5 h-[5px] w-full overflow-hidden rounded-full bg-ink-800">
        <div className="h-full rounded-full" style={{ width: `${width}%`, background: color }} />
      </div>
      <div className="tnum mt-1 text-[0.62rem] text-mist-600">
        {grams} g{target > 0 ? ` of ${target} g` : ""}
      </div>
    </div>
  );
}

function FoodRow({
  line, theirName, first,
}: { line: SourceGap; theirName: string; first: boolean }) {
  const total = line.mine + line.theirs;
  const mineShare = total > 0 ? (line.mine / total) * 100 : 0;

  return (
    <div className={first ? "py-2" : "hair py-2"}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 flex-1 truncate text-sm capitalize text-mist-200">{line.name}</span>
        <span className="tnum shrink-0 text-xs font-bold" style={{ color: THEM }}>
          +{line.delta} g
        </span>
      </div>
      <div className="mt-1.5 flex items-center gap-2">
        <span className="tnum w-9 shrink-0 text-right text-[0.62rem]" style={{ color: YOU }}>
          {line.mine}g
        </span>
        <div className="flex h-[3px] flex-1 overflow-hidden rounded-full bg-ink-800">
          <div style={{ width: `${mineShare}%`, background: YOU }} />
          <div className="flex-1" style={{ background: THEM }} />
        </div>
        <span className="tnum w-9 shrink-0 text-[0.62rem]" style={{ color: THEM }}>
          {line.theirs}g
        </span>
      </div>
      {line.mine === 0 && (
        <p className="mt-1 text-[0.62rem] text-mist-600">
          You did not eat this; {theirName} did.
        </p>
      )}
    </div>
  );
}
