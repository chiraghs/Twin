/**
 * Numeric grounding for agent answers: every figure in an answer should be traceable to a tool
 * result (or the user's own question), within the precision the answer states it at.
 * Used to label copilot answers as verified or to list the figures that could not be traced.
 */

export interface Figure {
  raw: string;
  value: number;
  tolerance: number;
  percent: boolean;
}

// A number not glued to an identifier (ORD-1042, A-ROB-03, LINE-A, R2…), with optional $ / k / M / %.
const FIGURE = /(?<![A-Za-z0-9_\-/.])(\$?)(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?\s?([kKmM](?![a-zA-Z]))?(%?)/g;

export function extractFigures(text: string, minimum = 10): Figure[] {
  const out: Figure[] = [];
  for (const m of text.matchAll(FIGURE)) {
    const [raw, , int, frac = "", suffix = "", pctSign] = m;
    const mult = suffix.toLowerCase() === "k" ? 1e3 : suffix.toLowerCase() === "m" ? 1e6 : 1;
    const decimals = frac ? frac.length - 1 : 0;
    const value = Number(`${int.replace(/,/g, "")}${frac}`) * mult;
    if (!Number.isFinite(value)) continue;
    // Small whole numbers ("3 lines", "2 shifts") carry little risk and are not checked.
    if (!frac && !suffix && !pctSign && value < minimum) continue;
    out.push({ raw: raw.trim(), value, tolerance: 0.5 * 10 ** -decimals * mult + 1e-9, percent: pctSign === "%" });
  }
  return out;
}

/** All numbers in tool results: numeric fields and numbers inside strings. */
export function sourceNumbers(sources: unknown[]): number[] {
  const nums: number[] = [];
  const walk = (v: unknown) => {
    if (typeof v === "number" && Number.isFinite(v)) nums.push(v);
    else if (typeof v === "string") for (const f of extractFigures(v, 0)) nums.push(f.value);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  sources.forEach(walk);
  return nums;
}

export function checkGrounding(answer: string, sources: unknown[]) {
  const nums = [...new Set(sourceNumbers(sources).map((n) => Math.round(n * 1e6) / 1e6))];
  const figures = extractFigures(answer);
  const near = (c: number, f: Figure) => Number.isFinite(c) && Math.abs(c - f.value) <= f.tolerance;
  const direct = (f: Figure) => nums.some((s) => near(s, f) || near(Math.abs(s), f) || (f.percent && Math.abs(s) <= 1 && near(s * 100, f)));
  // A difference between two tool figures ("saves $X versus …") is accepted but reported as derived.
  const difference = (f: Figure) => nums.length <= 600 && nums.some((a, i) => nums.some((b, j) => j > i && near(Math.abs(a - b), f)));
  const unverified: string[] = [];
  const derived: string[] = [];
  for (const f of figures) {
    if (direct(f)) continue;
    if (difference(f)) derived.push(f.raw);
    else unverified.push(f.raw);
  }
  return { figures: figures.length, unverified: [...new Set(unverified)], derived: [...new Set(derived)] };
}
