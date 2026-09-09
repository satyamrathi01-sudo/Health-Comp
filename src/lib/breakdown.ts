/* =====================================================================
 * Which items produced a number, and who they belonged to.
 *
 * The score says WHO won a line and by how much; versus.ts says what did
 * it for protein specifically, with swap advice attached. This is the plain
 * arithmetic underneath both, generalised over any per-item field: fold
 * two people's rows to one row per name, subtract, sort by what mattered.
 *
 * One function rather than one per nutrient, because foods and exercises
 * fold identically — a plate of chole and forty minutes of running are the
 * same shape of evidence for two different lines.
 * ===================================================================== */

export interface BreakdownRow {
  name: string;
  mine: number;
  theirs: number;
  /** theirs − mine, in the field's own unit. */
  delta: number;
}

export interface Breakdown {
  mineTotal: number;
  theirsTotal: number;
  /** Everyone's rows, biggest difference first. */
  rows: BreakdownRow[];
  /** Only mine, largest contribution first. */
  mineRows: BreakdownRow[];
  /** Only theirs, largest contribution first. */
  theirRows: BreakdownRow[];
  empty: boolean;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export interface HasOwner {
  user_id: string;
  name: string;
}

/**
 * Fold rows belonging to two people into one row per food or exercise.
 *
 * Names are matched case- and space-insensitively, so "Dal" and "dal " are
 * one line rather than two that each look like something only one of you
 * ate. The first spelling seen wins for display.
 */
export function compareItems<T extends HasOwner>(
  rows: T[],
  myId: string,
  theirId: string,
  value: (row: T) => number,
): Breakdown {
  const mine = new Map<string, { name: string; total: number }>();
  const theirs = new Map<string, { name: string; total: number }>();

  for (const row of rows) {
    const key = row.name.trim().toLowerCase();
    if (!key) continue;
    const v = Number(value(row)) || 0;
    if (v === 0) continue;

    const target = row.user_id === myId ? mine : row.user_id === theirId ? theirs : null;
    if (!target) continue;

    const prev = target.get(key);
    target.set(key, { name: prev?.name ?? row.name.trim(), total: (prev?.total ?? 0) + v });
  }

  const names = new Set([...mine.keys(), ...theirs.keys()]);
  const all: BreakdownRow[] = [...names].map((key) => {
    const a = mine.get(key);
    const b = theirs.get(key);
    return {
      name: b?.name ?? a?.name ?? key,
      mine: round1(a?.total ?? 0),
      theirs: round1(b?.total ?? 0),
      delta: round1((b?.total ?? 0) - (a?.total ?? 0)),
    };
  });

  const sum = (m: Map<string, { total: number }>) =>
    round1([...m.values()].reduce((acc, v) => acc + v.total, 0));

  return {
    mineTotal: sum(mine),
    theirsTotal: sum(theirs),
    rows: [...all].sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta)),
    mineRows: all.filter((r) => r.mine > 0).sort((x, y) => y.mine - x.mine),
    theirRows: all.filter((r) => r.theirs > 0).sort((x, y) => y.theirs - x.theirs),
    empty: all.length === 0,
  };
}
