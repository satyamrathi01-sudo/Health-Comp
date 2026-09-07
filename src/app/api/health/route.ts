import { NextResponse } from "next/server";
import { configuredModel, geminiConfigured } from "@/lib/gemini";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Quick "is this thing wired up" check — visit /api/health. */
export async function GET() {
  return NextResponse.json({
    ok: true,
    supabaseUrl: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
    supabaseAnonKey: Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
    gemini: geminiConfigured(),
    geminiModel: configuredModel(),
  });
}
