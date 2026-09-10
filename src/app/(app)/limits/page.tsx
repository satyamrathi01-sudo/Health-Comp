import Link from "next/link";
import { mine, requireArena } from "@/lib/data";
import { todaysBreaches } from "@/lib/limits";
import { explainLimits, swapBrief } from "@/lib/overage";
import { EmptyState, PageHeader } from "@/components/ui";
import LimitBreakdown from "@/components/LimitBreakdown";

export const dynamic = "force-dynamic";
export const metadata = { title: "Limits · FitClash" };

/**
 * Today's limits, opened up — reached from the warning at the top of Today.
 *
 * Which foods pushed each limit over, and the fewest cuts that would have
 * kept you under, are arithmetic over what you logged (lib/overage.ts). Only
 * the swap ideas come from Gemini, and they load after the page so the
 * useful part never waits for them.
 */
export default async function LimitsPage() {
  // Limits are about today, so one day of history is all this needs.
  const arena = await requireArena({ days: 1 });
  const totals = mine(arena).totals.get(arena.today) ?? null;

  const overages = explainLimits(
    todaysBreaches(totals, arena.me, arena.myTargets),
    arena.todayFood,
  );
  // The same text the swaps route builds from the database, so every card and
  // the one request they share agree on which foods they are about.
  const basis = swapBrief(overages);
  const overCount = overages.filter((o) => o.overBy > 0).length;

  return (
    <div className="rise space-y-6">
      <PageHeader
        title="Your limits"
        subtitle={
          overCount
            ? `Over ${overCount} today — here's what caused it`
            : "Today"
        }
        right={
          <Link href="/" className="text-xs font-semibold text-lime-glow">
            Today
          </Link>
        }
      />

      {overages.length === 0 ? (
        <EmptyState
          icon="✓"
          title="You're inside every limit today"
          body="If you go over one, it will show up here with the foods that caused it."
        />
      ) : (
        overages.map((o) => <LimitBreakdown key={o.limit.key} overage={o} basis={basis} />)
      )}

      <p className="px-1 text-[0.62rem] leading-relaxed text-mist-600">
        These are ideas for next time — nothing here changes what you logged. If an entry is
        wrong, fix or delete it in{" "}
        <Link href="/?tab=log" className="font-semibold text-lime-glow">
          Today&apos;s Log
        </Link>
        .
      </p>
    </div>
  );
}
