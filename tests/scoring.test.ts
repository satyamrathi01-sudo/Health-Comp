import { scoreDay, streakEndingAt, dayOutcome, MAX_BASE_SCORE } from "../src/lib/scoring.ts";
import { emptyDailyTotals } from "../src/lib/types.ts";

const T = (o: Partial<any> = {}) => ({ ...emptyDailyTotals("u", "2026-09-07"), ...o });

let fails = 0;
const check = (name: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`}`);
};

console.log("MAX_BASE_SCORE =", MAX_BASE_SCORE);
check("max base is 100", MAX_BASE_SCORE, 100);

// 1. Empty day
check("empty day scores 0", scoreDay(null, "2026-09-07", 0).total, 0);
check("empty day not logged", scoreDay(null, "2026-09-07", 0).logged, false);

// 2. THE EXPLOIT: huge burn, zero food logged. Must NOT award net-calorie points.
const cheat = scoreDay(T({ kcal_out: 900, active_minutes: 90, sessions: 1 }), "2026-09-07", 0);
const netLine = cheat.lines.find((l) => l.key === "net")!;
check("no food => zero net points", netLine.points, 0);
// burn 25 (capped) + minutes 10 (capped) + protein 0 + net 0 + logging 5 (training only)
check("workout-only day total", cheat.total, 40);

// 3. A strong, complete day
const strong = scoreDay(
  T({ kcal_in: 2100, protein_g: 140, meals: 3, kcal_out: 500, active_minutes: 70, sessions: 1 }),
  "2026-09-07", 5,
);
// burn 25 + min 10 + protein 25 + net(2100-500=1600 => 0) + logging 10 = 70, +5 streak
check("strong day base", strong.base, 70);
check("strong day bonus", strong.bonus, 5);
check("strong day total", strong.total, 75);

// 4. Deficit day: eats less than burns
const deficit = scoreDay(
  T({ kcal_in: 400, protein_g: 60, meals: 2, kcal_out: 500, active_minutes: 60, sessions: 1 }),
  "2026-09-07", 0,
);
// burn 25 + min 10 + protein 12 + net(-100 <= 0 => 18) + logging 10 = 75
check("deficit day scores net max", deficit.base, 75);

// 5. Rest day earns the training half of logging, no burn
const rest = scoreDay(T({ kcal_in: 1800, protein_g: 100, meals: 3, is_rest_day: true }), "2026-09-07", 0);
// burn 0 + min 0 + protein 20 + net(1800 => 0) + logging 10 = 30
check("rest day with food", rest.base, 30);

// 6. Streak bonus caps at 10
check("streak caps at 10", scoreDay(T({ meals: 1 }), "2026-09-07", 40).bonus, 10);

// 7. streakEndingAt counts backwards, stops at a gap
const dates = new Set(["2026-09-07", "2026-09-06", "2026-09-05", "2026-09-03"]);
check("streak stops at gap", streakEndingAt(dates, "2026-09-07"), 3);
check("streak zero when today missing", streakEndingAt(dates, "2026-09-08"), 0);

// 8. Head-to-head outcomes
const a = scoreDay(T({ meals: 2, protein_g: 100 }), "2026-09-07", 0);
const b = scoreDay(T({ meals: 2, protein_g: 40 }), "2026-09-07", 0);
check("higher score wins", dayOutcome(a, b), "win");
check("lower score loses", dayOutcome(b, a), "loss");
check("equal scores draw", dayOutcome(a, a), "tie");
check("both empty => none", dayOutcome(scoreDay(null, "d"), scoreDay(null, "d")), "none");

// 9. Caps really cap
const monster = scoreDay(
  T({ kcal_in: 100, protein_g: 500, meals: 5, kcal_out: 5000, active_minutes: 400,
      sessions: 3, fiber_g: 200 }),
  "2026-09-07", 0,
);
// Raw mode cannot reach 100: ceilings and micronutrient aims only exist when
// targets are published, so 7 of the 100 are simply not on offer.
check("raw mode tops out at 93", monster.base, 93);
check("and says the limits line was not scored",
  monster.lines.find((l) => l.key === "limits")!.max, 0);
check("nor the micronutrient line",
  monster.lines.find((l) => l.key === "micros")!.max, 0);

