/**
 * The new reasoning: targets you can set by hand, a weight plan with a date,
 * the ceilings that turn red, the forward/back walk, and the protein
 * comparison that names the food.
 *
 * Same shape as scoring.test.ts — no framework, no dependencies, runs under
 * `node --experimental-strip-types`.
 */
import {
  ageFrom, bmi, bmiBand, bmr, cardTargets, daysBetween, deriveTargets, publishedTargets,
  weightPlan, MICRO_REFS, microTarget, PLAN_LIMITS, KCAL_PER_KG,
  REFERENCE_KCAL, REFERENCE_WEIGHT_KG, type DerivedTargets,
} from "../src/lib/calc.ts";
import { breachedLimits, trackedLimits } from "../src/lib/limits.ts";
import { buildPace, dayMovement } from "../src/lib/progress.ts";
import { compareProtein, foldSources } from "../src/lib/versus.ts";
import {
  dayElapsed, hydration, litres, waterCeilingMl, waterTarget, HYDRATION,
} from "../src/lib/hydration.ts";
import { scoreDay } from "../src/lib/scoring.ts";
import { emptyDailyTotals, type DailyTotals, type Profile } from "../src/lib/types.ts";

let fails = 0;
const check = (name: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`}`);
};

const TODAY = "2026-09-09";

const person = (over: Partial<Profile> = {}): Profile => ({
  id: "u", display_name: "Sam", avatar_emoji: "🔥",
  sex: "male", birth_date: "1994-01-01", height_cm: 178, weight_kg: 80,
  activity_level: "moderate", goal: "cut", timezone: "Asia/Kolkata",
  onboarded: true, active_challenge_id: null, created_at: "2026-01-01",
  bmr_override: null, kcal_target_override: null,
  protein_target_g: null, carbs_target_g: null, fat_target_g: null, fiber_target_g: null,
  burn_target_override: null, minutes_target_override: null, water_target_ml: null,
  target_micros: null,
  weight_goal_kg: null, weight_goal_date: null,
  weight_goal_start_kg: null, weight_goal_set_on: null,
  target_kcal: null, target_protein_g: null, target_burn_kcal: null,
  target_active_minutes: null,
  ...over,
});

const T = (o: Partial<DailyTotals> = {}): DailyTotals =>
  ({ ...emptyDailyTotals("u", TODAY), ...o });

/* ===================== body maths ===================== */

check("BMI is weight over height squared", bmi(178, 80), 25.2);
check("BMI needs both numbers", bmi(null, 80), null);
check("Asian cut-offs put 25.2 above the healthy range", bmiBand(25.2), "over");
check("22 is healthy", bmiBand(22), "healthy");
check("days between counts forward", daysBetween("2026-09-09", "2026-09-23"), 14);
check("and backward", daysBetween("2026-09-23", "2026-09-09"), -14);

/* ===================== manual overrides ===================== */

// The equation itself, on fixed inputs. Everything below is checked against
// the same primitives rather than a hard-coded number, so a birthday does not
// break the suite.
check("Mifflin-St Jeor: 32-year-old man, 80 kg, 178 cm",
  bmr({ sex: "male", weightKg: 80, heightCm: 178, age: 32 }), 1758);

const auto = deriveTargets(person(), TODAY)!;
const ownBmr = bmr({ sex: "male", weightKg: 80, heightCm: 178, age: ageFrom("1994-01-01")! });
check("the resting burn comes from the equation", auto.bmr, ownBmr);
check("maintenance applies the activity factor", auto.tdee, Math.round(ownBmr * 1.55));
check("a cut takes 500 off maintenance", auto.kcalTarget, auto.tdee - 500);
check("protein is 2 g/kg on a cut", auto.proteinTarget, 160);
check("and the basis says it was calculated", auto.basis.bmr, "formula");

const manualBmr = deriveTargets(person({ bmr_override: 1900 }), TODAY)!;
check("a manual BMR replaces the equation", manualBmr.bmr, 1900);
check("and everything scales from it", manualBmr.tdee, Math.round(1900 * 1.55));
check("the basis says so", manualBmr.basis.bmr, "manual");

