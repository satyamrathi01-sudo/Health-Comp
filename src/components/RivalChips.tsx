"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";

/**
 * Who Versus is comparing you with, when you have more than one rival.
 *
 * A client component only so each chip can carry the open tab with it:
 * switching rival while looking at past days should stay on past days, and
 * the tab is written to the URL on the client where a server-rendered link
 * would never see it.
 */
export default function RivalChips({
  rivals,
  activeId,
}: {
  rivals: { id: string; name: string; emoji: string }[];
  activeId: string;
}) {
  const tab = useSearchParams().get("tab");

  const href = (id: string | null) => {
    const params = new URLSearchParams();
    if (id) params.set("vs", id);
    if (tab) params.set("tab", tab);
    const query = params.toString();
    return query ? `/vs?${query}` : "/vs";
  };

  return (
    <nav aria-label="Compare with" className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
      {rivals.map((r) => {
        const active = r.id === activeId;
        return (
          <Link
            key={r.id}
            // Tapping the selected chip clears the choice, which falls back to
            // whoever is ahead.
            href={active ? href(null) : href(r.id)}
            scroll={false}
            aria-current={active ? "true" : undefined}
            className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold ${
              active ? "bg-lime-glow text-ink-900" : "surface text-mist-200"
            }`}
          >
            <span aria-hidden="true">{r.emoji}</span>
            {r.name}
          </Link>
        );
      })}
    </nav>
  );
}
