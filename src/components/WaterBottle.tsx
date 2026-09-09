"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { HYDRATION, hydration, litres, type WaterTarget } from "@/lib/hydration";

/* ---------------------------------------------------------------------
 * The bottle.
 *
 * Fills as the day goes on. Taps are optimistic — the water moves the
 * instant you press, and the write goes out behind it — because a drink
 * tracker that makes you wait for a round trip before it acknowledges a
 * glass is a drink tracker nobody uses twice.
 *
 * If the write fails the level rolls back to the truth rather than
 * quietly keeping a number the database never took.
 * ------------------------------------------------------------------- */

const WATER = "var(--color-cool)";
const OVER = "var(--color-gold)";

const W = 118;
const H = 232;

/** The bottle silhouette, used both as the outline and as the water's clip. */
const BOTTLE =
  "M48 26 V14 Q48 8 54 8 H64 Q70 8 70 14 V26 " +
  "C70 40 96 46 96 78 V200 Q96 224 72 224 H46 Q22 224 22 200 V78 " +
  "C22 46 48 40 48 26 Z";

/** Water surface at 0% and at 100%, in viewBox units. */
const EMPTY_Y = 222;
const FULL_Y = 30;

/** Text baselines, which double as the "is there water behind this" line. */
const BIG_LABEL_Y = H / 2 - 4;
const SUB_LABEL_Y = H / 2 + 14;

const TONE: Record<string, string> = {
  over: OVER, met: WATER, ahead: WATER, "on-track": WATER,
  behind: "var(--color-gold)", low: "var(--color-danger)",
};