const manualMacros = deriveTargets(
  person({ kcal_target_override: 2000, protein_target_g: 170, carbs_target_g: 200, fat_target_g: 60 }),
  TODAY,
)!;
check("a manual calorie target wins", manualMacros.kcalTarget, 2000);
check("a manual protein target wins", manualMacros.proteinTarget, 170);
check("manual carbs are carried through", manualMacros.carbsTarget, 200);
check("and are marked manual", manualMacros.basis.kcal, "manual");

// A blank override must hand the number back to the formula.
check("clearing an override restores the formula",
  deriveTargets(person({ kcal_target_override: null }), TODAY)!.kcalTarget, auto.kcalTarget);

// Someone with a measured BMR but no height still gets targets.
check("a manual BMR is enough without height",
  deriveTargets(person({ height_cm: null, sex: null, birth_date: null, bmr_override: 1700 }), TODAY) !== null,
  true);
check("but nothing can be derived from nothing",
  deriveTargets(person({ height_cm: null, sex: null, birth_date: null }), TODAY), null);

/* ===================== the weight plan ===================== */

// 2 kg in 14 days = 15,400 kcal = 1,100/day, which is past the safety rail.
const fast = weightPlan(
  { weight_kg: 80, weight_goal_kg: 78, weight_goal_date: "2026-09-23",
    weight_goal_start_kg: 80, weight_goal_set_on: TODAY },
  TODAY, 2800, 1800,
)!;
check("it asks for what the date needs", fast.requestedDailyDelta, -1100);
check("but clamps to a quarter of maintenance",
  fast.dailyDelta, -Math.round(2800 * PLAN_LIMITS.maxDeficitShareOfTdee));
check("and says it was clamped", fast.clamped, true);
check("and gives a realistic date instead", fast.arrivesOn > "2026-09-23", true);
check("the note explains the change", /not a safe pace/.test(fast.note ?? ""), true);

// A sane pace should pass through untouched.
const sane = weightPlan(
  { weight_kg: 80, weight_goal_kg: 78, weight_goal_date: "2026-11-08",
    weight_goal_start_kg: 80, weight_goal_set_on: TODAY },
  TODAY, 2800, 1800,
)!;
check("a reasonable pace is not clamped", sane.clamped, false);
check("2 kg over 60 days is about 257 kcal a day", sane.dailyDelta, -257);
check("which is a quarter-kilo a week", sane.kgPerWeek, 0.23);
check("and keeps the date asked for", sane.arrivesOn, "2026-11-08");

check("no plan without a date",
  weightPlan({ weight_kg: 80, weight_goal_kg: 75, weight_goal_date: null,
    weight_goal_start_kg: null, weight_goal_set_on: null }, TODAY, 2800, 1800), null);
check("no plan once you are there",
  weightPlan({ weight_kg: 80, weight_goal_kg: 80, weight_goal_date: "2026-12-01",
    weight_goal_start_kg: 80, weight_goal_set_on: TODAY }, TODAY, 2800, 1800), null);

// Gaining works the same way, in the other direction.
const bulk = weightPlan(
  { weight_kg: 70, weight_goal_kg: 73, weight_goal_date: "2026-12-08",
    weight_goal_start_kg: 70, weight_goal_set_on: TODAY },
  TODAY, 2600, 1700,
)!;
check("a gain plan asks for a surplus", bulk.dailyDelta > 0, true);
check("and is capped at the surplus limit", bulk.dailyDelta <= PLAN_LIMITS.maxSurplusKcal, true);

