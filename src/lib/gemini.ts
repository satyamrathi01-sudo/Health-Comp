import "server-only";
import { createHash } from "crypto";
import { EMPTY_MICROS, MICRO_KEYS, type AdvicePoint, type Confidence, type Exercise, type FoodItem, type Micros } from "./types.ts";
import type { ChatTurn } from "./chat.ts";

/* ---------------------------------------------------------------------
 * Gemini — server side only. The key must never reach the browser.
 * Free key: https://aistudio.google.com/apikey
 * ------------------------------------------------------------------- */

/**
 * Model choice, verified against a live key on 2026-09-07:
 *   gemini-2.5-flash  404 — "no longer available to new users"
 *   gemini-3.5-flash  works; ~2s; accepts thinkingBudget 0     <- default
 *   gemini-3.6-flash  works, but REJECTS thinkingBudget 0 (400)
 *   gemini-3.8-flash  works, but ~8s and frequently 503
 *
 * Because a pinned model can be retired underneath us, the chain below is
 * tried in order whenever one is missing or overloaded.
 */
const DEFAULT_MODEL = "gemini-3.5-flash";

/**
 * Free-tier quota is counted PER MODEL PER DAY — gemini-3.5-flash allows just
 * 20 GenerateRequests/day. Chaining across several models therefore multiplies
 * the daily headroom, which matters a lot for two people logging four meals
 * each. Ordered best-quality first.
 */
const FALLBACK_MODELS = [
  // Measured 2026-09-07 on the same prompt:
  //   3.1-flash-lite  1.1s, accepts thinkingBudget 0   <- fast, cheap fallback
  //   3.6-flash      15.7s, and only with a budget > 0
  //   flash-latest   frequently 503 "high demand"
  "gemini-3.1-flash-lite",
  "gemini-3.6-flash",
  "gemini-flash-latest",
];

/**
 * Some models reject a zero thinking budget outright. Omitting the config is
 * NOT a safe fallback — gemini-3.6-flash then thinks at full default and blows
 * straight past the request timeout — so retry with a small positive budget.
 */
const SMALL_THINKING_BUDGET = 128;
const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

export function configuredModel(): string {
  return process.env.GEMINI_MODEL || DEFAULT_MODEL;
}

function modelChain(): string[] {
  const first = configuredModel();
  return [first, ...FALLBACK_MODELS.filter((m) => m !== first)];
}

export class GeminiError extends Error {
  // Plain field rather than a constructor parameter property, so this module
  // also runs under Node's --experimental-strip-types (used by the probes).
  readonly status: number;

  constructor(message: string, status = 502) {
    super(message);
    this.name = "GeminiError";
    this.status = status;
  }
}

export function geminiConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY);
}

/**
 * Bump when a prompt or response schema changes shape. Without this, entries
 * cached under the old shape keep winning and the new fields silently stay
 * empty forever — micros never appeared for any meal logged before they
 * existed, which is exactly how this was found.
 */
const CACHE_VERSION: Record<string, number> = {
  food: 2,     // v2 added meal-level micronutrients
  workout: 2,  // v2 requires sets / reps / load to be filled in
};

export function cacheKey(kind: string, text: string, salt = ""): string {
  const normalized = text.toLowerCase().replace(/\s+/g, " ").trim();
  const version = CACHE_VERSION[kind] ?? 1;
  // Deliberately NOT keyed on the model: a cached answer stays usable when the
  // model chain shifts under us, which is the whole point of the fallbacks.
  return createHash("sha256")
    .update(`${kind}|v${version}|${salt}|${normalized}`)
    .digest("hex");
}

type SchemaNode = Record<string, unknown>;

interface Attempt {
  ok: boolean;
  status: number;
  text?: string;
  body?: string;
}

