"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { localDate } from "@/lib/calc";
import { DEFAULT_CLASH, inviteMessage, randomInviteCode, whatsappLink } from "@/lib/clash";

/* ---------------------------------------------------------------------
 * "Start a new challenge and share it with your friend" — shown on Today
 * once someone has gone a day without a running challenge (the rule is
 * needsChallengePrompt() in lib/clash.ts, checked by the page).
 *
 * Starting is the lead: one tap makes a 60-day challenge, then the sheet
 * turns into the invite, with WhatsApp first. Joining a friend's challenge
 * with the code they sent is the quieter second option.
 *
 * Never compulsory, but persistent: "Skip for today" holds it off until
 * tomorrow on this device, and it comes back every day until they are in a
 * running challenge. It never opens on top of the home-screen sheet: it
 * waits for that one to close.
 * ------------------------------------------------------------------- */

const SNOOZE_KEY = "fitclash:challenge-prompt-snoozed";
/** Fired by InstallPrompt when its sheet closes. */
export const SHEET_CLOSED_EVENT = "fitclash:sheet-closed";

export default function ChallengePrompt({ userId, timezone }: { userId: string; timezone: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const today = localDate(timezone);
    try {
      if (window.localStorage.getItem(SNOOZE_KEY) === today) return;
    } catch {
      // Storage blocked: still worth asking; "Not now" just won't stick.
    }

    // Give the home-screen sheet, which decides on load, the first turn.
    let waiting = false;
    const show = () => setOpen(true);
    const timer = window.setTimeout(() => {
      if (document.querySelector('[role="dialog"]')) {
        waiting = true;
        window.addEventListener(SHEET_CLOSED_EVENT, show, { once: true });
      } else {
        show();
      }
    }, 900);

    return () => {
      window.clearTimeout(timer);
      if (waiting) window.removeEventListener(SHEET_CLOSED_EVENT, show);
    };
  }, [timezone]);

  function snooze() {
    try {
      window.localStorage.setItem(SNOOZE_KEY, localDate(timezone));
    } catch {
      // Nothing to do: the sheet still closes.
    }
    setOpen(false);
  }

  if (!open) return null;
  return (
    <ChallengeSheet
      userId={userId}
      timezone={timezone}
      onClose={snooze}
      onJoined={() => {
        setOpen(false);
        router.refresh();
      }}
    />
  );
}

type Created = { name: string; code: string };

