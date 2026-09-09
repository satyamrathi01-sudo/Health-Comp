import { SCORING } from "./scoring.ts";
import type { FoodItemRow } from "./types.ts";

/* =====================================================================
 * Why they are ahead of you on protein — and which plate did it.
 *
 * The score already says WHO won and by how much. This says WHAT. If they
 * ate chole and you ate dal, and the chole is where their protein points
 * came from, that is the sentence worth showing — not "eat more protein".
 *
 * Deterministic on purpose. Both sides' meals have already been broken
 * into items with macros at log time, so the difference is arithmetic over
 * data we hold; asking a language model to narrate it would be slower,
 * non-reproducible, and no more accurate.
 *
 * Everything is expressed against each person's OWN protein target, since
 * that is what the score uses: 120 g is a strong day for a 60 kg person
 * and a poor one for a 95 kg lifter.
 * ===================================================================== */

/** Below this a food is a rounding error, not an explanation. */
const MIN_MEANINGFUL_G = 2;
/** A swap suggestion has to be a real portion, not a spoonful. */
const MIN_SWAP_KCAL = 60;

export interface FoodSource {
  name: string;
  protein: number;
  kcal: number;
  /** Grams of protein per 100 kcal — the number that decides a swap. */
  density: number;
}

export interface SourceGap {
  name: string;
  mine: number;
  theirs: number;
  /** theirs − mine, in grams of protein. */
  delta: number;
  mineKcal: number;
  theirsKcal: number;
}

export interface ProteinSwap {
  from: FoodSource;
  to: FoodSource;
  /** Protein gained by spending the same calories on their food instead. */
  gainG: number;
  /** Share of the gap this one swap would close, 0–1. */
  shareOfGap: number;
  text: string;
}

export interface ProteinComparison {
  /** True when neither side logged any food — nothing to compare. */
  empty: boolean;
  mineG: number;
  theirsG: number;
  /** theirs − mine, grams. */
  gapG: number;
  /** Each side as a fraction of their own target. */
  minePct: number;
  theirsPct: number;
  mineTarget: number;
  theirsTarget: number;
  /** Points on the protein line, from their own targets. */
  minePoints: number;
  theirsPoints: number;
  pointsGap: number;
  /** Foods where they out-scored you, biggest first. */
  theirEdge: SourceGap[];
  /** Foods where you out-scored them. */
  myEdge: SourceGap[];
  swap: ProteinSwap | null;
  headline: string;
  explain: string;
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const density = (protein: number, kcal: number) => (kcal > 0 ? (protein / kcal) * 100 : 0);

/** Fold item rows into one entry per food, keyed on a normalised name. */
export function foldSources(rows: FoodItemRow[]): Map<string, FoodSource> {
  const out = new Map<string, FoodSource>();
  for (const r of rows) {
    const key = r.name.trim().toLowerCase();
    if (!key) continue;
    const prev = out.get(key);
    const protein = (prev?.protein ?? 0) + Number(r.protein_g || 0);
    const kcal = (prev?.kcal ?? 0) + Number(r.kcal || 0);
    out.set(key, {
      name: prev?.name ?? r.name.trim(),
      protein: round1(protein),
      kcal: Math.round(kcal),
      density: round1(density(protein, kcal)),
    });
  }
  return out;
}

/** Protein points on the score's own terms, so this can never disagree with it. */
function proteinPoints(grams: number, target: number): number {
  if (!(target > 0)) return round1(Math.min(SCORING.protein.max, grams / SCORING.protein.gramsPerPoint));
  return round1(Math.min(1, grams / target) * SCORING.protein.max);
}

export interface ProteinInput {
  mineItems: FoodItemRow[];
  theirItems: FoodItemRow[];
  mineTarget: number;
  theirTarget: number;
  theirName: string;
}

export function compareProtein(input: ProteinInput): ProteinComparison {
  const mine = foldSources(input.mineItems);
  const theirs = foldSources(input.theirItems);

  const sum = (m: Map<string, FoodSource>) =>
    round1([...m.values()].reduce((a, s) => a + s.protein, 0));

  const mineG = sum(mine);
  const theirsG = sum(theirs);
  const gapG = round1(theirsG - mineG);

  const minePoints = proteinPoints(mineG, input.mineTarget);
  const theirsPoints = proteinPoints(theirsG, input.theirTarget);

  const names = new Set([...mine.keys(), ...theirs.keys()]);
  const lines: SourceGap[] = [...names]
    .map((key) => {
      const a = mine.get(key);
      const b = theirs.get(key);
      return {
        name: b?.name ?? a?.name ?? key,
        mine: a?.protein ?? 0,
        theirs: b?.protein ?? 0,
        delta: round1((b?.protein ?? 0) - (a?.protein ?? 0)),
        mineKcal: a?.kcal ?? 0,
        theirsKcal: b?.kcal ?? 0,
      };
    })
    .filter((l) => Math.abs(l.delta) >= MIN_MEANINGFUL_G)
    .sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));

  const theirEdge = lines.filter((l) => l.delta > 0);
  const myEdge = lines.filter((l) => l.delta < 0);

  const empty = mine.size === 0 && theirs.size === 0;
  const swap = gapG > 0 ? bestSwap(mine, theirs, gapG, input.theirName) : null;

  return {
    empty,
    mineG,
    theirsG,
    gapG,
    mineTarget: input.mineTarget,
    theirsTarget: input.theirTarget,
    minePct: input.mineTarget > 0 ? mineG / input.mineTarget : 0,
    theirsPct: input.theirTarget > 0 ? theirsG / input.theirTarget : 0,
    minePoints,
    theirsPoints,
    pointsGap: round1(theirsPoints - minePoints),
    theirEdge,
    myEdge,
    swap,
    headline: headlineFor(empty, gapG, theirEdge, input.theirName),
    explain: explainFor({ empty, gapG, theirEdge, myEdge, name: input.theirName, swap }),
  };
}

