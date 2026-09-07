import { NextResponse } from "next/server";
import { createClient, supabaseConfigured } from "@/lib/supabase/server";
import { cacheKey, GeminiError, parseFood, type FoodParse } from "@/lib/gemini";
import { EMPTY_MICROS, type FoodItem, type Micros } from "@/lib/types";

export const runtime = "nodejs";

function totalsOf(items: FoodItem[]) {
  const sum = (k: keyof FoodItem) =>
    Math.round(items.reduce((a, i) => a + Number(i[k] ?? 0), 0) * 10) / 10;
  return {
    kcal: sum("kcal"),
    protein_g: sum("protein_g"),
    carbs_g: sum("carbs_g"),
    fat_g: sum("fat_g"),
    fiber_g: sum("fiber_g"),
  };
}

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
    return NextResponse.json({ error: "Tell me what you ate first." }, { status: 400 });
  }
  if (text.length > 1200) {
    return NextResponse.json({ error: "That's a lot of text — keep it under 1200 characters." }, { status: 400 });
  }

  const hash = cacheKey("food", text);

  // Cache hit: identical meal text costs no Gemini quota at all. People eat
  // the same breakfast for weeks, so this pays for itself fast.
  const { data: cached } = await supabase
    .from("ai_cache").select("response").eq("hash", hash).maybeSingle();

  if (cached?.response) {
    const parsed = cached.response as FoodParse;
    return NextResponse.json({
      ...parsed,
      // Entries cached before micros existed have none; zero-fill so the
      // client always receives the full shape.
      micros: { ...EMPTY_MICROS, ...(parsed.micros ?? {}) } as Micros,
      totals: totalsOf(parsed.items),
      cached: true,
    });
  }

  try {
    const parsed = await parseFood(text);
    if (!parsed.items.length) {
      return NextResponse.json(
        { error: "I couldn't find any food in that. Try naming the dishes and rough quantities." },
        { status: 422 },
      );
    }

    await supabase.rpc("cache_ai", {
      p_hash: hash, p_kind: "food", p_prompt: text, p_response: parsed,
    });

    return NextResponse.json({ ...parsed, totals: totalsOf(parsed.items), cached: false });
  } catch (err) {
    if (err instanceof GeminiError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("parse/food", err);
    return NextResponse.json({ error: "Something broke while analysing that." }, { status: 500 });
  }
}
