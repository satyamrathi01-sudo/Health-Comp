import { NextResponse } from "next/server";
import { createClient, supabaseConfigured } from "@/lib/supabase/server";
import { cacheKey, GeminiError, parseWorkout, type WorkoutParse } from "@/lib/gemini";
import { priceExercises } from "@/lib/calc";

export const runtime = "nodejs";

const DEFAULT_BODY_WEIGHT = 70;

export async function POST(request: Request) {
  if (!supabaseConfigured()) {
    return NextResponse.json(
      { error: "Supabase isn't configured yet. Fill in .env.local — see the README." },
      { status: 503 },
    );
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  let text = "";
  try {
    ({ text } = await request.json());
  } catch {
    return NextResponse.json({ error: "Bad request body." }, { status: 400 });
  }

  text = String(text ?? "").trim();
  if (text.length < 2) {
    return NextResponse.json({ error: "Describe the workout first." }, { status: 400 });
  }
  if (text.length > 1200) {
    return NextResponse.json({ error: "Keep it under 1200 characters." }, { status: 400 });
  }

  const { data: profile } = await supabase
    .from("profiles").select("weight_kg").eq("id", user.id).single();
  const bodyWeight = Number(profile?.weight_kg) || DEFAULT_BODY_WEIGHT;

  // Cache holds MET + minutes only — burn is priced per request against the
  // user's current bodyweight, so the cache stays valid as their weight moves.
  const hash = cacheKey("workout", text);
  const { data: cached } = await supabase
    .from("ai_cache").select("response").eq("hash", hash).maybeSingle();

  const respond = (parsed: WorkoutParse, wasCached: boolean) => {
    const exercises = priceExercises(
      parsed.exercises.map((e) => ({ ...e, kcal: 0 })),
      bodyWeight,
    );
    const minutes = Math.round(exercises.reduce((a, e) => a + e.minutes, 0) * 10) / 10;
    const kcal = Math.round(exercises.reduce((a, e) => a + e.kcal, 0));
    return NextResponse.json({
      exercises,
      confidence: parsed.confidence,
      assumptions: parsed.assumptions,
      minutes,
      kcal,
      body_weight_kg: bodyWeight,
      cached: wasCached,
    });
  };

  if (cached?.response) return respond(cached.response as WorkoutParse, true);

  try {
    const parsed = await parseWorkout(text);
    if (!parsed.exercises.length) {
      return NextResponse.json(
        { error: "I couldn't find a workout in that. Try naming the exercise and how long." },
        { status: 422 },
      );
    }

    await supabase.rpc("cache_ai", {
      p_hash: hash, p_kind: "workout", p_prompt: text, p_response: parsed,
    });

    return respond(parsed, false);
  } catch (err) {
    if (err instanceof GeminiError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("parse/workout", err);
    return NextResponse.json({ error: "Something broke while analysing that." }, { status: 500 });
  }
}