async function callModel(
  model: string,
  systemPrompt: string,
  userText: string,
  schema: SchemaNode,
  thinkingBudget: number | null,
): Promise<Attempt> {
  const generationConfig: Record<string, unknown> = {
    responseMimeType: "application/json",
    responseSchema: schema,
    temperature: 0.2, // extraction, not creative writing
  };

  // Thinking is off by default so logging a meal feels instant.
  if (thinkingBudget !== null) {
    generationConfig.thinkingConfig = { thinkingBudget };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25_000);

  try {
    const res = await fetch(`${ENDPOINT}/${model}:generateContent`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": process.env.GEMINI_API_KEY!,
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: "user", parts: [{ text: userText }] }],
        generationConfig,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      return { ok: false, status: res.status, body: await res.text().catch(() => "") };
    }

    const data = await res.json();
    const text: string | undefined = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      const reason = data?.candidates?.[0]?.finishReason ?? "unknown";
      return { ok: false, status: 502, body: `no content (finishReason: ${reason})` };
    }
    return { ok: true, status: 200, text };
  } catch (err) {
    const aborted = (err as Error).name === "AbortError";
    return { ok: false, status: aborted ? 504 : 599, body: (err as Error).message };
  } finally {
    clearTimeout(timeout);
  }
}

async function generate<T>(systemPrompt: string, userText: string, schema: SchemaNode): Promise<T> {
  if (!process.env.GEMINI_API_KEY) {
    throw new GeminiError(
      "GEMINI_API_KEY is not set. Add it to .env.local, or use manual entry.",
      503,
    );
  }

  let last: Attempt | null = null;

  const preferredBudget = Number(process.env.GEMINI_THINKING_BUDGET ?? 0);

  for (const model of modelChain()) {
    let attempt = await callModel(model, systemPrompt, userText, schema, preferredBudget);

    // 400 usually means this model refuses a zero budget — nudge it up rather
    // than dropping the config, which would leave thinking fully enabled.
    if (!attempt.ok && attempt.status === 400 && preferredBudget < SMALL_THINKING_BUDGET) {
      attempt = await callModel(model, systemPrompt, userText, schema, SMALL_THINKING_BUDGET);
    }

    if (attempt.ok && attempt.text) {
      try {
        return JSON.parse(attempt.text) as T;
      } catch {
        throw new GeminiError("Gemini returned malformed JSON.");
      }
    }

    last = attempt;

    // Retired (404), overloaded (503), out of quota (429), or too slow (504).
    // Free-tier quota is counted per model per day, and latency varies wildly
    // between models, so none of these says anything about the next one.
    if ([404, 503, 429, 504].includes(attempt.status)) continue;
    if (attempt.status === 400 && (attempt.body ?? "").includes("API_KEY")) {
      throw new GeminiError("That GEMINI_API_KEY was rejected. Check it in AI Studio.", 401);
    }
    throw new GeminiError(`Gemini ${attempt.status}: ${(attempt.body ?? "").slice(0, 300)}`);
  }

  // Everything in the chain is exhausted.
  if (last?.status === 504) {
    throw new GeminiError(
      "Every Gemini model was too slow to answer. Try again, or enter it by hand.",
      504,
    );
  }

  if (last?.status === 429) {
    throw new GeminiError(
      `Every Gemini model has used up today's free quota (${modelChain().length} tried). ` +
        `It resets at midnight Pacific.${retryHint(last.body)} You can still enter this by hand.`,
      429,
    );
  }

  throw new GeminiError(
    `No usable Gemini model. Tried ${modelChain().join(", ")}. ` +
      `Last response ${last?.status}: ${(last?.body ?? "").slice(0, 200)}`,
  );
}

/** Google returns a RetryInfo detail on 429; surface it when present. */
function retryHint(body: string | undefined): string {
  if (!body) return "";
  try {
    const details = JSON.parse(body)?.error?.details ?? [];
    const retry = details.find((d: { "@type"?: string }) =>
      d["@type"]?.includes("RetryInfo"),
    )?.retryDelay;
    return retry ? ` Next slot in about ${retry}.` : "";
  } catch {
    return "";
  }
}

/* ------------------------------- FOOD ------------------------------- */