// The real ceiling claim: with targets published, a perfect day is exactly
// MAX_BASE_SCORE. If a weight is ever changed without changing the total,
// this is the test that catches it.
const perfectTargets = {
  burnTarget: 400, proteinTarget: 150, kcalTarget: 2400, minutesTarget: 60,
  fibreTarget: 34,
  ceilings: [
    { key: "sugar_g", label: "Added sugar", limit: 60 },
    { key: "satfat_g", label: "Saturated fat", limit: 27 },
  ],
  microAims: [
    { key: "iron_mg", label: "Iron", atRest: 19, perSweat: 0, maxSweatAdd: 0 },
    { key: "zinc_mg", label: "Zinc", atRest: 17, perSweat: 0, maxSweatAdd: 0 },
  ],
};
const perfect = scoreDay(
  T({
    kcal_in: 2400, protein_g: 200, meals: 4, kcal_out: 600, active_minutes: 90,
    sessions: 2, fiber_g: 40, sugar_g: 10, satfat_g: 5, iron_mg: 25, zinc_mg: 20,
  }),
  "2026-09-07", 0, perfectTargets,
);
check("a perfect scored day is exactly MAX_BASE_SCORE", perfect.base, MAX_BASE_SCORE);

// Blowing a ceiling costs points; doubling it costs the whole share of them.
const sugary = scoreDay(
  T({ ...perfect.targets ? {} : {}, kcal_in: 2400, protein_g: 200, meals: 4, kcal_out: 600,
      active_minutes: 90, sessions: 2, fiber_g: 40, sugar_g: 120, satfat_g: 5,
      iron_mg: 25, zinc_mg: 20 }),
  "2026-09-07", 0, perfectTargets,
);
check("doubling a ceiling forfeits half the limits line",
  sugary.lines.find((l) => l.key === "limits")!.points, 2);
check("and the line names what went over",
  /added sugar/i.test(sugary.lines.find((l) => l.key === "limits")!.detail), true);

// Micronutrients are scored on the mean shortfall, not a count of aims hit.
const halfMicros = scoreDay(
  T({ kcal_in: 2400, protein_g: 200, meals: 4, fiber_g: 40, sugar_g: 10, satfat_g: 5,
      iron_mg: 19, zinc_mg: 0 }),
  "2026-09-07", 0, perfectTargets,
);
check("one aim of two met scores half the micro line",
  halfMicros.lines.find((l) => l.key === "micros")!.points, 1.5);
check("and reports the count", 
  halfMicros.lines.find((l) => l.key === "micros")!.detail, "1 of 2 aims met");

// The sweat term is added back from the day's own burn, which is what lets a
// rival's aim be reconstructed without publishing their body.
const sweatTargets = { ...perfectTargets, microAims: [
  { key: "sodium_mg", label: "Sodium", atRest: 100, perSweat: 0.5, maxSweatAdd: 400 },
]};
const sweaty = scoreDay(
  T({ kcal_in: 2400, meals: 2, kcal_out: 400, sodium_mg: 300 }), "2026-09-07", 0, sweatTargets,
);
// aim = 100 + min(400, 400*0.5) = 300, so 300 mg exactly meets it.
check("burn raises the aim it is measured against",
  sweaty.lines.find((l) => l.key === "micros")!.detail, "1 of 1 aims met");


// ---- score gap ----
import { compareScores } from "../src/lib/scoring.ts";

const strongDay = scoreDay(T({ kcal_in: 1800, protein_g: 140, meals: 3, kcal_out: 400, active_minutes: 60, sessions: 1 }), "d", 0);
const weakDay   = scoreDay(T({ kcal_in: 2400, protein_g: 60,  meals: 2, kcal_out: 100, active_minutes: 15, sessions: 1 }), "d", 0);

const gap = compareScores(strongDay, weakDay);
check("gap leader is me", gap.leader, "me");
check("gap delta matches totals", gap.delta, Math.round((strongDay.total - weakDay.total) * 10) / 10);
check("every line accounted for", gap.lines.length, strongDay.lines.length);
check("line deltas sum to total delta",
  Math.round(gap.lines.reduce((a, l) => a + l.delta, 0) * 10) / 10, gap.delta);
check("gains are all positive", gap.gains.every((l) => l.delta > 0), true);
check("drops are all negative", gap.drops.every((l) => l.delta < 0), true);
check("ordered by magnitude",
  gap.lines.every((l, i) => i === 0 || Math.abs(gap.lines[i - 1].delta) >= Math.abs(l.delta)), true);