/** The sheet itself, kept apart from the when-to-show logic above. */
export function ChallengeSheet({
  userId,
  timezone,
  onClose,
  onJoined,
  initialCreated = null,
}: {
  userId: string;
  timezone: string;
  onClose: () => void;
  onJoined: () => void;
  /** For previews: open straight on the invite. */
  initialCreated?: Created | null;
}) {
  const [created, setCreated] = useState<Created | null>(initialCreated);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<null | "start" | "join">(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // Once a challenge exists the page behind is out of date; refresh on the
  // way out rather than straight away, which would take the invite with it.
  function close() {
    if (created) onJoined();
    else onClose();
  }

  const supabase = () => createClient();

  async function makeActive(id: string) {
    const { error } = await supabase()
      .from("profiles").update({ active_challenge_id: id }).eq("id", userId);
    if (error) console.warn("could not set active challenge —", error.message);
  }

  async function start() {
    setBusy("start"); setError(null);
    try {
      const end = new Date();
      end.setDate(end.getDate() + DEFAULT_CLASH.days);
      const name = DEFAULT_CLASH.name;

      const client = supabase();
      const { data, error } = await client.from("challenges").insert({
        name,
        invite_code: randomInviteCode(),
        start_date: localDate(timezone),
        end_date: localDate(timezone, end),
        created_by: userId,
      }).select().single();
      if (error) throw error;

      const { error: mErr } = await client.from("challenge_members")
        .insert({ challenge_id: data.id, user_id: userId });
      if (mErr) throw mErr;

      await makeActive(data.id);
      setCreated({ name, code: data.invite_code });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function join() {
    setBusy("join"); setError(null);
    try {
      const { data, error } = await supabase().rpc("join_challenge", { code: code.trim() });
      if (error) throw error;
      if (data) await makeActive(data as string);
      onJoined();
    } catch (err) {
      setError((err as Error).message);
      setBusy(null);
    }
  }

  const message = created ? inviteMessage(created.name, created.code, window.location.origin) : "";

  async function shareElsewhere() {
    try {
      if (navigator.share) {
        await navigator.share({ text: message });
      } else {
        await navigator.clipboard.writeText(message);
        setCopied(true);
        setTimeout(() => setCopied(false), 2200);
      }
    } catch {
      /* share sheet dismissed */
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-void/70 px-4 backdrop-blur-sm"
      style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 1rem)" }}
      onClick={close}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="challenge-title"
        aria-describedby="challenge-body"
        className="rise w-full max-w-md rounded-[1.25rem] border border-hair bg-ink-900 p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {!created ? (
          <>
            <p className="text-2xl" aria-hidden="true">⚔️</p>
            <p id="challenge-title" className="mt-2 text-lg font-semibold leading-snug text-white">
              Start a new challenge and share it with your friend
            </p>
            <p id="challenge-body" className="mt-1.5 text-[0.8rem] leading-relaxed text-mist-400">
              You&apos;re not in a challenge right now. Start a 60-day one and send your friend
              the code — FitClash is better with someone to beat.
            </p>

            {error && <p className="mt-3 text-xs text-danger">{error}</p>}

            <button
              type="button"
              className="btn btn-primary mt-5 w-full"
              onClick={start}
              disabled={busy !== null}
              autoFocus
            >
              {busy === "start" ? "Starting…" : "Start a challenge"}
            </button>

            <form
              className="mt-4 rounded-xl bg-ink-850 px-4 py-3.5"
              onSubmit={(e) => {
                e.preventDefault();
                join();
              }}
            >
              <label className="eyebrow block" htmlFor="challenge-code">
                Or join a friend&apos;s challenge
              </label>
              <div className="mt-2 flex items-center gap-2">
                <input
                  id="challenge-code"
                  className="field tnum min-w-0 flex-1 text-center font-bold tracking-[0.3em]"
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  placeholder="CODE"
                  maxLength={6}
                  autoCapitalize="characters"
                  autoComplete="off"
                  disabled={busy !== null}
                />
                <button
                  type="submit"
                  className="btn btn-ghost shrink-0 px-5"
                  disabled={busy !== null || code.trim().length < 4}
                >
                  {busy === "join" ? "Joining…" : "Join"}
                </button>
              </div>
              <p className="mt-2 text-[0.7rem] text-mist-600">Enter the code your friend sent you.</p>
            </form>

            <button type="button" className="btn btn-quiet mt-2 w-full" onClick={close} disabled={busy !== null}>
              Skip for today
            </button>
          </>
        ) : (
          <>
            <p className="text-2xl" aria-hidden="true">🎉</p>
            <p id="challenge-title" className="mt-2 text-lg font-semibold leading-snug text-white">
              Your challenge is ready
            </p>
            <p id="challenge-body" className="mt-1.5 text-[0.8rem] leading-relaxed text-mist-400">
              Send your friend the code. The clash starts as soon as they join.
            </p>

            <div className="mt-4 rounded-xl border border-dashed border-hair px-4 py-4 text-center">
              <p className="eyebrow">{created.name} · invite code</p>
              <p className="hero-num tnum mt-2 text-2xl tracking-[0.3em]" style={{ color: "var(--color-lime-glow)" }}>
                {created.code}
              </p>
            </div>

            <a
              href={whatsappLink(message)}
              target="_blank"
              rel="noopener noreferrer"
              className="btn mt-5 flex w-full items-center justify-center gap-2 text-white"
              style={{ background: "#25D366", color: "#0b1f12" }}
            >
              <WhatsAppIcon />
              Share on WhatsApp
            </a>
            <div className="mt-2 flex gap-2">
              <button type="button" className="btn btn-ghost flex-1" onClick={shareElsewhere}>
                {copied ? "Copied ✓" : "Other apps"}
              </button>
              <button type="button" className="btn btn-quiet flex-1" onClick={close}>
                Done
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function WhatsAppIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.1l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.2-.4.7-1.4.1-.2 0-.3 0-.5l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.6a2.7 2.7 0 0 0 1.8-1.3 2.2 2.2 0 0 0 .2-1.3c-.1-.1-.2-.2-.5-.3Z" />
    </svg>
  );
}
