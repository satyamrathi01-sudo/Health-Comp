import "server-only";
import {
  addDays, deriveTargets, localDate, localHour, MICRO_REFS, microTarget, prettyDate,
  scoreTargetsFrom, type WeightPlan,
} from "./calc.ts";
import { breachedLimits } from "./limits.ts";
import { hydration, litres, waterCeilingMl, waterTarget } from "./hydration.ts";
import { scoreDay, type ScoreTargets } from "./scoring.ts";
import { computeRecovery } from "./recovery.ts";
import type { createClient } from "./supabase/server.ts";
import type { DailyTotals, FoodLog, MealSlot, Profile } from "./types.ts";

/* =====================================================================
 * What the coach knows about your day.
 *
 * Shared by the tips for tomorrow (/api/coach) and the chat box
 * (/api/coach/chat), so a question asked in the chat is answered from exactly
 * the numbers the tips were written from. The advice briefing is kept
 * byte-for-byte what it was: its hash decides when tips are regenerated, and
 * changing it would throw away every cached note.
 * ===================================================================== */

type Supabase = Awaited<ReturnType<typeof createClient>>;

const SLOT_LABEL: Record<MealSlot, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
  snack: "Snack",
};

export interface CoachContext {
  today: string;
  todayTotals: DailyTotals | null;
  /** The three targets the tips are priced against. */
  targets: ScoreTargets | null;
  /** True once anything has been eaten or trained today. */
  hasData: boolean;
  /** The briefing the tips are written from. Its hash is the tips' cache key. */
  text: string;
  /** Today's score, one line per scored component. Empty without targets. */
  scoreLines: string;
  /** Today's meals, food by food. Only filled when asked for. */
  foods: string;
}

/** Build the plain-text briefing the coach reasons over. */
function briefing(
  profile: Profile,
  today: DailyTotals | null,
  week: DailyTotals[],
  targets: ScoreTargets | null,
  plan: WeightPlan | null,
  breaches: ReturnType<typeof breachedLimits>,
  water: ReturnType<typeof hydration> | null,
  macros: ReturnType<typeof deriveTargets>,
): string {
  const n = (v: number | null | undefined) => Math.round(Number(v ?? 0));

  const lines: string[] = [
    `Person: ${profile.sex ?? "unspecified"}, goal ${profile.goal}, ${profile.weight_kg} kg.`,
    targets
      ? `Daily targets they are scored against: ${targets.kcalTarget} kcal intake, ` +
        `${targets.proteinTarget} g protein, ${targets.burnTarget} kcal burned.`
      : "Targets: not enough profile data.",
    macros
      ? `Their macro split, worked out from that calorie target and their goal: ` +
        `${macros.proteinTarget} g protein, ${macros.carbsTarget} g carbs, ` +
        `${macros.fatTarget} g fat, ${macros.fiberTarget} g fibre. Every number below ` +
        `is set for THIS person — do not fall back on generic advice.`
      : "",
    "",
    "TODAY",
    `  Eaten ${n(today?.kcal_in)} kcal across ${n(today?.meals)} meals.`,
    `  Protein ${n(today?.protein_g)} g, carbs ${n(today?.carbs_g)} g, fat ${n(today?.fat_g)} g, fibre ${n(today?.fiber_g)} g.`,
    today?.sessions
      ? `  Trained: ${n(today.sessions)} session(s), ${n(today.active_minutes)} min, ${n(today.kcal_out)} kcal burned.`
      : today?.is_rest_day
        ? "  Marked as a rest day."
        : "  No training logged.",
    today?.sleep_hours != null
      ? `  Sleep ${today.sleep_hours} h${today.sleep_quality ? ` (${today.sleep_quality})` : ""}.`
      : "  Sleep not logged.",
    water
      ? `  Water ${litres(water.drankMl)} of a ${litres(water.targetMl)} aim — ${water.headline.toLowerCase()}.`
      : "  Water not tracked today.",
    "",
    "MICRONUTRIENTS TODAY (value vs target)",
  ];

  if (plan) {
    lines.splice(2, 0,
      `They are working to reach ${plan.targetKg} kg by ${prettyDate(plan.targetDate)} — ` +
      `${plan.kgToGo} kg to go at ${plan.kgPerWeek} kg a week, which is what the calorie ` +
      `target above is set for. Advice that ignores this plan is not useful to them.`);
  }

  if (breaches.length) {
    lines.push(
      "",
      "ALREADY PAST A LIMIT TODAY — address the worst of these first:",
      ...breaches.map((b) =>
        `  ${b.label}: ${b.value} of ${b.limit} ${b.unit}` +
        (b.state === "over" ? ` — OVER by ${b.over}` : " — nearly at the limit")),
    );
  }

  const microCtx = {
    kcalTarget: targets?.kcalTarget ?? 2000,
    weightKg: profile.weight_kg,
    exerciseKcal: Number(today?.kcal_out ?? 0),
  };

  for (const ref of MICRO_REFS) {
    const value = Number(today?.[ref.key] ?? 0);
    const target = microTarget(ref, profile.sex, microCtx);
    const verdict =
      ref.mode === "limit"
        ? value > target ? "OVER LIMIT" : "within limit"
        : value < target * 0.6 ? "LOW" : "ok";
    lines.push(`  ${ref.label}: ${Math.round(value * 10) / 10} / ${target} ${ref.unit} — ${verdict}`);
  }

  const logged = week.filter((d) => d.meals > 0 || d.sessions > 0);
  if (logged.length) {
    const avg = (pick: (d: DailyTotals) => number) =>
      Math.round(logged.reduce((a, d) => a + pick(d), 0) / logged.length);
    lines.push(
      "",
      `LAST ${logged.length} LOGGED DAYS`,
      `  Average intake ${avg((d) => d.kcal_in)} kcal, protein ${avg((d) => d.protein_g)} g, burn ${avg((d) => d.kcal_out)} kcal.`,
      `  Trained on ${week.filter((d) => d.sessions > 0).length} of the last ${week.length} days.`,
    );
  }

  return lines.filter((l, i) => l !== "" || lines[i - 1] !== "").join("\n");
}

