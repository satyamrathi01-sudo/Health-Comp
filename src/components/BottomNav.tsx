"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/", label: "Today", icon: "M3 11.5 12 4l9 7.5M5.5 10v9h13v-9" },
  { href: "/vs", label: "Versus", icon: "M6 4v7a6 6 0 0 0 12 0V4M9 20h6M12 17v3" },
  { href: "/goals", label: "Goals", icon: "M12 3v18M12 5h7l-2 3 2 3h-7" },
  { href: "/me", label: "Me", icon: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4.5 20a7.5 7.5 0 0 1 15 0" },
] as const;

export default function BottomNav() {
  const pathname = usePathname();
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t border-ink-700 bg-ink-950/92 backdrop-blur-lg"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="mx-auto grid max-w-md grid-cols-5 items-center px-2">
        {TABS.slice(0, 2).map((t) => (
          <Tab key={t.href} {...t} active={isActive(t.href)} />
        ))}

        <div className="flex justify-center">
          <Link
            href="/log"
            aria-label="Log food or a workout"
            className="-mt-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-lime-glow text-ink-950 shadow-lg shadow-lime-glow/25 transition-transform active:scale-95"
          >
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </Link>
        </div>

        {TABS.slice(2).map((t) => (
          <Tab key={t.href} {...t} active={isActive(t.href)} />
        ))}
      </div>
    </nav>
  );
}

function Tab({ href, label, icon, active }: { href: string; label: string; icon: string; active: boolean }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`flex flex-col items-center gap-1 py-2.5 text-[0.62rem] font-semibold tracking-wide transition-colors ${
        active ? "text-lime-glow" : "text-mist-500"
      }`}
    >
      <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d={icon} />
      </svg>
      {label}
    </Link>
  );
}
