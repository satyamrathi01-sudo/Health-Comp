"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function WeighIn({
  userId, today, current, delta,
}: {
  userId: string;
  today: string;
  current: number;
  delta: number | null;
}) {
  const router = useRouter();
  const [value, setValue] = useState(String(current || ""));
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  async function save() {
    const weight = Number(value);
    if (!(weight > 25 && weight < 400)) return;
    setBusy(true);
    const supabase = createClient();

    // The weigh-in drives the chart; profile.weight_kg prices future workouts.
    await supabase.from("weigh_ins").upsert({ user_id: userId, local_date: today, weight_kg: weight });
    await supabase.from("profiles").update({ weight_kg: weight }).eq("id", userId);

    setBusy(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    router.refresh();
  }

  return (
    <div className="surface p-5">
      <div className="flex items-end gap-3">
        <label className="flex-1">
          <span className="eyebrow mb-2 block">Today&apos;s weight (kg)</span>
          <input
            className="field tnum" type="number" inputMode="decimal" step="0.1"
            value={value} onChange={(e) => setValue(e.target.value)}
          />
        </label>
        <button className="btn btn-primary" onClick={save} disabled={busy}>
          {busy ? "…" : saved ? "✓" : "Save"}
        </button>
      </div>

      {delta !== null && delta !== 0 && (
        <p className="tnum mt-3 text-xs text-mist-600">
          <span className={delta < 0 ? "font-semibold text-lime-glow" : "font-semibold text-flame"}>
            {delta > 0 ? "+" : ""}{delta} kg
          </span>{" "}
          since your first logged weigh-in
        </p>
      )}
    </div>
  );
}
