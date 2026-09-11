"use client";

import { useEffect, useRef, useState } from "react";
import { CHAT_LIMITS, type ChatTurn } from "@/lib/chat";

/** Tap-to-ask starters, for an empty conversation. */
const STARTERS = [
  "How can I get more points today?",
  "What should I eat for dinner?",
  "What's costing me the most points?",
];

/**
 * Ask the coach anything about today — what to eat, what to do, why a line
 * scored what it did.
 *
 * The conversation lives on the page and is not saved. Each question sends
 * the last few turns back, so follow-ups work; leaving Today starts afresh.
 */
export default function CoachChat() {
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (turns.length) endRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [turns.length, busy]);

  async function ask(text: string) {
    const question = text.replace(/\s+/g, " ").trim();
    if (!question || busy) return;
    if (question.length > CHAT_LIMITS.question) {
      setError(`Keep it under ${CHAT_LIMITS.question} characters.`);
      return;
    }

    const history = turns;
    setTurns([...history, { role: "user", text: question }]);
    setDraft("");
    setError(null);
    setBusy(true);

    try {
      const res = await fetch("/api/coach/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, history }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.answer) {
        setError(data.error ?? "The coach couldn't answer that. Try again.");
      } else {
        setTurns((t) => [...t, { role: "coach", text: data.answer }]);
      }
    } catch {
      setError("Couldn't reach the coach. Check your connection.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="surface overflow-hidden">
      {turns.length === 0 ? (
        <div className="px-5 pb-1 pt-4">
          <p className="text-[0.8rem] leading-relaxed text-mist-400">
            Ask about today — what to eat, how to earn more points, or why a line scored what it
            did. Answers use what you&apos;ve logged and your own targets.
          </p>
          <div className="hide-scrollbar mt-3 flex flex-wrap gap-2 pb-3">
            {STARTERS.map((s) => (
              <button key={s} type="button" className="chip" onClick={() => ask(s)} disabled={busy}>
                {s}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="max-h-[26rem] space-y-3 overflow-y-auto px-4 py-4" aria-live="polite">
          {turns.map((t, i) =>
            t.role === "user" ? (
              <div key={i} className="flex justify-end">
                <p className="max-w-[85%] rounded-2xl rounded-br-md bg-ink-800 px-3.5 py-2 text-sm leading-relaxed text-white">
                  {t.text}
                </p>
              </div>
            ) : (
              <div key={i} className="flex justify-start">
                <p className="max-w-[92%] whitespace-pre-line rounded-2xl rounded-bl-md border border-hair px-3.5 py-2.5 text-[0.85rem] leading-relaxed text-mist-200">
                  {t.text}
                </p>
              </div>
            ),
          )}
          {busy && (
            <div className="flex justify-start">
              <p className="thinking rounded-2xl rounded-bl-md border border-hair px-3.5 py-2 text-sm text-mist-600">
                Thinking…
              </p>
            </div>
          )}
          <div ref={endRef} />
        </div>
      )}

      {error && <p className="hair px-5 py-2.5 text-[0.72rem] text-danger">{error}</p>}

      <form
        className="hair flex items-end gap-2 px-3 py-3"
        onSubmit={(e) => {
          e.preventDefault();
          ask(draft);
        }}
      >
        <label className="sr-only" htmlFor="coach-question">Ask the coach</label>
        <textarea
          id="coach-question"
          className="field min-h-[2.75rem] flex-1 resize-none py-2.5"
          rows={1}
          maxLength={CHAT_LIMITS.question}
          placeholder="Ask the coach…"
          value={draft}
          disabled={busy}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            // Enter sends; Shift+Enter makes a new line.
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              ask(draft);
            }
          }}
        />
        <button type="submit" className="btn btn-primary shrink-0 px-4" disabled={busy || !draft.trim()}>
          {busy ? "…" : "Ask"}
        </button>
      </form>

      <p className="hair px-5 py-2 text-[0.6rem] leading-relaxed text-mist-600">
        Not saved — leaving Today clears it. General guidance, not medical advice.
      </p>
    </div>
  );
}