// The plan must actually move the calorie target the score uses.
const planned = deriveTargets(person({
  weight_goal_kg: 78, weight_goal_date: "2026-11-08",
  weight_goal_start_kg: 80, weight_goal_set_on: TODAY,
}), TODAY)!;
check("the plan sets the calorie target", planned.kcalTarget, auto.tdee - 257);
check("and the basis says where it came from", planned.basis.kcal, "plan");
check("intake never falls below the floor",
  deriveTargets(person({ weight_goal_kg: 60, weight_goal_date: "2026-10-01",
    weight_goal_start_kg: 80, weight_goal_set_on: TODAY }), TODAY)!.kcalTarget
    >= Math.max(PLAN_LIMITS.absoluteFloorKcal, Math.round(auto.bmr * PLAN_LIMITS.floorShareOfBmr)),
  true);

/* ===================== what a rival may see ===================== */

const published = publishedTargets(person(), TODAY);
check("publishes targets and nothing else", Object.keys(published).sort(),
  ["target_active_minutes", "target_burn_kcal", "target_kcal", "target_micros",
   "target_protein_g"]);
// The aims are published; the sex and weight they were computed FROM are not.
check("the published aims are a bag of numbers", 
  Object.values(published.target_micros ?? {}).every((v) => typeof v === "number" && v > 0), true);
check("and they match the derived ones", published.target_protein_g, auto.proteinTarget);

const card = cardTargets({
  id: "them", display_name: "Riya", avatar_emoji: "⚡", created_at: "2026-01-01",
  target_kcal: 1800, target_protein_g: 110, target_burn_kcal: 300,
  target_active_minutes: 55, target_micros: null,
})!;
check("a card scores against its own published targets", card.kcalTarget, 1800);
check("a card carries no body at all", [card.bmi, card.plan], [null, null]);
check("an un-onboarded card has no targets",
  cardTargets({ id: "x", display_name: "x", avatar_emoji: "x", created_at: "",
    target_kcal: null, target_protein_g: null, target_burn_kcal: null,
    target_active_minutes: null, target_micros: null }), null);

/* ===================== ceilings ===================== */

const limitTargets = { kcalTarget: 2200, carbsTarget: 220, fatTarget: 65 };

const bigDay = T({
  meals: 3, kcal_in: 2600, carbs_g: 240, fat_g: 60,
  satfat_g: 31, sodium_mg: 2900, sugar_g: 20,
});
const breached = breachedLimits(bigDay, "male", limitTargets);
const keys = breached.map((b) => b.key);
check("saturated fat over the limit is flagged", keys.includes("satfat_g"), true);
check("so is sodium", keys.includes("sodium_mg"), true);
check("so are calories", keys.includes("kcal"), true);
check("and a manual carb ceiling", keys.includes("carbs_g"), true);
check("sugar well under is not mentioned", keys.includes("sugar_g"), false);
check("worst offender comes first", breached[0].pct >= breached[1].pct, true);
// The saturated fat ceiling is 10% of the calorie target, so it is 24 g at
// 2,200 kcal rather than a flat 22 g for everybody.
check("it says how far over", breached.find((b) => b.key === "satfat_g")!.over, 7);
check("and the ceiling itself came from the calorie target",
  breached.find((b) => b.key === "satfat_g")!.limit, Math.round((2200 * 0.10) / 9));

// 90% of a ceiling is a warning, not an alarm.
const nearly = breachedLimits(T({ meals: 2, satfat_g: 21 }), "male", null);
check("nearly at the limit is amber", nearly[0].state, "close");
check("and reports nothing over", nearly[0].over, 0);

check("an empty day flags nothing", breachedLimits(T(), "male", limitTargets).length, 0);
check("a zeroed ceiling is not tracked at all",
  trackedLimits(bigDay, "male", { kcalTarget: 2200, carbsTarget: 0, fatTarget: 0 })
    .some((l) => l.key === "fat_g"),
  false);

/* ===================== forward or back ===================== */

const paceTargets: DerivedTargets = { ...auto };

// Ate on target, trained as expected: that is the planned deficit, forward.
check("a day on target is a step forward",
  dayMovement(T({ kcal_in: auto.kcalTarget, kcal_out: auto.burnTarget }), paceTargets, "lose"),
  auto.tdee - auto.kcalTarget);