check("protein gap has a concrete hint",
  /g more protein/.test(gap.lines.find((l) => l.key === "protein")?.toClose ?? ""), true);

const level = compareScores(strongDay, strongDay);
check("identical days are level", level.leader, "level");
check("identical days have no gains", level.gains.length, 0);


// ---- relative scoring: judged against each body's own targets ----

// A big man maintaining on ~2900 kcal, and a smaller woman on ~1700.
const BIG   = { burnTarget: 800, proteinTarget: 170, kcalTarget: 2400 };
const SMALL = { burnTarget: 300, proteinTarget: 100, kcalTarget: 1500 };

// The exact case that motivated this: 600 kcal burned should NOT beat 300
// when the 600 came from a body expected to burn far more.
const bigBurn   = scoreDay(T({ kcal_out: 600, sessions: 1 }), "d", 0, BIG);
const smallBurn = scoreDay(T({ kcal_out: 300, sessions: 1 }), "d", 0, SMALL);
const bigBurnLine   = bigBurn.lines.find((l) => l.key === "burn")!;
const smallBurnLine = smallBurn.lines.find((l) => l.key === "burn")!;

check("600/800 scores 75% of the burn max", bigBurnLine.points, 18.8);
check("300/300 scores the full burn max", smallBurnLine.points, 25);
check("smaller person burning less still wins the line",
  smallBurnLine.points > bigBurnLine.points, true);

// Hitting your own target is a full mark regardless of the absolute number.
check("big hitting 800 maxes burn",
  scoreDay(T({ kcal_out: 800, sessions: 1 }), "d", 0, BIG).lines.find((l) => l.key === "burn")!.points, 25);
// Beating an aim is free up to half again; past that the line falls to
// nothing at double, so no single line can be farmed.
const burnAt = (kcal: number) =>
  scoreDay(T({ kcal_out: kcal, sessions: 1 }), "d", 0, SMALL).lines.find((l) => l.key === "burn")!;
check("half again past the burn target is still full marks", burnAt(450).points, 25);
check("three-quarters past it scores half the line", burnAt(525).points, 12.5);
check("double the target scores nothing on the line", burnAt(600).points, 0);
check("and far past it cannot go below nothing", burnAt(5000).points, 0);
check("going too far is flagged, so hints say less rather than more", burnAt(525).over, true);
check("but beating the target inside the free zone is not", burnAt(450).over, false);

// Protein scales the same way.
check("85/170 protein scores half",
  scoreDay(T({ protein_g: 85, meals: 1 }), "d", 0, BIG).lines.find((l) => l.key === "protein")!.points, 12.5);
check("100/100 protein maxes",
  scoreDay(T({ protein_g: 100, meals: 1 }), "d", 0, SMALL).lines.find((l) => l.key === "protein")!.points, 25);
const proteinAt = (g: number) =>
  scoreDay(T({ protein_g: g, meals: 1 }), "d", 0, SMALL).lines.find((l) => l.key === "protein")!;
check("150 g against a 100 g target is still full marks", proteinAt(150).points, 25);
check("200 g against it scores nothing on the line", proteinAt(200).points, 0);
check("and the detail says it went way over", /way over/.test(proteinAt(180).detail), true);

// Calorie adherence punishes under-eating as well as over-eating.
const onTarget = scoreDay(T({ kcal_in: 2400, meals: 3 }), "d", 0, BIG).lines.find((l) => l.key === "net")!;
const wayUnder = scoreDay(T({ kcal_in: 1000, meals: 3 }), "d", 0, BIG).lines.find((l) => l.key === "net")!;
const wayOver  = scoreDay(T({ kcal_in: 3800, meals: 3 }), "d", 0, BIG).lines.find((l) => l.key === "net")!;
check("on target maxes calories", onTarget.points, 18);
check("under-eating is penalised", wayUnder.points < onTarget.points, true);
check("over-eating is penalised", wayOver.points < onTarget.points, true);

// Full marks only within 2%, then a straight line to nothing at 30% off.
// The day that prompted this: 2,526 against 2,391 used to score 18 of 18.
const kcalAt = (kcal: number, target = 2391) =>
  scoreDay(T({ kcal_in: kcal, meals: 3 }), "d", 0, { ...BIG, kcalTarget: target })
    .lines.find((l) => l.key === "net")!.points;
