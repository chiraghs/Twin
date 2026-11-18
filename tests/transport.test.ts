import { describe, expect, it } from "vitest";
import { atLimit, homePose, jogAxis, machineAxes } from "@/domain/axes";
import { createTransport, stepTransport, syncTransport, transportStats } from "@/domain/transport";
import { crisis } from "./helpers";

describe("per-product transport", () => {
  it("conserves units, follows the product mix, counts at every photo-eye and is deterministic", () => {
    const s = crisis();
    const line = s.lines[0];
    const a = createTransport(s, line.id);
    const b = createTransport(s, line.id);
    stepTransport(a, 1800);
    stepTransport(b, 1800);
    const st = transportStats(a);
    expect(JSON.stringify(st)).toBe(JSON.stringify(transportStats(b)));
    expect(st.created).toBe(st.wip + st.finished);
    expect(st.finished).toBeGreaterThan(5);
    // Every finished unit passed every photo-eye.
    for (const sensor of st.sensors) expect(sensor.count).toBeGreaterThanOrEqual(st.finished);
    // Mix follows the allocation (within one unit per product).
    const shares = Object.entries(line.allocation).filter(([, v]) => v > 0);
    const total = shares.reduce((x, [, v]) => x + v, 0);
    for (const [p, v] of shares) expect(Math.abs((st.finishedByProduct[p] ?? 0) - (st.finished * v) / total)).toBeLessThanOrEqual(2);
    // The output rate can't exceed the slowest machine.
    const slowest = Math.min(...a.stations.map((x) => 3600 / x.cycleS));
    expect(st.ratePerHour).toBeLessThanOrEqual(Math.ceil(slowest) + 1);
    expect(st.bottleneck).not.toBeNull();
  });

  it("a machine going down stops output, queues units in front of it and starves the machines after it", () => {
    const s = crisis();
    const line = s.lines[0];
    const sim = createTransport(s, line.id);
    stepTransport(sim, 900);
    const mid = sim.stations[1];
    const asset = s.assets.find((x) => x.id === mid.assetId)!;
    asset.mode = "down";
    syncTransport(sim, s);
    const before = transportStats(sim);
    // Units already past the downed machine (on the belt or in the machines after it).
    const downstream = sim.units.filter((u) => u.next > 1).length;
    const upstream = sim.units.length - downstream;
    stepTransport(sim, 900);
    const after = transportStats(sim);
    expect(after.stations[1].state).toBe("down");
    // Whatever was downstream finishes, then nothing more leaves the line.
    expect(after.finished - before.finished).toBe(downstream);
    // The queue in front of it fills the belt, then the source is held back (no room to release).
    expect(sim.units.length).toBeGreaterThanOrEqual(upstream);
    expect(sim.units.every((u) => u.next <= 1)).toBe(true);
    const created = sim.created;
    stepTransport(sim, 300);
    expect(sim.created).toBe(created);
    expect(after.stations[sim.stations.length - 1].state).toBe("starved");
    expect(after.sensors[1].blocked).toBe(true);
    // Restore: flow resumes.
    asset.mode = "running";
    syncTransport(sim, s);
    stepTransport(sim, 900);
    expect(transportStats(sim).finished).toBeGreaterThan(after.finished);
  });
});

describe("machine axes", () => {
  it("defines axes per machine type and jogs within limits", () => {
    expect(machineAxes("robot").map((a) => a.id)).toEqual(["J1", "J2", "J3", "J4", "GRIP"]);
    expect(machineAxes("conveyor")).toEqual([]);
    expect(homePose("press")).toEqual({ Z: 0 });
    const z = machineAxes("press")[0];
    expect(jogAxis(z, 115, 10)).toBe(120);
    expect(atLimit(z, 120)).toBe(true);
    expect(jogAxis(z, 0, -10)).toBe(0);
    const c = machineAxes("cnc")[0];
    expect(jogAxis(c, 350, 15)).toBe(5);
    expect(jogAxis(c, 0, -15)).toBe(345);
    expect(atLimit(c, 0)).toBe(false);
  });
});
