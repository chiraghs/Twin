/** Deterministic numeric helpers shared by the plant model, agents and simulator. */

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export const round = (v: number, digits = 0) => {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
};

/** mulberry32 — small, fast, reproducible PRNG. */
export function createRng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable 32-bit hash for deriving per-asset / per-tick seeds. */
export function hashString(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Deterministic standard-normal sample for a (seed, key) pair. */
export function gaussian(seed: number, key: string) {
  const rng = createRng(seed ^ hashString(key));
  const u1 = Math.max(rng(), 1e-9);
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

export interface LinearFit {
  slope: number;
  intercept: number;
  r2: number;
  slopeStdErr: number;
  n: number;
  residualStd: number;
}

/** Ordinary least squares fit of y = a + b·x. */
export function linearFit(xs: number[], ys: number[]): LinearFit {
  const n = xs.length;
  if (n < 3) return { slope: 0, intercept: ys[0] ?? 0, r2: 0, slopeStdErr: Infinity, n, residualStd: 0 };
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (xs[i] - mx) ** 2;
    sxy += (xs[i] - mx) * (ys[i] - my);
    syy += (ys[i] - my) ** 2;
  }
  if (sxx === 0) return { slope: 0, intercept: my, r2: 0, slopeStdErr: Infinity, n, residualStd: 0 };
  const slope = sxy / sxx;
  const intercept = my - slope * mx;
  let sse = 0;
  for (let i = 0; i < n; i++) sse += (ys[i] - (intercept + slope * xs[i])) ** 2;
  const r2 = syy === 0 ? 0 : clamp(1 - sse / syy, 0, 1);
  const residualVar = sse / Math.max(1, n - 2);
  return {
    slope,
    intercept,
    r2,
    slopeStdErr: Math.sqrt(residualVar / sxx),
    n,
    residualStd: Math.sqrt(residualVar),
  };
}

export function mean(xs: number[]) {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

export function std(xs: number[]) {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
}

/** Standard normal CDF (Abramowitz–Stegun 7.1.26 approximation). */
export function normalCdf(z: number) {
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-(z * z) / 2);
  return z >= 0 ? (1 + y) / 2 : (1 - y) / 2;
}

export function sum(xs: number[]) {
  return xs.reduce((a, b) => a + b, 0);
}
