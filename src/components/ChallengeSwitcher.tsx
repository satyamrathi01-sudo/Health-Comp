"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { ChallengeSummary } from "@/lib/types";

/**
 * Picks which challenge the screens are reporting on.
 *
 * The choice is stored on the profile rather than in a URL or in component
 * state, so it survives navigation, reloads and a switch to another device —
 * and so the server can resolve it inside get_arena without the client
 * having to thread an id through every page.
 */
export default function ChallengeSwitcher({
  challenges,
  activeId,
}: {
  challenges: ChallengeSummary[];
  activeId: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  // Nothing to switch between.
  if (challenges.length <= 1) return null;

  const active = challenges.find((c) => c.id === activeId) ?? challenges[0];

  async function pick(id: string) {
    if (id === active.id) { setOpen(false); return; }
    setBusy(id);
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { error } = await supabase
        .from("profiles").update({ active_challenge_id: id }).eq("id", user.id);
      if (error) console.warn("could not set active challenge —", error.message);
    }
    setBusy(null);
    setOpen(false);
    router.refresh();
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2.5 rounded-xl border border-hair bg-ink-900 px-3.5 py-2.5 text-left"
      >
        <span className="text-base" aria-hidden="true">{active.owner_emoji}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-white">{active.name}</span>
          <span className="eyebrow mt-0.5 block">
            {active.is_mine ? "yours" : `${active.owner_name}'s`} · {active.member_count} in
          </span>
        </span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
          className="shrink-0 text-mist-600 transition-transform"
          style={{ transform: open ? "rotate(180deg)" : "none" }} aria-hidden="true">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div className="rise absolute inset-x-0 top-full z-30 mt-1.5 overflow-hidden rounded-xl border border-hair bg-ink-850 shadow-2xl">
          {challenges.map((c, i) => (
            <button
              key={c.id}
              onClick={() => pick(c.id)}
              disabled={busy !== null}
              className={`flex w-full items-center gap-2.5 px-3.5 py-3 text-left disabled:opacity-50 ${i > 0 ? "hair" : ""}`}
            >
              <span className="text-base" aria-hidden="true">{c.owner_emoji}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-mist-200">{c.name}</span>
                <span className="eyebrow mt-0.5 block">
                  {c.is_mine ? "yours" : `${c.owner_name}'s`} · {c.member_count} in
                </span>
              </span>
              {c.id === active.id && (
                <span className="shrink-0 text-xs font-bold text-lime-glow">✓</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
