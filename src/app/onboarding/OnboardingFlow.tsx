"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { localDate, publishedTargets } from "@/lib/calc";
import type { ActivityLevel, Goal, Profile, Sex } from "@/lib/types";

const EMOJI = ["🔥", "⚡", "🐺", "🦍", "🚀", "🥊", "🦁", "🎯", "💪", "🧊"];

const ACTIVITY: { value: ActivityLevel; label: string; hint: string }[] = [
  { value: "sedentary", label: "Sedentary", hint: "Desk job, little movement" },
  { value: "light", label: "Light", hint: "Light exercise 1–3 days/week" },
  { value: "moderate", label: "Moderate", hint: "Exercise 3–5 days/week" },
  { value: "active", label: "Active", hint: "Hard exercise 6–7 days/week" },
  { value: "very_active", label: "Very active", hint: "Physical job or twice a day" },
];

const GOALS: { value: Goal; label: string; hint: string }[] = [
  { value: "cut", label: "Lose fat", hint: "Calorie deficit" },
  { value: "maintain", label: "Maintain", hint: "Hold steady" },
  { value: "bulk", label: "Build muscle", hint: "Slight surplus" },
];

function randomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I/O/0/1
  return Array.from({ length: 6 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
}

export default function OnboardingFlow({ profile }: { profile: Profile }) {
  const router = useRouter();
  const supabase = createClient();

  const [step, setStep] = useState<0 | 1>(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState(profile.display_name);
  const [emoji, setEmoji] = useState(profile.avatar_emoji || "🔥");
  const [sex, setSex] = useState<Sex>(profile.sex ?? "male");
  const [birth, setBirth] = useState(profile.birth_date ?? "");
  const [height, setHeight] = useState(profile.height_cm?.toString() ?? "");
  const [weight, setWeight] = useState(profile.weight_kg?.toString() ?? "");
  const [activity, setActivity] = useState<ActivityLevel>(profile.activity_level);
  const [goal, setGoal] = useState<Goal>(profile.goal);

  const [mode, setMode] = useState<"create" | "join">("create");
  const [challengeName, setChallengeName] = useState("The 60-Day Clash");
  const [weeks, setWeeks] = useState("8");
  const [code, setCode] = useState("");

  const profileValid =
    name.trim().length > 0 && birth !== "" && Number(height) > 80 && Number(weight) > 25;

  async function saveProfile() {
    setError(null);
    setBusy(true);
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Kolkata";
    try {
      const stats = {
        display_name: name.trim(),
        avatar_emoji: emoji,
        sex,
        birth_date: birth,
        height_cm: Number(height),
        weight_kg: Number(weight),
        activity_level: activity,
        goal,
        timezone: tz,
      };

      const { error } = await supabase
        .from("profiles")
        .update({
          ...stats,
          // The three numbers a rival is allowed to see, published in the same
          // write as the body they come from. Without this a new player has no
          // targets on anyone else's scoreboard until their next page load.
          ...publishedTargets({ ...profile, ...stats }, localDate(tz)),
        })
        .eq("id", profile.id);
      if (error) throw error;

      // Seed today's weigh-in so the weight chart has a starting point.
      await supabase.from("weigh_ins").upsert({
        user_id: profile.id,
        local_date: localDate(tz),
        weight_kg: Number(weight),
      });

      setStep(1);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function finish() {
    setError(null);
    setBusy(true);
    let activeId: string | null = null;
    try {
      if (mode === "create") {
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Kolkata";
        const start = localDate(tz);
        const end = new Date();
        end.setDate(end.getDate() + Math.max(7, Number(weeks) || 8) * 7);

        const { data: challenge, error: cErr } = await supabase
          .from("challenges")
          .insert({
            name: challengeName.trim() || "The Clash",
            invite_code: randomCode(),
            start_date: start,
            end_date: localDate(tz, end),
            created_by: profile.id,
          })
          .select()
          .single();
        if (cErr) throw cErr;

        const { error: mErr } = await supabase
          .from("challenge_members")
          .insert({ challenge_id: challenge.id, user_id: profile.id });
        if (mErr) throw mErr;
        activeId = challenge.id;
      } else {
        const { data: joined, error: jErr } = await supabase.rpc("join_challenge", { code: code.trim() });
        if (jErr) throw jErr;
        activeId = (joined as string) ?? null;
      }

      // active_challenge_id may not exist yet on an un-migrated database, and
      // failing to record a preference must never block finishing setup.
      const { error: pErr } = await supabase
        .from("profiles")
        .update({ onboarded: true, active_challenge_id: activeId })
        .eq("id", profile.id);
      if (pErr) {
        const { error: fallbackErr } = await supabase
          .from("profiles").update({ onboarded: true }).eq("id", profile.id);
        if (fallbackErr) throw fallbackErr;
      }

      router.replace("/");
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rise">
      <div className="mb-6 flex items-center gap-2">
        {[0, 1].map((i) => (
          <div
            key={i}
            className={`h-1 flex-1 rounded-full ${i <= step ? "bg-lime-glow" : "bg-ink-800"}`}
          />
        ))}
      </div>

      {step === 0 ? (
        <>
          <h1 className="hero-num text-2xl">Your numbers</h1>
          <p className="mb-6 mt-2 text-sm leading-relaxed text-mist-600">
            Height and weight let the app price your workouts properly — a heavier body
            genuinely burns more for the same run.
          </p>

          <div className="space-y-4">
            <label className="block">
              <span className="eyebrow mb-2 block">Name</span>
              <input className="field" value={name} onChange={(e) => setName(e.target.value)} />
            </label>

            <div>
              <span className="eyebrow mb-2 block">Your emoji</span>
              <div className="hide-scrollbar flex gap-2 overflow-x-auto pb-1">
                {EMOJI.map((e) => (
                  <button
                    key={e} type="button" onClick={() => setEmoji(e)}
                    className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border text-xl ${
                      emoji === e ? "border-lime-glow bg-lime-glow/15" : "border-hair bg-transparent"
                    }`}
                  >
                    {e}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="eyebrow mb-2 block">Sex</span>
                <select className="field" value={sex} onChange={(e) => setSex(e.target.value as Sex)}>
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                </select>
              </label>
              <label className="block">
                <span className="eyebrow mb-2 block">Date of birth</span>
                <input className="field" type="date" value={birth} onChange={(e) => setBirth(e.target.value)} />
              </label>
              <label className="block">
                <span className="eyebrow mb-2 block">Height (cm)</span>
                <input className="field tnum" type="number" inputMode="decimal" value={height}
                  onChange={(e) => setHeight(e.target.value)} placeholder="175" />
              </label>
              <label className="block">
                <span className="eyebrow mb-2 block">Weight (kg)</span>
                <input className="field tnum" type="number" inputMode="decimal" value={weight}
                  onChange={(e) => setWeight(e.target.value)} placeholder="72" />
              </label>
            </div>

            <div>
              <span className="eyebrow mb-2 block">Day-to-day activity</span>
              <div className="space-y-1.5">
                {ACTIVITY.map((a) => (
                  <button
                    key={a.value} type="button" onClick={() => setActivity(a.value)}
                    className={`flex w-full items-center justify-between rounded-xl border px-3.5 py-2.5 text-left ${
                      activity === a.value ? "border-lime-glow bg-lime-glow/10" : "border-hair bg-transparent"
                    }`}
                  >
                    <span className="text-sm font-semibold">{a.label}</span>
                    <span className="text-[0.7rem] text-mist-600">{a.hint}</span>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <span className="eyebrow mb-2 block">Goal</span>
              <div className="grid grid-cols-3 gap-2">
                {GOALS.map((g) => (
                  <button
                    key={g.value} type="button" onClick={() => setGoal(g.value)}
                    className={`rounded-xl border px-2 py-3 text-center ${
                      goal === g.value ? "border-lime-glow bg-lime-glow/10" : "border-hair bg-transparent"
                    }`}
                  >
                    <div className="text-sm font-semibold">{g.label}</div>
                    <div className="mt-1 text-[0.65rem] leading-tight text-mist-600">{g.hint}</div>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {error && <p className="mt-4 text-xs text-danger">{error}</p>}

          <button className="btn btn-primary mt-6 w-full" disabled={!profileValid || busy} onClick={saveProfile}>
            {busy ? "Saving…" : "Continue"}
          </button>
        </>
      ) : (
        <>
          <h1 className="hero-num text-2xl">The challenge</h1>
          <p className="mb-6 mt-2 text-sm leading-relaxed text-mist-600">
            Start one and send your friend the code, or paste theirs.
          </p>

          <div className="mb-5 grid grid-cols-2 gap-1 rounded-xl bg-ink-900 p-1">
            {(["create", "join"] as const).map((m) => (
              <button
                key={m} type="button" onClick={() => { setMode(m); setError(null); }}
                className={`rounded-lg py-2 text-sm font-semibold transition-colors ${
                  mode === m ? "bg-ink-800 text-white" : "text-mist-600"
                }`}
              >
                {m === "create" ? "Start one" : "Join with code"}
              </button>
            ))}
          </div>

          {mode === "create" ? (
            <div className="space-y-4">
              <label className="block">
                <span className="eyebrow mb-2 block">Challenge name</span>
                <input className="field" value={challengeName} onChange={(e) => setChallengeName(e.target.value)} />
              </label>
              <label className="block">
                <span className="eyebrow mb-2 block">Length (weeks)</span>
                <input className="field tnum" type="number" min={1} max={26} value={weeks}
                  onChange={(e) => setWeeks(e.target.value)} />
              </label>
            </div>
          ) : (
            <label className="block">
              <span className="eyebrow mb-2 block">Invite code</span>
              <input
                className="field tnum text-center text-xl font-bold tracking-[0.3em]"
                value={code} onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="ABC123" maxLength={6} autoCapitalize="characters"
              />
            </label>
          )}

          {error && <p className="mt-4 text-xs text-danger">{error}</p>}

          <button
            className="btn btn-primary mt-6 w-full"
            disabled={busy || (mode === "join" && code.trim().length < 4)}
            onClick={finish}
          >
            {busy ? "Setting up…" : "Let's go"}
          </button>

          <button className="btn btn-quiet mt-2 w-full" onClick={() => setStep(0)} disabled={busy}>
            Back
          </button>
        </>
      )}
    </div>
  );
}
