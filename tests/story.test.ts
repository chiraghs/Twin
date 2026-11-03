import { describe, expect, it } from "vitest";
import { getStory } from "@/server/story";

describe("landing-page story data", () => {
  const s = getStory();

  it("is computed by the engine on the scripted crisis", () => {
    expect(s.recommendedId).toBe("reroute");
    expect(s.agents.map((a) => a.id)).toEqual(["maintenance", "quality", "production", "supply", "energy", "orchestrator"]);
    expect(s.scenarios.map((x) => x.id)).toEqual(["continue", "preventive", "reroute"]);
    expect(s.focus.step).toBeGreaterThan(1);
    expect(s.focus.hoursToTrip).toBeGreaterThan(5);
    expect(s.vibration.length).toBeGreaterThan(20);
  });

  it("reports positive avoided impact for the recommended plan", () => {
    expect(s.impact.downtimeAvoided).toBeGreaterThan(10);
    expect(s.impact.lateAvoided).toBeGreaterThan(0);
    expect(s.impact.costAvoided).toBeGreaterThan(10000);
  });

  it("captures the executed plan and the restored asset", () => {
    expect(s.audit.some((t) => t.startsWith("Approved"))).toBe(true);
    expect(s.audit.some((t) => t.includes("returned to service"))).toBe(true);
    expect(s.afterHealth).toBeGreaterThan(90);
    expect(s.after.lines.flatMap((l) => l.machines).find((m) => m.id === "A-ROB-03")!.status).toBe("healthy");
    expect(s.crisis.lines.flatMap((l) => l.machines).find((m) => m.id === "A-ROB-03")!.status).toBe("critical");
  });
});
