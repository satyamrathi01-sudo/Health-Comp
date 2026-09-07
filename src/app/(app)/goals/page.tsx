import { loadArena, mine, rival } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import { EmptyState, PageHeader, Section } from "@/components/ui";
import GoalsBoard from "@/components/GoalsBoard";
import type { MonthlyGoal } from "@/lib/types";

export const dynamic = "force-dynamic";
export const metadata = { title: "Goals · FitClash" };

/** Actual value achieved this month for each goal metric. */
function progressFor(
  metric: MonthlyGoal["metric"],
  totals: { kcal_out: number; protein_g: number; sessions: number; meals: number }[],
  scores: number[],
  latestWeight: number | null,
): number | null {
  const withFood = totals.filter((t) => t.meals > 0);
  switch (metric) {
    case "weight_kg":
      return latestWeight;
    case "avg_protein_g":
      return withFood.length
        ? Math.round(withFood.reduce((a, t) => a + t.protein_g, 0) / withFood.length)
        : 0;
    case "total_kcal_burned":
      return Math.round(totals.reduce((a, t) => a + t.kcal_out, 0));
    case "workout_days":
      return totals.filter((t) => t.sessions > 0).length;
    case "avg_score":
      return scores.length
        ? Math.round((scores.reduce((a, s) => a + s, 0) / scores.length) * 10) / 10
        : 0;
    default:
      return null;
  }
}

export default async function GoalsPage() {
  const arena = await loadArena(31);
  if (!arena) return null;

  const supabase = await createClient();
  const me = mine(arena);
  const them = rival(arena);

  // Calendar month, not a rolling window — "what I want to achieve this month".
  const monthStart = arena.today.slice(0, 8) + "01";
  const userIds = arena.players.map((p) => p.profile.id);

  const [{ data: goalRows }, { data: weighIns }] = await Promise.all([
    supabase.from("monthly_goals").select("*")
      .in("user_id", userIds).eq("month", monthStart)
      .order("created_at", { ascending: true }),
    supabase.from("weigh_ins").select("user_id, weight_kg, local_date")
      .in("user_id", userIds).order("local_date", { ascending: false }),
  ]);

  const goals = (goalRows ?? []) as MonthlyGoal[];

  const latestWeight = (userId: string): number | null => {
    const row = (weighIns ?? []).find((w) => w.user_id === userId);
    return row ? Number(row.weight_kg) : null;
  };

  // Only days inside the current calendar month count towards progress.
  const monthDays = arena.days.filter((d) => d >= monthStart);

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
    progressByGoal[goal.id] = progressFor(goal.metric, totals, scores, latestWeight(goal.user_id));
  }

  const monthLabel = new Date(monthStart + "T00:00:00").toLocaleDateString("en-GB", {
    month: "long", year: "numeric",
  });

  const myGoals = goals.filter((g) => g.user_id === arena.me.id);
  const theirGoals = them ? goals.filter((g) => g.user_id === them.profile.id) : [];

  return (
    <div className="rise space-y-6">
      <PageHeader title="Goals" subtitle={monthLabel} />

      <GoalsBoard
        userId={arena.me.id}
        month={monthStart}
        goals={myGoals}
        progress={progressByGoal}
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
                        {progressByGoal[g.id] ?? "—"} / {g.target_value}
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
