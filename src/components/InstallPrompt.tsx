"use client";

import { useEffect, useState } from "react";

/* ---------------------------------------------------------------------
 * "Add FitClash to your home screen" — asked once per device, right after
 * someone signs in.
 *
 * Two routes, because the platforms genuinely differ:
 *   - Chrome, Edge and Samsung Internet fire beforeinstallprompt. The root
 *     layout catches it before React loads (it fires early, and once), and
 *     the button here replays it.
 *   - iPhone and iPad have no install API. The only way is Share → Add to
 *     Home Screen, so the sheet shows those two steps instead.
 *
 * Anywhere else — a laptop, or the app already opened from the home screen —
 * there is nothing useful to offer, so nothing appears.
 *
 * "Once" lives in localStorage rather than the database: installing is per
 * device, so a new phone is asked again and signing back in on the same
 * phone is not.
 * ------------------------------------------------------------------- */

/** Set by the sign-in form; read and cleared here. */
export const JUST_SIGNED_IN_KEY = "fitclash:just-signed-in";
const ASKED_KEY = "fitclash:install-asked";

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

declare global {
  interface Window {
    __fitclashInstall?: InstallPromptEvent | null;
  }
}

export type InstallMode = "native" | "ios";

export default function InstallPrompt() {
  const [mode, setMode] = useState<InstallMode | null>(null);

  useEffect(() => {
    try {
      const store = window.localStorage;
      if (!store.getItem(JUST_SIGNED_IN_KEY) || store.getItem(ASKED_KEY)) return;
    } catch {
      // Storage blocked: better never to ask than to ask on every visit.
      return;
    }

    const installed =
      window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true;
    if (installed) {
      remember();
      return;
    }

    const ios =
      /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    if (ios) {
      setMode("ios");
      return;
    }

    // "Home screen" means nothing on a laptop, so phones and tablets only.
    if (!window.matchMedia("(pointer: coarse)").matches) return;

    if (window.__fitclashInstall) {
      setMode("native");
      return;
    }
    // Chrome can decide the site is installable a little after load.
    const ready = () => setMode("native");
    window.addEventListener("fitclash:installable", ready);
    return () => window.removeEventListener("fitclash:installable", ready);
  }, []);

  useEffect(() => {
    if (!mode) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") remember();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode]);

  function remember() {
    try {
      window.localStorage.setItem(ASKED_KEY, "1");
      window.localStorage.removeItem(JUST_SIGNED_IN_KEY);
    } catch {
      // Nothing to do: the sheet still closes.
    }
    setMode(null);
    // Lets a sheet that waited for this one (ChallengePrompt) open now.
    window.dispatchEvent(new Event("fitclash:sheet-closed"));
  }

  function install() {
    const event = window.__fitclashInstall;
    // A captured prompt can only be shown once.
    window.__fitclashInstall = null;
    remember();
    // Called straight from the tap, which the browser requires.
    event?.prompt().catch(() => {});
  }

  if (!mode) return null;
  return <InstallSheet mode={mode} onInstall={install} onClose={remember} />;
}

/** The sheet itself, kept apart from the when-to-show logic above. */
export function InstallSheet({
  mode,
  onInstall,
  onClose,
}: {
  mode: InstallMode;
  onInstall: () => void;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-void/70 px-4 backdrop-blur-sm"
      style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 1rem)" }}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="install-title"
        aria-describedby="install-body"
        className="rise w-full max-w-md rounded-[1.25rem] border border-hair bg-ink-900 p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3.5">
          {/* eslint-disable-next-line @next/next/no-img-element -- a 48px SVG needs no optimising */}
          <img
            src="/icons/icon.svg"
            alt=""
            width={48}
            height={48}
            className="h-12 w-12 shrink-0 rounded-xl"
          />
          <div className="min-w-0">
            <p id="install-title" className="text-base font-semibold text-white">
              Add FitClash to your home screen
            </p>
            <p id="install-body" className="mt-0.5 text-xs leading-relaxed text-mist-400">
              Open it in one tap, full screen, like any other app.
            </p>
          </div>
        </div>

        {mode === "ios" && (
          <ol className="mt-4 space-y-2.5 rounded-xl bg-ink-850 px-4 py-3.5 text-sm text-mist-200">
            <li className="flex items-center gap-2.5">
              <StepNumber n={1} />
              <span>
                Tap <ShareIcon /> <span className="font-semibold text-white">Share</span> in the
                browser bar
              </span>
            </li>
            <li className="flex items-center gap-2.5">
              <StepNumber n={2} />
              <span>
                Choose <span className="font-semibold text-white">Add to Home Screen</span>
              </span>
            </li>
          </ol>
        )}

        <div className="mt-5 flex gap-2">
          <button type="button" className="btn btn-ghost flex-1" onClick={onClose}>
            Not now
          </button>
          <button
            type="button"
            className="btn btn-primary flex-[2]"
            onClick={mode === "native" ? onInstall : onClose}
            autoFocus
          >
            {mode === "native" ? "Add to home screen" : "Got it"}
          </button>
        </div>
      </div>
    </div>
  );
}

function StepNumber({ n }: { n: number }) {
  return (
    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-ink-800 text-[0.65rem] font-bold text-mist-200">
      {n}
    </span>
  );
}

function ShareIcon() {
  return (
    <svg
      width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
      className="inline-block -translate-y-px text-cool" aria-hidden="true"
    >
      <path d="M12 3v12M8 7l4-4 4 4M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" />
    </svg>
  );
}