// Training beyond the target counts again; training inside it does not double up.
check("extra training adds to the day",
  dayMovement(T({ kcal_in: auto.kcalTarget, kcal_out: auto.burnTarget + 300 }), paceTargets, "lose"),
  auto.tdee - auto.kcalTarget + 300);

check("a blowout is a step back",
  dayMovement(T({ kcal_in: 4000, kcal_out: auto.burnTarget }), paceTargets, "lose") < 0, true);

check("bulking flips the sign",
  dayMovement(T({ kcal_in: 4000, kcal_out: auto.burnTarget }), paceTargets, "gain") > 0, true);

const days = ["2026-09-05", "2026-09-06", "2026-09-07", "2026-09-08", "2026-09-09"];
const totals = new Map<string, DailyTotals>([
  ["2026-09-05", T({ meals: 3, kcal_in: 2000, kcal_out: 500, sessions: 1 })],
  ["2026-09-06", T({ meals: 3, kcal_in: 3600, kcal_out: 0 })],
  ["2026-09-07", T({ meals: 3, kcal_in: 2100, kcal_out: 400, sessions: 1 })],
  ["2026-09-08", T({ meals: 3, kcal_in: 2764, kcal_out: 414 })],
]);
const pace = buildPace({ days, totals, targets: paceTargets, today: TODAY })!;
check("every day in the window gets a step", pace.steps.length, 5);
check("good days step forward", pace.forwardDays, 2);
check("the blowout steps back", pace.backDays, 1);
check("an unlogged day is flat, not skipped",
  pace.steps.find((s) => s.date === TODAY)!.direction, "flat");
check("a day that lands on maintenance is flat",
  pace.steps.find((s) => s.date === "2026-09-08")!.direction, "flat");
check("progress is the sum, in kg",
  pace.achievedKg,
  Math.round((pace.steps.reduce((a, s) => a + s.kcal, 0) / KCAL_PER_KG) * 100) / 100);
check("the detail names the days", /forward/.test(pace.detail), true);

/* ===================== the protein comparison ===================== */

// Two people, one lunch each. This is the chole-and-dal case.
const mineItems = [
  { user_id: "me", date: TODAY, name: "Dal tadka", protein_g: 9, kcal: 180 },
  { user_id: "me", date: TODAY, name: "Rice", protein_g: 4, kcal: 200 },
  { user_id: "me", date: TODAY, name: "Roti", protein_g: 6, kcal: 210 },
];
const theirItems = [
  { user_id: "you", date: TODAY, name: "Chole", protein_g: 22, kcal: 190 },
  { user_id: "you", date: TODAY, name: "Rice", protein_g: 4, kcal: 200 },
  { user_id: "you", date: TODAY, name: "Roti", protein_g: 6, kcal: 210 },
];

const cmp = compareProtein({
  mineItems, theirItems, mineTarget: 160, theirTarget: 120, theirName: "Riya",
});

check("the gap is the difference in grams", cmp.gapG, 13);
check("the food that caused it is named first", cmp.theirEdge[0].name, "Chole");
check("shared foods are not part of the difference",
  cmp.theirEdge.some((l) => l.name === "Rice"), false);
check("the headline names the food", /chole/i.test(cmp.headline), true);
check("each side is measured against their own target",
  [Math.round(cmp.minePct * 100), Math.round(cmp.theirsPct * 100)], [12, 27]);
check("points use the score's own protein weighting", cmp.theirsPoints > cmp.minePoints, true);

check("the swap trades one of your foods for one of theirs", cmp.swap!.to.name, "Chole");
check("and it is the low-density food that goes", cmp.swap!.from.name, "Rice");
check("the swap gains real grams", cmp.swap!.gainG > 0, true);
check("and the sentence says both densities",
  /per 100 kcal/.test(cmp.swap!.text) && /chole/i.test(cmp.swap!.text), true);
check("the explanation quantifies the share", /% of the difference/.test(cmp.explain), true);

