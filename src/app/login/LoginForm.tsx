"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { supabaseAnonKey, supabaseUrl } from "@/lib/env";
import { JUST_SIGNED_IN_KEY } from "@/components/InstallPrompt";

type Mode = "in" | "up";

export default function LoginForm() {
  const router = useRouter();
  const next = useSearchParams().get("next") || "/";

  // NEXT_PUBLIC_* values are compiled into this bundle at build time. If the
  // host only exposes them at runtime — Vercel does exactly that for variables
  // marked Secret/Sensitive — the server looks perfectly configured while the
  // browser gets undefined, and every request dies inside the Supabase client.
  //
  // Checked after mount, not during render: server-side this component still
  // sees a real runtime value, so testing it inline would render the form on
  // the server and the warning on the client — a hydration mismatch.
  const [clientEnvMissing, setClientEnvMissing] = useState(false);
  useEffect(() => {
    setClientEnvMissing(!supabaseUrl() || !supabaseAnonKey());
  }, []);

  const [mode, setMode] = useState<Mode>("in");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);

    try {
      const supabase = createClient();

      if (mode === "up") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { display_name: name.trim() || email.split("@")[0] } },
        });
        if (error) throw error;

        // With "Confirm email" ON in Supabase, signUp returns no session.
        const { data: session } = await supabase.auth.getSession();
        if (!session.session) {
          setError(
            "Account created, but Supabase is asking for email confirmation. " +
              "Turn off Authentication → Sign In / Providers → Confirm email, then sign in.",
          );
          setMode("in");
          return;
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }

      // Ask the app to offer "add to home screen" once, on the next screen.
      try {
        window.localStorage.setItem(JUST_SIGNED_IN_KEY, "1");
      } catch {
        // Storage blocked (private browsing): the offer is skipped, nothing breaks.
      }

      router.replace(next);
      router.refresh();
    } catch (err) {
      const message = (err as Error).message;
      setError(
        message.includes("supabaseUrl") || message.includes("supabaseKey")
          ? "This page was built without the Supabase settings. On Vercel, re-add " +
            "NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY as Config " +
            "rather than Secret, then redeploy."
          : message,
      );
    } finally {
      setBusy(false);
    }
  }

  if (clientEnvMissing) {
    return (
      <div className="surface space-y-3 p-5 text-sm leading-relaxed">
        <p className="font-semibold text-gold">The browser didn&apos;t get the config</p>
        <p className="text-mist-500">
          The server has your Supabase settings, but they were never compiled into the
          page you&apos;re looking at — so signing in can&apos;t work.
        </p>
        <p className="text-mist-500">
          On Vercel this means{" "}
          <code className="text-mist-400">NEXT_PUBLIC_SUPABASE_URL</code> and{" "}
          <code className="text-mist-400">NEXT_PUBLIC_SUPABASE_ANON_KEY</code> are stored as{" "}
          <strong className="text-mist-400">Secret</strong>. Secret values are only decrypted
          at runtime, so the build cannot read them. Re-add both as{" "}
          <strong className="text-mist-400">Config</strong> and redeploy. Both are public by
          design — the anon key ships in this bundle either way, and RLS is what protects
          your data.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="surface space-y-4 p-5">
      <div className="mb-1 grid grid-cols-2 gap-1 rounded-xl bg-ink-900 p-1">
        {(["in", "up"] as Mode[]).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => { setMode(m); setError(null); }}
            className={`rounded-lg py-2 text-sm font-semibold transition-colors ${
              mode === m ? "bg-ink-800 text-white" : "text-mist-600"
            }`}
          >
            {m === "in" ? "Sign in" : "Create account"}
          </button>
        ))}
      </div>

      {mode === "up" && (
        <label className="block">
          <span className="eyebrow mb-2 block">Name</span>
          <input
            className="field" value={name} onChange={(e) => setName(e.target.value)}
            placeholder="Satyam" autoComplete="name"
          />
        </label>
      )}

      <label className="block">
        <span className="eyebrow mb-2 block">Email</span>
        <input
          className="field" type="email" required value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com" autoComplete="email" inputMode="email"
        />
      </label>

      <label className="block">
        <span className="eyebrow mb-2 block">Password</span>
        <input
          className="field" type="password" required minLength={6} value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="At least 6 characters"
          autoComplete={mode === "up" ? "new-password" : "current-password"}
        />
      </label>

      {error && (
        <p className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-xs leading-relaxed text-danger">
          {error}
        </p>
      )}

      <button className="btn btn-primary w-full" disabled={busy}>
        {busy ? "One sec…" : mode === "in" ? "Sign in" : "Create account"}
      </button>
    </form>
  );
}
