import type { ReactNode } from "react";

/* --------------------------------- Ring ------------------------------
 * The one dominant element. Thin stroke, generous diameter, the number
 * carrying the whole screen.
 * ------------------------------------------------------------------- */

export function Ring({
  value,
  max = 100,
  size = 232,
  color = "var(--color-lime-glow)",
  label,
  sub,
  children,
}: {
  value: number;
  max?: number;
  size?: number;
  color?: string;
  label?: string;
  sub?: string;
  children?: ReactNode;
}) {
  const stroke = 10;
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(1, max > 0 ? value / max : 0));

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden="true">
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none"
          stroke="var(--color-ink-800)" strokeWidth={stroke}
        />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none"
          stroke={color} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - pct)}
          style={{ transition: "stroke-dashoffset 0.8s cubic-bezier(0.22, 1, 0.36, 1)" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        {children ?? (
          <>
            <span className="hero-num tnum" style={{ fontSize: size / 3 }}>
              {Math.round(value)}
            </span>
            {label && <span className="eyebrow mt-2">{label}</span>}
            {sub && <span className="tnum mt-1 text-xs text-mist-600">{sub}</span>}
          </>
        )}
      </div>
    </div>
  );
}

/* -------------------------------- Metric -----------------------------
 * Big number, tiny label. Used in the quiet row under the ring.
 * ------------------------------------------------------------------- */

export function Metric({
  value,
  unit,
  label,
  color,
  hint,
}: {
  value: string | number;
  unit?: string;
  label: string;
  color?: string;
  hint?: string;
}) {
  return (
    <div className="text-center">
      <div className="flex items-baseline justify-center gap-0.5">
        <span
          className="hero-num tnum text-[1.6rem]"
          style={color ? { color } : undefined}
        >
          {value}
        </span>
        {unit && <span className="text-[0.65rem] font-medium text-mist-600">{unit}</span>}
      </div>
      <div className="eyebrow mt-1.5">{label}</div>
      {hint && <div className="mt-0.5 text-[0.62rem] text-mist-600">{hint}</div>}
    </div>
  );
}

/* ------------------------------- DataRow ----------------------------- */

export function DataRow({
  label,
  value,
  sub,
  color,
  bar,
}: {
  label: string;
  value: ReactNode;
  sub?: string;
  color?: string;
  /** 0–1; draws a hairline progress track beneath the row */
  bar?: number;
}) {
  return (
    <div className="py-3">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm text-mist-200">{label}</span>
        <span className="tnum text-sm font-semibold" style={color ? { color } : undefined}>
          {value}
        </span>
      </div>
      {sub && <div className="mt-0.5 text-[0.68rem] text-mist-600">{sub}</div>}
      {bar !== undefined && (
        <div className="mt-2 h-[3px] w-full overflow-hidden rounded-full bg-ink-800">
          <div
            className="h-full rounded-full"
            style={{
              width: `${Math.max(0, Math.min(100, bar * 100))}%`,
              background: color ?? "var(--color-lime-glow)",
              transition: "width 0.6s ease",
            }}
          />
        </div>
      )}
    </div>
  );
}

/* ------------------------------ Structure ---------------------------- */

export function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section>
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="eyebrow">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function PageHeader({
  title,
  subtitle,
  right,
}: {
  title: string;
  subtitle?: string;
  right?: ReactNode;
}) {
  return (
    <header className="mb-7 flex items-start justify-between gap-3">
      <div>
        <h1 className="text-[1.7rem] font-bold tracking-tight text-white">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-mist-600">{subtitle}</p>}
      </div>
      {right}
    </header>
  );
}

export function EmptyState({ icon, title, body }: { icon: string; title: string; body?: string }) {
  return (
    <div className="surface flex flex-col items-center gap-2 px-6 py-10 text-center">
      <span className="text-2xl opacity-60" aria-hidden="true">{icon}</span>
      <p className="text-sm font-semibold text-mist-200">{title}</p>
      {body && <p className="max-w-[32ch] text-xs leading-relaxed text-mist-600">{body}</p>}
    </div>
  );
}

export function StreakBadge({ days }: { days: number }) {
  if (days <= 0) return null;
  return (
    <div className="flex items-center gap-1.5 rounded-full border border-hair px-3 py-1.5">
      <span className="text-xs" aria-hidden="true">🔥</span>
      <span className="tnum text-sm font-bold text-gold">{days}</span>
    </div>
  );
}
