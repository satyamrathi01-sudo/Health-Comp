"use client";

import { useEffect, useState } from "react";

/** Mirrors SwapIdea in gemini.ts, which is server-only and cannot be imported here. */
interface Swap {
  limit: string;
  instead_of: string;
  have: string;
  saves: number;
  why: string;
}

type Result = { swaps: Swap[] } | { error: string };

/**
 * One request per set of foods, however many cards ask.
 *
 * Every over-limit card on /limits renders one of these. Without the shared
 * promise, a day over three limits would ask for the same answer three times.
 * Keyed on the foods behind the limits, so logging another meal asks again,
 * and a failure is forgotten so the next visit can retry.
 */
const requests = new Map<string, Promise<Result>>();

function load(basis: string): Promise<Result> {
  const existing = requests.get(basis);
  if (existing) return existing;

  const pending: Promise<Result> = fetch("/api/swaps", { method: "POST" })
    .then(async (res) => {
      const data = await res.json().catch(() => ({}));
      return res.ok
        ? { swaps: Array.isArray(data.swaps) ? data.swaps : [] }
        : { error: data.error ?? "Couldn't load swap ideas." };
    })
    .catch(() => ({ error: "Couldn't reach the server for swap ideas." }));

  requests.set(basis, pending);
  pending.then((r) => {
    if ("error" in r) requests.delete(basis);
  });
  return pending;
}

const fmt = (n: number) => Math.round(n).toLocaleString("en-GB");

/**
 * "Instead of this, have that" for one limit, loaded after the page so the
 * exact part of the card — the foods and the cut plan — never waits for it.
 */
export default function LimitSwaps({
  basis,
  limitKey,
  unit,
  overBy,
  total,
}: {
  /** The food list the ideas are about; see swapBrief() in overage.ts. */
  basis: string;
  limitKey: string;
  unit: string;
  /** How far over the limit. Stays on the page; never sent anywhere. */
  overBy: number;
  /** The day's whole amount, so no swap is credited with more than that. */
  total: number;
}) {
  const [result, setResult] = useState<Result | null>(null);

  useEffect(() => {
    let live = true;
    load(basis).then((r) => {
      if (live) setResult(r);
    });
    return () => {
      live = false;
    };
  }, [basis]);

  if (!result) {
    return (
      <div className="space-y-2.5 py-3" aria-label="Loading swap ideas">
        <div className="thinking h-3 w-4/5 rounded bg-ink-800" />
        <div className="thinking h-2.5 w-3/5 rounded bg-ink-800" />
      </div>
    );
  }

  if ("error" in result) {
    return <p className="py-2.5 text-[0.7rem] leading-relaxed text-mist-600">{result.error}</p>;
  }

  const mine = result.swaps.filter((s) => s.limit === limitKey);
  if (!mine.length) {
    return <p className="py-2.5 text-[0.7rem] text-mist-600">No swap ideas for this one.</p>;
  }

  return (
    <ul>
      {mine.map((s, i) => {
        const saves = Math.max(0, Math.min(Number(s.saves) || 0, total));
        const share = overBy > 0 ? Math.min(100, Math.round((saves / overBy) * 100)) : 0;
        return (
          <li key={`${s.instead_of}-${i}`} className={i > 0 ? "hair py-3" : "py-3"}>
            <p className="text-sm leading-snug text-mist-200">
              <span className="text-mist-600">Instead of </span>
              {s.instead_of.toLowerCase()}
              <span className="text-mist-600">, have </span>
              <span className="font-semibold text-white">{s.have}</span>
            </p>
            <p className="mt-1 text-[0.68rem] leading-relaxed text-mist-600">
              {saves > 0 && (
                <span className="font-semibold text-lime-glow">
                  saves about {fmt(saves)} {unit}
                  {share > 0 ? ` (${share}% of what you went over)` : ""}
                </span>
              )}
              {saves > 0 && s.why ? " · " : ""}
              {s.why}
            </p>
          </li>
        );
      })}
    </ul>
  );
}
