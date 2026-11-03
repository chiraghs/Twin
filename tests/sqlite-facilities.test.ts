import { describe, expect, it } from "vitest";
import { sqliteStore } from "@/server/db/sqlite";
import { defaultAnchor, newFactorySeed } from "@/domain/seed";
import { templateById } from "@/domain/builder/templates";
import { compileSpec } from "@/domain/builder/compile";
import { nowISO } from "@/server/http";

describe("SQLite Multi-Facility System", () => {
  it("initializes and lists demo-electronics as default", () => {
    const facilities = sqliteStore.listFacilities();
    expect(facilities.length).toBeGreaterThanOrEqual(1);
    const demo = facilities.find((f) => f.id === "demo-electronics");
    expect(demo).toBeDefined();
    expect(demo?.isDemo).toBe(true);
    expect(sqliteStore.getActiveFacilityId()).toBeTruthy();
  });

  it("saves a new custom twin without overwriting the demo", () => {
    const spec = structuredClone(templateById("beverage-bottling")!.spec);
    const customState = compileSpec(spec, defaultAnchor(), newFactorySeed(), nowISO(), "Test User");
    const customId = "fac-test-beverage";
    customState.profile.id = customId;
    customState.profile.isDemo = false;

    sqliteStore.saveFacility(customState, false);

    const facilities = sqliteStore.listFacilities();
    const demo = facilities.find((f) => f.id === "demo-electronics");
    const custom = facilities.find((f) => f.id === customId);

    expect(demo).toBeDefined();
    expect(custom).toBeDefined();
    expect(custom?.isDemo).toBe(false);
    expect(custom?.name).toBe(customState.profile.name);
  });

  it("can switch active facility back and forth", () => {
    sqliteStore.setActiveFacilityId("fac-test-beverage");
    expect(sqliteStore.getActiveFacilityId()).toBe("fac-test-beverage");

    const activeState = sqliteStore.getFacility("fac-test-beverage");
    expect(activeState?.profile.id).toBe("fac-test-beverage");

    sqliteStore.setActiveFacilityId("demo-electronics");
    expect(sqliteStore.getActiveFacilityId()).toBe("demo-electronics");
  });

  it("resetDemo only resets demo-electronics and preserves custom facilities", () => {
    sqliteStore.resetDemo();

    const facilities = sqliteStore.listFacilities();
    const custom = facilities.find((f) => f.id === "fac-test-beverage");
    const demo = facilities.find((f) => f.id === "demo-electronics");

    expect(demo).toBeDefined();
    expect(custom).toBeDefined(); // custom twin is still intact!
  });

  it("deletes a custom facility cleanly", () => {
    sqliteStore.deleteFacility("fac-test-beverage");
    const facilities = sqliteStore.listFacilities();
    const custom = facilities.find((f) => f.id === "fac-test-beverage");
    expect(custom).toBeUndefined();
  });
});
