import { addDays } from "./calc.ts";

/* =====================================================================
 * Getting someone back into a challenge.
 *
 * Onboarding makes everyone start or join one, but challenges end and people
 * leave them. FitClash is a game against someone, so a day spent in no
 * challenge at all gets a nudge on Today: start one and send it to a friend,
 * or join a friend's with the code they sent.
 *
 * Pure, so the rule is tested and the server and the sheet agree on it.
 * ===================================================================== */

/** What "Start a challenge" makes in one tap. */
export const DEFAULT_CLASH = {
  name: "The 60-Day Clash",
  days: 60,
} as const;

const DAY_MS = 86_400_000;

/**
 * True when someone has spent at least a day outside any running challenge.
 *
 * A challenge runs through its end date. A new account is left alone for its
 * first day, and so is anyone whose last challenge ended only yesterday.
 * Leaving a challenge leaves no date behind, so that case counts from when
 * the account was made.
 */
export function needsChallengePrompt(
  challenges: { end_date: string }[],
  accountCreatedAt: string,
  today: string,
  now: number = Date.now(),
): boolean {
  if (challenges.some((c) => c.end_date >= today)) return false;

  const created = Date.parse(accountCreatedAt);
  if (Number.isFinite(created) && now - created < DAY_MS) return false;

  const lastEnd = challenges.map((c) => c.end_date).sort().at(-1);
  return !lastEnd || lastEnd < addDays(today, -1);
}

/** Six characters, no I, O, 0 or 1 to misread. */
export function randomInviteCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 6 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
}

/** What a friend receives: the challenge, its code and where to sign up. */
export function inviteMessage(name: string, code: string, origin: string): string {
  return `Join me on FitClash 💪\n\n${name}\nCode: ${code}\n\n${origin}`;
}

/** Opens WhatsApp with the invite typed out, on a phone or on the web. */
export function whatsappLink(message: string): string {
  return `https://wa.me/?text=${encodeURIComponent(message)}`;
}