const FOOD_SCHEMA: SchemaNode = {
  type: "OBJECT",
  properties: {
    items: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          name: { type: "STRING", description: "Canonical food name, e.g. 'Roti (whole wheat)'" },
          qty: { type: "NUMBER" },
          unit: { type: "STRING", description: "piece, katori, bowl, plate, g, ml, cup, tbsp, slice" },
          kcal: { type: "NUMBER" },
          protein_g: { type: "NUMBER" },
          carbs_g: { type: "NUMBER" },
          fat_g: { type: "NUMBER" },
          fiber_g: { type: "NUMBER" },
        },
        required: ["name", "qty", "unit", "kcal", "protein_g", "carbs_g", "fat_g", "fiber_g"],
      },
    },
    micros: {
      type: "OBJECT",
      description: "Micronutrient totals for the WHOLE meal, not per item.",
      properties: {
        sodium_mg: { type: "NUMBER" },
        potassium_mg: { type: "NUMBER" },
        calcium_mg: { type: "NUMBER" },
        iron_mg: { type: "NUMBER" },
        magnesium_mg: { type: "NUMBER" },
        zinc_mg: { type: "NUMBER" },
        vitamin_c_mg: { type: "NUMBER" },
        vitamin_d_ug: { type: "NUMBER" },
        vitamin_b12_ug: { type: "NUMBER" },
        folate_ug: { type: "NUMBER" },
        sugar_g: { type: "NUMBER", description: "Added + free sugars, not lactose in milk" },
        satfat_g: { type: "NUMBER" },
      },
      required: [
        "sodium_mg", "potassium_mg", "calcium_mg", "iron_mg", "magnesium_mg", "zinc_mg",
        "vitamin_c_mg", "vitamin_d_ug", "vitamin_b12_ug", "folate_ug", "sugar_g", "satfat_g",
      ],
    },
    confidence: { type: "STRING", enum: ["low", "medium", "high"] },
    assumptions: {
      type: "STRING",
      description: "One short line on portion sizes assumed. Empty if obvious.",
    },
  },
  required: ["items", "micros", "confidence", "assumptions"],
};

const FOOD_PROMPT = `You are a nutrition analyst for a food-logging app used by two friends in India.

Break the user's meal description into individual food items with nutrition for the
QUANTITY ACTUALLY EATEN — never per 100 g unless they literally ate 100 g.

Rules:
- You are fluent in Indian home cooking and restaurant food: roti, phulka, paratha,
  dal (tadka/fry/makhani), sabzi, poha, upma, idli, dosa, sambar, rajma, chole, biryani,
  paneer dishes, curd/dahi, thali, chai with sugar, and typical street food.
- Interpret Indian household measures properly: 1 katori ≈ 150 ml, 1 bowl ≈ 200 ml,
  "half plate rice" ≈ 100 g cooked, 1 roti ≈ 40 g flour, 1 tbsp ghee/oil ≈ 14 g.
- Assume normal home cooking with oil/ghee unless told otherwise. Do not pretend a
  dal has no fat — a tadka carries real calories.
- If quantity is vague ("some rice", "a bit of curd"), assume one normal adult serving
  and say so in the assumptions field.
- Split composite dishes only when it genuinely helps (a thali → its components);
  keep a single dish like "chicken biryani" as one item.
- Numbers must be internally consistent: protein×4 + carbs×4 + fat×9 should land
  within ~10% of kcal.
- confidence: "high" for exact quantities of common foods, "medium" for normal
  estimation, "low" when you are largely guessing.
- If the text contains no actual food, return an empty items array.

Also give micronutrient totals for the WHOLE meal (not per item). Be realistic about
Indian cooking: restaurant and street food carry a lot of sodium; ghee and coconut push
saturated fat; dal, ragi and leafy sabzi carry useful iron, folate and magnesium; dairy
and curd carry calcium and B12; a purely vegetarian meal usually has very little B12 and
essentially no vitamin D. Report 0 for a nutrient a meal genuinely has none of rather
than sprinkling small numbers everywhere.

Return only JSON matching the schema.`;

export interface FoodParse {
  items: FoodItem[];
  micros: Micros;
  confidence: Confidence;
  assumptions: string;
}

export async function parseFood(text: string): Promise<FoodParse> {
  const raw = await generate<FoodParse>(FOOD_PROMPT, text, FOOD_SCHEMA);
  return {
    items: (raw.items ?? []).map(sanitizeFoodItem).filter((i) => i.name),
    micros: sanitizeMicros(raw.micros),
    confidence: normalizeConfidence(raw.confidence),
    assumptions: (raw.assumptions ?? "").slice(0, 300),
  };
}

