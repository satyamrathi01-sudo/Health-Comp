"use client";

import { useState } from "react";
import type { Challenge } from "@/lib/types";

export default function InviteCard({
  challenge, rivalName, hasRival,
}: {
  challenge: Challenge | null;
  rivalName: string | null;
  hasRival: boolean;
}) {
  const [copied, setCopied] = useState(false);

  if (!challenge) {
    return (
      <div className="surface p-5 text-sm text-mist-600">
        You&apos;re not in a challenge yet.
      </div>
    );
  }

  const daysLeft = Math.max(
    0,
    Math.ceil((new Date(challenge.end_date + "T00:00:00").getTime() - Date.now()) / 86_400_000),
  );

  async function copy() {
    const message =
      `Join me on FitClash 💪\n\n` +
      `Challenge: ${challenge!.name}\n` +
      `Code: ${challenge!.invite_code}\n\n` +
      `${window.location.origin}`;
    try {
      if (navigator.share) await navigator.share({ text: message });
      else await navigator.clipboard.writeText(message);
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    } catch {
      /* user dismissed the share sheet */
    }
  }

  return (
    <div className="surface p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-semibold">{challenge.name}</p>
          <p className="tnum mt-1 text-xs text-mist-600">
            {daysLeft} day{daysLeft === 1 ? "" : "s"} left ·{" "}
            {hasRival ? `you vs ${rivalName}` : "waiting for your rival"}
          </p>
        </div>
      </div>

      <div className="mt-5 rounded-xl border border-dashed border-hair px-4 py-4 text-center">
        <div className="eyebrow">
          Invite code
        </div>
        <div className="hero-num tnum mt-2 text-2xl tracking-[0.3em]" style={{ color: "var(--color-lime-glow)" }}>
          {challenge.invite_code}
        </div>
      </div>

      <button className="btn btn-ghost mt-4 w-full" onClick={copy}>
        {copied ? "Copied ✓" : "Share with your friend"}
      </button>
    </div>
  );
}
