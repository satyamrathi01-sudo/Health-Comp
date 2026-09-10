# FitClash ⚡

Two friends, one scoreboard. Log what you ate and how you trained in plain
English; Gemini turns it into calories, macros and MET-based burn; the app
scores the day and decides who won.

Everyone is judged against their own body, and nobody gets to see anyone
else's. When your rival is ahead, the app names the plate that did it.

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

### Every number is yours

Nothing on any screen is a generic adult's figure. Each target is derived from
your body, your goal and — where it matters — what you did today:

| | Set from |
|---|---|
| Calories | your BMR × activity, then your goal or your weight plan |
| Protein | g/kg by goal — 2.0 cutting, 1.8 building, 1.6 holding |
| Fat | a share of *your* calorie target by goal, with a 0.6 g/kg floor |
| Carbs | whatever is left of your calories after protein and fat |
| Fibre | 14 g per 1,000 kcal you actually eat |
| Water | 33 ml/kg, plus a litre for every 700 kcal you burn training |
| Burn | 15% of your maintenance |
| Active minutes | how long *your* burn aim takes at a moderate effort |
| Added sugar · saturated fat | 10% of *your* calories each, not a flat 50 g and 22 g |
| Iron · zinc · magnesium | per kg against the reference body the RDAs are written for |
| Sodium · potassium | raised by what you sweated out today |
| B12 · D · C · folate · calcium | fixed — these are physiological requirements that a bigger body does not change |

The macro split always adds back up to the calorie target you are being scored
against, so a weight plan or a manual calorie figure moves all three with it.
Fat has a floor that calories cannot argue with: below roughly 0.6 g/kg,
hormones follow. On an aggressive cut that floor, not the share, is what sets
the number, and carbs absorb the squeeze.

Only two things stay absolute, and both on purpose: **active minutes** (an hour
is an hour whoever you are) and the **logging and streak points** (showing up is
showing up).

### Your numbers, your call

Every target the formulas produce can be overridden by hand on the **Goals** tab,
and a blank field hands the number straight back to the formula — there is no
reset to hunt for:

- **BMR.** A measured resting metabolic rate replaces Mifflin–St Jeor outright,
  and everything else rescales from it. The equation is a population fit; if you
  have had yours measured, yours is better.
- **Macros.** Calories, protein, carbs, fat and fibre. Protein is scored; carbs
  and fat become ceilings (see below).
- **Burn aim** and **water**.

### "I want to be 74 kg by 30 November"

Give a target weight and a date and `weightPlan()` turns it into a daily calorie
number: `(kg to go × 7,700) ÷ days left`, applied to maintenance. That number
becomes the calorie target the score judges you against, so the plan and the
scoreboard cannot disagree.

It refuses to hand back a pace that is not survivable. A deficit is capped at
1,000 kcal or 25% of maintenance, whichever is smaller, and intake never falls
below 1,200 kcal or 1.1 × BMR. When the clamp bites, the app says so and gives
the date you will actually arrive:

> 1,100 kcal a day off maintenance is not a safe pace. Held at 691, which
> reaches 78 kg around 2 Nov.

### The walk

The Today tab draws one tick per day since the plan began — up if that day moved
you toward your target, down if it moved you away, flat for a wash or an unlogged
day. Under it, a bar showing where you are against where the plan says you should
be by now.

The daily number is `TDEE − eaten + (burned − burn target)`. Exercise the app
already expects of you is inside TDEE, so only training *beyond* the burn target
counts again; adding the whole day's burn on top would pay you twice for the same
run. The pace marker uses the rate the plan asked for on the day it was set, not
"what is left over the days that remain" — otherwise it steepens every time you
slip and always shows you roughly on pace.

### Ceilings

Anything you have already gone past today appears in red at the top of Today,
worst first, before the score: saturated fat, sodium, added sugar, calories, your
carb and fat ceilings, and water if you have drunk a genuinely excessive amount. Amber at 90%. Everything
comfortably inside its limit is not mentioned at all, so seeing this block means
something. `src/lib/limits.ts` has the list; adding a tracked factor there is
enough to have it watched.

### Water

A bottle on the Today tab that fills as the day goes on, with a wave at the
surface. Three taps to add a glass, half a litre or a litre, and one to take the
last glass back.

The aim is **33 ml per kg of bodyweight**, plus **a litre for every 700 kcal you
burn training** — keyed on burn rather than minutes because burn already carries
your weight and the intensity, so an hour is not an hour here either. Set your
own figure on the Goals tab and it is used exactly as typed, training day or not:
someone who has decided should not have half a litre quietly added on top.

Progress is paced against the clock, not just the total. Two litres by nine in
the morning and two litres by eleven at night are not the same day, and a bare
percentage cannot tell them apart, so the bar carries a marker for where the
waking day says you should be:

> **Falling behind** — 400 ml behind where the day should have you. A glass now
> puts you back on it.

Taps are optimistic: the water moves the instant you press and the write goes out
behind it, rolling back only if it fails. A drink tracker that makes you wait for
a round trip before acknowledging a glass is one nobody uses twice.

Like sleep, it is **tracked but not scored**. Adding it to the hundred points
would re-score every day anyone logged before water existed, marking down a year
of good days for missing a field that was not there. It does reach the coach, and
it has a ceiling — but at 1.75× the target, so hitting your aim is never met with
a red banner.

---

## What your rivals can see

