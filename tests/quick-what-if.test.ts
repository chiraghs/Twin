import { describe, expect, it } from "vitest";
import { quickWhatIf } from "@/domain/quick-what-if";
import { crisis } from "./helpers";

describe("quick what-if", () => {
  it("slowing the wearing robot delays its trip and changes nothing in the plant", () => {
    const s = crisis();
    const before = JSON.stringify(s);
    const r = quickWhatIf(s, "A-ROB-03", { speedPct: 80 });
    expect(r.asIs.failureHour).not.toBeNull();
    expect(r.plan.failureHour!).toBeGreaterThan(r.asIs.failureHour!);
    expect(r.summary).toMatch(/^What if A-ROB-03 runs at 80%: .*trip moves from hour \d+ to hour \d+/);
    expect(JSON.stringify(s)).toBe(before);
  });

  it("maintaining now avoids the trip; speeds outside the machine's range are capped", () => {
    const s = crisis();
    const m = quickWhatIf(s, "A-ROB-03", { maintainNow: true });
    expect(m.plan.failureHour).toBeNull();
    expect(m.summary).toMatch(/avoids the trip/);
    expect(m.better).toBe(true);
    const c = quickWhatIf(s, "A-ROB-03", { speedPct: 150 });
    expect(c).toMatchObject({ speedPct: 110, capped: true });
  });
});
