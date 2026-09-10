"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  addDays, bmiBand, deriveTargets, prettyDate, publishedTargets,
  type DerivedTargets, type GoalLike,
} from "@/lib/calc";
import { litres, waterTarget } from "@/lib/hydration";
import type { Profile } from "@/lib/types";

/* ---------------------------------------------------------------------
 * Your numbers, your call.
 *
 * Every target the app scores you against can be typed in by hand. The
 * formulas are a good default, not an authority: someone with a real
 * metabolic-cart BMR, or a dietitian's macro split, knows better than an
 * equation fitted to a population.
 *
 * Leaving a field blank hands it back to the formula, so there is no
 * "reset" to hunt for and nothing to get stuck in.
 *
 * The preview under each section is computed with the same deriveTargets()
 * the score uses, on the profile as it would be after saving — so what you
 * are shown before saving is exactly what you get after.
 * ------------------------------------------------------------------- */

const WEEK_PICKS = [2, 4, 8, 12] as const;

type Draft = {
  bmr: string;
  kcal: string;
  protein: string;
  carbs: string;
  fat: string;
  fiber: string;
  burn: string;
  minutes: string;
  water: string;
  goalKg: string;
  goalDate: string;
};

const str = (v: number | null) => (v === null || v === undefined ? "" : String(v));
const numOrNull = (v: string): number | null => {
  const n = Number(v.trim());
  return v.trim() !== "" && Number.isFinite(n) && n > 0 ? Math.round(n * 10) / 10 : null;
};

