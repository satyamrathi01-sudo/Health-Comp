"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Bar, EmptyState, SectionTitle } from "./ui";
import type { MonthlyGoal } from "@/lib/types";

const METRICS: { value: MonthlyGoal["metric"]; label: string; unit: string; hint: string }[] = [
  { value: "custom", label: "Just a promise", unit: "", hint: "No number — tick it off yourself" },
  { value: "weight_kg", label: "Reach a weight", unit: "kg", hint: "Tracked from your weigh-ins" },
  { value: "avg_protein_g", label: "Average protein", unit: "g/day", hint: "Across days you logged food" },
  { value: "total_kcal_burned", label: "Burn in total", unit: "kcal", hint: "Sum of every workout" },
  { value: "workout_days", label: "Train on N days", unit: "days", hint: "Days with a workout logged" },
  { value: "avg_score", label: "Average score", unit: "pts", hint: "Mean daily score this month" },
];

export default function GoalsBoard({
  userId, month, goals, progress,
}: {
  userId: string;
  month: string;
  goals: MonthlyGoal[];
  progress: Record<string, number | null>;
}) {
  const router = useRouter();
  const supabase = createClient();

  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [metric, setMetric] = useState<MonthlyGoal["metric"]>("custom");
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const meta = (m: MonthlyGoal["metric"]) => METRICS.find((x) => x.value === m)!;

  async function add() {
    if (!title.trim()) return;
    setBusy(true);
    setError(null);
    const { error } = await supabase.from("monthly_goals").insert({
      user_id: userId,
      month,
      title: title.trim(),
      metric,
      target_value: metric === "custom" ? null : Number(target) || null,
    });
    setBusy(false);
    if (error) { setError(error.message); return; }
    setTitle(""); setTarget(""); setMetric("custom"); setAdding(false);
    router.refresh();
  }

  async function toggle(goal: MonthlyGoal) {
    await supabase.from("monthly_goals").update({ done: !goal.done }).eq("id", goal.id);
    router.refresh();
  }

  async function remove(id: string) {
    await supabase.from("monthly_goals").delete().eq("id", id);
    router.refresh();
  }

  return (
    <section>
      <SectionTitle
        action={
          <button className="text-xs font-semibold text-lime-glow" onClick={() => setAdding((v) => !v)}>
            {adding ? "Cancel" : "Add +"}
          </button>
        }
      >
        Your month
      </SectionTitle>

      {adding && (
        <div className="card-raised mb-3 space-y-3 p-4">
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-mist-500">What are you going for?</span>
            <input
              className="field" value={title} onChange={(e) => setTitle(e.target.value)}
              placeholder="Hit 130g protein every day" autoFocus
            />
          </label>

          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-mist-500">Track it how?</span>
            <select
              className="field" value={metric}
              onChange={(e) => setMetric(e.target.value as MonthlyGoal["metric"])}
            >
              {METRICS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
            <span className="mt-1 block text-[0.68rem] text-mist-500">{meta(metric).hint}</span>
          </label>

          {metric !== "custom" && (
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold text-mist-500">
                Target ({meta(metric).unit})
              </span>
              <input
                className="field tnum" type="number" inputMode="decimal"
                value={target} onChange={(e) => setTarget(e.target.value)} placeholder="130"
              />
            </label>
          )}

          {error && <p className="text-xs text-danger">{error}</p>}

          <button className="btn btn-primary w-full" disabled={busy || !title.trim()} onClick={add}>
            {busy ? "Adding…" : "Add goal"}
          </button>
        </div>
      )}

      {goals.length === 0 && !adding ? (
        <EmptyState
          icon="🎯"
          title="No goals set for this month"
          body="Write down what you want by month end. Your friend sees it too — that's the point."
        />
      ) : (
        <ul className="space-y-2.5">
          {goals.map((goal) => {
            const done = progress[goal.id];
            const info = meta(goal.metric);
            const pct =
              goal.target_value && done !== null && done !== undefined
                ? Math.min(100, (done / goal.target_value) * 100)
                : null;

            return (
              <li key={goal.id} className="card p-3.5">
                <div className="flex items-start gap-3">
                  <button
                    onClick={() => toggle(goal)}
                    className="mt-0.5 text-lg leading-none"
                    aria-label={goal.done ? "Mark as not done" : "Mark as done"}
                  >
                    {goal.done ? "✅" : "⬜"}
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className={`text-sm font-medium ${goal.done ? "text-mist-500 line-through" : ""}`}>
                      {goal.title}
                    </p>
                    {goal.target_value !== null && (
                      <p className="tnum mt-1 text-[0.7rem] text-mist-500">
                        <span className="font-semibold text-mist-100">{done ?? "—"}</span>
                        {" / "}{goal.target_value} {info.unit}
                      </p>
                    )}
                  </div>
                  <button
                    className="shrink-0 px-1 text-lg leading-none text-mist-500"
                    onClick={() => remove(goal.id)}
                    aria-label="Delete goal"
                  >
                    ×
                  </button>
                </div>

                {pct !== null && (
                  <div className="mt-2.5">
                    <Bar value={pct} max={100} height={5} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
