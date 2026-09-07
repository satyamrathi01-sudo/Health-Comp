"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { burnKcal, guessMealSlot, localHour } from "@/lib/calc";
import type { Confidence, Exercise, FoodItem, MealSlot, Profile } from "@/lib/types";
import { PageHeader } from "./ui";

type Tab = "food" | "workout";

const SLOTS: { value: MealSlot; label: string }[] = [
  { value: "breakfast", label: "Breakfast" },
  { value: "lunch", label: "Lunch" },
  { value: "dinner", label: "Dinner" },
  { value: "snack", label: "Snack" },
];

const FOOD_PLACEHOLDER =
  "3 rotis, a katori of dal tadka, half plate rice, salad and a glass of buttermilk";
const WORKOUT_PLACEHOLDER =
  "45 min gym — bench 4x8 at 60kg, rows 4x10, then 20 min treadmill run 4 km";

const blankItem = (): FoodItem => ({
  name: "", qty: 1, unit: "serving", kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0,
});

export default function LogComposer({
  profile, today, isRestDay, aiReady,
}: {
  profile: Profile;
  today: string;
  isRestDay: boolean;
  aiReady: boolean;
}) {
  const router = useRouter();
  const supabase = createClient();

  const [tab, setTab] = useState<Tab>("food");
  const [text, setText] = useState("");
  const [slot, setSlot] = useState<MealSlot>(() => guessMealSlot(localHour(profile.timezone)));

  const [items, setItems] = useState<FoodItem[] | null>(null);
  const [exercises, setExercises] = useState<Exercise[] | null>(null);
  const [meta, setMeta] = useState<{ confidence: Confidence; assumptions: string; cached: boolean } | null>(null);

  const [busy, setBusy] = useState<"analyse" | "save" | "rest" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tuning, setTuning] = useState<number | null>(null);

  const bodyWeight = Number(profile.weight_kg) || 70;
  const hasResult = tab === "food" ? items !== null : exercises !== null;

  const totals = useMemo(() => {
    if (tab === "food") {
      const list = items ?? [];
      const sum = (k: keyof FoodItem) => list.reduce((a, i) => a + Number(i[k] || 0), 0);
      return {
        kcal: Math.round(sum("kcal")),
        protein: Math.round(sum("protein_g")),
        carbs: Math.round(sum("carbs_g")),
        fat: Math.round(sum("fat_g")),
        fiber: Math.round(sum("fiber_g")),
        minutes: 0,
      };
    }
    const list = exercises ?? [];
    return {
      kcal: Math.round(list.reduce((a, e) => a + e.kcal, 0)),
      protein: 0, carbs: 0, fat: 0, fiber: 0,
      minutes: Math.round(list.reduce((a, e) => a + e.minutes, 0)),
    };
  }, [tab, items, exercises]);

  function reset() {
    setItems(null);
    setExercises(null);
    setMeta(null);
    setError(null);
    setTuning(null);
  }

  function switchTab(next: Tab) {
    setTab(next);
    setText("");
    reset();
  }

  async function analyse() {
    setError(null);
    setBusy("analyse");
    try {
      const res = await fetch(`/api/parse/${tab}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not analyse that.");

      if (tab === "food") setItems(data.items as FoodItem[]);
      else setExercises(data.exercises as Exercise[]);

      setMeta({ confidence: data.confidence, assumptions: data.assumptions, cached: data.cached });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    setError(null);
    setBusy("save");
    try {
      if (tab === "food") {
        const list = (items ?? []).filter((i) => i.name.trim());
        if (!list.length) throw new Error("Add at least one item.");
        const { error } = await supabase.from("food_logs").insert({
          user_id: profile.id,
          local_date: today,
          meal_slot: slot,
          raw_text: text.trim() || list.map((i) => i.name).join(", "),
          items: list,
          kcal: totals.kcal,
          protein_g: totals.protein,
          carbs_g: totals.carbs,
          fat_g: totals.fat,
          fiber_g: totals.fiber,
          confidence: meta?.confidence ?? "medium",
          source: meta ? "ai" : "manual",
        });
        if (error) throw error;
      } else {
        const list = (exercises ?? []).filter((e) => e.name.trim());
        if (!list.length) throw new Error("Add at least one exercise.");
        const { error } = await supabase.from("workout_logs").insert({
          user_id: profile.id,
          local_date: today,
          raw_text: text.trim() || list.map((e) => e.name).join(", "),
          exercises: list,
          minutes: totals.minutes,
          kcal: totals.kcal,
          body_weight_kg: bodyWeight,
          confidence: meta?.confidence ?? "medium",
          source: meta ? "ai" : "manual",
        });
        if (error) throw error;
      }

      router.push("/");
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
      setBusy(null);
    }
  }

  async function toggleRestDay() {
    setBusy("rest");
    if (isRestDay) {
      await supabase.from("rest_days").delete()
        .eq("user_id", profile.id).eq("local_date", today);
    } else {
      await supabase.from("rest_days")
        .upsert({ user_id: profile.id, local_date: today });
    }
    setBusy(null);
    router.refresh();
  }

  /* ---------------- item editing ---------------- */

  const patchItem = (idx: number, patch: Partial<FoodItem>) =>
    setItems((prev) => prev?.map((it, i) => (i === idx ? { ...it, ...patch } : it)) ?? prev);

  const patchExercise = (idx: number, patch: Partial<Exercise>) =>
    setExercises((prev) =>
      prev?.map((ex, i) => {
        if (i !== idx) return ex;
        const merged = { ...ex, ...patch };
        // Burn always follows from MET × minutes × bodyweight — never typed in.
        return { ...merged, kcal: burnKcal(merged.met, merged.minutes, bodyWeight) };
      }) ?? prev,
    );

  return (
    <div className="rise space-y-5 pb-4">
      <PageHeader title="Log it" subtitle="Plain English. The AI does the rest." />

      <div className="grid grid-cols-2 gap-1 rounded-xl bg-ink-850 p-1">
        {(["food", "workout"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => switchTab(t)}
            className={`rounded-lg py-2.5 text-sm font-semibold transition-colors ${
              tab === t ? "bg-ink-700 text-mist-100" : "text-mist-500"
            }`}
          >
            {t === "food" ? "🍽️ Food" : "🏋️ Workout"}
          </button>
        ))}
      </div>

      {tab === "food" && (
        <div className="hide-scrollbar flex gap-2 overflow-x-auto">
          {SLOTS.map((s) => (
            <button
              key={s.value}
              className="chip"
              data-on={slot === s.value}
              onClick={() => setSlot(s.value)}
            >
              {s.label}
            </button>
          ))}
        </div>
      )}

      <div>
        <textarea
          className="field min-h-28 resize-none leading-relaxed"
          value={text}
          onChange={(e) => { setText(e.target.value); if (hasResult) reset(); }}
          placeholder={tab === "food" ? FOOD_PLACEHOLDER : WORKOUT_PLACEHOLDER}
          maxLength={1200}
        />
        <div className="mt-1.5 flex items-center justify-between text-[0.68rem] text-mist-500">
          <span>{tab === "food" ? "Rough quantities are fine." : "Say how long, or how many sets."}</span>
          <span className="tnum">{text.length}/1200</span>
        </div>
      </div>

      {!aiReady && (
        <p className="rounded-lg border border-gold/40 bg-gold/10 px-3 py-2 text-xs leading-relaxed text-gold">
          GEMINI_API_KEY isn&apos;t set, so AI analysis is off. You can still add entries by hand below.
        </p>
      )}

      {error && (
        <p className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-xs leading-relaxed text-danger">
          {error}
        </p>
      )}

      {!hasResult ? (
        <div className="space-y-2">
          <button
            className="btn btn-primary w-full"
            disabled={text.trim().length < 2 || busy !== null || !aiReady}
            onClick={analyse}
          >
            {busy === "analyse" ? (
              <span className="thinking">Working out the numbers…</span>
            ) : (
              "✨ Analyse with AI"
            )}
          </button>
          <button
            className="btn btn-quiet w-full text-xs"
            onClick={() => (tab === "food" ? setItems([blankItem()]) : setExercises([blankExercise(bodyWeight)]))}
          >
            or enter it manually
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {/* ---- totals ---- */}
          <div className="card-raised p-4">
            <div className="flex items-end justify-between">
              <div>
                <div className="text-[0.68rem] font-semibold uppercase tracking-wider text-mist-500">
                  {tab === "food" ? "Total intake" : "Total burn"}
                </div>
                <div className="tnum mt-1 text-3xl font-bold" style={{ color: "var(--color-lime-glow)" }}>
                  {totals.kcal}
                  <span className="ml-1 text-sm font-medium text-mist-500">kcal</span>
                </div>
              </div>
              {meta && (
                <div className="text-right">
                  <span
                    className={`rounded-full border px-2 py-0.5 text-[0.65rem] font-semibold ${
                      meta.confidence === "high"
                        ? "border-lime-glow/40 bg-lime-glow/15 text-lime-glow"
                        : meta.confidence === "low"
                          ? "border-danger/40 bg-danger/10 text-danger"
                          : "border-gold/40 bg-gold/10 text-gold"
                    }`}
                  >
                    {meta.confidence} confidence
                  </span>
                  {meta.cached && (
                    <div className="mt-1 text-[0.62rem] text-mist-500">from cache</div>
                  )}
                </div>
              )}
            </div>

            {tab === "food" ? (
              <div className="mt-3 flex gap-4 border-t border-ink-700 pt-3 text-xs text-mist-500">
                <span className="tnum">P <b className="text-mist-100">{totals.protein}</b>g</span>
                <span className="tnum">C <b className="text-mist-100">{totals.carbs}</b>g</span>
                <span className="tnum">F <b className="text-mist-100">{totals.fat}</b>g</span>
                <span className="tnum">Fib <b className="text-mist-100">{totals.fiber}</b>g</span>
              </div>
            ) : (
              <div className="mt-3 border-t border-ink-700 pt-3 text-xs text-mist-500">
                <span className="tnum">{totals.minutes} min</span> · priced at{" "}
                <span className="tnum">{bodyWeight} kg</span> bodyweight
              </div>
            )}

            {meta?.assumptions && (
              <p className="mt-2 text-[0.7rem] leading-relaxed text-mist-500">💡 {meta.assumptions}</p>
            )}
          </div>

          {/* ---- editable rows ---- */}
          <div className="space-y-2">
            {tab === "food"
              ? (items ?? []).map((item, i) => (
                  <div key={i} className="card p-3">
                    <div className="flex items-center gap-2">
                      <input
                        className="field flex-1 py-1.5 text-sm"
                        value={item.name}
                        onChange={(e) => patchItem(i, { name: e.target.value })}
                        placeholder="Food name"
                      />
                      <button
                        className="shrink-0 px-1 text-xs text-mist-500"
                        onClick={() => setTuning(tuning === i ? null : i)}
                        aria-label="Adjust numbers"
                      >
                        {tuning === i ? "Done" : "Edit"}
                      </button>
                      <button
                        className="shrink-0 px-1 text-lg leading-none text-mist-500"
                        onClick={() => setItems((p) => p?.filter((_, j) => j !== i) ?? p)}
                        aria-label="Remove item"
                      >
                        ×
                      </button>
                    </div>

                    <div className="mt-1.5 flex items-center gap-3 text-[0.7rem] text-mist-500">
                      <span className="tnum">{item.qty} {item.unit}</span>
                      <span className="tnum">{Math.round(item.kcal)} kcal</span>
                      <span className="tnum">{Math.round(item.protein_g)}g protein</span>
                    </div>

                    {tuning === i && (
                      <div className="mt-3 grid grid-cols-3 gap-2">
                        <NumField label="Qty" value={item.qty} onChange={(v) => patchItem(i, { qty: v })} />
                        <TextField label="Unit" value={item.unit} onChange={(v) => patchItem(i, { unit: v })} />
                        <NumField label="kcal" value={item.kcal} onChange={(v) => patchItem(i, { kcal: v })} />
                        <NumField label="Protein g" value={item.protein_g} onChange={(v) => patchItem(i, { protein_g: v })} />
                        <NumField label="Carbs g" value={item.carbs_g} onChange={(v) => patchItem(i, { carbs_g: v })} />
                        <NumField label="Fat g" value={item.fat_g} onChange={(v) => patchItem(i, { fat_g: v })} />
                      </div>
                    )}
                  </div>
                ))
              : (exercises ?? []).map((ex, i) => (
                  <div key={i} className="card p-3">
                    <div className="flex items-center gap-2">
                      <input
                        className="field flex-1 py-1.5 text-sm"
                        value={ex.name}
                        onChange={(e) => patchExercise(i, { name: e.target.value })}
                        placeholder="Exercise"
                      />
                      <button
                        className="shrink-0 px-1 text-xs text-mist-500"
                        onClick={() => setTuning(tuning === i ? null : i)}
                      >
                        {tuning === i ? "Done" : "Edit"}
                      </button>
                      <button
                        className="shrink-0 px-1 text-lg leading-none text-mist-500"
                        onClick={() => setExercises((p) => p?.filter((_, j) => j !== i) ?? p)}
                        aria-label="Remove exercise"
                      >
                        ×
                      </button>
                    </div>

                    <div className="mt-1.5 flex items-center gap-3 text-[0.7rem] text-mist-500">
                      <span className="tnum">{Math.round(ex.minutes)} min</span>
                      <span className="tnum">MET {ex.met}</span>
                      <span className="tnum font-semibold text-lime-glow">{Math.round(ex.kcal)} kcal</span>
                    </div>

                    {tuning === i && (
                      <div className="mt-3 grid grid-cols-3 gap-2">
                        <NumField label="Minutes" value={ex.minutes} onChange={(v) => patchExercise(i, { minutes: v })} />
                        <NumField label="MET" value={ex.met} step={0.1} onChange={(v) => patchExercise(i, { met: v })} />
                        <NumField label="Sets" value={ex.sets ?? 0} onChange={(v) => patchExercise(i, { sets: v })} />
                        <NumField label="Reps" value={ex.reps ?? 0} onChange={(v) => patchExercise(i, { reps: v })} />
                        <NumField label="Weight kg" value={ex.weight_kg ?? 0} onChange={(v) => patchExercise(i, { weight_kg: v })} />
                        <NumField label="Distance km" value={ex.distance_km ?? 0} step={0.1} onChange={(v) => patchExercise(i, { distance_km: v })} />
                      </div>
                    )}
                  </div>
                ))}

            <button
              className="btn btn-ghost w-full py-2 text-xs"
              onClick={() =>
                tab === "food"
                  ? setItems((p) => [...(p ?? []), blankItem()])
                  : setExercises((p) => [...(p ?? []), blankExercise(bodyWeight)])
              }
            >
              + Add another
            </button>
          </div>

          <div className="flex gap-2">
            <button className="btn btn-ghost flex-1" onClick={reset} disabled={busy !== null}>
              Start over
            </button>
            <button className="btn btn-primary flex-[2]" onClick={save} disabled={busy !== null}>
              {busy === "save" ? "Saving…" : "Save to today"}
            </button>
          </div>
        </div>
      )}

      {tab === "workout" && !hasResult && (
        <button
          className={`btn w-full ${isRestDay ? "btn-primary" : "btn-ghost"}`}
          onClick={toggleRestDay}
          disabled={busy !== null}
        >
          {isRestDay ? "✓ Marked as a rest day" : "😴 Mark today as a rest day"}
        </button>
      )}
    </div>
  );
}

function blankExercise(bodyWeight: number): Exercise {
  return {
    name: "", kind: "other", met: 4, minutes: 30,
    sets: null, reps: null, weight_kg: null, distance_km: null,
    kcal: burnKcal(4, 30, bodyWeight),
  };
}

function NumField({
  label, value, onChange, step = 1,
}: { label: string; value: number; onChange: (v: number) => void; step?: number }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[0.62rem] font-semibold uppercase tracking-wide text-mist-500">
        {label}
      </span>
      <input
        className="field tnum py-1.5 text-sm"
        type="number" inputMode="decimal" step={step} min={0}
        value={String(value)}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
      />
    </label>
  );
}

function TextField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[0.62rem] font-semibold uppercase tracking-wide text-mist-500">
        {label}
      </span>
      <input className="field py-1.5 text-sm" value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}