export default function TargetsEditor({
  profile, today, goals,
}: {
  profile: Profile;
  today: string;
  /** This month's goals, folded into what gets published — see publishedTargets(). */
  goals: GoalLike[];
}) {
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const [d, setD] = useState<Draft>({
    bmr: str(profile.bmr_override),
    kcal: str(profile.kcal_target_override),
    protein: str(profile.protein_target_g),
    carbs: str(profile.carbs_target_g),
    fat: str(profile.fat_target_g),
    fiber: str(profile.fiber_target_g),
    burn: str(profile.burn_target_override),
    minutes: str(profile.minutes_target_override),
    water: str(profile.water_target_ml),
    goalKg: str(profile.weight_goal_kg),
    goalDate: profile.weight_goal_date ?? "",
  });

  const set = (patch: Partial<Draft>) => { setD((p) => ({ ...p, ...patch })); setSaved(false); };

  /** The profile as it would be after saving — what the preview is built on. */
  const candidate: Profile = useMemo(() => ({
    ...profile,
    bmr_override: numOrNull(d.bmr),
    kcal_target_override: numOrNull(d.kcal),
    protein_target_g: numOrNull(d.protein),
    carbs_target_g: numOrNull(d.carbs),
    fat_target_g: numOrNull(d.fat),
    fiber_target_g: numOrNull(d.fiber),
    burn_target_override: numOrNull(d.burn),
    minutes_target_override: numOrNull(d.minutes),
    water_target_ml: numOrNull(d.water),
    weight_goal_kg: numOrNull(d.goalKg),
    weight_goal_date: d.goalDate || null,
    // A brand-new plan starts from today's weight; an existing one keeps the
    // point it actually started from.
    weight_goal_start_kg: profile.weight_goal_kg ? profile.weight_goal_start_kg : profile.weight_kg,
    weight_goal_set_on: profile.weight_goal_kg ? profile.weight_goal_set_on : today,
  }), [profile, d, today]);

  const preview = deriveTargets(candidate, today);

  async function save() {
    setBusy(true);
    setError(null);
    const supabase = createClient();

    const patch = {
      bmr_override: candidate.bmr_override,
      kcal_target_override: candidate.kcal_target_override,
      protein_target_g: candidate.protein_target_g,
      carbs_target_g: candidate.carbs_target_g,
      fat_target_g: candidate.fat_target_g,
      fiber_target_g: candidate.fiber_target_g,
      burn_target_override: candidate.burn_target_override,
      minutes_target_override: candidate.minutes_target_override,
      water_target_ml: candidate.water_target_ml,
      weight_goal_kg: candidate.weight_goal_kg,
      weight_goal_date: candidate.weight_goal_kg ? candidate.weight_goal_date : null,
      weight_goal_start_kg: candidate.weight_goal_kg ? candidate.weight_goal_start_kg : null,
      weight_goal_set_on: candidate.weight_goal_kg ? candidate.weight_goal_set_on : null,
      // Republished in the same write, so a rival's scoreboard never lags
      // behind a change made here.
      ...publishedTargets(candidate, today, goals),
    };

    const { error: err } = await supabase.from("profiles").update(patch).eq("id", profile.id);
    setBusy(false);
    if (err) { setError(err.message); return; }
    setSaved(true);
    router.refresh();
  }

  function clearPlan() {
    set({ goalKg: "", goalDate: "" });
  }

  const planWeeks = (weeks: number) => set({ goalDate: addDays(today, weeks * 7) });

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="surface flex w-full items-center justify-between px-5 py-4 text-left"
      >
        <div className="min-w-0">
          <div className="eyebrow">Change your targets</div>
          {/* The figures themselves are on the tiles above. Repeating them here
              would put the formula's numbers beside the goal-adjusted ones the
              score uses, and the two disagree whenever a goal is set. */}
          <p className="mt-1.5 truncate text-sm text-mist-200">
            {preview
              ? "Weight plan, resting burn, macros, burn and water"
              : "Not enough profile data yet"}
          </p>
          <p className="mt-0.5 text-[0.65rem] text-mist-600">
            {describeBasis(preview)}
          </p>
        </div>
        <span className="shrink-0 text-xs font-semibold text-lime-glow">Edit</span>
      </button>
    );
  }

  return (
    <div className="surface space-y-6 px-5 py-5">
      {/* ---------------- the plan ---------------- */}
      <section>
        <div className="eyebrow mb-1">Where you want to be</div>
        <p className="mb-3 text-[0.7rem] leading-relaxed text-mist-600">
          A weight and a date. The app works out what you have to eat to get there,
          and refuses to suggest a pace that is not safe.
        </p>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Target weight (kg)">
            <input
              className="field tnum" type="number" inputMode="decimal" step="0.1"
              value={d.goalKg} onChange={(e) => set({ goalKg: e.target.value })}
              placeholder={profile.weight_kg ? String(Math.round(Number(profile.weight_kg) - 2)) : "70"}
            />
          </Field>
          <Field label="By when">
            <input
              className="field" type="date" min={addDays(today, 7)}
              value={d.goalDate} onChange={(e) => set({ goalDate: e.target.value })}
            />
          </Field>
        </div>

        <div className="hide-scrollbar mt-2.5 flex gap-2 overflow-x-auto">
          {WEEK_PICKS.map((w) => (
            <button key={w} className="chip" data-on={d.goalDate === addDays(today, w * 7)}
              onClick={() => planWeeks(w)}>
              {w} weeks
            </button>
          ))}
          {(d.goalKg || d.goalDate) && (
            <button className="chip" onClick={clearPlan}>Clear</button>
          )}
        </div>

        {preview?.plan && (
          <div className="mt-3.5 rounded-xl border border-hair bg-ink-850 px-4 py-3">
            <p className="tnum text-sm font-semibold text-white">
              {preview.kcalTarget} kcal a day
              <span className="ml-1.5 text-xs font-normal text-mist-600">
                ({preview.plan.dailyDelta > 0 ? "+" : ""}{preview.plan.dailyDelta} vs maintenance)
              </span>
            </p>
            <p className="mt-1 text-[0.7rem] leading-relaxed text-mist-400">
              {preview.plan.kgToGo} kg to {preview.plan.direction} at {preview.plan.kgPerWeek} kg a
              week, arriving {prettyDate(preview.plan.arrivesOn)}.
            </p>
            {preview.plan.note && (
              <p className="mt-1.5 text-[0.7rem] leading-relaxed text-gold">{preview.plan.note}</p>
            )}
            {preview.bmi !== null && (
              <p className="mt-1.5 text-[0.65rem] text-mist-600">
                Target BMI {targetBmi(candidate)} — {bandWord(targetBmi(candidate))}
              </p>
            )}
          </div>
        )}
      </section>

      {/* ---------------- resting burn ---------------- */}
      <section className="hair pt-5">
        <div className="eyebrow mb-1">Resting burn (BMR)</div>
        <p className="mb-3 text-[0.7rem] leading-relaxed text-mist-600">
          Leave blank for Mifflin–St Jeor from your height, weight and age. Fill it in
          if you have had it measured — everything else scales from this number.
        </p>
        <input
          className="field tnum" type="number" inputMode="decimal"
          value={d.bmr} onChange={(e) => set({ bmr: e.target.value })}
          placeholder={preview && profile.bmr_override === null ? `${preview.bmr} (calculated)` : "1650"}
        />
        {preview && (
          <p className="tnum mt-2 text-[0.68rem] text-mist-600">
            Maintenance works out at {preview.tdee} kcal with your activity level.
          </p>
        )}
      </section>

      {/* ---------------- macros ---------------- */}
      <section className="hair pt-5">
        <div className="eyebrow mb-1">Daily macros</div>
        <p className="mb-3 text-[0.7rem] leading-relaxed text-mist-600">
          Blank means the app decides. Protein is scored; carbs and fat are ceilings that
          turn red at the top of Today when you pass them.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Calories (kcal)">
            <input className="field tnum" type="number" inputMode="decimal"
              value={d.kcal} onChange={(e) => set({ kcal: e.target.value })}
              placeholder={preview ? String(preview.kcalTarget) : "2000"} />
          </Field>
          <Field label="Protein (g)">
            <input className="field tnum" type="number" inputMode="decimal"
              value={d.protein} onChange={(e) => set({ protein: e.target.value })}
              placeholder={preview ? String(preview.proteinTarget) : "140"} />
          </Field>
          <Field label="Carbs (g)">
            <input className="field tnum" type="number" inputMode="decimal"
              value={d.carbs} onChange={(e) => set({ carbs: e.target.value })}
              placeholder="optional" />
          </Field>
          <Field label="Fat (g)">
            <input className="field tnum" type="number" inputMode="decimal"
              value={d.fat} onChange={(e) => set({ fat: e.target.value })}
              placeholder="optional" />
          </Field>
          <Field label="Fibre (g)">
            <input className="field tnum" type="number" inputMode="decimal"
              value={d.fiber} onChange={(e) => set({ fiber: e.target.value })}
              placeholder="optional" />
          </Field>
          <Field label="Burn aim (kcal)">
            <input className="field tnum" type="number" inputMode="decimal"
              value={d.burn} onChange={(e) => set({ burn: e.target.value })}
              placeholder={preview ? String(preview.burnTarget) : "350"} />
          </Field>
          <Field label="Active minutes">
            <input className="field tnum" type="number" inputMode="decimal"
              value={d.minutes} onChange={(e) => set({ minutes: e.target.value })}
              placeholder={preview ? String(preview.minutesTarget) : "60"} />
          </Field>
          <Field label="Water (ml)">
            <input className="field tnum" type="number" inputMode="decimal"
              value={d.water} onChange={(e) => set({ water: e.target.value })}
              placeholder={`${waterTarget(profile, null).baseMl} (calculated)`} />
          </Field>
        </div>

        <p className="mt-2.5 text-[0.65rem] leading-relaxed text-mist-600">
          Active minutes default to how long your burn aim takes at a moderate effort
          {preview ? ` — ${preview.minutesTarget} for you` : ""}. Left blank, water is {litres(waterTarget(profile, null).baseMl)} for your bodyweight
          plus roughly a litre for every 700 kcal you burn training. Set it yourself and
          that figure is used exactly as typed, training day or not.
        </p>

        {preview && d.kcal.trim() === "" && (
          <p className="mt-2.5 text-[0.65rem] leading-relaxed text-mist-600">
            Macro grams should land near your calorie aim: protein and carbs are 4 kcal a
            gram, fat 9. Yours currently come to {macroKcal(candidate)} kcal of {preview.kcalTarget}.
          </p>
        )}
      </section>

      {error && <p className="text-xs text-danger">{error}</p>}

      <div className="flex gap-2">
        <button className="btn btn-ghost flex-1" onClick={() => setOpen(false)} disabled={busy}>
          Close
        </button>
        <button className="btn btn-primary flex-[2]" onClick={save} disabled={busy}>
          {busy ? "Saving…" : saved ? "✓ Saved" : "Save targets"}
        </button>
      </div>

      <p className="text-[0.62rem] leading-relaxed text-mist-600">
        Your weight plan and everything you type here stay private. A competitor&apos;s
        screen gets only the daily aims that result, because it scores your day against
        them — never your height, weight, age, BMI, resting burn or goals.
      </p>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="eyebrow mb-2 block">{label}</span>
      {children}
    </label>
  );
}

