import { createHash } from "crypto";
import { NextResponse } from "next/server";
import { createClient, supabaseConfigured } from "@/lib/supabase/server";
import { generateAdvice, GeminiError } from "@/lib/gemini";
import { localDate } from "@/lib/calc";
import { loadCoachContext } from "@/lib/coachContext";
import { projectedGain, scoreDay } from "@/lib/scoring";
import { getMyProfile } from "@/lib/data";
import type { AdvicePoint, Profile } from "@/lib/types";

export const runtime = "nodejs";

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

  // Independent reads, together rather than one after another — on a function
  // talking to Supabase across a region, sequencing these was most of the wait.
  const [ctx, { data: existing }] = await Promise.all([
    loadCoachContext(supabase, profile),
    supabase.from("daily_advice").select("*")
      .eq("user_id", profile.id).eq("local_date", today).maybeSingle(),
  ]);

  if (!ctx.hasData) {
    return NextResponse.json(
      { error: "Log something first — there's nothing to advise on yet." },
      { status: 422 },
    );
  }

  // Regenerate only when the day's numbers actually moved. Without this the
  // coach would burn a Gemini call on every dashboard render.
  const basisHash = createHash("sha256").update(ctx.text).digest("hex").slice(0, 32);

  const unchanged = existing && existing.basis_hash === basisHash;
  if (existing && (unchanged || !force)) {
    return NextResponse.json({
      headline: existing.headline,
      points: existing.points,
      score: scoreDay(ctx.todayTotals, today).total,
      cached: true,
      // Tells the UI whether a refresh would actually say anything new.
      stale: !unchanged,
      generatedAt: existing.created_at,
    });
  }

  try {
    const advice = await generateAdvice(ctx.text);

    // The model proposes; the scoring engine prices. Re-scoring the day with
    // each change applied means the number shown can never contradict the
    // score itself.
    const priced: AdvicePoint[] = advice.points.map((p) => ({
      ...p,
      points: projectedGain(
        { component: p.component ?? "none", amount: p.amount ?? 0 },
        ctx.todayTotals,
        0,
        ctx.targets,
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
      score: scoreDay(ctx.todayTotals, today).total,
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
