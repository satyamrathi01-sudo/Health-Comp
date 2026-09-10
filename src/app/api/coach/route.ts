import { createHash } from "crypto";
import { NextResponse } from "next/server";
import { createClient, supabaseConfigured } from "@/lib/supabase/server";
import { generateAdvice, GeminiError } from "@/lib/gemini";
import {
  addDays, deriveTargets, localDate, localHour,
  MICRO_REFS, microTarget, prettyDate, type WeightPlan,
} from "@/lib/calc";
import { breachedLimits } from "@/lib/limits";
import { hydration, litres, waterCeilingMl, waterTarget } from "@/lib/hydration";
import { projectedGain, scoreDay, type ScoreTargets } from "@/lib/scoring";
import { computeRecovery } from "@/lib/recovery";
import { getMyProfile } from "@/lib/data";
import type { AdvicePoint, DailyTotals, Profile } from "@/lib/types";

export const runtime = "nodejs";

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

export async function POST(request: Request) {
  // Without `force`, an existing note for today is reused regardless of whether
  // the numbers have moved. Free-tier quota is ~20 requests per model per day,
  // so regenerating on every logged meal would burn it before lunch. The user
  // asks for a fresh read explicitly via the Refresh control.
  let force = false;
  try {
    force = Boolean((await request.json())?.force);
  } catch {
    // no body — treat as a normal, non-forced read
  }

  if (!supabaseConfigured()) {
    return NextResponse.json({ error: "Supabase isn't configured." }, { status: 503 });
  }

  const supabase = await createClient();

  // Through getMyProfile so the numerics are coerced exactly as they are for
  // the pages: PostgREST hands back "72.5" as a string, and a target derived
  // from strings is a target that quietly disagrees with the scoreboard. It
  // also reads auth.uid() from the JWT, so no separate "who am I" call is
  // needed before it.
  const profile: Profile | null = await getMyProfile();
  if (!profile) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const today = localDate(profile.timezone);
  const fromDate = addDays(today, -6);

  // Two independent reads. They only need the timezone from the profile, so
  // they go together rather than one after another — on a function talking to
  // Supabase across a region, sequencing these was most of the wait.
  const [{ data: rows }, { data: existing }] = await Promise.all([
    supabase.from("daily_totals").select("*")
      .eq("user_id", profile.id).gte("local_date", fromDate).lte("local_date", today),
    supabase.from("daily_advice").select("*")
      .eq("user_id", profile.id).eq("local_date", today).maybeSingle(),
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

  if (!todayTotals || (todayTotals.meals === 0 && todayTotals.sessions === 0)) {
    return NextResponse.json(
      { error: "Log something first — there's nothing to advise on yet." },
      { status: 422 },
    );
  }

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

  // Regenerate only when the day's numbers actually moved. Without this the
  // coach would burn a Gemini call on every dashboard render.
  const basisHash = createHash("sha256").update(text).digest("hex").slice(0, 32);

  const unchanged = existing && existing.basis_hash === basisHash;
  if (existing && (unchanged || !force)) {
    return NextResponse.json({
      headline: existing.headline,
      points: existing.points,
      score: scoreDay(todayTotals, today).total,
      cached: true,
      // Tells the UI whether a refresh would actually say anything new.
      stale: !unchanged,
      generatedAt: existing.created_at,
    });
  }

  try {
    const advice = await generateAdvice(text);

    // The model proposes; the scoring engine prices. Re-scoring the day with
    // each change applied means the number shown can never contradict the
    // score itself.
    const priced: AdvicePoint[] = advice.points.map((p) => ({
      ...p,
      points: projectedGain(
        { component: p.component ?? "none", amount: p.amount ?? 0 },
        todayTotals,
        0,
        targets,
      ),
    }));
    advice.points = priced;

    await supabase.from("daily_advice").upsert({
      user_id: profile.id,
      local_date: today,
      basis_hash: basisHash,
      headline: advice.headline,
      points: advice.points,
      created_at: new Date().toISOString(),
    });

    return NextResponse.json({
      ...advice,
      score: scoreDay(todayTotals, today).total,
      cached: false,
      stale: false,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    if (err instanceof GeminiError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("coach", err);
    return NextResponse.json({ error: "Could not generate advice." }, { status: 500 });
  }
}
