import { createHash } from "crypto";
import { NextResponse } from "next/server";
import { createClient, supabaseConfigured } from "@/lib/supabase/server";
import { generateAdvice, GeminiError } from "@/lib/gemini";
import { applyGoalsToTargets, daysInMonthOf, deriveTargets, MICRO_REFS, microTarget } from "@/lib/calc";
import { projectedGain, scoreDay, type ScoreTargets } from "@/lib/scoring";
import { computeRecovery } from "@/lib/recovery";
import type { AdvicePoint, DailyTotals, MonthlyGoal, Profile } from "@/lib/types";

export const runtime = "nodejs";

/** Build the plain-text briefing the coach reasons over. */
function briefing(
  profile: Profile,
  today: DailyTotals | null,
  week: DailyTotals[],
  goals: MonthlyGoal[],
  targets: ScoreTargets | null,
): string {
  const n = (v: number | null | undefined) => Math.round(Number(v ?? 0));

  const lines: string[] = [
    `Person: ${profile.sex ?? "unspecified"}, goal ${profile.goal}, ${profile.weight_kg} kg.`,
    targets
      ? `Daily targets they are scored against: ${targets.kcalTarget} kcal intake, ` +
        `${targets.proteinTarget} g protein, ${targets.burnTarget} kcal burned.`
      : "Targets: not enough profile data.",
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
    "",
    "MICRONUTRIENTS TODAY (value vs target)",
  ];

  for (const ref of MICRO_REFS) {
    const value = Number(today?.[ref.key] ?? 0);
    const target = microTarget(ref, profile.sex);
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

  const active = goals.filter((g) => !g.done);
  if (active.length) {
    lines.push("", "THEIR GOALS THIS MONTH — these take priority over anything else:");
    for (const g of active) {
      lines.push(
        g.target_value !== null
          ? `  - ${g.title} (target ${g.target_value}, tracked as ${g.metric})`
          : `  - ${g.title}`,
      );
    }
  } else {
    lines.push("", "They have set no goals this month.");
  }

  return lines.join("\n");
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
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { data: profileRow } = await supabase
    .from("profiles").select("*").eq("id", user.id).single();
  if (!profileRow) return NextResponse.json({ error: "No profile." }, { status: 400 });
  const profile = profileRow as Profile;

  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: profile.timezone, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());

  const from = new Date(today + "T00:00:00Z");
  from.setUTCDate(from.getUTCDate() - 6);
  const fromDate = from.toISOString().slice(0, 10);

  const { data: rows } = await supabase
    .from("daily_totals").select("*")
    .eq("user_id", user.id).gte("local_date", fromDate).lte("local_date", today);

  const week = (rows ?? []) as DailyTotals[];
  const todayTotals = week.find((d) => d.local_date === today) ?? null;

  const monthStart = today.slice(0, 8) + "01";
  const { data: goalRows } = await supabase
    .from("monthly_goals").select("*")
    .eq("user_id", user.id).eq("month", monthStart);
  const goals = (goalRows ?? []) as MonthlyGoal[];

  // Goals override the derived targets where they overlap, so the coach and
  // the score are working from the same numbers.
  const derived = deriveTargets(profile);
  const adjusted = derived
    ? applyGoalsToTargets(derived, goals, profile.weight_kg, daysInMonthOf(today))
    : null;
  const targets: ScoreTargets | null = adjusted
    ? {
        burnTarget: adjusted.burnTarget,
        proteinTarget: adjusted.proteinTarget,
        kcalTarget: adjusted.kcalTarget,
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
  const yesterdayDate = (() => {
    const d = new Date(today + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
  })();
  const yesterday = week.find((d) => d.local_date === yesterdayDate) ?? null;

  let consecutiveTrainingDays = 0;
  for (let i = 1; i < 8; i++) {
    const d = new Date(today + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() - i);
    const row = week.find((w) => w.local_date === d.toISOString().slice(0, 10));
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

  const text =
    briefing(profile, todayTotals, week, goals, targets) +
    (recovery.score === null
      ? "\n\nRECOVERY: unknown, no sleep logged."
      : `\n\nRECOVERY: ${recovery.score}/100 (${recovery.band}) — ${recovery.headline}.\n` +
        recovery.drivers.map((d) => `  ${d.label}: ${Math.round(d.value * 100)}% (${d.detail})`).join("\n") +
        "\nIf recovery is low, say so and steer them toward rest and sleep rather than " +
        "more training, however tempting the score is.");

  // Regenerate only when the day's numbers actually moved. Without this the
  // coach would burn a Gemini call on every dashboard render.
  const basisHash = createHash("sha256").update(text).digest("hex").slice(0, 32);

  const { data: existing } = await supabase
    .from("daily_advice").select("*")
    .eq("user_id", user.id).eq("local_date", today).maybeSingle();

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
      user_id: user.id,
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