// Being ahead reads as being ahead, not as a scolding.
const ahead = compareProtein({
  mineItems: theirItems, theirItems: mineItems, mineTarget: 120, theirTarget: 160, theirName: "Riya",
});
check("leading is reported as leading", /you are 13 g of protein ahead/i.test(ahead.headline), true);
check("and offers no swap", ahead.swap, null);

const nothing = compareProtein({
  mineItems: [], theirItems: [], mineTarget: 150, theirTarget: 150, theirName: "Riya",
});
check("nothing logged is handled", nothing.empty, true);
// The card now fills as soon as EITHER side logs, so the empty copy must not
// tell people to wait for both.
check("and says something useful", /either of you logs/i.test(nothing.explain), true);
check("and does not ask for both", /both/i.test(nothing.explain), false);

// The same food logged at two meals is one line, summed.
const folded = foldSources([
  { user_id: "me", date: TODAY, name: "Curd", protein_g: 6, kcal: 90 },
  { user_id: "me", date: TODAY, name: "curd ", protein_g: 6, kcal: 90 },
]);
check("names fold case- and space-insensitively", folded.size, 1);
check("and their protein adds up", folded.get("curd")!.protein, 12);
check("density is protein per 100 kcal", folded.get("curd")!.density, 6.7);

// The pace marker must not chase you. It is the rate the plan asked for on
// the day it was set, so falling behind shows as falling behind.
const planned14 = deriveTargets(person({
  weight_goal_kg: 78, weight_goal_date: "2026-09-23",
  weight_goal_start_kg: 80, weight_goal_set_on: "2026-08-26",
}), TODAY)!;
const lazy = new Map<string, DailyTotals>(
  ["2026-09-05", "2026-09-06", "2026-09-07", "2026-09-08"].map((d) =>
    [d, T({ meals: 3, kcal_in: 3400, kcal_out: 0 })]),
);
const behind = buildPace({ days, totals: lazy, targets: planned14, today: TODAY })!;
check("the plan's own rate drives the marker",
  behind.paceKgPerDay, Math.round((2 / 28) * 100) / 100);
check("the journey is start weight to target", behind.totalKg, 2);
check("four blowout days read as behind pace", behind.aheadKg < 0, true);
check("and every one of them is a step back", behind.backDays, 4);

// Maintenance: drift in either direction is drift, and the words say so.
const holding = deriveTargets(person({ goal: "maintain" }), TODAY)!;
const steady = buildPace({
  days,
  totals: new Map(days.slice(0, 4).map((d) =>
    [d, T({ meals: 3, kcal_in: holding.kcalTarget, kcal_out: holding.burnTarget })])),
  targets: holding,
  today: TODAY,
})!;
check("holding the line is flat, not backward", steady.backDays, 0);
check("and reads as holding steady", steady.headline, "Holding steady");
check("the wording drops 'forward' for maintenance", /held/.test(steady.detail), true);


/* ===================== water ===================== */

// The aim scales with the body, like everything else here.
const dryDay = waterTarget(person(), T());
check("33 ml per kg for an 80 kg body", dryDay.baseMl, 2650);
check("a rest day adds nothing for training", dryDay.exerciseMl, 0);
check("and the total is just the base", dryDay.totalMl, 2650);

const lighter = waterTarget(person({ weight_kg: 52 }), T());
check("a smaller body gets a smaller aim", lighter.baseMl, 1700);
check("but never below the floor",
  waterTarget(person({ weight_kg: 30 }), T()).baseMl, HYDRATION.minTargetMl);
check("nor above the ceiling",
  waterTarget(person({ weight_kg: 200 }), T()).baseMl, HYDRATION.maxTargetMl);

// Training adds sweat replacement — about a litre per 700 kcal burned.
const trained = waterTarget(person(), T({ kcal_out: 700, sessions: 1 }));
check("700 kcal of training asks for a litre more", trained.exerciseMl, 1000);
check("which lands on the total", trained.totalMl, 3650);
check("the add-on is capped",
  waterTarget(person(), T({ kcal_out: 5000, sessions: 1 })).exerciseMl,
  HYDRATION.maxExerciseAddMl);

