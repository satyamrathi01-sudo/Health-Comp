import Link from "next/link";
import { GOAL_UNITS, goalFraction } from "@/lib/goals";
import { EmptyState } from "./ui";
import type { MonthlyGoal } from "@/lib/types";

/**
 * Your own goals and how far along they are. Read-only — adding, editing
 * and ticking off all live on the Goals tab, so this stays a status panel
 * rather than a second editor.
 */
export default function GoalProgress({
  goals,
  progress,
}: {
  goals: MonthlyGoal[];
  progress: Record<string, number | null>;
}) {
  if (!goals.length) {
    return (
      <EmptyState
        icon="○"
        title="No goals this month"
        body="A goal changes what you're scored against, not just what you're reminded of."
      />
    );
  }

  return (
    <div className="surface px-5">
      {goals.map((goal, i) => {
        const achieved = progress[goal.id] ?? null;
        const fraction = goalFraction(goal, achieved);
        return (
          <div key={goal.id} className={i > 0 ? "hair py-3.5" : "py-3.5"}>
            <div className="flex items-start gap-3">
              <span className="mt-0.5 text-xs leading-none text-mist-600" aria-hidden="true">
                {goal.done ? "✓" : "○"}
              </span>
              <div className="min-w-0 flex-1">
                <p className={`text-sm ${goal.done ? "text-mist-600 line-through" : "text-mist-200"}`}>
                  {goal.title}
                </p>
                {goal.target_value !== null && (
                  <p className="tnum mt-1 text-[0.68rem] text-mist-600">
                    <span className="font-semibold text-white">{achieved ?? "—"}</span>
                    {" / "}
                    {goal.target_value} {GOAL_UNITS[goal.metric]}
                  </p>
                )}
              </div>
              {fraction !== null && (
                <span className="tnum shrink-0 text-xs font-semibold text-lime-glow">
                  {Math.round(fraction * 100)}%
                </span>
              )}
            </div>

            {fraction !== null && (
              <div className="mt-2.5 h-[3px] w-full overflow-hidden rounded-full bg-ink-800">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${fraction * 100}%`, background: "var(--color-lime-glow)" }}
                />
              </div>
            )}
          </div>
        );
      })}
      <Link href="/goals" className="hair block py-3 text-center text-xs font-semibold text-lime-glow">
        Manage goals
      </Link>
    </div>
  );
}
