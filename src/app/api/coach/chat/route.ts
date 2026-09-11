import { NextResponse } from "next/server";
import { createClient, supabaseConfigured } from "@/lib/supabase/server";
import { answerCoachQuestion, GeminiError } from "@/lib/gemini";
import { loadCoachContext } from "@/lib/coachContext";
import { cleanHistory, cleanQuestion, CHAT_LIMITS } from "@/lib/chat";
import { getMyProfile } from "@/lib/data";

export const runtime = "nodejs";

/**
 * The chat box under "Tips for tomorrow": one question in, one answer out.
 *
 * Answered from the same briefing the tips are written from, plus how every
 * line of today's score was earned and what was eaten food by food — the two
 * things a "what should I do / eat" question most needs.
 *
 * Nothing is cached or stored. Questions are too varied for a cache to hit,
 * and each one is a Gemini request against the free daily quota, which the
 * page says plainly.
 */
export async function POST(request: Request) {
  let body: { question?: unknown; history?: unknown } = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Bad request body." }, { status: 400 });
  }

  const question = cleanQuestion(body.question);
  if (!question) {
    return NextResponse.json(
      { error: `Ask a question of up to ${CHAT_LIMITS.question} characters.` },
      { status: 400 },
    );
  }

  if (!supabaseConfigured()) {
    return NextResponse.json({ error: "Supabase isn't configured." }, { status: 503 });
  }

  const profile = await getMyProfile();
  if (!profile) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const supabase = await createClient();
  const ctx = await loadCoachContext(supabase, profile, { foods: true });

  const briefing = [
    ctx.text,
    "",
    "TODAY'S SCORE, LINE BY LINE (streak bonus not included)",
    ctx.scoreLines || "  Not available: their profile is missing the details targets need.",
    "",
    "WHAT THEY ATE TODAY",
    ctx.foods || "  Nothing logged yet.",
  ].join("\n");

  try {
    const answer = await answerCoachQuestion(briefing, cleanHistory(body.history), question);
    return NextResponse.json({ answer });
  } catch (err) {
    if (err instanceof GeminiError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("coach chat", err);
    return NextResponse.json({ error: "The coach couldn't answer that." }, { status: 500 });
  }
}