// A typed target is taken exactly as typed, training day or not.
const manualWater = waterTarget(person({ water_target_ml: 3000 }), T({ kcal_out: 900 }));
check("a manual aim is used verbatim", manualWater.totalMl, 3000);
check("and does not quietly grow on a training day", manualWater.exerciseMl, 0);
check("and says where it came from", manualWater.source, "manual");

// Pacing: the clock is half the question.
check("nothing has elapsed before waking", dayElapsed(6), 0);
check("half the drinking day by 3pm", dayElapsed(15), 0.5);
check("all of it by midnight", dayElapsed(24), 1);

const target2L = { baseMl: 2000, exerciseMl: 0, totalMl: 2000, source: "derived" as const };

// A litre at 3pm is exactly on the pace; the same litre at 10pm is not.
check("on the pace reads as on track", hydration(1000, target2L, 15).status, "on-track");
check("the same amount late is behind", hydration(1000, target2L, 22).status, "low");
check("nothing all day is short", hydration(0, target2L, 20).status, "low");
check("early and eager is ahead", hydration(900, target2L, 10).status, "ahead");
check("hitting the aim is met", hydration(2000, target2L, 20).status, "met");
check("and stays met just over it", hydration(2400, target2L, 20).status, "met");

// Passing the aim must never be scolded; genuinely excessive is flagged.
check("1.75x the aim is where it becomes too much",
  hydration(2000 * HYDRATION.excessMultiple, target2L, 20).status, "over");
check("the ceiling sits well clear of the goal",
  waterCeilingMl(target2L) > target2L.totalMl * 1.5, true);

const midday = hydration(600, target2L, 15);
check("what is expected by now is paced", midday.expectedMl, 1000);
check("and the shortfall is named", midday.aheadMl, -400);
check("remaining is what is left", midday.remainingMl, 1400);
check("in glasses you can actually drink", midday.glassesLeft, 6);
check("the guidance says how far behind", /400 ml behind/.test(midday.guidance), true);

check("a full bottle has nothing left", hydration(2000, target2L, 20).remainingMl, 0);
check("the fraction drives the fill", hydration(1500, target2L, 15).fraction, 0.75);
check("a negative reading cannot happen", hydration(-500, target2L, 12).drankMl, 0);

check("small amounts read in millilitres", litres(400), "400 ml");
check("large ones in litres", litres(2650), "2.65 L");
check("and round numbers stay round", litres(2000), "2 L");

// The water ceiling only reaches the alert block when it is genuinely high.
const wetDay = T({ meals: 3, water_ml: 4000 });
const withWater = { kcalTarget: 2200, carbsTarget: 0, fatTarget: 0,
                    waterCeilingMl: waterCeilingMl(target2L) };
check("4 L against a 2 L aim is flagged",
  breachedLimits(wetDay, "male", withWater).some((l) => l.key === "water_ml"), true);
check("but hitting the aim is not",
  breachedLimits(T({ meals: 3, water_ml: 2000 }), "male", withWater)
    .some((l) => l.key === "water_ml"), false);
check("and a water-only day still reports water",
  breachedLimits(T({ water_ml: 4000 }), "male", withWater).map((l) => l.key), ["water_ml"]);
check("without dragging every food ceiling in with it",
  breachedLimits(T({ water_ml: 4000 }), "male", withWater).length, 1);


/* ===================== targets follow the goal, not a table ===================== */

// The macro split divides YOUR calorie target, and follows the goal.
const cutting = deriveTargets(person({ goal: "cut" }), TODAY)!;
const bulking = deriveTargets(person({ goal: "bulk" }), TODAY)!;

check("protein, carbs and fat add back up to the calorie target",
  Math.abs((cutting.proteinTarget * 4 + cutting.carbsTarget * 4 + cutting.fatTarget * 9)
    - cutting.kcalTarget) <= 12, true);
check("a bulk eats more carbs than a cut", bulking.carbsTarget > cutting.carbsTarget, true);
check("and takes a smaller share of its calories from fat",
  bulking.fatTarget * 9 / bulking.kcalTarget < cutting.fatTarget * 9 / cutting.kcalTarget, true);
