import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildDemoFactory, buildFactory, DEMO_BLUEPRINT } from "@/domain/seed";
import { ANCHOR } from "./helpers";

/** The judge demo must stay byte-identical: any change to the seeded plant shows up here. */
describe("demo fingerprints", () => {
  const h = (o: unknown) => createHash("sha256").update(JSON.stringify(o)).digest("hex").slice(0, 16);
  it("the demo factory is unchanged", () => {
    expect(h(buildDemoFactory(ANCHOR))).toBe("9c4d928e1463c433");
  });
  it("a blueprint factory (3 lines) is unchanged", () => {
    expect(h(buildFactory({ ...DEMO_BLUEPRINT, assemblyLines: 3, assetKinds: ["conveyor", "robot", "camera"], isDemo: false }, ANCHOR, 42))).toBe("dd66e3213f2331ba");
  });
});
