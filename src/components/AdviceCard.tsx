"use client";

import { useEffect, useState } from "react";
import type { AdvicePoint } from "@/lib/types";

const ICON: Record<AdvicePoint["kind"], string> = {
  add: "+",
  reduce: "−",
  keep: "✓",
  train: "▲",
  rest: "◦",
};

const TONE: Record<AdvicePoint["kind"], string> = {
  add: "var(--color-lime-glow)",
  reduce: "var(--color-flame)",
  keep: "var(--color-mist-400)",
  train: "var(--color-cool)",
  rest: "var(--color-mist-400)",
};

interface Advice {
  headline: string | null;
  points: AdvicePoint[];
  /** True when newer logs exist than the note was written from. */
  stale?: boolean;
  generatedAt?: string;
}

export default function AdviceCard({ hasData }: { hasData: boolean }) {
  const [advice, setAdvice] = useState<Advice | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(hasData);
  const [refreshing, setRefreshing] = useState(false);

  async function load(force: boolean, signal?: () => boolean) {
    try {
      const res = await fetch("/api/coach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force }),
      });
      const data = await res.json();
      if (signal?.()) return;
      if (!res.ok) setError(data.error ?? "Couldn't get suggestions.");
      else {
        setError(null);
        setAdvice({
          headline: data.headline,
          points: data.points ?? [],
          stale: data.stale,
          generatedAt: data.generatedAt,
        });
      }
    } catch {
      if (!signal?.()) setError("Couldn't reach the coach.");
    }
  }

  useEffect(() => {
    if (!hasData) return;
    let cancelled = false;

    // Unforced: reuses today's existing note if there is one, so this costs a
    // Gemini call at most once a day.
    load(false, () => cancelled).finally(() => {
      if (!cancelled) setLoading(false);
    });

    return () => { cancelled = true; };
  }, [hasData]);

  async function refresh() {
    setRefreshing(true);
    await load(true);
    setRefreshing(false);
  }

  if (!hasData) {
    return (
      <div className="surface px-5 py-6 text-center">
        <p className="text-xs leading-relaxed text-mist-600">
          Log a meal or a workout to get tips for tomorrow.
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="surface space-y-3 px-5 py-5">
        <div className="thinking h-3 w-2/5 rounded bg-ink-800" />
        <div className="thinking h-2.5 w-full rounded bg-ink-800" />
        <div className="thinking h-2.5 w-4/5 rounded bg-ink-800" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="surface px-5 py-4">
        <p className="text-xs leading-relaxed text-mist-600">{error}</p>
      </div>
    );
  }

  if (!advice?.points.length) return null;

  return (
    <div className="surface overflow-hidden">
      {advice.headline && (
        <div className="hair-b px-5 py-4">
          <p className="text-base font-semibold leading-snug text-white">{advice.headline}</p>
        </div>
      )}
      <ul>
        {advice.points.map((p, i) => (
          <li key={i} className={`flex gap-3 px-5 py-3.5 ${i > 0 ? "hair" : ""}`}>
            <span
              className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[0.7rem] font-bold leading-none"
              style={{ color: TONE[p.kind], border: `1px solid ${TONE[p.kind]}40` }}
              aria-hidden="true"
            >
              {ICON[p.kind]}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[0.82rem] leading-relaxed text-mist-200">{p.text}</span>
              {p.points !== undefined && (
                <span className="mt-1 block text-[0.65rem] text-mist-600">
                  {p.points > 0 ? (
                    <>
                      <span className="font-semibold text-lime-glow">
                        +{p.points} pts
                      </span>{" "}
                      on today&apos;s score
                    </>
                  ) : p.component === "sleep" ? (
                    "Not scored, but it helps you recover"
                  ) : p.component === "water" ? (
                    "Not scored, but it helps your workouts"
                  ) : p.component === "micros" ? (
                    "Good for long-term health"
                  ) : (
                    "You've already maxed this today"
                  )}
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>
      <div className="hair flex items-center justify-between gap-3 px-5 py-2.5">
        <p className="text-[0.6rem] text-mist-600">
          {advice.stale ? "You've logged more since these tips" : ""}
        </p>
        <button
          onClick={refresh}
          disabled={refreshing}
          className="shrink-0 text-[0.65rem] font-semibold text-lime-glow disabled:opacity-50"
        >
          {refreshing ? "…" : "Refresh"}
        </button>
      </div>
    </div>
  );
}
