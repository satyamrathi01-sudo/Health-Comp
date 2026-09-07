import "server-only";
import { createHash } from "crypto";
import type { Confidence, Exercise, FoodItem } from "./types";

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
const FALLBACK_MODELS = ["gemini-3.6-flash", "gemini-flash-latest"];
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

export function cacheKey(kind: string, text: string, salt = ""): string {
  const normalized = text.toLowerCase().replace(/\s+/g, " ").trim();
  // Deliberately NOT keyed on the model: a cached answer stays usable when the
  // model chain shifts under us, which is the whole point of the fallbacks.
  return createHash("sha256").update(`${kind}|${salt}|${normalized}`).digest("hex");
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
  withThinkingConfig: boolean,
): Promise<Attempt> {
  const generationConfig: Record<string, unknown> = {
    responseMimeType: "application/json",
    responseSchema: schema,
    temperature: 0.2, // extraction, not creative writing
  };

  // Thinking is disabled by default so logging a meal feels instant. Some
  // models reject a zero budget outright, so this is retried without it.
  if (withThinkingConfig) {
    generationConfig.thinkingConfig = {
      thinkingBudget: Number(process.env.GEMINI_THINKING_BUDGET ?? 0),
    };
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

  for (const model of modelChain()) {
    let attempt = await callModel(model, systemPrompt, userText, schema, true);

    // 400 is usually this model refusing thinkingConfig — retry without it.
    if (!attempt.ok && attempt.status === 400) {
      attempt = await callModel(model, systemPrompt, userText, schema, false);
    }

    if (attempt.ok && attempt.text) {
      try {
        return JSON.parse(attempt.text) as T;
      } catch {
        throw new GeminiError("Gemini returned malformed JSON.");
      }
    }

    last = attempt;

    // A retired or overloaded model: move down the chain.
    if (attempt.status === 404 || attempt.status === 503) continue;

    if (attempt.status === 429) {
      throw new GeminiError("Gemini free-tier rate limit hit. Wait a minute and retry.", 429);
    }
    if (attempt.status === 504) {
      throw new GeminiError("Gemini took too long. Try again, or enter it manually.", 504);
    }
    if (attempt.status === 400 && (attempt.body ?? "").includes("API_KEY")) {
      throw new GeminiError("That GEMINI_API_KEY was rejected. Check it in AI Studio.", 401);
    }
    throw new GeminiError(`Gemini ${attempt.status}: ${(attempt.body ?? "").slice(0, 300)}`);
  }

  throw new GeminiError(
    `No usable Gemini model. Tried ${modelChain().join(", ")}. ` +
      `Last response ${last?.status}: ${(last?.body ?? "").slice(0, 200)}`,
  );
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
    confidence: { type: "STRING", enum: ["low", "medium", "high"] },
    assumptions: {
      type: "STRING",
      description: "One short line on portion sizes assumed. Empty if obvious.",
    },
  },
  required: ["items", "confidence", "assumptions"],
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

Return only JSON matching the schema.`;

export interface FoodParse {
  items: FoodItem[];
  confidence: Confidence;
  assumptions: string;
}

export async function parseFood(text: string): Promise<FoodParse> {
  const raw = await generate<FoodParse>(FOOD_PROMPT, text, FOOD_SCHEMA);
  return {
    items: (raw.items ?? []).map(sanitizeFoodItem).filter((i) => i.name),
    confidence: normalizeConfidence(raw.confidence),
    assumptions: (raw.assumptions ?? "").slice(0, 300),
  };
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
