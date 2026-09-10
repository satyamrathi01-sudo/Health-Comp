"use client";

import { useSearchParams } from "next/navigation";
import { useId, useState, type KeyboardEvent, type ReactNode } from "react";

export interface SubTab {
  id: string;
  label: string;
  content: ReactNode;
}

/**
 * Tabs inside a screen, so one long scroll becomes a few short views.
 *
 * Every panel is rendered on the server and stays mounted; switching only
 * hides and shows. That makes a switch instant with no round trip, keeps a
 * half-typed form intact while you look at another tab, and means a card
 * that loads something on mount does it once rather than on every switch.
 *
 * The open tab is kept in ?tab= so a reload or the back button returns to
 * it. It is written with history.replaceState, which Next's router picks up
 * without re-rendering the page on the server. The first tab keeps the URL
 * clean.
 */
export default function SubTabs({ tabs, label }: { tabs: SubTab[]; label: string }) {
  const requested = useSearchParams().get("tab");
  const [active, setActive] = useState(
    tabs.some((t) => t.id === requested) ? requested! : tabs[0].id,
  );
  const uid = useId();
  const tabId = (id: string) => `${uid}-tab-${id}`;
  const panelId = (id: string) => `${uid}-panel-${id}`;

  function select(id: string) {
    setActive(id);
    const params = new URLSearchParams(window.location.search);
    if (id === tabs[0].id) params.delete("tab");
    else params.set("tab", id);
    const query = params.toString();
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`,
    );
  }

  // Arrow keys move between tabs, as a tab list is expected to.
  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const next = tabs[(index + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
    select(next.id);
    document.getElementById(tabId(next.id))?.focus();
  }

  return (
    <div>
      <div
        className="sticky z-30 -mx-4 bg-void/95 px-4 pb-3 pt-2 backdrop-blur-xl"
        style={{ top: "env(safe-area-inset-top, 0px)" }}
      >
        <div
          role="tablist"
          aria-label={label}
          className="grid gap-1 rounded-xl bg-ink-900 p-1"
          style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}
        >
          {tabs.map((t, i) => {
            const on = t.id === active;
            return (
              <button
                key={t.id}
                id={tabId(t.id)}
                type="button"
                role="tab"
                aria-selected={on}
                aria-controls={panelId(t.id)}
                tabIndex={on ? 0 : -1}
                onClick={() => select(t.id)}
                onKeyDown={(e) => onKeyDown(e, i)}
                className={`rounded-lg py-2 text-sm font-semibold transition-colors ${
                  on ? "bg-ink-800 text-white" : "text-mist-600"
                }`}
              >
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      {tabs.map((t) => (
        <div
          key={t.id}
          id={panelId(t.id)}
          role="tabpanel"
          aria-labelledby={tabId(t.id)}
          hidden={t.id !== active}
          className="space-y-8 pt-4"
        >
          {t.content}
        </div>
      ))}
    </div>
  );
}
