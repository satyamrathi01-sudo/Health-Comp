import { prettyDate, type WeightPlan } from "@/lib/calc";
import type { PaceReport } from "@/lib/progress";

/* ---------------------------------------------------------------------
 * The walk.
 *
 * One tick per day since the plan began: up if that day's eating and
 * training moved you toward the weight you asked for, down if it moved you
 * away, flat if it was a wash or nothing was logged. Under it, where you
 * actually are against where the pace says you should be.
 *
 * A number tells you that you are 0.4 kg behind. Fourteen ticks tell you
 * which four days did it.
 * ------------------------------------------------------------------- */

const FORWARD = "var(--color-lime-glow)";
const BACK = "var(--color-flame)";
const FLAT = "var(--color-ink-800)";

/** Tallest a tick may be drawn, in px, at ±500 kcal or more. */
const MAX_TICK = 26;
const FULL_TICK_KCAL = 500;

export default function PlanProgress({
  pace,
  plan,
  today,
}: {
  pace: PaceReport;
  plan: WeightPlan | null;
  today: string;
}) {
  const ahead = pace.aheadKg >= 0;

  // The bar under the ticks spans the plan's whole journey — the weight it
  // started from to the weight it is aiming at. Without a plan there is no
  // journey, so it spans whichever of the two markers is further along.
  const goalKg = pace.totalKg > 0
    ? pace.totalKg
    : Math.max(pace.expectedKg, pace.achievedKg, 0.1);
  const pct = (v: number) => Math.max(0, Math.min(100, (v / Math.max(goalKg, 0.1)) * 100));

  return (
    <div className="surface overflow-hidden">
      <div className="hair-b px-5 py-4">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-base font-semibold text-white">{pace.headline}</p>
          {plan && (
            <span className="eyebrow shrink-0">
              {plan.daysLeft}d left
            </span>
          )}
        </div>
        <p className="mt-1 text-[0.7rem] leading-relaxed text-mist-600">
          {plan
            ? `${plan.direction === "lose" ? "Down" : "Up"} to ${plan.targetKg} kg by ${prettyDate(plan.targetDate)} · ${plan.kgToGo} kg to go`
            : "Set a target weight and date in Goals to follow a plan."}
        </p>
      </div>

      {/* ---- the daily steps ---- */}
      <div className="px-5 py-4">
        <div className="flex h-[64px] items-center gap-[3px]">
          {pace.steps.map((s) => {
            const height = Math.max(
              3,
              Math.round((Math.min(Math.abs(s.kcal), FULL_TICK_KCAL) / FULL_TICK_KCAL) * MAX_TICK),
            );
            const color =
              s.direction === "forward" ? FORWARD : s.direction === "back" ? BACK : FLAT;
            return (
              <div
                key={s.date}
                className="flex flex-1 flex-col items-center justify-center"
                title={`${s.date}: ${s.logged ? `${s.kcal > 0 ? "+" : ""}${s.kcal} kcal` : "not logged"}`}
              >
                {/* above the line = forward */}
                <div className="flex h-[26px] w-full items-end justify-center">
                  {s.direction === "forward" && (
                    <span className="w-full rounded-t-[2px]" style={{ height, background: color }} />
                  )}
                </div>
                <span
                  className="h-[2px] w-full"
                  style={{
                    background: s.date === today ? "var(--color-mist-400)" : "var(--color-hair)",
                  }}
                />
                <div className="flex h-[26px] w-full items-start justify-center">
                  {s.direction === "back" && (
                    <span className="w-full rounded-b-[2px]" style={{ height, background: color }} />
                  )}
                  {s.direction === "flat" && (
                    <span
                      className="mt-[3px] h-[3px] w-[3px] rounded-full"
                      style={{ background: s.logged ? "var(--color-mist-600)" : "var(--color-ink-800)" }}
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-1 flex justify-between text-[0.6rem] text-mist-600">
          <span>{prettyDate(pace.from)}</span>
          <span>{pace.to === today ? "today" : prettyDate(pace.to)}</span>
        </div>
      </div>

      {/* ---- where that leaves you ---- */}
      <div className="hair px-5 py-4">
        <div className="relative h-[6px] w-full overflow-hidden rounded-full bg-ink-800">
          <div
            className="absolute inset-y-0 left-0 rounded-full"
            style={{
              width: `${pct(Math.max(0, pace.achievedKg))}%`,
              background: ahead ? FORWARD : BACK,
              transition: "width 0.6s ease",
            }}
          />
          {/* where the plan says you should be by now */}
          <span
            className="absolute inset-y-0 w-[2px]"
            style={{ left: `${pct(pace.expectedKg)}%`, background: "var(--color-mist-400)" }}
            aria-hidden="true"
          />
        </div>

        <div className="mt-2.5 flex items-baseline justify-between gap-3">
          <span className="tnum text-xs" style={{ color: ahead ? FORWARD : BACK }}>
            {pace.achievedKg > 0 ? "+" : ""}
            {pace.achievedKg} kg
            <span className="text-mist-600"> of {Math.round(goalKg * 10) / 10} kg</span>
          </span>
          <span className="tnum text-[0.65rem] text-mist-600">
            aim by now: {pace.expectedKg} kg
          </span>
        </div>

        <p className="mt-2 text-[0.65rem] leading-relaxed text-mist-600">{pace.detail}</p>
      </div>
    </div>
  );
}