check("fibre follows what you actually eat",
  cutting.fiberTarget, Math.round((cutting.kcalTarget / 1000) * 14));
check("a bigger intake asks for more fibre", bulking.fiberTarget > cutting.fiberTarget, true);

// Fat has a floor that calories cannot argue with.
const crashing = deriveTargets(person({ kcal_target_override: 1300 }), TODAY)!;
check("fat never drops below 0.6 g/kg", crashing.fatTarget >= Math.round(80 * 0.6), true);
check("and carbs absorb the squeeze", crashing.carbsTarget < cutting.carbsTarget, true);

// Typed values still win outright.
const handSet = deriveTargets(person({ carbs_target_g: 150, fat_target_g: 70, fiber_target_g: 40 }), TODAY)!;
check("a manual carb figure is used as given", handSet.carbsTarget, 150);
check("so is fat", handSet.fatTarget, 70);
check("so is fibre", handSet.fiberTarget, 40);

// Micronutrients scale three different ways, each for a reason.
const ref = (key: string) => MICRO_REFS.find((r) => r.key === key)!;
const ctx = (over: Partial<{ kcalTarget: number; weightKg: number | null; exerciseKcal: number }> = {}) =>
  ({ kcalTarget: 2200, weightKg: 80, exerciseKcal: 0, ...over });

check("with no context at all, the flat reference figure stands",
  microTarget(ref("satfat_g"), "male"), 22);

// The invariant that makes the whole model legible: a reference body, eating
// the reference intake, resting, gets exactly the figure in the book. Every
// number on the screen is a departure from that, and you can say why.
for (const r of MICRO_REFS) {
  const atReference = microTarget(r, "male",
    { kcalTarget: REFERENCE_KCAL, weightKg: REFERENCE_WEIGHT_KG.male, exerciseKcal: 0 });
  check(`${r.label} at the reference body and intake is the book figure`,
    Math.abs(atReference - r.male) <= 0.6, true);
}

// Nothing is frozen any more: every nutrient responds to something.
for (const r of MICRO_REFS) {
  const big = microTarget(r, "male", ctx({ weightKg: 110, kcalTarget: 3200, exerciseKcal: 700 }));
  const small = microTarget(r, "male", ctx({ weightKg: 52, kcalTarget: 1500, exerciseKcal: 0 }));
  check(`${r.label} responds to the person`, big > small, true);
}

// energy: the ceilings that are literally a share of intake
check("added sugar is 10% of your calories",
  microTarget(ref("sugar_g"), "male", ctx()), Math.round((2200 * 0.10) / 4));
check("so a bigger eater gets a bigger sugar allowance",
  microTarget(ref("sugar_g"), "male", ctx({ kcalTarget: 3200 }))
    > microTarget(ref("sugar_g"), "male", ctx({ kcalTarget: 1800 })), true);

// body: strongest where the source tables derive the figure from bodyweight
check("iron scales past the reference body",
  microTarget(ref("iron_mg"), "male", ctx({ weightKg: 95 })) > 19, true);
check("and down below it",
  microTarget(ref("iron_mg"), "male", ctx({ weightKg: 55 })) < 19, true);
check("fully, since the table is written per kg",
  microTarget(ref("iron_mg"), "male", { kcalTarget: REFERENCE_KCAL, weightKg: 78, exerciseKcal: 0 }),
  Math.round(19 * (78 / 65) * 10) / 10);
check("but the scaling is bounded",
  microTarget(ref("iron_mg"), "male", ctx({ weightKg: 200, kcalTarget: REFERENCE_KCAL })),
  Math.round(19 * 1.6 * 10) / 10);
check("and women scale against the women's reference body",
  microTarget(ref("iron_mg"), "female",
    { kcalTarget: REFERENCE_KCAL, weightKg: REFERENCE_WEIGHT_KG.female, exerciseKcal: 0 }), 29);

