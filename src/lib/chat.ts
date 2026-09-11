/* =====================================================================
 * The coach chat's input, checked before it goes anywhere near Gemini.
 *
 * Pure so it can be tested, and so the browser and the server agree on the
 * limits. Nothing is stored: a conversation lives on the page, and each
 * question sends the last few turns back so a follow-up ("and for dinner?")
 * still makes sense.
 * ===================================================================== */

export const CHAT_LIMITS = {
  /** Characters in one question. */
  question: 500,
  /** Characters kept from any earlier turn. */
  turnText: 1500,
  /** Earlier turns sent back with a question. */
  turns: 6,
} as const;

export interface ChatTurn {
  role: "user" | "coach";
  text: string;
}

/** A question worth sending, or null. Too-long questions are refused, not cut. */
export function cleanQuestion(value: unknown): string | null {
  const q = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  if (q.length < 2 || q.length > CHAT_LIMITS.question) return null;
  return q;
}

/** The recent conversation, with anything malformed dropped. */
export function cleanHistory(value: unknown): ChatTurn[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((t): t is ChatTurn =>
      Boolean(t) && (t.role === "user" || t.role === "coach") && typeof t.text === "string")
    .map((t) => ({ role: t.role, text: t.text.trim().slice(0, CHAT_LIMITS.turnText) }))
    .filter((t) => t.text.length > 0)
    .slice(-CHAT_LIMITS.turns);
}
