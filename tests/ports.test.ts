import { describe, expect, it } from "vitest";
import { applyOps } from "@/domain/builder/ops";
import { templateById, TEMPLATES } from "@/domain/builder/templates";
import { canFollow, checkLine, portSummary } from "@/domain/ports";
import type { AssetKind } from "@/domain/types";
import { crisis } from "./helpers";

describe("typed material ports", () => {
  it("every line in the demo plant and in every template flows", () => {
    const s = crisis();
    for (const l of s.lines) {
      const kinds = l.assetIds.map((id) => s.assets.find((a) => a.id === id)!.kind);
      expect(checkLine(kinds).problems, l.id).toEqual([]);
    }
    for (const t of TEMPLATES) {
      for (const l of t.spec.lines) expect(checkLine(l.machines.map((m) => m.archetype as AssetKind)).problems, `${t.id}/${l.id}`).toEqual([]);
    }
  });

  it("refuses links whose material doesn't match, with a reason", () => {
    const line: AssetKind[] = ["conveyor", "robot", "packager"];
    expect(canFollow(line, 2, "labeler")).toEqual({ ok: true, material: "packed" });
    const bad = canFollow(line, 2, "cnc");
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.reason).toMatch(/delivers packed goods; this machine takes parts or assemblies/);
    expect(canFollow(["mixer"], 0, "cnc").ok).toBe(false);
    expect(canFollow(["conveyor", "palletizer"], 1, "labeler").ok).toBe(false);
    expect(canFollow(["mixer"], 0, "filler")).toEqual({ ok: true, material: "bulk" });
    expect(checkLine(["mixer", "filler", "labeler", "palletizer"]).out).toEqual(["bulk", "packed", "packed", "pallet"]);
    expect(portSummary("packager")).toBe("parts, assemblies, packed goods → packed goods");
  });

  it("the shared connect operation (used by the floor and the AI assistant) refuses a mismatch", () => {
    const spec = templateById("beverage-bottling")!.spec;
    const palletizer = spec.lines.flatMap((l) => l.machines).find((m) => m.archetype === "palletizer")!;
    const labeler = spec.lines.flatMap((l) => l.machines).find((m) => m.archetype === "labeler")!;
    const r = applyOps(spec, [{ op: "connect", machineId: palletizer.id, targetId: labeler.id }], { source: "user", at: "2026-01-01T00:00:00Z" } as never);
    expect(r.applied).toEqual([]);
    expect(r.rejected.join(" ")).toMatch(/can't follow .*delivers pallets/);
  });
});
