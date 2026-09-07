import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

/** True once both Supabase env vars are present. */
export function supabaseConfigured(): boolean {
  return missingSupabaseEnv().length === 0;
}

/**
 * Which Supabase vars are absent, by name.
 *
 * Each var is spelled out in full rather than looked up dynamically: Next
 * substitutes NEXT_PUBLIC_* literally at build time, so `process.env[name]`
 * would silently read nothing.
 */
export function missingSupabaseEnv(): string[] {
  const missing: string[] = [];
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) missing.push("NEXT_PUBLIC_SUPABASE_URL");
  if (!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) missing.push("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  return missing;
}

/** Running on a host rather than someone's laptop. */
export function isHosted(): boolean {
  return Boolean(process.env.VERCEL) || process.env.NODE_ENV === "production";
}

/** Server-side Supabase bound to the request's cookies. */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll(list) {
          try {
            list.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {
            // Called from a Server Component, where cookies are read-only.
            // Middleware already refreshes the session, so this is safe to swallow.
          }
        },
      },
    },
  );
}

/** The signed-in user, or null. */
export async function getUser() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  return data.user ?? null;
}