/**
 * The single most useful thing to change: which of your foods to spend the
 * same calories on differently.
 *
 * Compared per 100 kcal rather than per portion, because that is the trade
 * a person can actually make. Swapping a katori of dal for a katori of
 * chole is a real swap; "eat 40 g more protein" is not.
 */
function bestSwap(
  mine: Map<string, FoodSource>,
  theirs: Map<string, FoodSource>,
  gapG: number,
  theirName: string,
): ProteinSwap | null {
  const candidates = [...theirs.values()]
    .filter((t) => t.kcal >= MIN_SWAP_KCAL && t.density > 0)
    .sort((a, b) => b.density - a.density);
  if (!candidates.length) return null;

  let best: ProteinSwap | null = null;

  for (const from of mine.values()) {
    if (from.kcal < MIN_SWAP_KCAL) continue;
    for (const to of candidates) {
      // Swapping a food for itself explains nothing.
      if (to.name.toLowerCase() === from.name.toLowerCase()) continue;
      const gain = round1((from.kcal * (to.density - from.density)) / 100);
      if (gain <= MIN_MEANINGFUL_G) continue;
      if (!best || gain > best.gainG) {
        best = {
          from,
          to,
          gainG: gain,
          shareOfGap: gapG > 0 ? Math.min(1, gain / gapG) : 0,
          text:
            `Their ${to.name.toLowerCase()} carries ${to.density} g of protein per 100 kcal; ` +
            `your ${from.name.toLowerCase()} carries ${from.density}. Spending the same ` +
            `${from.kcal} kcal on ${to.name.toLowerCase()} instead would have added about ` +
            `${gain} g — ${Math.round(Math.min(1, gain / gapG) * 100)}% of the gap to ${theirName}.`,
        };
      }
    }
  }

  return best;
}

function headlineFor(
  empty: boolean,
  gapG: number,
  theirEdge: SourceGap[],
  theirName: string,
): string {
  if (empty) return "Nothing logged yet";
  if (Math.abs(gapG) < MIN_MEANINGFUL_G) return "Level on protein";
  if (gapG < 0) return `You are ${Math.abs(gapG)} g of protein ahead`;
  const top = theirEdge[0];
  return top
    ? `${theirName} is ${gapG} g ahead, mostly on ${top.name.toLowerCase()}`
    : `${theirName} is ${gapG} g of protein ahead`;
}

function explainFor(o: {
  empty: boolean;
  gapG: number;
  theirEdge: SourceGap[];
  myEdge: SourceGap[];
  name: string;
  swap: ProteinSwap | null;
}): string {
  if (o.empty) return "The moment either of you logs a meal, this breaks the difference down food by food.";
  if (Math.abs(o.gapG) < MIN_MEANINGFUL_G) return "Neither of you is getting protein from anywhere the other is not.";

  if (o.gapG < 0) {
    const top = o.myEdge[0];
    return top
      ? `Your ${top.name.toLowerCase()} is doing the work — ${Math.abs(top.delta)} g more than ${o.name} got from it.`
      : `You are ahead on protein across the board.`;
  }

  const top = o.theirEdge[0];
  if (!top) return `${o.name} is ahead on volume rather than on any one food.`;

  const share = Math.round(Math.min(1, top.delta / o.gapG) * 100);
  const theirs =
    top.mine > 0
      ? `${top.theirs} g against your ${top.mine} g`
      : `${top.theirs} g, and you had none`;

  return (
    `${o.name}'s ${top.name.toLowerCase()} is ${share}% of the difference — ${theirs}. ` +
    (o.swap ? o.swap.text : `Matching that one item would put you level.`)
  );
}
