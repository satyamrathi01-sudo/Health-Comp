import Link from "next/link";
import type { TrackedLimit } from "@/lib/limits";

const fmt = (n: number) => Math.round(n).toLocaleString("en-GB");

/**
 * One line at the top of Today for anything already over a limit (red) or
 * nearly there (amber).
 *
 * It names the limits and nothing more. The detail is one tap away on
 * /limits: the foods that caused each one, the fewest cuts that would have
 * kept you under, and what to have instead. Anything comfortably inside its
 * limit is not mentioned at all, so seeing this line means something.
 */
export default function LimitAlerts({ limits }: { limits: TrackedLimit[] }) {
  if (!limits.length) return null;

  const over = limits.filter((l) => l.state === "over");
  const named = over.length ? over : limits;
  const tone = over.length ? "var(--color-danger)" : "var(--color-gold)";
  const title = over.length
    ? `Over ${over.length} limit${over.length === 1 ? "" : "s"} today`
    : `Close to ${limits.length} limit${limits.length === 1 ? "" : "s"}`;

  return (
    <Link
      href="/limits"
      className="flex items-center gap-3 rounded-[1.25rem] border px-4 py-3"
      style={{
        borderColor: `color-mix(in srgb, ${tone} ${over.length ? 45 : 40}%, transparent)`,
        background: `color-mix(in srgb, ${tone} ${over.length ? 9 : 8}%, var(--color-ink-900))`,
      }}
    >
      <svg
        width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
        className="shrink-0" style={{ color: tone }} aria-hidden="true"
      >
        <path d="M12 3 2 21h20L12 3Z" />
        <path d="M12 10v5M12 18h.01" />
      </svg>

      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold" style={{ color: tone }}>{title}</span>
        <span className="tnum mt-0.5 block truncate text-[0.7rem] text-mist-400">
          {named.map((l) => `${l.label} ${fmt(l.value)}/${fmt(l.limit)} ${l.unit}`).join(" · ")}
        </span>
      </span>

      <span className="shrink-0 text-xs font-semibold" style={{ color: tone }}>See why</span>
      <svg
        width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="2.5" strokeLinecap="round" className="shrink-0" style={{ color: tone }}
        aria-hidden="true"
      >
        <path d="m9 18 6-6-6-6" />
      </svg>
    </Link>
  );
}