export default function WaterBottle({
  target,
  drankMl,
  hour,
  today,
}: {
  target: WaterTarget;
  drankMl: number;
  /** The user's local hour, so the pace is judged against their clock. */
  hour: number;
  today: string;
}) {
  const router = useRouter();
  const [ml, setMl] = useState(drankMl);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const h = hydration(ml, target, hour);
  const color = TONE[h.status] ?? WATER;

  // The drawn level stops at the brim; the number keeps counting past it.
  const level = Math.min(1, h.fraction);
  const surfaceY = EMPTY_Y - (EMPTY_Y - FULL_Y) * level;

  // White on light blue is barely legible, so a label flips to the near-black
  // ground colour once water is behind it. Two details matter here:
  //
  //   * each line is tested separately — at just over half full the surface
  //     runs between them, and one shared test washes out whichever it got
  //     wrong;
  //   * the test is against the middle of the glyphs, not the baseline. Text
  //     sits ABOVE its baseline, so a baseline test flips the colour while the
  //     water is still only under the last few pixels, painting dark on dark.
  //
  // Around the crossover some of the glyph is over water either way, so both
  // lines also carry a halo in the opposite colour. Between them the number is
  // readable at every level rather than at most of them.
  const waterTop = surfaceY + 8;
  const bigOverWater = waterTop < BIG_LABEL_Y - 9;
  const subOverWater = waterTop < SUB_LABEL_Y - 4;

  const labelColor = bigOverWater ? "var(--color-void)" : "var(--color-white)";
  const labelHalo = bigOverWater ? "var(--color-white)" : "var(--color-void)";
  const subLabelColor = subOverWater ? "var(--color-void)" : "var(--color-mist-200)";
  const subLabelHalo = subOverWater ? "var(--color-white)" : "var(--color-void)";

  async function add(delta: number) {
    const before = ml;
    const next = Math.max(0, ml + delta);
    setMl(next);
    setError(null);

    const { data, error: err } = await createClient()
      .rpc("log_water", { delta_ml: delta, on_date: today });

    if (err) {
      setMl(before);
      setError("Couldn't save that — check your connection.");
      return;
    }
    // The server owns the total: two taps in flight at once both land, and
    // this is where the screen finds out the real figure.
    if (typeof data === "number") setMl(data);
    startTransition(() => router.refresh());
  }

  return (
    <div className="surface overflow-hidden">
      <div className="flex items-stretch gap-4 px-5 py-5">
        {/* ---------------- the bottle ---------------- */}
        <svg
          width={W} height={H} viewBox={`0 0 ${W} ${H}`}
          className="shrink-0"
          role="img"
          aria-label={`${litres(h.drankMl)} of ${litres(h.targetMl)} — ${h.headline}`}
        >
          <defs>
            <clipPath id="bottle-clip">
              <path d={BOTTLE} />
            </clipPath>
            <linearGradient id="water-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.95" />
              <stop offset="100%" stopColor={color} stopOpacity="0.55" />
            </linearGradient>
          </defs>

          {/* the empty vessel */}
          <path d={BOTTLE} fill="var(--color-ink-850)" />

          <g clipPath="url(#bottle-clip)">
            {/* Translated rather than resized: the browser can move a filled
                shape far more cheaply than it can re-rasterise a growing one,
                which is what keeps this smooth on a mid-range phone. */}
            <g
              style={{
                transform: `translateY(${surfaceY}px)`,
                transition: "transform 0.75s cubic-bezier(0.22, 1, 0.36, 1)",
              }}
            >
              <rect x="0" y="8" width={W} height={H} fill="url(#water-fill)" />
              <path className="water-wave" d={wave(0)} fill={color} opacity="0.85" />
              <path className="water-wave water-wave--slow" d={wave(1)} fill={color} opacity="0.45" />
            </g>

            {/* quarter marks, only over the empty part so they stay legible */}
            {[0.25, 0.5, 0.75].map((q) => (
              <line
                key={q}
                x1={W - 34} x2={W - 22}
                y1={EMPTY_Y - (EMPTY_Y - FULL_Y) * q}
                y2={EMPTY_Y - (EMPTY_Y - FULL_Y) * q}
                stroke="var(--color-hair)" strokeWidth="1.5" strokeLinecap="round"
              />
            ))}
          </g>

          {/* rim and cap sit above the water */}
          <path d={BOTTLE} fill="none" stroke="var(--color-hair)" strokeWidth="2.5" />
          <rect x="44" y="0" width="30" height="12" rx="4" fill="var(--color-ink-800)" />

          <text
            x={W / 2} y={BIG_LABEL_Y}
            textAnchor="middle"
            className="hero-num tnum"
            style={{
              fontSize: 26,
              fill: labelColor,
              stroke: labelHalo,
              strokeWidth: 3,
              strokeOpacity: 0.35,
              paintOrder: "stroke",
              transition: "fill 0.4s ease, stroke 0.4s ease",
            }}
          >
            {Math.round(h.fraction * 100)}%
          </text>
          <text
            x={W / 2} y={SUB_LABEL_Y}
            textAnchor="middle"
            style={{
              fontSize: 10,
              fill: subLabelColor,
              stroke: subLabelHalo,
              strokeWidth: 2,
              strokeOpacity: 0.3,
              paintOrder: "stroke",
              letterSpacing: "0.05em",
              transition: "fill 0.4s ease, stroke 0.4s ease",
            }}
          >
            {litres(h.drankMl)}
          </text>
        </svg>

        {/* ---------------- the numbers ---------------- */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="eyebrow">water</div>
          <p className="mt-1.5 text-base font-semibold leading-snug" style={{ color }}>
            {h.headline}
          </p>
          <p className="mt-1 text-[0.7rem] leading-relaxed text-mist-600">{h.guidance}</p>

          {/* where the day says you should be */}
          <div className="mt-3">
            <div className="relative h-[4px] w-full overflow-hidden rounded-full bg-ink-800">
              <div
                className="absolute inset-y-0 left-0 rounded-full"
                style={{
                  width: `${Math.min(100, h.fraction * 100)}%`,
                  background: color,
                  transition: "width 0.6s ease",
                }}
              />
              <span
                className="absolute inset-y-0 w-[2px]"
                style={{
                  left: `${Math.min(100, (h.expectedMl / h.targetMl) * 100)}%`,
                  background: "var(--color-mist-400)",
                }}
                aria-hidden="true"
              />
            </div>
            <div className="tnum mt-1.5 flex justify-between text-[0.62rem] text-mist-600">
              <span>{litres(h.drankMl)} of {litres(h.targetMl)}</span>
              <span>by now: {litres(h.expectedMl)}</span>
            </div>
          </div>

          <div className="mt-auto pt-3.5">
            <div className="flex flex-wrap gap-1.5">
              {HYDRATION.quickAddMl.map((amount) => (
                <button
                  key={amount}
                  onClick={() => add(amount)}
                  className="chip px-3"
                  aria-label={`Add ${litres(amount)}`}
                >
                  +{amount >= 1000 ? `${amount / 1000}L` : amount}
                </button>
              ))}
              <button
                onClick={() => add(-HYDRATION.glassMl)}
                disabled={ml <= 0}
                className="chip disabled:opacity-40"
                aria-label="Undo a glass"
              >
                −
              </button>
            </div>
          </div>
        </div>
      </div>

      {error && (
        <p className="hair px-5 py-2.5 text-[0.68rem] text-danger">{error}</p>
      )}

      <p className="hair px-5 py-2 text-[0.6rem] leading-relaxed text-mist-600">
        {target.source === "manual"
          ? `${litres(target.totalMl)} a day, set by you.`
          : `${litres(target.baseMl)} for your bodyweight` +
            (target.exerciseMl > 0 ? ` plus ${litres(target.exerciseMl)} for today's training.` : ".")}
        {" "}Tracked, not scored — like sleep.
      </p>
    </div>
  );
}

/**
 * A sine surface two bottle-widths long, so it can slide one width sideways
 * and land exactly where it started. Phase shifts the second copy.
 */
function wave(phase: number): string {
  const amp = 4;
  const width = W;
  const points: string[] = [];
  for (let x = 0; x <= width * 2; x += 6) {
    const y = 8 + Math.sin((x / width) * Math.PI * 2 + phase * Math.PI) * amp;
    points.push(`${x === 0 ? "M" : "L"}${x} ${y.toFixed(2)}`);
  }
  return `${points.join(" ")} L${width * 2} 40 L0 40 Z`;
}