function sanitizeMicros(m: Partial<Micros> | undefined): Micros {
  const out = { ...EMPTY_MICROS };
  for (const key of MICRO_KEYS) out[key] = num(m?.[key], 100000);
  return out;
}

function num(v: unknown, max = 100000): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(Math.min(n, max) * 10) / 10;
}

function sanitizeFoodItem(i: Partial<FoodItem>): FoodItem {
  return {
    name: String(i.name ?? "").slice(0, 120).trim(),
    qty: num(i.qty, 1000) || 1,
    unit: String(i.unit ?? "serving").slice(0, 24).trim() || "serving",
    kcal: num(i.kcal, 10000),
    protein_g: num(i.protein_g, 1000),
    carbs_g: num(i.carbs_g, 2000),
    fat_g: num(i.fat_g, 1000),
    fiber_g: num(i.fiber_g, 500),
  };
}

function normalizeConfidence(c: unknown): Confidence {
  return c === "low" || c === "high" ? c : "medium";
}

/* ----------------------------- WORKOUT ------------------------------ */

const WORKOUT_SCHEMA: SchemaNode = {
  type: "OBJECT",
  properties: {
    exercises: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          name: { type: "STRING" },
          kind: { type: "STRING", enum: ["cardio", "strength", "sport", "mobility", "other"] },
          met: { type: "NUMBER", description: "Compendium of Physical Activities MET value" },
          minutes: { type: "NUMBER", description: "Actual elapsed minutes for this exercise" },
          sets: { type: "NUMBER", description: "Number of sets, when stated or clearly implied" },
          reps: { type: "NUMBER", description: "Reps per set, when stated. '4x8' means sets 4, reps 8" },
          weight_kg: { type: "NUMBER", description: "Load lifted per rep in kg, when stated" },
          distance_km: { type: "NUMBER", description: "Distance covered in km, when stated" },
        },
        required: ["name", "kind", "met", "minutes"],
      },
    },
    confidence: { type: "STRING", enum: ["low", "medium", "high"] },
    assumptions: { type: "STRING" },
  },
  required: ["exercises", "confidence", "assumptions"],
};

const WORKOUT_PROMPT = `You are an exercise physiologist for a workout-logging app.

Turn the user's description into structured exercises. For each one give a MET value
from the Compendium of Physical Activities and the elapsed minutes.

Do NOT return calories. The app computes burn itself from MET, minutes and the user's
bodyweight, so that the same session always scores identically.

MET guidance:
- Walking casual 3.0 · brisk 4.3 · uphill 6.0
- Running 8 km/h 8.3 · 10 km/h 9.8 · 12 km/h 11.5 · 14 km/h 13.5
- Cycling leisure 6.0 · vigorous 10.0 · Swimming laps 7.0–9.8
- Weight training moderate 3.5 · vigorous/heavy compound 6.0
- HIIT / circuit 8.0 · Yoga 2.5–4.0 · Stretching/mobility 2.3
- Cricket 4.8 · Badminton 5.5 · Football 7.0 · Basketball 6.5
- Skipping rope 11.0 · Stair climbing 8.8

Rules:
- If they gave a distance and a time, derive pace and pick the matching MET.
- If they gave a distance but no time, estimate a sensible recreational pace.
- Whenever the text states sets, reps or load, you MUST return them in sets, reps and
  weight_kg. "bench 4x8 at 60kg" means sets 4, reps 8, weight_kg 60 — never leave those
  null when the user actually said them; they are the record of how the session went.
- For strength work given as sets/reps with no duration, estimate elapsed minutes at
  roughly 3 minutes per set including rest.
- Likewise return distance_km whenever a distance is stated.
- "Gym for an hour" with no detail → one 60-minute "Weight training" entry at MET 4.0.
- Never invent exercises that were not mentioned. If nothing describes exercise,
  return an empty array.
- confidence: "high" when duration and intensity are both explicit, "low" when you
  are inferring most of it.

Return only JSON matching the schema.`;

export interface WorkoutParse {
  exercises: Omit<Exercise, "kcal">[];
  confidence: Confidence;
  assumptions: string;
}

