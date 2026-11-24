import { describe, expect, it } from "vitest";
import { computeKpis } from "@/domain/kpis";
import { machineProduction, plantProduction } from "@/domain/production";
import { partCounts } from "@/domain/process-signals";
import { demo } from "./helpers";

describe("production figures", () => {
  it("a machine's Production tab agrees with its line's counts and the plant KPIs", () => {
    const s = demo();
    const a = s.assets.find((x) => x.id === "A-ROB-03")!;
    const m = machineProduction(s, a);
    expect(m.state?.bottleneck).toBe(true);
    expect(m.line?.id).toBe("LINE-A");
    expect(m.line?.bottleneckId).toBe("A-ROB-03");
    // The window's first hour counts in part, so the line can be a little above the whole-hour count.
    expect(m.line!.good).toBeGreaterThanOrEqual(partCounts(s).lines["LINE-A"].good);
    expect(m.line!.good + m.line!.reject).toBeLessThanOrEqual(Math.ceil(m.units * 1.02));
    expect(m.rejectsCaused).toBe(partCounts(s).byMachine["A-ROB-03"] ?? 0);
    expect(m.cycle.idealS).toBeCloseTo(3600 / a.nominalRate, 1);
    expect(m.line!.hourly.length).toBeGreaterThan(0);
    expect(m.line!.losses.run).toBeLessThanOrEqual(m.line!.losses.planned + 1e-6);
    // Units produced: its throughput integrated over time — about its rate × the hours it ran.
    expect(m.units).toBeGreaterThan(0);
    expect(m.units).toBeLessThanOrEqual(Math.ceil(a.nominalRate * 8 * 1.05));
    expect(m.hourlyUnits.length).toBeGreaterThan(0);
    for (const h of m.hourlyUnits) expect(h.units).toBeLessThanOrEqual(Math.ceil(a.nominalRate * 1.05));
  });

  it("the plant page covers every line, machine and open order", () => {
    const s = demo();
    const p = plantProduction(s, 8);
    expect(p.lines).toHaveLength(s.lines.length);
    expect(p.machines).toHaveLength(s.assets.length);
    expect(p.kpis.oee.oee).toBe(computeKpis(s, 8).oee.oee);
    expect(p.orders.every((o) => o.completedHour === null && o.progress >= 0 && o.progress <= 1)).toBe(true);
    expect(p.orders.map((o) => o.dueHour)).toEqual([...p.orders.map((o) => o.dueHour)].sort((x, y) => x - y));
  });
});
