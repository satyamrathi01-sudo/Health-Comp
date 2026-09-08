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

Each player is judged against **their own body**, not against each other's raw
numbers. Targets come from `deriveTargets()` in `src/lib/calc.ts`: Mifflin–St
Jeor BMR, an activity multiplier for maintenance, protein per kg by goal, and a
daily burn target set at 15% of maintenance.

| Component | Full marks at | Points |
|---|---|---|
| Calories burned | your own burn target | 35 |
| Protein | your own protein target | 25 |
| Calorie target | intake within 10% of your aim | 18 |
| Active minutes | 60 min | 12 |
| Logged the day | food + training (or rest day) | 10 |
| **Base** | | **100** |
| Streak bonus | 10 consecutive days | +10 |

So burning 600 kcal against an 800 target scores *less* than burning 300
against a 300 target. That is the point: a 95 kg man maintaining on 2900 kcal
has to do meaningfully more work than a 55 kg woman on 1700 to earn the same
score.

Active minutes, the logging points and the streak stay absolute — an hour is an
hour whoever you are, and showing up is showing up.

Two guards worth knowing about:

- Calories only score once food is logged, otherwise skipping breakfast would
  be worth 18 free points.
- Intake is scored on *distance from* your target, so under-eating is penalised
  as well as over-eating.

If a profile is too incomplete to derive targets, that player falls back to
absolute scoring rather than getting no score at all.

`compareScores()` explains any two days line by line and states what the
trailing side would have to do to close each gap — in their own units, since a
point of "burn" is worth a different number of calories to each person.

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