export async function parseWorkout(text: string): Promise<WorkoutParse> {
  const raw = await generate<WorkoutParse>(WORKOUT_PROMPT, text, WORKOUT_SCHEMA);
  return {
    exercises: (raw.exercises ?? []).map(sanitizeExercise).filter((e) => e.name),
    confidence: normalizeConfidence(raw.confidence),
    assumptions: (raw.assumptions ?? "").slice(0, 300),
  };
}

const KINDS = ["cardio", "strength", "sport", "mobility", "other"] as const;

function sanitizeExercise(e: Partial<Exercise>): Omit<Exercise, "kcal"> {
  const kind = KINDS.includes(e.kind as (typeof KINDS)[number]) ? e.kind! : "other";
  return {
    name: String(e.name ?? "").slice(0, 120).trim(),
    kind,
    met: Math.min(23, Math.max(1, num(e.met, 23) || 3)),
    minutes: Math.min(600, num(e.minutes, 600)),
    sets: e.sets ? num(e.sets, 100) : null,
    reps: e.reps ? num(e.reps, 1000) : null,
    weight_kg: e.weight_kg ? num(e.weight_kg, 1000) : null,
    distance_km: e.distance_km ? num(e.distance_km, 1000) : null,
  };
}

/* ------------------------------- COACH ------------------------------ */

const ADVICE_SCHEMA: SchemaNode = {
  type: "OBJECT",
  properties: {
    headline: {
      type: "STRING",
      description: "Six words or fewer summing up the day, e.g. 'Protein short, training solid'",
    },
    points: {
      type: "ARRAY",
      description: "Three to five pointers for tomorrow, most important first",
      items: {
        type: "OBJECT",
        properties: {
          kind: { type: "STRING", enum: ["add", "reduce", "keep", "train", "rest"] },
          text: {
            type: "STRING",
            description: "One concrete sentence, max ~110 characters. Name real foods or actions.",
          },
          component: {
            type: "STRING",
            enum: ["burn", "protein", "calories", "minutes", "logging", "sleep", "water", "micros", "none"],
            description: "Which part of the score this would move, if any.",
          },
          amount: {
            type: "NUMBER",
            description:
              "Size of the change in that component's own unit: kcal for burn and calories, " +
              "grams for protein, minutes for minutes. NEGATIVE to eat less. 0 when not applicable.",
          },
        },
        required: ["kind", "text", "component", "amount"],
      },
    },
  },
  required: ["headline", "points"],
};

const ADVICE_PROMPT = `You are a pragmatic strength-and-nutrition coach writing a short
end-of-day note for someone logging food and training in India.

Give three to five pointers for TOMORROW. Rules:

- Be specific and actionable. "Add 150 g paneer or a bowl of rajma at lunch" beats
  "eat more protein". Name foods that are ordinary in an Indian kitchen.
- Lead with whatever actually matters most today. If protein was 40 g short, that is the
  first point. If they did not train, say so plainly.
- Use "reduce" when something is genuinely high — sodium over the limit, saturated fat
  from fried food, added sugar. Do not invent problems: if a day was good, use "keep"
  and say what to repeat.
- Comment on sleep only when it was actually logged and is short (under ~7 h) or clearly
  affecting recovery. Never speculate about sleep that was not recorded.
- Mention water only when they are meaningfully short of the stated aim, or well past it.
  Use component "water" with the millilitres as the amount. Hitting the aim needs no
  comment; nagging someone who drank enough is how a tracker gets deleted.
- Micronutrients are worth a point only when notably low against the stated target, and
  only with a real food fix (iron -> ragi, dates, spinach with lemon; B12 -> curd, milk,
  eggs; vitamin D -> sunlight or a supplement conversation).
- THEIR PLAN COMES FIRST. If a target weight and date are stated below, every pointer
  should serve that plan: someone cutting towards a date wants to hear about the deficit
  and protein, not a generic priority.
- Quantify each pointer with the component and amount fields so the app can price it: "add 150 g
  of paneer" is component "protein", amount 30. "Walk 30 minutes" is component "minutes",
  amount 30 (use "burn" with a kcal amount instead if you mean the energy). "Cut the
  evening namkeen" is component "calories" with a NEGATIVE amount. Sleep and
  micronutrient pointers use "sleep" or "micros" with amount 0 — the app knows those do
  not move the score and will say so. Water uses "water" with the millilitres to add. Be realistic: the amount is what one ordinary day's
  change would actually deliver.
- The score rewards landing close to the calorie target from either side, and stops
  rewarding protein, fibre, vitamins and minerals once they pass 1.5 times their targets.
  Never suggest more of those when they are already well past; suggest easing off. Training
  past the burn target is never marked down, so never suggest training less for the score.
- Tone: direct, warm, no cheerleading, no emoji, no exclamation marks. Address them as
  "you". This is a friendly competition between two friends, not a clinic.
- This is general fitness guidance, not medical advice. Do not diagnose, do not name
  conditions, and do not prescribe doses. If something looks genuinely concerning,
  suggest they raise it with a doctor and move on.

Return only JSON matching the schema.`;

