import type { ReactNode } from "react";

/* ------------------------------ ScoreDial ---------------------------- */

export function ScoreDial({
  score,
  max = 100,
  size = 156,
  color = "var(--color-lime-glow)",
  caption,
  sub,
}: {
  score: number;
  max?: number;
  size?: number;
  color?: string;
  caption?: string;
  sub?: string;
}) {
  const stroke = size / 11;
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(1, score / max));

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
          style={{ transition: "stroke-dashoffset 0.6s cubic-bezier(0.22, 1, 0.36, 1)" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="tnum font-bold leading-none" style={{ fontSize: size / 3.4, color }}>
          {Math.round(score)}
        </span>
        {caption && (
          <span className="mt-1 text-[0.68rem] font-semibold uppercase tracking-widest text-mist-500">
            {caption}
          </span>
        )}
        {sub && <span className="mt-0.5 text-xs text-mist-300">{sub}</span>}
      </div>
    </div>
  );
}

/* ------------------------------- StatTile ---------------------------- */

export function StatTile({
  label,
  value,
  unit,
  hint,
  accent,
}: {
  label: string;
  value: string | number;
  unit?: string;
  hint?: string;
  accent?: string;
}) {
  return (
    <div className="card px-3.5 py-3">
      <div className="text-[0.68rem] font-semibold uppercase tracking-wider text-mist-500">{label}</div>
      <div className="mt-1.5 flex items-baseline gap-1">
        <span className="tnum text-2xl font-bold leading-none" style={accent ? { color: accent } : undefined}>
          {value}
        </span>
        {unit && <span className="text-xs font-medium text-mist-500">{unit}</span>}
      </div>
      {hint && <div className="mt-1 text-[0.7rem] text-mist-500">{hint}</div>}
    </div>
  );
}

/* --------------------------------- Bar ------------------------------- */

export function Bar({
  value,
  max,
  color = "var(--color-lime-glow)",
  height = 6,
}: {
  value: number;
  max: number;
  color?: string;
  height?: number;
}) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div
      className="w-full overflow-hidden rounded-full bg-ink-800"
      style={{ height }}
      role="presentation"
    >
      <div
        className="h-full rounded-full"
        style={{ width: `${pct}%`, background: color, transition: "width 0.5s ease" }}
      />
    </div>
  );
}

/* ------------------------------ Structure ---------------------------- */

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-2.5 flex items-center justify-between">
      <h2 className="text-[0.72rem] font-bold uppercase tracking-[0.14em] text-mist-500">{children}</h2>
      {action}
    </div>
  );
}

export function EmptyState({ icon, title, body }: { icon: string; title: string; body?: string }) {
  return (
    <div className="card flex flex-col items-center gap-1.5 px-5 py-8 text-center">
      <span className="text-3xl" aria-hidden="true">{icon}</span>
      <p className="font-semibold text-mist-100">{title}</p>
      {body && <p className="max-w-[34ch] text-sm leading-relaxed text-mist-500">{body}</p>}
    </div>
  );
}

export function Pill({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "good" | "warn" | "bad" }) {
  const tones = {
    neutral: "bg-ink-800 text-mist-300 border-ink-700",
    good: "bg-lime-glow/15 text-lime-glow border-lime-glow/40",
    warn: "bg-gold/15 text-gold border-gold/40",
    bad: "bg-danger/15 text-danger border-danger/40",
  } as const;
  return (
    <span className={`rounded-full border px-2 py-0.5 text-[0.68rem] font-semibold ${tones[tone]}`}>
      {children}
    </span>
  );
}

export function PageHeader({ title, subtitle, right }: { title: string; subtitle?: string; right?: ReactNode }) {
  return (
    <header className="mb-5 flex items-start justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-mist-500">{subtitle}</p>}
      </div>
      {right}
    </header>
  );
}
