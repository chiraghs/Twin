import { describe, expect, it } from "vitest";
import { amrPaths } from "@/components/three/amr-paths";
import { findEntries, findIndex } from "@/components/three/vr-search";
import { amrFleet } from "@/domain/intralogistics";
import { isoModelFromState, layoutIso } from "@/domain/layout";
import { crisis } from "./helpers";

describe("VR search", () => {
  const s = crisis();
  const layout = layoutIso(isoModelFromState(s, {}, { cameras: false }));
  const index = findIndex(s, layout, amrPaths(layout, amrFleet(s), s.lines.map((l) => l.id)));

  it("indexes machines, lines, robots, cameras, stock and orders with positions", () => {
    const kinds = new Set(index.map((e) => e.kind));
    for (const k of ["machine", "line", "robot", "camera", "stock", "order"]) expect(kinds.has(k as never), k).toBe(true);
    expect(index.filter((e) => e.kind === "machine")).toHaveLength(layout.machines.length);
    for (const e of index) expect(Number.isFinite(e.x) && Number.isFinite(e.y)).toBe(true);
  });

  it("finds by id, name, type and words, best match first", () => {
    expect(findEntries(index, "a-rob-03")[0].assetId).toBe("A-ROB-03");
    // As speech transcription returns ids.
    expect(findEntries(index, "arob03")[0].assetId).toBe("A-ROB-03");
    expect(findEntries(index, "a rob 03")[0].assetId).toBe("A-ROB-03");
    expect(findEntries(index, "A ROB 03.")[0].assetId).toBe("A-ROB-03");
    expect(findEntries(index, "robot").some((e) => e.kind === "robot")).toBe(true);
    expect(findEntries(index, "robot").some((e) => e.kind === "machine")).toBe(true);
    expect(findEntries(index, "assembly line a")[0].kind).toBe("line");
    expect(findEntries(index, "")).toEqual([]);
    expect(findEntries(index, "zzzz-nothing")).toEqual([]);
  });
});

describe("VR stand point", async () => {
  const { standPoint } = await import("@/components/three/vr-search");
  it("picks a spot clear of other machines and inside the bounds", () => {
    const s = crisis();
    const layout = layoutIso(isoModelFromState(s, {}, { cameras: false }));
    const b = layout.bounds;
    const bounds = { x0: b.x0 - 0.5, x1: b.x1 + 0.5, y0: b.y0 - 0.5, y1: b.y1 + 3 };
    for (const pm of layout.machines) {
      const sp = standPoint(layout, pm.x, pm.y, bounds, pm.m.id);
      expect(sp.x).toBeGreaterThanOrEqual(bounds.x0);
      expect(sp.y).toBeLessThanOrEqual(bounds.y1);
      const nearest = Math.min(...layout.machines.filter((m) => m.m.id !== pm.m.id).map((m) => Math.hypot(m.x - sp.x, m.y - sp.y)));
      expect(nearest, pm.m.id).toBeGreaterThan(1.2);
    }
  });
});
