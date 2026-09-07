# FitClash ⚡

Two friends, one scoreboard. Log what you ate and how you trained in plain
English; Gemini turns it into calories, macros and MET-based burn; the app
scores the day and decides who won.

Built to replace a cluttered WhatsApp challenge thread.

---

## Setup (about 10 minutes)

### 1. Supabase

1. Create a free project at [supabase.com](https://supabase.com).
2. Open **SQL Editor**, paste all of [`supabase/schema.sql`](supabase/schema.sql), Run.
   It is idempotent — safe to re-run after edits.
3. Go to **Authentication → Sign In / Providers → Email** and turn
   **"Confirm email" OFF**. With it on, sign-up returns no session and the app
   will tell you to come back here.
4. Copy the project URL and the `anon` public key.

### 2. Gemini

Get a free key at [aistudio.google.com/apikey](https://aistudio.google.com/apikey).
The free tier is far more than two people can use.

### 3. Env

```bash
cp .env.local.example .env.local   # then fill in the three values
npm install
npm run dev
```

Open <http://localhost:3000>. Check <http://localhost:3000/api/health> if
something looks unwired — it reports which env vars actually landed.

### 4. Play

First person signs up → sets their stats → **Start one** → gets a 6-character
invite code. Second person signs up → **Join with code**. You now have a rival.

On your phone, open the site and **Add to Home Screen** — it installs as a
standalone app, no app store involved.

---

## How scoring works

`src/lib/scoring.ts` is the single source of truth. Scores are **derived from
raw logs at read time**, never stored — so changing a weight there instantly
re-scores all history, no migration.

Mode is **raw absolute numbers**: nobody's body stats enter the maths.

| Component | Full marks at | Points |
|---|---|---|
| Calories burned | 350 kcal | 35 |
| Protein | 125 g | 25 |
| Net calories (eaten − burned) | ≤ 0 kcal | 18 |
| Active minutes | 60 min | 12 |
| Logged the day | food + training (or rest day) | 10 |
| **Base** | | **100** |
| Streak bonus | 10 consecutive days | +10 |

Net calories only score once food is logged — otherwise skipping breakfast
would be worth 18 free points.

**The known trade-off:** a heavier person burns more kcal for identical work,
so raw burn mildly favours them. If that starts to bite, add a `"relative"`
branch in `SCORING` that divides by bodyweight or by each player's own targets
(`deriveTargets()` in `src/lib/calc.ts` already computes them, and they're shown
on the Me tab). The breakdown shape stays the same, so no UI changes needed.

---

## How the AI is used

Deliberately narrow: **Gemini parses, code computes.**

- **Food** → Gemini returns items with macros for the quantity actually eaten.
  The prompt is tuned for Indian home cooking (katori, thali, roti, tadka)
  because generic nutrition databases are poor at it.
- **Workout** → Gemini returns only exercise names, MET values and minutes.
  It never returns calories. Burn is computed in `src/lib/calc.ts` as
  `MET × 3.5 × kg / 200 × minutes`, so the same session always scores the
  same and bodyweight is applied correctly.

**Model:** defaults to `gemini-3.5-flash`. Verified live on 2026-09-07 —
`gemini-2.5-flash` now returns 404 ("no longer available to new users"), and
`gemini-3.6-flash` rejects `thinkingBudget: 0` with a 400. Because a pinned model
can be retired underneath you, `generate()` walks a fallback chain on 404/503 and
retries once without `thinkingConfig` on a 400. Override with `GEMINI_MODEL`.

Every parse is cached in `ai_cache`, keyed by a hash of the normalised text.
People eat the same breakfast for weeks, so the free tier stretches a long way.
Workout cache stores MET + minutes only, and burn is re-priced per request
against current bodyweight — so the cache stays valid as weight changes.

If `GEMINI_API_KEY` is missing the app still works: the composer falls back to
manual entry.

---

## Commands

```bash
npm run dev     # dev server
npm run build   # production build
npm test        # scoring engine checks (18 assertions, no deps)
```

## Layout

```
src/lib/scoring.ts    the scoreboard — all weights live here
src/lib/calc.ts       BMR, MET burn, timezone-correct local dates
src/lib/gemini.ts     prompts + schemas, server-only
src/lib/data.ts       loads both players and derives every score
src/app/(app)/        Today · Versus · Log · Goals · Me
supabase/schema.sql   tables, RLS, views, helper functions
```

## Deploying

Any Node host works. Given the existing Cloud Run setup: build the image,
deploy with **min-instances 0** so it scales to zero and stays free, and set
`GEMINI_API_KEY` + the two Supabase vars as service env vars.
