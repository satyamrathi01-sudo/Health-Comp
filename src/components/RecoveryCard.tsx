import type { Recovery } from "@/lib/recovery";

const BAND_COLOR = {
  high: "var(--color-lime-glow)",
  moderate: "var(--color-gold)",
  low: "var(--color-danger)",
} as const;

/**
 * How ready you are to train, estimated from sleep, yesterday's training and
 * what you ate. It sits directly above the Sleep card on Today's Body tab,
 * which is where its main missing input gets filled in.
 */
export default function RecoveryCard({ recovery }: { recovery: Recovery }) {
  // No sleep logged: say what is missing rather than showing a number built
  // mostly out of guesswork.
  if (recovery.score === null) {
    return (
      <div className="surface flex items-center gap-4 px-5 py-4">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border-[3px] border-ink-800">
          <span className="text-lg text-mist-600">?</span>
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-white">{recovery.headline}</p>
          <p className="mt-0.5 text-[0.7rem] leading-relaxed text-mist-600">{recovery.guidance}</p>
        </div>
      </div>
    );
  }

  const color = BAND_COLOR[recovery.band!];
  const size = 56;
  const stroke = 5;
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;

  return (
    <div className="surface overflow-hidden">
      <div className="flex items-center gap-4 px-5 py-4">
        <div className="relative shrink-0" style={{ width: size, height: size }}>
          <svg width={size} height={size} className="-rotate-90" aria-hidden="true">
            <circle cx={size / 2} cy={size / 2} r={r} fill="none"
              stroke="var(--color-ink-800)" strokeWidth={stroke} />
            <circle cx={size / 2} cy={size / 2} r={r} fill="none"
              stroke={color} strokeWidth={stroke} strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={circumference * (1 - recovery.score / 100)}
              style={{ transition: "stroke-dashoffset 0.8s cubic-bezier(0.22, 1, 0.36, 1)" }} />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="tnum text-sm font-bold" style={{ color }}>{recovery.score}</span>
          </div>
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-white">{recovery.headline}</p>
          <p className="mt-0.5 text-[0.7rem] leading-relaxed text-mist-600">{recovery.guidance}</p>
        </div>
      </div>

      <div className="hair flex gap-4 px-5 py-3">
        {recovery.drivers.map((d) => (
          <div key={d.label} className="min-w-0 flex-1">
            <div className="h-[3px] w-full overflow-hidden rounded-full bg-ink-800">
              <div className="h-full rounded-full"
                style={{ width: `${d.value * 100}%`, background: color }} />
            </div>
            <div className="eyebrow mt-1.5 truncate">{d.label}</div>
            <div className="truncate text-[0.62rem] text-mist-600">{d.detail}</div>
          </div>
        ))}
      </div>

      <p className="hair px-5 py-2 text-[0.6rem] leading-relaxed text-mist-600">
        An estimate from your sleep, training and food, not a heart-rate reading.
      </p>
    </div>
  );
}