function describeBasis(t: DerivedTargets | null): string {
  if (!t) return "Add your height and weight to derive them";
  const manual = [
    t.basis.bmr === "manual" ? "BMR" : null,
    t.basis.kcal === "manual" ? "calories" : null,
    t.basis.protein === "manual" ? "protein" : null,
    t.basis.burn === "manual" ? "burn" : null,
  ].filter(Boolean);
  if (t.basis.kcal === "plan") {
    return manual.length
      ? `From your weight plan; ${manual.join(", ")} set by hand`
      : "From your weight plan";
  }
  return manual.length ? `${manual.join(", ")} set by hand` : "Calculated from your profile";
}

function targetBmi(p: Profile): number {
  const h = Number(p.height_cm) / 100;
  const w = Number(p.weight_goal_kg);
  if (!(h > 0) || !(w > 0)) return 0;
  return Math.round((w / (h * h)) * 10) / 10;
}

function bandWord(value: number): string {
  if (!value) return "—";
  const band = bmiBand(value);
  return band === "under"
    ? "below the healthy range"
    : band === "healthy"
      ? "in the healthy range"
      : band === "over"
        ? "above the healthy range"
        : "well above the healthy range";
}

function macroKcal(p: Profile): number {
  const g = (v: number | null) => Number(v ?? 0);
  return Math.round(g(p.protein_target_g) * 4 + g(p.carbs_target_g) * 4 + g(p.fat_target_g) * 9);
}
