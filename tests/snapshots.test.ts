import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { injectFault } from "@/domain/commands";
import { NOW } from "./helpers";

/** Named snapshots: save the whole twin, restore it exactly, per facility, with a limit. */

let dir = "";
let repo: typeof import("@/server/db/sqlite");
let conn: typeof import("@/server/db/connection");
let snaps: typeof import("@/server/db/snapshots");
let views: typeof import("@/server/db/views");
let links: typeof import("@/server/db/signal-links");
let models: typeof import("@/server/db/models");

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "twin-snap-"));
  vi.stubEnv("TWIN_DATA_DIR", dir);
  vi.resetModules();
  conn = await import("@/server/db/connection");
  repo = await import("@/server/db/sqlite");
  snaps = await import("@/server/db/snapshots");
  views = await import("@/server/db/views");
  links = await import("@/server/db/signal-links");
  models = await import("@/server/db/models");
});
afterAll(() => {
  conn.closeDb();
  vi.unstubAllEnvs();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("facility snapshots", () => {
  it("saves, lists, restores exactly and deletes", () => {
    const store = repo.sqliteStore;
    const id = store.listFacilities()[0].id;
    const before = store.getFacility(id)!;
    const meta = snaps.saveSnapshot(before, "Before trip test", "tester", NOW);
    expect(snaps.listSnapshots(id).map((s) => s.name)).toEqual(["Before trip test"]);
    expect(meta.bytes).toBeGreaterThan(1000);

    // Change the twin: trip a machine, persist.
    const changed = JSON.parse(JSON.stringify(before));
    const assetId = changed.assets[0].id;
    injectFault(changed, { assetId, mode: "failure", severity: 100 }, NOW);
    store.saveFacility(changed, true);
    expect(JSON.stringify(store.getFacility(id))).not.toBe(JSON.stringify(before));

    // Restore: the saved state round-trips exactly, including rows the change added.
    const snap = snaps.loadSnapshot(id, meta.id)!;
    store.saveFacility(snap.state, true);
    expect(JSON.stringify(store.getFacility(id))).toBe(JSON.stringify(before));

    expect(snaps.loadSnapshot("other-facility", meta.id)).toBeNull();
    expect(snaps.deleteSnapshot(id, meta.id)).toBe(true);
    expect(snaps.deleteSnapshot(id, meta.id)).toBe(false);
    expect(snaps.listSnapshots(id)).toEqual([]);
  });

  it("refuses more than the limit per facility", () => {
    const store = repo.sqliteStore;
    const state = store.getFacility(store.listFacilities()[0].id)!;
    for (let i = 0; i < snaps.SNAPSHOT_LIMIT; i++) snaps.saveSnapshot(state, `s${i}`, "t", NOW);
    expect(() => snaps.saveSnapshot(state, "one too many", "t", NOW)).toThrow(/already has/);
  });
});

describe("saved 3D views and virtual cameras", () => {
  it("saves, lists in order, rejects bad poses, enforces the limit and deletes", async () => {
    const { VIEW_LIMIT, validPose } = await import("@/domain/views");
    const fid = repo.sqliteStore.listFacilities()[0].id;
    const a = views.saveView(fid, { name: "Line A overview", kind: "view", position: [10.12345, 8, 10], target: [0, 0, 0] }, "t", NOW);
    const b = views.saveView(fid, { name: "Dock cam", kind: "camera", position: [4, 3, 4], target: [1, 0, 1] }, "t", NOW);
    expect(a.position[0]).toBe(10.123);
    expect(views.listViews(fid).map((v) => [v.name, v.kind])).toEqual([["Line A overview", "view"], ["Dock cam", "camera"]]);
    expect(views.listViews("other")).toEqual([]);
    expect(validPose([1, 1, 1], [1, 1, 1])).toBe(false);
    expect(validPose([Number.NaN, 0, 0], [0, 0, 0])).toBe(false);
    expect(() => views.saveView(fid, { name: "bad", kind: "view", position: [0, 0, 0], target: [0, 0, 0] }, "t", NOW)).toThrow(/isn't valid/);
    for (let i = 2; i < VIEW_LIMIT; i++) views.saveView(fid, { name: `v${i}`, kind: "view", position: [i, 2, 2], target: [0, 0, 0] }, "t", NOW);
    expect(() => views.saveView(fid, { name: "too many", kind: "view", position: [9, 9, 9], target: [0, 0, 0] }, "t", NOW)).toThrow(/already has/);
    expect(views.deleteView(fid, b.id)).toBe(true);
    expect(views.deleteView(fid, b.id)).toBe(false);
    expect(views.listViews(fid)).toHaveLength(VIEW_LIMIT - 1);
  });
});

describe("signal links", () => {
  it("links one field tag per twin signal, relinking replaces, and deletes", async () => {
    const { linkAgrees, modbusAddress } = await import("@/domain/signal-links");
    const fid = repo.sqliteStore.listFacilities()[0].id;
    const a = links.saveLink(fid, { signalId: "A-ROB-03.Vibration", protocol: "opcua", endpoint: "opc.tcp://127.0.0.1:4841/twin-plc/", address: "ns=2;s=PLC1.A-ROB-03.Vibration", scale: 1, label: "PLC1.A-ROB-03.Vibration" }, "t", NOW);
    const b = links.saveLink(fid, { signalId: "A-ROB-03.Vibration", protocol: "modbus", endpoint: "127.0.0.1:5021", address: modbusAddress("127.0.0.1", 5021, 1, "holding", 21), scale: 0.01, label: "reg 21" }, "t", NOW);
    expect(b.id).toBe(a.id);
    const list = links.listLinks(fid);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ protocol: "modbus", address: "127.0.0.1:5021/1/holding/21", scale: 0.01 });
    expect(links.deleteLink(fid, a.id)).toBe(true);
    expect(links.listLinks(fid)).toEqual([]);
    expect(linkAgrees(6.0, 6.1, 7.1)).toBe(true);
    expect(linkAgrees(6.0, 7.5, 7.1)).toBe(false);
    expect(linkAgrees(true, 1)).toBe(true);
    expect(linkAgrees(true, null)).toBeNull();
  });
});

describe("machine models", () => {
  it("accepts only binary glTF and stores one model per machine type", () => {
    const fid = repo.sqliteStore.listFacilities()[0].id;
    const glb = new Uint8Array(24);
    glb.set([0x67, 0x6c, 0x54, 0x46, 2, 0, 0, 0]);
    expect(models.isGlb(glb)).toBe(true);
    expect(models.isGlb(new Uint8Array(24))).toBe(false);
    models.saveModel(fid, "robot", "arm.glb", glb, "t", NOW);
    models.saveModel(fid, "robot", "arm-v2.glb", glb, "t", NOW);
    expect(models.listModels(fid).map((m) => m.fileName)).toEqual(["arm-v2.glb"]);
    expect(models.loadModel(fid, "robot")!.bytes.length).toBe(24);
    expect(models.deleteModel(fid, "robot")).toBe(true);
    expect(models.loadModel(fid, "robot")).toBeNull();
  });
});
