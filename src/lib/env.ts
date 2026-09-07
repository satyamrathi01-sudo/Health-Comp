/**
 * Read a public env var, tolerating values pasted with surrounding quotes or
 * stray whitespace — a very easy mistake to make in a hosting dashboard, and
 * one that otherwise surfaces as an opaque 500 from inside the Supabase client
 * rather than as anything resembling a configuration error.
 *
 * Call sites must write `process.env.NEXT_PUBLIC_X` out in full: Next
 * substitutes those tokens literally at build time, so handing `process.env`
 * around by reference would read nothing.
 */
export function cleanEnv(raw: string | undefined): string {
  if (!raw) return "";
  return raw.trim().replace(/^['"]|['"]$/g, "").trim();
}

export function supabaseUrl(): string {
  return cleanEnv(process.env.NEXT_PUBLIC_SUPABASE_URL);
}

export function supabaseAnonKey(): string {
  return cleanEnv(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

/** Describes what is wrong with the configured URL, or null when it is fine. */
export function supabaseUrlProblem(): string | null {
  const raw = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!raw) return "not set";
  const cleaned = cleanEnv(raw);
  if (!cleaned) return "set but empty";
  try {
    const parsed = new URL(cleaned);
    if (parsed.protocol !== "https:") return `uses ${parsed.protocol} — expected https:`;
    return null;
  } catch {
    return "not a valid URL — check for a stray quote, space or missing https://";
  }
}
