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
// burn 35 (capped) + minutes 12 (capped) + protein 0 + net 0 + logging 5 (training only)
check("workout-only day total", cheat.total, 52);

// 3. A strong, complete day
const strong = scoreDay(
  T({ kcal_in: 2100, protein_g: 140, meals: 3, kcal_out: 500, active_minutes: 70, sessions: 1 }),
  "2026-09-07", 5,
);
// burn 35 + min 12 + protein 25 + net(2100-500=1600 => 0) + logging 10 = 82, +5 streak
check("strong day base", strong.base, 82);
check("strong day bonus", strong.bonus, 5);
check("strong day total", strong.total, 87);

// 4. Deficit day: eats less than burns
const deficit = scoreDay(
  T({ kcal_in: 400, protein_g: 60, meals: 2, kcal_out: 500, active_minutes: 60, sessions: 1 }),
  "2026-09-07", 0,
);
// burn 35 + min 12 + protein 12 + net(-100 <= 0 => 18) + logging 10 = 87
check("deficit day scores net max", deficit.base, 87);

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
  T({ kcal_in: 100, protein_g: 500, meals: 5, kcal_out: 5000, active_minutes: 400, sessions: 3 }),
  "2026-09-07", 0,
);
check("everything capped => exactly 100", monster.base, 100);


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

console.log(fails === 0 ? "\nAll scoring checks passed." : `\n${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);