export interface AdviceResult {
  headline: string;
  points: AdvicePoint[];
}

const ADVICE_KINDS = ["add", "reduce", "keep", "train", "rest"] as const;
const IMPACT_COMPONENTS = [
  "burn", "protein", "calories", "minutes", "logging", "sleep", "water", "micros", "none",
] as const;

export async function generateAdvice(summary: string): Promise<AdviceResult> {
  const raw = await generate<AdviceResult>(ADVICE_PROMPT, summary, ADVICE_SCHEMA);
  return {
    headline: String(raw.headline ?? "").slice(0, 80),
    points: (raw.points ?? [])
      .filter((p) => p?.text)
      .slice(0, 5)
      .map((p) => ({
        kind: ADVICE_KINDS.includes(p.kind) ? p.kind : "keep",
        text: String(p.text).slice(0, 200),
        component: IMPACT_COMPONENTS.includes(p.component as (typeof IMPACT_COMPONENTS)[number])
          ? p.component
          : "none",
        // Clamped: a hallucinated 5000 g of protein must not produce a
        // ludicrous projection.
        amount: Math.max(-4000, Math.min(4000, num(p.amount, 4000) * (Number(p.amount) < 0 ? -1 : 1))),
      })),
  };
}

/* -------------------------------- CHAT ------------------------------ */

const CHAT_SCHEMA: SchemaNode = {
  type: "OBJECT",
  properties: {
    answer: {
      type: "STRING",
      description: "The reply: two to six plain sentences, or a short list with '- ' bullets",
    },
  },
  required: ["answer"],
};

const CHAT_PROMPT = `You are the FitClash coach, answering a question from someone who logs their
food and training in India. Below the rules you get a briefing of their day: their targets,
what they ate food by food, their training, how many points each line of today's score earned
and why, any limits they have passed, recovery, and their last week.

Answer the question they actually asked, specifically:

- Use their numbers. "You're 38 g short on protein — 150 g of paneer tikka, or two eggs and a
  katori of dal, closes it" beats "eat more protein".
- For "how do I get more points", point at the score lines with the most points still
  available and say what it would take, in grams, kcal or minutes.
- How the score works: protein, fibre and each vitamin or mineral score full from the target
  up to 1.5 times it, then fall to nothing at double. The calorie target is full within 2%
  and falls to nothing at 30% off, over or under. Calories burned and active minutes fill up
  at the target and are never marked down for doing more. Added sugar and saturated fat lose
  points once over their limits. Logging food and training is worth 10 points.
- Name ordinary Indian foods with realistic portions. When they ask what to eat, give two or
  three concrete options that fit what is left of their targets today.
- If something has not been logged, say so rather than guessing.
- Keep it short: two to six sentences, or a short list. No headings, no emoji, no exclamation
  marks. Address them as "you".
- General fitness and food guidance only. Do not diagnose, name conditions or give supplement
  doses; for anything medical, suggest a doctor.
- If the question is not about their food, training, sleep, water or score, say in one
  sentence that you can only help with those.

Return only JSON matching the schema.`;

/**
 * One answer from the coach chat. The briefing comes from loadCoachContext();
 * the history and question have already been through cleanHistory() and
 * cleanQuestion() in chat.ts.
 */
