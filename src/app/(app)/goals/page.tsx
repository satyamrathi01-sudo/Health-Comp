import { latestWeight, requireArena, rival } from "@/lib/data";
import { EmptyState, PageHeader, Section } from "@/components/ui";
import GoalsBoard, { type GoalSuggestion } from "@/components/GoalsBoard";
import ChallengeSwitcher from "@/components/ChallengeSwitcher";
import { GOAL_UNITS, goalProgress } from "@/lib/goals";
import { daysInMonthOf } from "@/lib/calc";

export const dynamic = "force-dynamic";
export const metadata = { title: "Goals · FitClash" };

export default async function GoalsPage() {
  const arena = await requireArena({ days: 31 });

  const them = rival(arena);

  // Calendar month, not a rolling window — "what I want to achieve this month".
  const monthStart = arena.today.slice(0, 8) + "01";
  const monthDays = arena.days.filter((d) => d >= monthStart);
  const goals = arena.goals;

  const progressByGoal: Record<string, number | null> = {};
  for (const goal of goals) {
    const player = arena.players.find((p) => p.profile.id === goal.user_id);
    if (!player) continue;
    const totals = monthDays
      .map((d) => player.totals.get(d))
      .filter((t): t is NonNullable<typeof t> => Boolean(t));
    const scores = monthDays
      .map((d) => player.scores.get(d))
      .filter((s) => s?.logged)
      .map((s) => s!.total);
    progressByGoal[goal.id] = goalProgress({
      metric: goal.metric,
      totals,
      scores,
      // Only ever my own: weigh-ins are not readable across a challenge, so a
      // rival's weight goal shows its target and no reading against it.
      latestWeight: goal.user_id === arena.me.id ? latestWeight(arena) : null,
    });
  }

  const monthLabel = new Date(monthStart + "T00:00:00").toLocaleDateString("en-GB", {
    month: "long", year: "numeric",
  });

  const myGoals = goals.filter((g) => g.user_id === arena.me.id);
  const theirGoals = them ? goals.filter((g) => g.user_id === them.profile.id) : [];

  // Anchored to their own numbers, so a suggestion is a real stretch rather
  // than a round number pulled out of the air.
  const base = arena.myTargets;
  const daysThisMonth = daysInMonthOf(arena.today);
  const suggestions: GoalSuggestion[] = base
    ? [
        {
          title: `Average ${base.proteinTarget + 10} g protein a day`,
          metric: "avg_protein_g",
          target_value: base.proteinTarget + 10,
        },
        {
          title: `Train on ${Math.round(daysThisMonth * 0.6)} days this month`,
          metric: "workout_days",
          target_value: Math.round(daysThisMonth * 0.6),
        },
        {
          title: `Burn ${(base.burnTarget * daysThisMonth).toLocaleString()} kcal this month`,
          metric: "total_kcal_burned",
          target_value: base.burnTarget * daysThisMonth,
        },
        {
          title: "Average 75 points a day",
          metric: "avg_score",
          target_value: 75,
        },
        ...(arena.me.weight_kg && arena.me.goal === "cut"
          ? [{
              title: `Reach ${Math.round((Number(arena.me.weight_kg) - 2) * 10) / 10} kg`,
              metric: "weight_kg" as const,
              target_value: Math.round((Number(arena.me.weight_kg) - 2) * 10) / 10,
            }]
          : []),
      ]
    : [];

  return (
    <div className="rise space-y-6">
      <PageHeader title="Goals" subtitle={monthLabel} />

      {arena.myChallenges.length > 1 && (
        <ChallengeSwitcher challenges={arena.myChallenges} activeId={arena.challenge?.id ?? null} />
      )}

      <GoalsBoard
        userId={arena.me.id}
        month={monthStart}
        goals={myGoals}
        progress={progressByGoal}
        suggestions={suggestions}
      />

      {them && (
        <Section title={`${them.profile.display_name.split(" ")[0]}'s month`}>
          {theirGoals.length === 0 ? (
            <EmptyState icon="○" title="They haven't set any goals yet" />
          ) : (
            <div className="surface px-5">
              {theirGoals.map((g, i) => (
                <div key={g.id} className={`flex items-center gap-3 py-3.5 ${i > 0 ? "hair" : ""}`}>
                  <span className="text-xs text-mist-600" aria-hidden="true">
                    {g.done ? "✓" : "○"}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={`block truncate text-sm ${g.done ? "text-mist-600 line-through" : "text-mist-200"}`}>
                      {g.title}
                    </span>
                    {g.target_value !== null && (
                      <span className="tnum mt-0.5 block text-[0.68rem] text-mist-600">
                        {g.metric === "weight_kg" ? (
                          <>target {g.target_value} kg · progress private</>
                        ) : (
                          <>
                            {progressByGoal[g.id] ?? "—"} / {g.target_value} {GOAL_UNITS[g.metric]}
                          </>
                        )}
                      </span>
                    )}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Section>
      )}
    </div>
  );
}