check("135 kcal over a 2,391 aim now costs points", kcalAt(2526), 15.7);
check("within 2% is still full marks", kcalAt(2430), 18);
check("3,000 kcal against 2,391 scores almost nothing", kcalAt(3000), 2.9);
check("30% off scores nothing, with no floor", kcalAt(Math.round(2391 * 1.3)), 0);
check("the same distance under costs the same as over", kcalAt(2391 - 135), kcalAt(2391 + 135));
check("no food still means no calorie points",
  scoreDay(T({ kcal_out: 500, sessions: 1 }), "d", 0, BIG).lines.find((l) => l.key === "net")!.points, 0);

// Active minutes stay absolute — an hour is an hour whoever you are.
check("minutes ignore body targets",
  scoreDay(T({ active_minutes: 60, sessions: 1 }), "d", 0, BIG).lines.find((l) => l.key === "minutes")!.points,
  scoreDay(T({ active_minutes: 60, sessions: 1 }), "d", 0, SMALL).lines.find((l) => l.key === "minutes")!.points);

// An incomplete profile must still produce a score.
check("no targets falls back to raw", scoreDay(T({ kcal_out: 350, sessions: 1 }), "d", 0, null).relative, false);
check("targets present marks the day relative", bigBurn.relative, true);
check("a zeroed target is treated as unusable",
  scoreDay(T({ kcal_out: 350, sessions: 1 }), "d", 0, { burnTarget: 0, proteinTarget: 0, kcalTarget: 0 }).relative, false);

// Gap hints must speak in the trailing player's own units.
const aheadDay  = scoreDay(T({ kcal_out: 300, sessions: 1 }), "d", 0, SMALL);
const behindDay = scoreDay(T({ kcal_out: 100, sessions: 1 }), "d", 0, SMALL);
const relGap = compareScores(behindDay, aheadDay);
const burnGap = relGap.lines.find((l) => l.key === "burn")!;
check("hint uses the small target, not the global constant",
  /200 kcal more/.test(burnGap.toClose ?? ""), true);

// When the trailing side lost the line by going too far, the hint says less.
const overDoer = scoreDay(T({ kcal_out: 560, sessions: 1 }), "d", 0, SMALL);
const onPlan   = scoreDay(T({ kcal_out: 300, sessions: 1 }), "d", 0, SMALL);
check("a hint for overdoing it asks for less, not more",
  /kcal less/.test(compareScores(overDoer, onPlan).lines.find((l) => l.key === "burn")!.toClose ?? ""),
  true);


// ---- projected impact of a suggestion ----
import { projectedGain } from "../src/lib/scoring.ts";

const day = T({ kcal_in: 1500, protein_g: 60, meals: 2, kcal_out: 150, active_minutes: 20, sessions: 1 });

const proteinGain = projectedGain({ component: "protein", amount: 40 }, day, 0, BIG);
check("adding protein is worth points", proteinGain > 0, true);
check("40g against a 170g target is ~5.9 pts", proteinGain, 5.9);

// Past the target the maths turns round. A little more is free; far past it,
// more burn is priced as a loss rather than as nothing.
const maxed = T({ kcal_out: 900, sessions: 1, meals: 1, protein_g: 200 });
check("a little more past the burn target costs nothing",
  projectedGain({ component: "burn", amount: 300 }, maxed, 0, BIG), 0);
check("far past it, more burn is priced as a loss",
  projectedGain({ component: "burn", amount: 500 }, maxed, 0, BIG) < 0, true);

// Sleep and micros are tracked but not scored — say zero rather than invent.
check("sleep is worth 0 points", projectedGain({ component: "sleep", amount: 1 }, day, 0, BIG), 0);
check("micros are worth 0 points", projectedGain({ component: "micros", amount: 1 }, day, 0, BIG), 0);

// Eating less moves you toward the target when you are over it.
const over = T({ kcal_in: 3400, meals: 3 });
check("cutting calories when over target helps",
  projectedGain({ component: "calories", amount: -900 }, over, 0, BIG) > 0, true);

// Logging the missing half of the day is worth exactly the logging points.
const foodOnly = T({ kcal_in: 2400, meals: 2, protein_g: 170 });
check("logging training adds the training half",
  projectedGain({ component: "logging", amount: 0 }, foodOnly, 0, BIG), 5);