// sweat: what you lost training today
const restingSodium = microTarget(ref("sodium_mg"), "male", ctx());
check("a hard session raises the sodium ceiling",
  microTarget(ref("sodium_mg"), "male", ctx({ exerciseKcal: 800 })), restingSodium + 480);
check("but only so far",
  microTarget(ref("sodium_mg"), "male", ctx({ exerciseKcal: 9000 })), restingSodium + 1200);
check("potassium rises with it too",
  microTarget(ref("potassium_mg"), "male", ctx({ exerciseKcal: 800 }))
    > microTarget(ref("potassium_mg"), "male", ctx()), true);
check("and a bigger body carries a slightly higher sodium ceiling even at rest",
  restingSodium > 2300, true);

// The weakly-evidenced ones move, but gently and within a tight band — the
// coefficient is where the strength of the evidence is encoded.
const b12Big = microTarget(ref("vitamin_b12_ug"), "male",
  ctx({ weightKg: 120, exerciseKcal: 1500, kcalTarget: 4000 }));
check("B12 moves rather than sitting frozen", b12Big > 2.4, true);
check("but is held to a narrow band, since absorption is the real limit",
  b12Big <= 2.4 * 1.25 + 0.05, true);
check("iron moves far more than B12 for the same person",
  (microTarget(ref("iron_mg"), "male", ctx({ weightKg: 120 })) / 19)
    > (b12Big / 2.4), true);

/* ===================== the last absolute target ===================== */

check("active minutes come from your own burn target",
  auto.minutesTarget, Math.round(auto.burnTarget / ((5 * 3.5 * 80) / 200)));

// The interesting part: minutes-to-target is nearly weight-independent,
// because a heavier body burns proportionally more per minute AND carries a
// proportionally larger burn target. What moves it is the part that is
// genuinely yours.
const heavy = deriveTargets(person({ weight_kg: 110, height_cm: 190 }), TODAY)!;
const light = deriveTargets(person({ weight_kg: 52, height_cm: 158, sex: "female" }), TODAY)!;
check("two very different bodies land within ten minutes of each other",
  Math.abs(heavy.minutesTarget - light.minutesTarget) <= 10, true);

const sedentary = deriveTargets(person({ activity_level: "sedentary" }), TODAY)!;
const veryActive = deriveTargets(person({ activity_level: "very_active" }), TODAY)!;
check("but activity level moves it properly",
  veryActive.minutesTarget > sedentary.minutesTarget, true);
check("a manual figure wins outright",
  deriveTargets(person({ minutes_target_override: 40 }), TODAY)!.minutesTarget, 40);
check("and is marked manual",
  deriveTargets(person({ minutes_target_override: 40 }), TODAY)!.basis.minutes, "manual");
check("the target is bounded either way",
  deriveTargets(person({ burn_target_override: 5000 }), TODAY)!.minutesTarget <= 90, true);

// It has to reach the score, and be scored relatively.
const minuteTargets = { burnTarget: 400, proteinTarget: 150, kcalTarget: 2200, minutesTarget: 40 };
const halfDone = scoreDay(T({ active_minutes: 20, sessions: 1 }), "d", 0, minuteTargets);
check("half your own minutes target is half the points",
  halfDone.lines.find((l) => l.key === "minutes")!.points, 5);
check("and the line says what it was measured against",
  halfDone.lines.find((l) => l.key === "minutes")!.detail, "20 / 40 min");
check("hitting it maxes the line",
  scoreDay(T({ active_minutes: 40, sessions: 1 }), "d", 0, minuteTargets)
    .lines.find((l) => l.key === "minutes")!.points, 10);

// A card published before this existed must not score zero minutes.
const legacy = { burnTarget: 400, proteinTarget: 150, kcalTarget: 2200 };
check("no published target falls back to the flat hour",
  scoreDay(T({ active_minutes: 60, sessions: 1 }), "d", 0, legacy)
    .lines.find((l) => l.key === "minutes")!.points, 10);


console.log(fails === 0 ? "\nAll analysis checks passed." : `\n${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);
