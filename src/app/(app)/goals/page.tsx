import { mine, requireArena } from "@/lib/data";
import { EmptyState, PageHeader } from "@/components/ui";
import SubTabs from "@/components/SubTabs";
import TargetKpis from "@/components/TargetKpis";
import TargetsEditor from "@/components/TargetsEditor";

export const dynamic = "force-dynamic";
export const metadata = { title: "Goals · FitClash" };

/**
 * Your targets — what the score measures you against — and nobody else's.
 *
 * Two tabs: Targets shows the numbers, Edit changes them. Monthly goals used
 * to live here as well; they only ever overrode a protein or burn target,
 * which Edit now does directly, so they were retired.
 *
 * No challenge switcher: nothing here depends on which challenge you are
 * looking at. What rivals can read is decided in the database (v8 and v11 in
 * schema.sql), not by what this page leaves out.
 */
export default async function GoalsPage() {
  const arena = await requireArena({ days: 31 });
  const me = mine(arena);
  const targets = arena.myTargets;

  const sleepNights = [...me.totals.values()].filter((t) => t.sleep_hours != null);
  const avgSleep = sleepNights.length
    ? Math.round((sleepNights.reduce((a, t) => a + Number(t.sleep_hours), 0) / sleepNights.length) * 10) / 10
    : null;

  return (
    <div className="rise space-y-6">
      <PageHeader title="Goals" subtitle="What your score is measured against" />

      <SubTabs
        label="Goals"
        tabs={[
          {
            id: "targets",
            label: "Targets",
            content: targets ? (
              <TargetKpis targets={targets} profile={arena.me} avgSleep={avgSleep} />
            ) : (
              <EmptyState
                icon="○"
                title="No targets yet"
                body="We need your height, weight and date of birth to work these out."
              />
            ),
          },
          {
            id: "edit",
            label: "Edit",
            content: <TargetsEditor profile={arena.me} today={arena.today} />,
          },
        ]}
      />

      <p className="px-1 text-[0.62rem] leading-relaxed text-mist-600">
        Rivals can&apos;t see this page. They only get your daily targets for eating,
        protein, burn and exercise, because your score is worked out from them — never
        your weight, height, age or weight goal.
      </p>
    </div>
  );
}
