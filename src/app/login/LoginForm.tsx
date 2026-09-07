"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Mode = "in" | "up";

export default function LoginForm() {
  const router = useRouter();
  const next = useSearchParams().get("next") || "/";

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
    const supabase = createClient();

    try {
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

      router.replace(next);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="card-raised space-y-3.5 p-5">
      <div className="mb-1 grid grid-cols-2 gap-1 rounded-xl bg-ink-850 p-1">
        {(["in", "up"] as Mode[]).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => { setMode(m); setError(null); }}
            className={`rounded-lg py-2 text-sm font-semibold transition-colors ${
              mode === m ? "bg-ink-700 text-mist-100" : "text-mist-500"
            }`}
          >
            {m === "in" ? "Sign in" : "Create account"}
          </button>
        ))}
      </div>

      {mode === "up" && (
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-mist-500">Name</span>
          <input
            className="field" value={name} onChange={(e) => setName(e.target.value)}
            placeholder="Satyam" autoComplete="name"
          />
        </label>
      )}

      <label className="block">
        <span className="mb-1.5 block text-xs font-semibold text-mist-500">Email</span>
        <input
          className="field" type="email" required value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com" autoComplete="email" inputMode="email"
        />
      </label>

      <label className="block">
        <span className="mb-1.5 block text-xs font-semibold text-mist-500">Password</span>
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
