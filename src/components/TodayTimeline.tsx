"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { FoodLog, WorkoutLog } from "@/lib/types";

type Entry =
  | { kind: "food"; at: string; log: FoodLog }
  | { kind: "workout"; at: string; log: WorkoutLog };

const SLOT_LABEL: Record<string, string> = {
  breakfast: "Breakfast", lunch: "Lunch", dinner: "Dinner", snack: "Snack",
};

export default function TodayTimeline({ foods, workouts }: { foods: FoodLog[]; workouts: WorkoutLog[] }) {
  const router = useRouter();
  const [open, setOpen] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const entries: Entry[] = [
    ...foods.map((log) => ({ kind: "food" as const, at: log.logged_at, log })),
    ...workouts.map((log) => ({ kind: "workout" as const, at: log.logged_at, log })),
  ].sort((a, b) => a.at.localeCompare(b.at));

  async function remove(kind: "food" | "workout", id: string) {
    setDeleting(id);
    const table = kind === "food" ? "food_logs" : "workout_logs";
    const { error } = await createClient().from(table).delete().eq("id", id);
    setDeleting(null);
    if (!error) router.refresh();
  }

  const time = (iso: string) =>
    new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

  return (
    <div className="surface px-5">
      {entries.map((entry, idx) => {
        const isOpen = open === entry.log.id;
        const isFood = entry.kind === "food";
        const accent = isFood ? "var(--color-mist-200)" : "var(--color-lime-glow)";

        return (
          <div key={entry.log.id} className={idx > 0 ? "hair" : ""}>
            <button
              className="flex w-full items-center gap-3 py-3.5 text-left"
              onClick={() => setOpen(isOpen ? null : entry.log.id)}
              aria-expanded={isOpen}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-mist-200">{entry.log.raw_text}</span>
                <span className="eyebrow mt-1 block">
                  {isFood ? SLOT_LABEL[(entry.log as FoodLog).meal_slot] ?? "Meal" : "Training"}
                  {" · "}{time(entry.at)}
                  {isFood
                    ? ` · ${Math.round((entry.log as FoodLog).protein_g)}g protein`
                    : ` · ${Math.round((entry.log as WorkoutLog).minutes)} min`}
                </span>
              </span>

              <span className="tnum shrink-0 text-sm font-bold" style={{ color: accent }}>
                {isFood ? "+" : "−"}
                {Math.round(entry.log.kcal)}
              </span>
            </button>

            {isOpen && (
              <div className="pb-4">
                {isFood ? (
                  <FoodDetail log={entry.log as FoodLog} />
                ) : (
                  <WorkoutDetail log={entry.log as WorkoutLog} />
                )}
                <button
                  className="btn btn-danger mt-4 w-full py-2 text-xs"
                  disabled={deleting === entry.log.id}
                  onClick={() => remove(entry.kind, entry.log.id)}
                >
                  {deleting === entry.log.id ? "Deleting…" : "Delete this entry"}
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function FoodDetail({ log }: { log: FoodLog }) {
  return (
    <div className="space-y-1.5">
      {log.items.map((item, i) => (
        <div key={i} className="flex items-baseline justify-between gap-2 text-xs">
          <span className="min-w-0 flex-1 truncate text-mist-400">
            {item.qty} {item.unit} · {item.name}
          </span>
          <span className="tnum shrink-0 text-mist-600">
            {Math.round(item.kcal)} kcal · {Math.round(item.protein_g)}p
          </span>
        </div>
      ))}
      <div className="hair mt-2.5 flex gap-3 pt-2.5 text-[0.68rem] text-mist-600">
        <span className="tnum">P {Math.round(log.protein_g)}g</span>
        <span className="tnum">C {Math.round(log.carbs_g)}g</span>
        <span className="tnum">F {Math.round(log.fat_g)}g</span>
        <span className="tnum">Fib {Math.round(log.fiber_g)}g</span>
      </div>
    </div>
  );
}

function WorkoutDetail({ log }: { log: WorkoutLog }) {
  return (
    <div className="space-y-1.5">
      {log.exercises.map((ex, i) => (
        <div key={i} className="flex items-baseline justify-between gap-2 text-xs">
          <span className="min-w-0 flex-1 truncate text-mist-400">
            {ex.name}
            {ex.sets ? ` · ${ex.sets}×${ex.reps ?? "?"}` : ""}
            {ex.distance_km ? ` · ${ex.distance_km} km` : ""}
          </span>
          <span className="tnum shrink-0 text-mist-500">
            {Math.round(ex.minutes)} min · MET {ex.met} · {Math.round(ex.kcal)} kcal
          </span>
        </div>
      ))}
      {log.body_weight_kg && (
        <div className="hair mt-2.5 pt-2.5 text-[0.68rem] text-mist-600">
          Burn computed at {log.body_weight_kg} kg bodyweight
        </div>
      )}
    </div>
  );
}
