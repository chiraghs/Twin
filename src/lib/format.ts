import type { FactoryState } from "@/domain/types";

export const fmtInt = (n: number | null | undefined) => (n === null || n === undefined || !Number.isFinite(n) ? "—" : Math.round(n).toLocaleString("en-US"));

export const fmtNum = (n: number | null | undefined, digits = 1) =>
  n === null || n === undefined || !Number.isFinite(n) ? "—" : n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });

export const fmtPct = (ratio: number | null | undefined, digits = 1) =>
  ratio === null || ratio === undefined || !Number.isFinite(ratio) ? "—" : `${(ratio * 100).toFixed(digits)}%`;

export const fmtMoney = (n: number | null | undefined) => {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (abs >= 1e4) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${Math.round(n).toLocaleString("en-US")}`;
};

export const fmtHours = (h: number | null | undefined) => {
  if (h === null || h === undefined || !Number.isFinite(h)) return "—";
  if (Math.abs(h) < 1) return `${Math.round(h * 60)} min`;
  return `${h.toFixed(Math.abs(h) < 10 ? 1 : 0)} h`;
};

/** Wall-clock time represented by a simulated hour. */
export function simDate(state: Pick<FactoryState, "clock">, hour: number) {
  return new Date(Date.parse(state.clock.anchorISO) + hour * 3600_000);
}

export function fmtSimTime(state: Pick<FactoryState, "clock">, hour: number, withDay = true) {
  const d = simDate(state, hour);
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  if (!withDay) return time;
  const day = d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  return `${day} · ${time}`;
}

/** "in 3.5 h" / "2.1 h ago" relative to the current sim clock. */
export function fmtRelHours(state: Pick<FactoryState, "clock">, hour: number) {
  const d = hour - state.clock.hour;
  if (Math.abs(d) < 1 / 60) return "now";
  const v = fmtHours(Math.abs(d));
  return d > 0 ? `in ${v}` : `${v} ago`;
}

export const titleCase = (s: string) => s.replace(/(^|[-\s])(\w)/g, (_, a, b) => `${a === "-" ? " " : a}${b.toUpperCase()}`);
