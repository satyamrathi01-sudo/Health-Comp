import type { Overage } from "@/lib/overage";
import LimitSwaps from "./LimitSwaps";

const OVER = "var(--color-danger)";
const CLOSE = "var(--color-gold)";

const fmt = (n: number) => Math.round(n).toLocaleString("en-GB");

/** How many sources to list before the rest are summarised. */
const SHOW = 6;

/**
 * One limit, opened up: where it came from, the fewest cuts that would have
 * kept you under, and what to have instead next time.
 *
 * The first two are exact (lib/overage.ts). The swap ideas load on their
 * own afterwards, and only for limits actually over — a limit you are merely
 * close to needs no rescue.
 */
export default function LimitBreakdown({ overage: o, basis }: { overage: Overage; basis: string }) {
  const l = o.limit;
  const over = l.state === "over";
  const color = over ? OVER : CLOSE;
  const total = o.contributors.reduce((a, c) => a + c.amount, 0);
  const left = Math.max(0, l.limit - l.value);
  const shown = o.contributors.slice(0, SHOW);
  const rest = o.contributors.length - shown.length;

  return (
    <section className="surface overflow-hidden" aria-labelledby={`limit-${l.key}`}>
      {/* ---------------- how far over ---------------- */}
      <div className="px-5 pb-4 pt-4">
        <div className="flex items-baseline justify-between gap-3">
          <h2 id={`limit-${l.key}`} className="text-base font-semibold" style={{ color }}>
            {l.label}
          </h2>
          <span className="tnum text-xs" style={{ color }}>
            {fmt(l.value)}
            <span className="text-mist-600"> / {fmt(l.limit)} {l.unit}</span>
          </span>
        </div>
        <div className="mt-2 h-[4px] w-full overflow-hidden rounded-full bg-ink-800">
          <div
            className="h-full rounded-full"
            style={{ width: `${Math.min(100, l.pct * 100)}%`, background: color }}
          />
        </div>
        <p className="mt-2 text-[0.72rem] leading-relaxed text-mist-400">
          {over
            ? `${fmt(l.over)} ${l.unit} over your daily limit.`
            : `Only ${fmt(left)} ${l.unit} left before your daily limit.`}{" "}
          <span className="text-mist-600">{l.why}.</span>
        </p>
      </div>

      {o.granularity === "none" ? (
        <p className="hair px-5 py-3.5 text-[0.72rem] leading-relaxed text-mist-400">
          Nothing to swap here — it&apos;s water, not food. Ease off for the rest of the day.
        </p>
      ) : (
        <>
          {/* ---------------- where it came from ---------------- */}
          <div className="hair px-5 py-3.5">
            <h3 className="eyebrow mb-1">
              {o.granularity === "item" ? "Where it came from" : "Which meals it came from"}
            </h3>
            {shown.map((c, i) => (
              <div key={c.name} className={i > 0 ? "hair py-2.5" : "py-2.5"}>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 flex-1 truncate text-sm text-mist-200">{c.name}</span>
                  <span className="tnum shrink-0 text-xs font-semibold text-white">
                    {fmt(c.amount)} {l.unit}
                  </span>
                </div>
                <div className="mt-1.5 flex items-center gap-2">
                  <div className="h-[3px] flex-1 overflow-hidden rounded-full bg-ink-800">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${Math.round(c.share * 100)}%`, background: color }}
                    />
                  </div>
                  <span className="tnum w-9 shrink-0 text-right text-[0.62rem] text-mist-600">
                    {Math.round(c.share * 100)}%
                  </span>
                </div>
                <p className="mt-1 truncate text-[0.62rem] text-mist-600">
                  {o.granularity === "item"
                    ? [c.portion, c.meals.join(", ")].filter(Boolean).join(" · ")
                    : c.foods.join(", ")}
                </p>
              </div>
            ))}
            {rest > 0 && (
              <p className="hair pt-2.5 text-[0.65rem] text-mist-600">
                and {rest} smaller {rest === 1 ? "one" : "ones"}
              </p>
            )}
            {o.granularity === "meal" && (
              <p className="mt-2 text-[0.62rem] leading-relaxed text-mist-600">
                {l.label} is estimated for each meal as a whole, so this shows meals rather than
                single foods.{over ? " The swap ideas below point at the likely culprits." : ""}
              </p>
            )}
          </div>

          {/* ---------------- the least that gets you under ---------------- */}
          {o.cuts.length > 0 && (
            <div className="hair px-5 py-3.5">
              <h3 className="eyebrow mb-1">To stay under</h3>
              <ul>
                {o.cuts.map((c) => (
                  <li key={c.name} className="flex items-baseline justify-between gap-3 py-1.5">
                    <span className="text-sm text-mist-200">
                      {c.action === "skip" ? "Skip the " : "Have half the "}
                      {c.name.toLowerCase()}
                    </span>
                    <span className="tnum shrink-0 text-xs font-semibold text-lime-glow">
                      −{fmt(c.saves)} {l.unit}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-[0.65rem] text-mist-600">
                {o.stillOver > 0
                  ? `You'd still be ${fmt(o.stillOver)} ${l.unit} over after these.`
                  : `That would have kept you under ${fmt(l.limit)} ${l.unit}.`}
              </p>
            </div>
          )}

          {/* ---------------- what to have instead ---------------- */}
          {over && (
            <div className="hair px-5 pb-1 pt-3.5">
              <h3 className="eyebrow">Swap ideas</h3>
              <LimitSwaps
                basis={basis}
                limitKey={l.key}
                unit={l.unit}
                overBy={o.overBy}
                total={total}
              />
            </div>
          )}
        </>
      )}
    </section>
  );
}