/** Today's meals as plain lines, food by food, for the chat. */
function describeFoods(rows: FoodLog[]): string {
  return rows
    .map((log) => {
      const items = (log.items ?? [])
        .map((i) => `${i.name} (${i.qty} ${i.unit}, ${Math.round(Number(i.kcal) || 0)} kcal, ` +
          `${Math.round(Number(i.protein_g) || 0)} g protein, ${Math.round(Number(i.fat_g) || 0)} g fat)`)
        .join("; ");
      return `  ${SLOT_LABEL[log.meal_slot] ?? "Meal"}: ${items || log.raw_text}`;
    })
    .join("\n");
}

export async function loadCoachContext(
  supabase: Supabase,
  profile: Profile,
  options: { foods?: boolean } = {},
): Promise<CoachContext> {
  const today = localDate(profile.timezone);
  const fromDate = addDays(today, -6);

  const [{ data: rows }, foodResult] = await Promise.all([
    supabase.from("daily_totals").select("*")
      .eq("user_id", profile.id).gte("local_date", fromDate).lte("local_date", today),
    options.foods
      ? supabase.from("food_logs").select("*")
          .eq("user_id", profile.id).eq("local_date", today).order("logged_at")
      : Promise.resolve({ data: [] as FoodLog[] }),
  ]);

  const week = (rows ?? []) as DailyTotals[];
  const todayTotals = week.find((d) => d.local_date === today) ?? null;

  // The same derivation the score uses, so the coach and the scoreboard are
  // working from the same numbers.
  const derived = deriveTargets(profile, today);
  const targets: ScoreTargets | null = derived
    ? {
        burnTarget: derived.burnTarget,
        proteinTarget: derived.proteinTarget,
        kcalTarget: derived.kcalTarget,
      }
    : null;

  // Readiness changes what good advice looks like: telling someone to go
  // hard on four hours of sleep is bad coaching.
  const yesterday = week.find((d) => d.local_date === addDays(today, -1)) ?? null;

  let consecutiveTrainingDays = 0;
  for (let i = 1; i < 8; i++) {
    const row = week.find((w) => w.local_date === addDays(today, -i));
    if (!row || row.sessions === 0) break;
    consecutiveTrainingDays++;
  }

  const recovery = computeRecovery({
    sleepHours: todayTotals?.sleep_hours ?? null,
    sleepQuality: todayTotals?.sleep_quality ?? null,
    yesterdayBurn: yesterday?.kcal_out ?? 0,
    yesterdayKcalIn: yesterday?.kcal_in ?? 0,
    yesterdayProtein: yesterday?.protein_g ?? 0,
    yesterdayLoggedFood: (yesterday?.meals ?? 0) > 0,
    consecutiveTrainingDays,
    targets,
  });

  const water = hydration(
    todayTotals?.water_ml ?? 0,
    waterTarget(profile, todayTotals),
    localHour(profile.timezone),
  );

  const breaches = breachedLimits(
    todayTotals,
    profile.sex,
    derived
      ? {
          ...derived,
          weightKg: profile.weight_kg,
          waterCeilingMl: waterCeilingMl(waterTarget(profile, todayTotals)),
        }
      : null,
  );

  const text =
    briefing(
      profile, todayTotals, week, targets,
      derived?.plan ?? null, breaches, water, derived,
    ) +
    (recovery.score === null
      ? "\n\nRECOVERY: unknown, no sleep logged."
      : `\n\nRECOVERY: ${recovery.score}/100 (${recovery.band}) — ${recovery.headline}.\n` +
        recovery.drivers.map((d) => `  ${d.label}: ${Math.round(d.value * 100)}% (${d.detail})`).join("\n") +
        "\nIf recovery is low, say so and steer them toward rest and sleep rather than " +
        "more training, however tempting the score is.");

  // The full targets, exactly as Today scores the day, so "how do I get more
  // points" is answered from the real lines rather than an approximation.
  const fullTargets = scoreTargetsFrom(derived, { sex: profile.sex, weightKg: profile.weight_kg });
  const scoreLines = fullTargets
    ? scoreDay(todayTotals, today, 0, fullTargets).lines
        .filter((l) => l.key !== "streak" && l.max > 0)
        .map((l) => `  ${l.label}: ${l.points} of ${l.max} points (${l.detail})`)
        .join("\n")
    : "";

  return {
    today,
    todayTotals,
    targets,
    hasData: Boolean(todayTotals && (todayTotals.meals > 0 || todayTotals.sessions > 0)),
    text,
    scoreLines,
    foods: describeFoods((foodResult.data ?? []) as FoodLog[]),
  };
}