export async function answerCoachQuestion(
  briefing: string,
  history: ChatTurn[],
  question: string,
): Promise<string> {
  const conversation = history
    .map((t) => `${t.role === "user" ? "THEM" : "YOU"}: ${t.text}`)
    .join("\n");

  const userText =
    `${briefing}\n\n` +
    (conversation ? `CONVERSATION SO FAR\n${conversation}\n\n` : "") +
    `THEIR QUESTION\n${question}`;

  const raw = await generate<{ answer?: string }>(CHAT_PROMPT, userText, CHAT_SCHEMA);
  const answer = String(raw.answer ?? "").trim().slice(0, 2000);
  if (!answer) throw new GeminiError("The coach came back empty. Try asking again.");
  return answer;
}

/* ------------------------------- SWAPS ------------------------------ */

/** The limits a swap can be about: the ones with food behind them. */
export const SWAP_LIMIT_KEYS = ["kcal", "carbs_g", "fat_g", "sodium_mg", "sugar_g", "satfat_g"] as const;

export interface SwapIdea {
  limit: (typeof SWAP_LIMIT_KEYS)[number];
  instead_of: string;
  have: string;
  /** Roughly how much of that limit's nutrient the swap removes, in its unit. */
  saves: number;
  why: string;
}

const SWAP_SCHEMA: SchemaNode = {
  type: "OBJECT",
  properties: {
    swaps: {
      type: "ARRAY",
      description: "Up to three swaps per nutrient, biggest saving first",
      items: {
        type: "OBJECT",
        properties: {
          limit: {
            type: "STRING",
            enum: [...SWAP_LIMIT_KEYS],
            description: "The nutrient key exactly as given, e.g. fat_g",
          },
          instead_of: {
            type: "STRING",
            description: "The food they ate, named as it appears in the list",
          },
          have: {
            type: "STRING",
            description: "An ordinary alternative with a realistic portion",
          },
          saves: {
            type: "NUMBER",
            description: "Roughly how much of THIS nutrient the swap removes, in its unit",
          },
          why: { type: "STRING", description: "One short phrase, max ~70 characters" },
        },
        required: ["limit", "instead_of", "have", "saves", "why"],
      },
    },
  },
  required: ["swaps"],
};

const SWAP_PROMPT = `You suggest food swaps for someone in India who went over a daily nutrition
limit. For each nutrient below you get the foods that supplied most of it today, and how
much each supplied.

Suggest up to three swaps per nutrient, biggest saving first. Rules:

- "instead_of" must be one of the listed foods, named as it appears. When a meal is listed
  as a whole, pick the food in it most likely responsible: papad, pickle or namkeen for
  sodium; a sweet, sugary chai or a soft drink for sugar; ghee, butter, cream or fried food
  for saturated fat.
- "have" is an ordinary alternative from an Indian kitchen with a realistic portion:
  "2 phulka without ghee", "chicken tikka", "a bowl of roasted makhana". Prefer a lighter
  version of the same dish or a close substitute over simply skipping it.
- "saves" is roughly how much of that nutrient the swap removes, in the unit shown, for the
  portion they actually ate. Be conservative, and never more than the food itself supplied.
- "why" is one short phrase.
- General food advice only: no medical claims, no emoji, no exclamation marks.

Return only JSON matching the schema.`;

/**
 * "Instead of this, have that" for the foods behind each limit that went
 * over. The brief comes from swapBrief() in overage.ts and carries food only.
 */
export async function generateSwaps(brief: string): Promise<SwapIdea[]> {
  const raw = await generate<{ swaps?: Partial<SwapIdea>[] }>(SWAP_PROMPT, brief, SWAP_SCHEMA);
  const perLimit = new Map<string, number>();
  const out: SwapIdea[] = [];

  for (const s of raw.swaps ?? []) {
    const limit = SWAP_LIMIT_KEYS.find((k) => k === s?.limit);
    if (!limit || !s?.instead_of || !s?.have) continue;

    // Three per limit, however many the model returns.
    const count = (perLimit.get(limit) ?? 0) + 1;
    if (count > 3) continue;
    perLimit.set(limit, count);

    out.push({
      limit,
      instead_of: String(s.instead_of).slice(0, 80).trim(),
      have: String(s.have).slice(0, 100).trim(),
      saves: num(s.saves, 10000),
      why: String(s.why ?? "").slice(0, 120).trim(),
    });
  }

  return out;
}
