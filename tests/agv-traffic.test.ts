import { describe, expect, it } from "vitest";
import { createTraffic, routeCells, stepTraffic, trafficStats, type TrafficRobotInput } from "@/domain/agv-traffic";

const robot = (id: string, points: [number, number][], extra: Partial<TrafficRobotInput> = {}): TrafficRobotInput => ({ id, fleetId: "F", points, speedMps: 1, tripsPerHour: 6, active: true, phase: 0, ...extra });

describe("AGV zone traffic", () => {
  it("splits a route into zones with headings", () => {
    const cells = routeCells([[0.5, 0.5], [3.5, 0.5], [3.5, 2.5]]);
    expect(cells.map((c) => c.zone)).toEqual(["0:0", "1:0", "2:0", "3:0", "3:1", "3:2"]);
    expect(cells[1].heading).toBe("E");
    expect(cells[5].heading).toBe("S");
  });

  it("robots meeting head-on in an aisle pass in opposite lanes without waiting", () => {
    const sim = createTraffic([robot("A", [[0.5, 0.5], [8.5, 0.5]]), robot("B", [[8.5, 0.5], [0.5, 0.5]])]);
    stepTraffic(sim, 1200);
    const st = trafficStats(sim);
    expect(st.totalWaitS).toBe(0);
    expect(st.robots.every((r) => r.trips >= 1)).toBe(true);
  });

  it("a robot behind a slower one in the same lane waits, and the wait shows up in that zone", () => {
    const sim = createTraffic([robot("slow", [[0.5, 0.5], [8.5, 0.5]], { speedMps: 0.2, tripsPerHour: 60 }), robot("fast", [[0.5, 0.5], [8.5, 0.5]], { speedMps: 1.5, tripsPerHour: 60 })]);
    stepTraffic(sim, 600);
    const st = trafficStats(sim);
    const fast = st.robots.find((r) => r.id === "fast")!;
    expect(fast.waitPct).toBeGreaterThan(10);
    expect(st.hotspots.length).toBeGreaterThan(0);
  });

  it("crossing traffic contends for the intersection zone", () => {
    const sim = createTraffic([robot("EW", [[0.5, 3.5], [8.5, 3.5]], { tripsPerHour: 60 }), robot("NS", [[4.5, 0.5], [4.5, 8.5]], { tripsPerHour: 60 })]);
    stepTraffic(sim, 1800);
    const st = trafficStats(sim);
    expect(st.zones.find((z) => z.zone === "4:3")!.robots).toBe(2);
    expect(st.robots.every((r) => r.trips > 3)).toBe(true);
  });

  it("paces to the required trips per hour, skips parked robots and is deterministic", () => {
    const mk = () => createTraffic([robot("A", [[0.5, 0.5], [6.5, 0.5]], { tripsPerHour: 4 }), robot("P", [[0.5, 1.5], [6.5, 1.5]], { active: false })]);
    const a = mk();
    const b = mk();
    stepTraffic(a, 3600);
    stepTraffic(b, 3600);
    expect(JSON.stringify(trafficStats(a))).toBe(JSON.stringify(trafficStats(b)));
    const st = trafficStats(a);
    expect(st.robots.find((r) => r.id === "A")!.trips).toBe(4);
    expect(st.robots.find((r) => r.id === "P")!.trips).toBe(0);
  });
});
