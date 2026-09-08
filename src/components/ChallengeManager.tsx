"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { localDate } from "@/lib/calc";
import type { ChallengeSummary } from "@/lib/types";

function randomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I/O/0/1
  return Array.from({ length: 6 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
}

type Mode = null | "create" | "join";

export default function ChallengeManager({
  userId,
  timezone,
  challenges,
  activeId,
}: {
  userId: string;
  timezone: string;
  challenges: ChallengeSummary[];
  activeId: string | null;
}) {
  const router = useRouter();
  const supabase = createClient();

  const [mode, setMode] = useState<Mode>(null);
  const [name, setName] = useState("");
  const [weeks, setWeeks] = useState("8");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  /**
   * Records which challenge to show. Tolerates the column not existing yet:
   * on a database still on v6 the update fails, and creating or joining a
   * challenge should not fail with it.
   */
  async function makeActive(id: string) {
    const { error } = await supabase
      .from("profiles").update({ active_challenge_id: id }).eq("id", userId);
    if (error) console.warn("could not set active challenge —", error.message);
  }

  async function create() {
    setBusy(true); setError(null);
    try {
      const start = localDate(timezone);
      const end = new Date();
      end.setDate(end.getDate() + Math.max(1, Number(weeks) || 8) * 7);

      const { data, error } = await supabase.from("challenges").insert({
        name: name.trim() || "New Challenge",
        invite_code: randomCode(),
        start_date: start,
        end_date: localDate(timezone, end),
        created_by: userId,
      }).select().single();
      if (error) throw error;

      const { error: mErr } = await supabase.from("challenge_members")
        .insert({ challenge_id: data.id, user_id: userId });
      if (mErr) throw mErr;

      // Land the user in the thing they just made.
      await makeActive(data.id);
      setName(""); setMode(null);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function join() {
    setBusy(true); setError(null);
    try {
      const { data, error } = await supabase.rpc("join_challenge", { code: code.trim() });
      if (error) throw error;
      if (data) await makeActive(data as string);
      setCode(""); setMode(null);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function share(c: ChallengeSummary) {
    const message = `Join me on FitClash 💪\n\n${c.name}\nCode: ${c.invite_code}\n\n${window.location.origin}`;
    try {
      if (navigator.share) await navigator.share({ text: message });
      else await navigator.clipboard.writeText(message);
      setCopied(c.id);
      setTimeout(() => setCopied(null), 2200);
    } catch { /* dismissed */ }
  }

  return (
    <div className="space-y-3">
      <div className="surface px-5">
        {challenges.map((c, i) => (
          <div key={c.id} className={`py-3.5 ${i > 0 ? "hair" : ""}`}>
            <div className="flex items-center gap-3">
              <span className="text-lg" aria-hidden="true">{c.owner_emoji}</span>
              <button onClick={() => { makeActive(c.id).then(() => router.refresh()); }}
                className="min-w-0 flex-1 text-left">
                <span className="block truncate text-sm font-semibold text-white">{c.name}</span>
                <span className="eyebrow mt-0.5 block">
                  {c.is_mine ? "yours" : `${c.owner_name}'s`} · {c.member_count} in
                  {c.id === activeId ? " · showing" : ""}
                </span>
              </button>
              <button onClick={() => share(c)}
                className="shrink-0 text-[0.65rem] font-semibold text-lime-glow">
                {copied === c.id ? "Copied" : c.invite_code}
              </button>
            </div>
          </div>
        ))}
        {challenges.length === 0 && (
          <p className="py-4 text-xs text-mist-600">You&apos;re not in any challenge yet.</p>
        )}
      </div>

      {mode === null && (
        <div className="flex gap-2">
          <button className="btn btn-ghost flex-1" onClick={() => { setMode("create"); setError(null); }}>
            Start a challenge
          </button>
          <button className="btn btn-ghost flex-1" onClick={() => { setMode("join"); setError(null); }}>
            Join with code
          </button>
        </div>
      )}

      {mode === "create" && (
        <div className="surface space-y-3.5 p-5">
          <label className="block">
            <span className="eyebrow mb-2 block">Challenge name</span>
            <input className="field" value={name} onChange={(e) => setName(e.target.value)}
              placeholder="The October Cut" autoFocus />
          </label>
          <label className="block">
            <span className="eyebrow mb-2 block">Length (weeks)</span>
            <input className="field tnum" type="number" min={1} max={26} value={weeks}
              onChange={(e) => setWeeks(e.target.value)} />
          </label>
          {error && <p className="text-xs text-danger">{error}</p>}
          <div className="flex gap-2">
            <button className="btn btn-ghost flex-1" onClick={() => setMode(null)} disabled={busy}>Cancel</button>
            <button className="btn btn-primary flex-[2]" onClick={create} disabled={busy}>
              {busy ? "Creating…" : "Create"}
            </button>
          </div>
        </div>
      )}

      {mode === "join" && (
        <div className="surface space-y-3.5 p-5">
          <label className="block">
            <span className="eyebrow mb-2 block">Invite code</span>
            <input className="field tnum text-center text-xl font-bold tracking-[0.3em]"
              value={code} onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="ABC123" maxLength={6} autoCapitalize="characters" autoFocus />
          </label>
          {error && <p className="text-xs text-danger">{error}</p>}
          <div className="flex gap-2">
            <button className="btn btn-ghost flex-1" onClick={() => setMode(null)} disabled={busy}>Cancel</button>
            <button className="btn btn-primary flex-[2]" onClick={join} disabled={busy || code.trim().length < 4}>
              {busy ? "Joining…" : "Join"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
