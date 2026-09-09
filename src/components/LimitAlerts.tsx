import type { TrackedLimit } from "@/lib/limits";

/**
 * What you have already gone past today, at the very top of the screen.
 *
 * Red for over the line, amber for nearly there. Anything comfortably
 * inside its limit is not mentioned at all — the whole value of this block
 * is that seeing it means something.
 */
export default function LimitAlerts({ limits }: { limits: TrackedLimit[] }) {
  if (!limits.length) return null;

  const over = limits.filter((l) => l.state === "over");
  const close = limits.filter((l) => l.state === "close");

  return (
    <section
      aria-label="Limits reached today"
      className="overflow-hidden rounded-[1.25rem] border"
      style={{
        borderColor: over.length
          ? "color-mix(in srgb, var(--color-danger) 45%, transparent)"
          : "color-mix(in srgb, var(--color-gold) 40%, transparent)",
        background: over.length
          ? "color-mix(in srgb, var(--color-danger) 9%, var(--color-ink-900))"
          : "color-mix(in srgb, var(--color-gold) 8%, var(--color-ink-900))",
      }}
    >
      <div className="flex items-baseline justify-between gap-3 px-5 pt-4">
        <p
          className="text-sm font-semibold"
          style={{ color: over.length ? "var(--color-danger)" : "var(--color-gold)" }}
        >
          {over.length
            ? `${over.length} limit${over.length === 1 ? "" : "s"} reached`
            : `${close.length} close to the limit`}
        </p>
        <span className="eyebrow">today</span>
      </div>

      <div className="px-5 pb-1.5 pt-2">
        {limits.map((l, i) => {
          const color = l.state === "over" ? "var(--color-danger)" : "var(--color-gold)";
          return (
            <div key={l.key} className={i > 0 ? "hair py-3" : "pb-3 pt-1"}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm font-semibold" style={{ color }}>
                  {l.label}
                </span>
                <span className="tnum text-xs" style={{ color }}>
                  {l.value}
                  <span className="text-mist-600">
                    {" / "}
                    {l.limit} {l.unit}
                  </span>
                </span>
              </div>

              <div className="mt-2 h-[3px] w-full overflow-hidden rounded-full bg-ink-800">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${Math.min(100, l.pct * 100)}%`, background: color }}
                />
              </div>

              <p className="mt-1.5 text-[0.65rem] leading-relaxed text-mist-400">
                {l.state === "over"
                  ? `${l.over} ${l.unit} over — ${l.why.toLowerCase()}`
                  : `${Math.round((1 - l.pct) * l.limit * 10) / 10} ${l.unit} left — ${l.why.toLowerCase()}`}
              </p>
            </div>
          );
        })}
      </div>
    </section>
  );
}
