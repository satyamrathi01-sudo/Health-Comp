"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { addDays, bmiBand, deriveTargets, prettyDate, publishedTargets } from "@/lib/calc";
import { litres, waterTarget } from "@/lib/hydration";
import type { Profile } from "@/lib/types";

/* ---------------------------------------------------------------------
 * Your numbers, your call.
 *
 * Every target the app scores you against can be typed in by hand. The
 * formulas are a good default, not an authority: someone with a measured
 * BMR, or a dietitian's macro split, knows better than an equation fitted
 * to a population.
 *
 * Leaving a field blank hands it back to the formula, so there is no
 * "reset" to hunt for and nothing to get stuck in.
 *
 * The preview is computed with the same deriveTargets() the score uses, on
 * the profile as it would be after saving — so what you see before saving
 * is exactly what you get after.
 *
 * It has its own tab on Goals, so it is always open: no collapsed summary
 * and no close button.
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

export default function TargetsEditor({ profile, today }: { profile: Profile; today: string }) {
  const router = useRouter();

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
  const baseWater = waterTarget(profile, null).baseMl;

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
      ...publishedTargets(candidate, today),
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

  return (
    <div className="space-y-4">
      {/* ---------------- weight goal ---------------- */}
      <section className="surface px-5 py-5">
        <div className="eyebrow mb-1">Weight goal</div>
        <p className="mb-3 text-[0.7rem] leading-relaxed text-mist-600">
          Pick a weight and a date. We&apos;ll work out how much to eat, and we won&apos;t
          suggest a pace that isn&apos;t safe.
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
              Eat {preview.kcalTarget} kcal a day
              <span className="ml-1.5 text-xs font-normal text-mist-600">
                ({preview.plan.dailyDelta > 0 ? "+" : ""}{preview.plan.dailyDelta} vs what you use)
              </span>
            </p>
            <p className="mt-1 text-[0.7rem] leading-relaxed text-mist-400">
              {preview.plan.kgToGo} kg to {preview.plan.direction}, about {preview.plan.kgPerWeek} kg
              a week. You&apos;d get there by {prettyDate(preview.plan.arrivesOn)}.
            </p>
            {preview.plan.note && (
              <p className="mt-1.5 text-[0.7rem] leading-relaxed text-gold">{preview.plan.note}</p>
            )}
            {preview.bmi !== null && (
              <p className="mt-1.5 text-[0.65rem] text-mist-600">
                BMI at that weight: {targetBmi(candidate)}, {bandWord(targetBmi(candidate))}
              </p>
            )}
          </div>
        )}
      </section>

      {/* ---------------- resting burn ---------------- */}
      <section className="surface px-5 py-5">
        <div className="eyebrow mb-1">Calories at rest (BMR)</div>
        <p className="mb-3 text-[0.7rem] leading-relaxed text-mist-600">
          Leave this empty and we&apos;ll work it out. Only fill it in if you&apos;ve had it
          measured — everything else is based on it.
        </p>
        <input
          className="field tnum" type="number" inputMode="decimal"
          value={d.bmr} onChange={(e) => set({ bmr: e.target.value })}
          placeholder={preview && profile.bmr_override === null ? `${preview.bmr} (worked out)` : "1650"}
        />
        {preview && (
          <p className="tnum mt-2 text-[0.68rem] text-mist-600">
            With your activity level you use about {preview.tdee} kcal a day.
          </p>
        )}
      </section>

      {/* ---------------- daily targets ---------------- */}
      <section className="surface px-5 py-5">
        <div className="eyebrow mb-1">Daily targets</div>
        <p className="mb-3 text-[0.7rem] leading-relaxed text-mist-600">
          Leave a box empty to use our number, shown in grey. Carbs and fat are limits:
          Today warns you if you go over.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Eat (kcal)">
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
          <Field label="Burn (kcal)">
            <input className="field tnum" type="number" inputMode="decimal"
              value={d.burn} onChange={(e) => set({ burn: e.target.value })}
              placeholder={preview ? String(preview.burnTarget) : "350"} />
          </Field>
          <Field label="Exercise (min)">
            <input className="field tnum" type="number" inputMode="decimal"
              value={d.minutes} onChange={(e) => set({ minutes: e.target.value })}
              placeholder={preview ? String(preview.minutesTarget) : "60"} />
          </Field>
          <Field label="Water (ml)">
            <input className="field tnum" type="number" inputMode="decimal"
              value={d.water} onChange={(e) => set({ water: e.target.value })}
              placeholder={`${baseWater} (worked out)`} />
          </Field>
        </div>

        <p className="mt-2.5 text-[0.65rem] leading-relaxed text-mist-600">
          Exercise is how long your burn target takes at a moderate pace
          {preview ? ` (${preview.minutesTarget} min for you)` : ""}. Water is {litres(baseWater)} for
          your weight, plus about 1 L for every 700 kcal you burn. If you set water yourself,
          we use exactly that.
        </p>

        {preview && d.kcal.trim() === "" && (
          <p className="mt-2 text-[0.65rem] leading-relaxed text-mist-600">
            Protein and carbs have 4 kcal per gram, fat has 9. The amounts you&apos;ve typed add
            up to {macroKcal(candidate)} of {preview.kcalTarget} kcal.
          </p>
        )}
      </section>

      {error && <p className="px-1 text-xs text-danger">{error}</p>}

      <button className="btn btn-primary w-full" onClick={save} disabled={busy}>
        {busy ? "Saving…" : saved ? "✓ Saved" : "Save targets"}
      </button>

      <p className="px-1 text-[0.62rem] leading-relaxed text-mist-600">
        Your weight goal and anything you type here stay private.
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
