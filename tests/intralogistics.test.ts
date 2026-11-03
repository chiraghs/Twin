import { describe, expect, it } from "vitest";
import { amrPaths, amrPose } from "@/components/three/amr-paths";
import { isoModelFromState, layoutIso } from "@/components/iso/model";
import { advanceFactory } from "@/domain/telemetry";
import { amrFleet, amrUtilisation, KIT_UNITS_PER_TRIP, lineOutputRate, PALLET_UNITS_PER_TRIP } from "@/domain/intralogistics";
import { demo, NOW } from "./helpers";

describe("mobile robots (simulated intralogistics)", () => {
  it("gives every process line a kitting robot and every packing line a pallet robot, sized from line output", () => {
    const s = demo();
    advanceFactory(s, 2, { nowISO: NOW });
    const fleet = amrFleet(s);
    expect(fleet.filter((a) => a.mission === "kitting").map((a) => a.lineId)).toEqual(s.lines.filter((l) => l.kind === "assembly").map((l) => l.id));
    expect(fleet.filter((a) => a.mission === "finished-goods").map((a) => a.lineId)).toEqual(s.lines.filter((l) => l.kind === "packaging").map((l) => l.id));
    for (const a of fleet) {
      const line = s.lines.find((l) => l.id === a.lineId)!;
      expect(a.status).toBe("active");
      const per = a.mission === "kitting" ? KIT_UNITS_PER_TRIP : PALLET_UNITS_PER_TRIP;
      expect(a.tripsPerHour).toBeCloseTo(lineOutputRate(s, line) / per, 1);
      expect(a.tripsPerHour).toBeGreaterThan(0);
    }
  });

  it("parks a robot, with the reason, when its line stops", () => {
    const s = demo();
    const line = s.lines.find((l) => l.kind === "assembly")!;
    line.state = "maintenance";
    const amr = amrFleet(s).find((a) => a.lineId === line.id)!;
    expect(amr).toMatchObject({ status: "parked", tripsPerHour: 0, reason: "Line in maintenance" });
    line.state = "starved";
    expect(amrFleet(s).find((a) => a.lineId === line.id)!.reason).toMatch(/out of stock/);
  });

  it("routes keep to the aisles and the animated pose stays on the route", () => {
    const s = demo();
    const layout = layoutIso(isoModelFromState(s));
    const paths = amrPaths(layout, amrFleet(s), s.lines.map((l) => l.id));
    expect(paths).toHaveLength(s.lines.length);
    for (const p of paths) {
      expect(p.length).toBeGreaterThan(1);
      // No waypoint sits on a machine footprint.
      for (const [x, y] of p.points) for (const m of layout.machines) expect(Math.hypot(x - m.x, y - m.y)).toBeGreaterThan(0.5);
      for (let t = 0; t < 40; t += 0.37) {
        const pose = amrPose(p, t, 1.1, 1.6);
        const onRoute = p.points.slice(1).some(([x1, y1], i) => {
          const [x0, y0] = p.points[i];
          const cross = Math.abs((x1 - x0) * (pose.y - y0) - (y1 - y0) * (pose.x - x0));
          const within = pose.x >= Math.min(x0, x1) - 1e-6 && pose.x <= Math.max(x0, x1) + 1e-6 && pose.y >= Math.min(y0, y1) - 1e-6 && pose.y <= Math.max(y0, y1) + 1e-6;
          return cross < 1e-6 && within;
        });
        expect(onRoute).toBe(true);
      }
      const util = amrUtilisation(p.amr, 2 * p.length);
      expect(util).toBeGreaterThan(0);
      expect(util).toBeLessThan(1);
    }
  });
});
