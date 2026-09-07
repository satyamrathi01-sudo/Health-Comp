import { NextResponse } from "next/server";
import { configuredModel, geminiConfigured } from "@/lib/gemini";
import { supabaseAnonKey, supabaseUrl, supabaseUrlProblem } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * "Is this thing wired up" — visit /api/health.
 *
 * Deliberately reports the Supabase host and what is wrong with the URL: both
 * are public values (the anon key ships in the browser bundle), and without
 * them a misconfigured deploy gives you nothing to go on.
 */
export async function GET() {
  const url = supabaseUrl();
  const problem = supabaseUrlProblem();

  let host: string | null = null;
  try {
    host = url ? new URL(url).host : null;
  } catch {
    host = null;
  }

  const key = supabaseAnonKey();

  return NextResponse.json({
    ok: !problem && Boolean(key) && geminiConfigured(),
    supabaseUrl: Boolean(url),
    supabaseAnonKey: Boolean(key),
    gemini: geminiConfigured(),
    geminiModel: configuredModel(),
    detail: {
      supabaseHost: host,
      supabaseUrlProblem: problem,
      // A JWT anon key is ~200+ chars and has two dots. Anything far off that
      // usually means a truncated paste or the wrong value entirely.
      anonKeyLength: key.length,
      anonKeyLooksLikeJwt: key.split(".").length === 3,
    },
  });
}
