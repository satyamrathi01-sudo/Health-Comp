import { MICRO_REFS, microTarget, microVerdict } from "@/lib/calc";
import type { DailyTotals, Sex } from "@/lib/types";

const TONE = {
  low: "var(--color-gold)",
  over: "var(--color-flame)",
  good: "var(--color-lime-glow)",
} as const;

/**
 * Micronutrients against Indian (ICMR) reference values. Nothing here feeds
 * the score — it is context, and the input the coach reasons over.
 */
export default function MicroPanel({ totals, sex }: { totals: DailyTotals | null; sex: Sex | null }) {
  if (!totals || totals.meals === 0) {
    return (
      <p className="px-1 py-3 text-xs text-mist-600">
        Log a meal to see how your micronutrients are tracking.
      </p>
    );
  }

  const rows = MICRO_REFS.map((ref) => {
    const value = Number(totals[ref.key] ?? 0);
    const target = microTarget(ref, sex);
    return { ref, value, target, verdict: microVerdict(value, ref, sex) };
  });

  // Anything low or over the limit is what you actually need to see.
  const flagged = rows.filter((r) => r.verdict !== "good");

  return (
    <div>
      {flagged.length > 0 && (
        <p className="mb-3 text-[0.7rem] leading-relaxed text-mist-400">
          {flagged.length} to watch:{" "}
          {flagged.map((f) => f.ref.label).join(", ")}
        </p>
      )}
      <div className="surface px-4">
        {rows.map(({ ref, value, target, verdict }, i) => (
          <div key={ref.key} className={i > 0 ? "hair py-3" : "py-3"}>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-sm text-mist-200">{ref.label}</span>
              <span className="tnum text-xs" style={{ color: TONE[verdict] }}>
                {Math.round(value * 10) / 10}
                <span className="text-mist-600">
                  {" / "}{target} {ref.unit}
                </span>
              </span>
            </div>
            <div className="mt-2 h-[3px] w-full overflow-hidden rounded-full bg-ink-800">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${Math.max(0, Math.min(100, (value / target) * 100))}%`,
                  background: TONE[verdict],
                }}
              />
            </div>
            {verdict !== "good" && (
              <p className="mt-1.5 text-[0.65rem] text-mist-600">
                {verdict === "over" ? "Over the limit — " : "Running low — "}
                {ref.why.toLowerCase()}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