// A projection must never exceed what the score could actually move by.
const beforeTotal = scoreDay(day, "d", 0, BIG).total;
check("projection cannot push past the ceiling",
  beforeTotal + projectedGain({ component: "protein", amount: 9999 }, day, 0, BIG) <= 110, true);


// ---- your own target decides the protein line ----
// A protein target set by hand must change the score, not just the number
// shown on the Goals tab.
const dayAt150 = T({ protein_g: 150, meals: 3 });
const easierTarget = scoreDay(dayAt150, "d", 0,
  { burnTarget: 390, proteinTarget: 150, kcalTarget: 2100 });
const harderTarget = scoreDay(dayAt150, "d", 0,
  { burnTarget: 390, proteinTarget: 200, kcalTarget: 2100 });
check("hitting your own target maxes protein",
  easierTarget.lines.find((l) => l.key === "protein")!.points, 25);
check("a harder target scores the same intake lower",
  harderTarget.lines.find((l) => l.key === "protein")!.points < 25, true);


// ---- recovery ----
import { computeRecovery } from "../src/lib/recovery.ts";

const REC_TARGETS = { burnTarget: 400, proteinTarget: 150, kcalTarget: 2200 };
const rec = (o: Partial<any> = {}) => computeRecovery({
  sleepHours: 8, sleepQuality: "good",
  yesterdayBurn: 0, yesterdayKcalIn: 2200, yesterdayProtein: 150,
  yesterdayLoggedFood: true, consecutiveTrainingDays: 0,
  targets: REC_TARGETS, ...o,
});

check("no sleep logged means no score", rec({ sleepHours: null }).score, null);
check("and says why", /Log your sleep/.test(rec({ sleepHours: null }).headline), true);

const rested = rec();
check("a full night, fed and rested scores high", rested.score! >= 90, true);
check("and is banded high", rested.band, "high");

check("four hours of sleep drags it down", rec({ sleepHours: 4 }).score! < rested.score!, true);
check("poor quality scores below good",
  rec({ sleepQuality: "poor" }).score! < rec({ sleepQuality: "good" }).score!, true);

// Yesterday's overreach must reduce today's readiness.
check("a huge session yesterday lowers recovery",
  rec({ yesterdayBurn: 1200 }).score! < rested.score!, true);
check("training every day without rest lowers it further",
  rec({ yesterdayBurn: 1200, consecutiveTrainingDays: 6 }).score!
    < rec({ yesterdayBurn: 1200, consecutiveTrainingDays: 0 }).score!, true);

// Under-fuelling is a recovery problem, not just a scoring one.
check("severe under-eating lowers recovery",
  rec({ yesterdayKcalIn: 700, yesterdayProtein: 30 }).score! < rested.score!, true);
check("unlogged food is treated as partial credit, not zero",
  rec({ yesterdayLoggedFood: false }).score! > 0, true);

// The guidance should name the actual limiter.
const sleepy = rec({ sleepHours: 4, sleepQuality: "poor" });
check("low recovery bands low", sleepy.band, "low");
check("guidance names sleep as the limiter", /[Ss]leep is the limiter/.test(sleepy.guidance), true);
const beaten = rec({ yesterdayBurn: 2000, consecutiveTrainingDays: 7 });
check("guidance names fatigue when load is the limiter",
  /fatigue|rest day/.test(beaten.guidance), true);

check("score never leaves 0-100",
  rec({ sleepHours: 14, yesterdayBurn: 0 }).score! <= 100
    && rec({ sleepHours: 1, yesterdayBurn: 9000, consecutiveTrainingDays: 20, yesterdayKcalIn: 0, yesterdayProtein: 0 }).score! >= 0,
  true);

// Recovery must not leak into the daily score.
const dayA = scoreDay(T({ protein_g: 100, meals: 2, kcal_out: 400, sessions: 1 }), "d", 0, REC_TARGETS);
const dayB = scoreDay(T({ protein_g: 100, meals: 2, kcal_out: 400, sessions: 1, sleep_hours: 3 }), "d", 0, REC_TARGETS);
check("sleep does not change the daily score", dayA.total, dayB.total);

console.log(fails === 0 ? "\nAll scoring checks passed." : `\n${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);
