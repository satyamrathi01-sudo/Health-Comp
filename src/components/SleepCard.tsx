"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { SleepQuality } from "@/lib/types";

const QUALITIES: { value: SleepQuality; label: string }[] = [
  { value: "poor", label: "Poor" },
  { value: "ok", label: "OK" },
  { value: "good", label: "Good" },
];

export default function SleepCard({
  userId,
  date,
  hours: initialHours,
  quality: initialQuality,
}: {
  userId: string;
  date: string;
  hours: number | null;
  quality: SleepQuality | null;
}) {
  const router = useRouter();
  const [hours, setHours] = useState<number>(initialHours ?? 7);
  const [quality, setQuality] = useState<SleepQuality | null>(initialQuality);
  const [open, setOpen] = useState(initialHours === null);
  const [busy, setBusy] = useState(false);

  const logged = initialHours !== null;

  async function save() {
    setBusy(true);
    await createClient().from("sleep_logs").upsert({
      user_id: userId,
      local_date: date,
      hours,
      quality,
    });
    setBusy(false);
    setOpen(false);
    router.refresh();
  }

  const step = (delta: number) =>
    setHours((h) => Math.round(Math.min(14, Math.max(0, h + delta)) * 4) / 4);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="surface flex w-full items-center justify-between px-5 py-4 text-left"
      >
        <div>
          <div className="eyebrow">Sleep</div>
          <div className="mt-1.5 flex items-baseline gap-1.5">
            <span className="hero-num tnum text-2xl">{initialHours}</span>
            <span className="text-xs text-mist-600">h</span>
            {initialQuality && (
              <span className="ml-1 text-xs capitalize text-mist-400">· {initialQuality}</span>
            )}
          </div>
        </div>
        <span className="text-xs font-semibold text-lime-glow">Edit</span>
      </button>
    );
  }

  return (
    <div className="surface px-5 py-5">
      <div className="eyebrow mb-4">{logged ? "Edit sleep" : "How did you sleep?"}</div>

      <div className="flex items-center justify-between">
        <button
          onClick={() => step(-0.25)}
          className="flex h-11 w-11 items-center justify-center rounded-full border border-hair text-xl text-mist-200"
          aria-label="Less sleep"
        >
          −
        </button>
        <div className="text-center">
          <span className="hero-num tnum text-5xl">{hours}</span>
          <span className="ml-1 text-sm text-mist-600">h</span>
        </div>
        <button
          onClick={() => step(0.25)}
          className="flex h-11 w-11 items-center justify-center rounded-full border border-hair text-xl text-mist-200"
          aria-label="More sleep"
        >
          +
        </button>
      </div>

      <div className="mt-5 flex justify-center gap-2">
        {QUALITIES.map((q) => (
          <button
            key={q.value}
            className="chip"
            data-on={quality === q.value}
            onClick={() => setQuality(quality === q.value ? null : q.value)}
          >
            {q.label}
          </button>
        ))}
      </div>

      <div className="mt-5 flex gap-2">
        {logged && (
          <button className="btn btn-ghost flex-1" onClick={() => setOpen(false)} disabled={busy}>
            Cancel
          </button>
        )}
        <button className="btn btn-primary flex-[2]" onClick={save} disabled={busy}>
          {busy ? "Saving…" : "Save sleep"}
        </button>
      </div>
    </div>
  );
}
