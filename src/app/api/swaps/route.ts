import { NextResponse } from "next/server";
import { createClient, supabaseConfigured } from "@/lib/supabase/server";
import { cacheKey, GeminiError, generateSwaps, type SwapIdea } from "@/lib/gemini";
import { deriveTargets, localDate } from "@/lib/calc";
import { todaysBreaches } from "@/lib/limits";
import { explainLimits, swapBrief } from "@/lib/overage";
import { getMyProfile } from "@/lib/data";
import type { DailyTotals, FoodLog } from "@/lib/types";

export const runtime = "nodejs";

/**
 * "Instead of this, have that" for whatever pushed a limit over today.
 *
 * Takes no input. The foods are recomputed from the database with the same
 * code the /limits page uses, so the prompt — and the cache key — are always
 * the canonical list, and nobody can post arbitrary text through here to
 * spend the Gemini quota.
 *
 * Cached in ai_cache under kind "swap", so the same plate on another day, or
 * on someone else's plate, costs nothing. What is cached is food only: see
 * swapBrief() in overage.ts for why no limit or target is ever in it.
 */
export async function POST() {
  if (!supabaseConfigured()) {
    return NextResponse.json({ error: "Supabase isn't configured." }, { status: 503 });
  }

  const profile = await getMyProfile();
  if (!profile) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const supabase = await createClient();
  const today = localDate(profile.timezone);

  // Two independent reads, together rather than one after the other.
  const [{ data: totalsRow }, { data: foodRows }] = await Promise.all([
    supabase.from("daily_totals").select("*")
      .eq("user_id", profile.id).eq("local_date", today).maybeSingle(),
    supabase.from("food_logs").select("*")
      .eq("user_id", profile.id).eq("local_date", today).order("logged_at"),
  ]);

  const limits = todaysBreaches(
    (totalsRow as DailyTotals | null) ?? null,
    profile,
    deriveTargets(profile, today),
  );
  const brief = swapBrief(explainLimits(limits, (foodRows ?? []) as FoodLog[]));
  if (!brief) return NextResponse.json({ swaps: [], cached: false });

  const hash = cacheKey("swap", brief);
  const { data: cached } = await supabase
    .from("ai_cache").select("response").eq("hash", hash).maybeSingle();

  if (cached?.response) {
    const { swaps } = cached.response as { swaps?: SwapIdea[] };
    return NextResponse.json({ swaps: swaps ?? [], cached: true });
  }

  try {
    const swaps = await generateSwaps(brief);

    // Before schema v12 the cache refuses kind "swap". The answer is still
    // good; it just isn't remembered, so say so in the log and move on.
    const { error } = await supabase.rpc("cache_ai", {
      p_hash: hash, p_kind: "swap", p_prompt: brief, p_response: { swaps },
    });
    if (error) console.warn("swaps: not cached —", error.message);

    return NextResponse.json({ swaps, cached: false });
  } catch (err) {
    if (err instanceof GeminiError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("swaps", err);
    return NextResponse.json({ error: "Couldn't come up with swap ideas." }, { status: 500 });
  }
}