Your name and your emoji. The daily aims your score is measured against, with
any monthly goal already applied. Your food, your training and your daily score,
which is the whole point of the challenge.

Not your height, weight, age, sex, BMI, BMR, activity level, weigh-ins, weight
plan, monthly goals or the coach's notes. Nothing on the **Goals** tab is theirs
to see.

This is enforced in the database, not in the UI. The browser holds an anon key
and can run its own queries, so a number left out of a React component is not
hidden at all — the fix has to be that the row never leaves Postgres:

- `profiles` is readable only by its owner. The policy that let challenge-mates
  read it is gone, as are the ones on `weigh_ins`, `monthly_goals` and
  `daily_advice`.
- Everything the app needs about someone else comes through **`player_cards`**, a
  view gated by the same `can_see()` hub-and-spoke rule as everything else.
- `get_arena()` returns your own profile and goals in full, and everyone else as
  a card.
- A goal still changes what you are scored against, so `publishedTargets()` folds
  it into your card before writing it. A rival scores your day against a 150 g
  protein aim without ever reading the goal that set it.

The one figure that crosses challenges is the count at the top of **Versus**: how
many people are in a running challenge anywhere. It comes from a `security
definer` function that returns a single integer, never a row.

Publishing the *targets* but not the *body* is a deliberate line. Relative
scoring is meaningless without the targets, and they are already implied by the
scoreboard — 450 kcal burned scoring 30 out of 35 says the burn target is about
525 whether or not we say so. Height and weight are implied by nothing.

The three published numbers live in `profiles.target_*`, written by the app from
`deriveTargets()` whenever a profile is saved, a weigh-in lands, or a page load
notices they have drifted. The formula therefore exists **once**, in TypeScript.
Mirroring it in SQL would guarantee the two versions diverge.

---

## Why they're ahead: the protein breakdown

The score says who won. The **Versus** tab says what won it.

If you ate dal and they ate chole, `compareProtein()` in `src/lib/versus.ts`
folds both sides' logged items into one entry per food, diffs them, and names
the plate:

> **Riya is 13 g ahead, mostly on chole**
> Riya's chole is 100% of the difference — 22 g, and you had none. Their chole
> carries 11.6 g of protein per 100 kcal; your rice carries 2. Spending the same
> 200 kcal on chole instead would have added about 19.2 g — 100% of the gap.

Both sides are shown as a percentage of *their own* protein target, because
130 g means different things to a 60 kg runner and a 95 kg lifter.

The swap is chosen on protein per 100 kcal — the trade a person can actually
make. "Swap a katori of dal for chole" is a decision; "eat 40 g more protein" is
not.

It is arithmetic, not a language model. Both meals were already broken into
items with macros when they were logged, so the difference is a subtraction over
data we hold: exact, reproducible, and free.

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

Editing a parsed item re-prices it. Quantity is a multiplier over everything the
food carries, so changing one katori to two doubles the calories and the macros
with it — the workout side has always recomputed burn on edit, and food now
matches. Meal micronutrients are stored for the whole meal rather than per item,
so they move in proportion to the meal's calories; that is an approximation and
the panel says so.

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

**Or skip it entirely.** The workout tab has an *I know the calories* mode: type
the number off the treadmill, the watch or the class, add the minutes if you have
them, save. No model in the loop, no round trip, and the number you type is the
number that is stored. The MET is back-computed from it so the stored session
stays internally consistent with everything the app parsed itself.

---

## Commands

```bash
npm run dev     # dev server
npm run build   # production build
npm test        # scoring + analysis checks, no deps
```

`npm test` runs both suites under `node --experimental-strip-types`. That is why
relative imports inside `src/lib` carry an explicit `.ts` extension: Node's
resolver does no extension guessing, so without it the modules cannot be executed
directly. TypeScript allows it via `allowImportingTsExtensions`, and the bundler
does not care.

## Layout

```
src/lib/scoring.ts    the scoreboard — all weights live here
src/lib/calc.ts       BMR, BMI, targets, the weight plan, MET burn, local dates
src/lib/versus.ts     why they are ahead on protein, food by food
src/lib/limits.ts     every ceiling, in one list
src/lib/progress.ts   the forward/back walk and the pace marker
src/lib/goals.ts      monthly goal progress, shared by Today and Goals
src/lib/hydration.ts  the water aim, the pace against the clock, the bottle
src/lib/portions.ts   re-pricing a meal when you edit a portion
src/lib/gemini.ts     prompts + schemas, server-only
src/lib/data.ts       loads everyone and derives every score, in one round trip
src/app/(app)/        Today · Versus · Log · Goals · Me
supabase/schema.sql   tables, RLS, views, helper functions
```

**Today is yours alone** — your score, your ceilings, your plan, your goals. No
rival appears on it. Comparison lives on **Versus**, where you go when you want
it. A dashboard that opens with someone else's number is a dashboard about
someone else.

## Deploying

**Run `supabase/schema.sql` before you deploy the code.** There is no longer a
query-by-query fallback for an un-migrated database: the old path read
`select * from profiles` for every member, which Postgres now refuses and which
would have handed out exactly the numbers this release keeps private. A build
talking to an old database says so plainly instead of quietly degrading.

Any Node host works. Given the existing Cloud Run setup: build the image,
deploy with **min-instances 0** so it scales to zero and stays free, and set
`GEMINI_API_KEY` + the two Supabase vars as service env vars.
