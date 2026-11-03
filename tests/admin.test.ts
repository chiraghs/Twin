import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DomainError } from "@/domain/actions";
import { clipsFor, FOOTAGE, getClip, suggestedClip } from "@/domain/footage";
import { advanceFactory } from "@/domain/telemetry";
import { describeStream, setCameraStream } from "@/domain/vision";
import { demo, NOW } from "./helpers";

const req = (cookie?: string, headers: Record<string, string> = {}) => new Request("https://twin.example/api/x", { headers: { ...(cookie ? { cookie } : {}), ...headers } });

describe("admin session", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("is open for local development, locked on Cloud Run without a passcode", async () => {
    const { adminMode, isAdmin, requireAdmin } = await import("@/server/admin");
    vi.stubEnv("TWIN_ADMIN_KEY", "");
    vi.stubEnv("K_SERVICE", "");
    expect(adminMode()).toBe("open-local");
    expect(isAdmin(req())).toBe(true);
    vi.stubEnv("K_SERVICE", "twin");
    expect(adminMode()).toBe("locked");
    expect(isAdmin(req())).toBe(false);
    expect(() => requireAdmin(req())).toThrow(DomainError);
  });

  it("issues a signed cookie for the right passcode only, and it expires", async () => {
    const { isAdmin, signIn } = await import("@/server/admin");
    vi.stubEnv("TWIN_ADMIN_KEY", "correct horse battery staple");
    expect(() => signIn(req(undefined, { "x-forwarded-for": "10.0.0.1" }), "wrong")).toThrow("Incorrect passcode");
    const now = Date.now();
    const setCookie = signIn(req(undefined, { "x-forwarded-for": "10.0.0.2" }), "correct horse battery staple", now);
    expect(setCookie).toMatch(/HttpOnly/);
    expect(setCookie).toMatch(/SameSite=Strict/);
    expect(setCookie).toMatch(/Secure/);
    const cookie = setCookie.split(";")[0];
    expect(isAdmin(req(cookie), now)).toBe(true);
    expect(isAdmin(req(cookie), now + 9 * 3600_000)).toBe(false);
    // Tampered signature or a different passcode invalidates the session.
    expect(isAdmin(req(cookie.replace(/.$/, (c) => (c === "A" ? "B" : "A"))), now)).toBe(false);
    vi.stubEnv("TWIN_ADMIN_KEY", "rotated passcode");
    expect(isAdmin(req(cookie), now)).toBe(false);
  });

  it("rate-limits repeated wrong passcodes", async () => {
    const { signIn } = await import("@/server/admin");
    vi.stubEnv("TWIN_ADMIN_KEY", "s3cret-passcode");
    const r = req(undefined, { "x-forwarded-for": "10.9.9.9" });
    for (let i = 0; i < 8; i++) expect(() => signIn(r, "nope")).toThrow("Incorrect passcode");
    expect(() => signIn(r, "s3cret-passcode")).toThrow("Too many attempts");
  });
});

describe("integration settings", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "tf-settings-"));
    vi.stubEnv("TWIN_DATA_DIR", dir);
    vi.stubEnv("TWIN_CONFIG_BUCKET", "");
    vi.resetModules();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("overrides the environment, can turn a setting off, and can return to the environment", async () => {
    vi.stubEnv("MQTT_BROKER_URL", "mqtt://env-broker:1883");
    const s = await import("@/server/settings");
    s.__resetSettingsForTests();
    expect(s.setting("MQTT_BROKER_URL")).toBe("mqtt://env-broker:1883");
    expect(s.settingSource("MQTT_BROKER_URL")).toBe("environment");

    expect(await s.updateSettings({ MQTT_BROKER_URL: "mqtts://ui-broker:8883" }, "Admin")).toEqual(["MQTT_BROKER_URL"]);
    expect(s.setting("MQTT_BROKER_URL")).toBe("mqtts://ui-broker:8883");
    expect(s.settingSource("MQTT_BROKER_URL")).toBe("ui");

    await s.updateSettings({ MQTT_BROKER_URL: "" }, "Admin");
    expect(s.setting("MQTT_BROKER_URL")).toBe("");

    await s.updateSettings({ MQTT_BROKER_URL: null }, "Admin");
    expect(s.setting("MQTT_BROKER_URL")).toBe("mqtt://env-broker:1883");
    const { db } = await import("@/server/db/connection");
    expect(db().prepare("SELECT COUNT(*) AS n FROM app_settings WHERE key = 'MQTT_BROKER_URL'").get()).toEqual({ n: 0 });
    expect(s.settingsHistory().filter((h) => h.key === "MQTT_BROKER_URL").map((h) => h.action)).toEqual(["reverted", "cleared", "set"]);
  });

  it("validates values and never returns secrets", async () => {
    const s = await import("@/server/settings");
    s.__resetSettingsForTests();
    await expect(s.updateSettings({ VISION_SERVICE_URL: "http://10.0.0.5:8000" }, "Admin")).rejects.toThrow(/https/);
    await expect(s.updateSettings({ VISION_SERVICE_URL: "https://169.254.169.254/" }, "Admin")).rejects.toThrow(/not allowed/);
    await expect(s.updateSettings({ TELEMETRY_SOURCE: "kafka" }, "Admin")).rejects.toThrow(/choose one of/);
    await expect(s.updateSettings({ NOT_A_SETTING: "x" }, "Admin")).rejects.toThrow(/unknown setting/);
    await s.updateSettings({ TWIN_MCP_TOKEN: "abcdefghijklmnop1234" }, "Admin");
    const [token] = s.describeSettings(["TWIN_MCP_TOKEN"]);
    expect(token.isSet).toBe(true);
    expect(token.value).toBeNull();
    expect(JSON.stringify(s.describeSettings(s.SETTING_KEYS))).not.toContain("abcdefghijklmnop1234");
  });

  it("with a Cloud Storage bucket, never overwrites saved settings it could not read", async () => {
    vi.stubEnv("TWIN_CONFIG_BUCKET", "cfg-bucket");
    let saved: { values: Record<string, string> } = { values: { MQTT_TOPIC: "plant/+/telemetry" } };
    let unreachable = true;
    vi.doMock("@/server/integrations/gcp", () => ({
      gcpFetch: vi.fn(async (_url: string, init?: { method?: string; body?: string }) => {
        if (init?.method === "POST") {
          saved = JSON.parse(init.body!);
          return {};
        }
        if (unreachable) throw new Error("This operation was aborted");
        return saved;
      }),
    }));
    const s = await import("@/server/settings");
    s.__resetSettingsForTests();
    await expect(s.updateSettings({ MQTT_BROKER_URL: "mqtt://broker:1883" }, "Admin")).rejects.toThrow(/could not be read/);
    expect(saved.values).toEqual({ MQTT_TOPIC: "plant/+/telemetry" });
    unreachable = false;
    await s.updateSettings({ MQTT_BROKER_URL: "mqtt://broker:1883" }, "Admin");
    expect(saved.values).toEqual({ MQTT_TOPIC: "plant/+/telemetry", MQTT_BROKER_URL: "mqtt://broker:1883" });
    expect(s.setting("MQTT_TOPIC")).toBe("plant/+/telemetry");
    expect(s.settingsStorage()).toMatchObject({ kind: "cloud-storage", ok: true });
    vi.doUnmock("@/server/integrations/gcp");
  });

  it("drives the adapters and the AI configuration", async () => {
    vi.stubEnv("MODEL_API_KEY", "meta-test-0123456789abcdefghijklmnop");
    const s = await import("@/server/settings");
    s.__resetSettingsForTests();
    const { aiConfig } = await import("@/server/ai/provider");
    const { visionService } = await import("@/server/integrations/vision-service");
    expect(aiConfig().provider).toBe("meta");
    await s.updateSettings({ AI_ENABLED: "false", VISION_SERVICE_URL: "http://localhost:8000/" }, "Admin");
    expect(aiConfig()).toMatchObject({ provider: "none", disabled: true });
    expect(visionService.configured()).toBe(true);
    expect(visionService.url()).toBe("http://localhost:8000");
  });
});

describe("camera sources", () => {
  it("switches between the twin feed, reference footage and a gateway, with an audit entry each time", () => {
    const s = demo();
    const cam = s.cameras.find((c) => c.id === "CCTV-A1")!;
    expect(() => setCameraStream(s, cam.id, { kind: "footage", clipId: "no-such-clip" }, "Admin", NOW)).toThrow(DomainError);
    expect(() => setCameraStream(s, cam.id, { kind: "hls", url: "http://10.0.0.9/a.m3u8" }, "Admin", NOW)).toThrow(/https/);
    setCameraStream(s, cam.id, { kind: "hls", url: "https://gw.example/cam/index.m3u8" }, "Admin", NOW);
    expect(cam.stream).toEqual({ kind: "hls", url: "https://gw.example/cam/index.m3u8" });
    expect(s.audit[0].title).toMatch(/HLS gateway/);
    setCameraStream(s, cam.id, { kind: "simulated" }, "Admin", NOW);
    expect(cam.stream).toEqual({ kind: "simulated", url: null });
    const clip = suggestedClip(cam);
    if (clip) {
      setCameraStream(s, cam.id, { kind: "footage", clipId: clip.id }, "Admin", NOW);
      expect(cam.stream).toEqual({ kind: "footage", url: clip.src, clipId: clip.id });
      expect(describeStream(cam)).toMatch(/not this plant/);
      expect(s.audit[0].detail).toMatch(/not this plant/);
    }
  });

  it("ships every footage clip with its file, poster and license", () => {
    for (const clip of FOOTAGE) {
      expect(getClip(clip.id)).toBe(clip);
      for (const f of [clip.src, clip.poster]) expect(fs.existsSync(path.join(process.cwd(), "public", f)), f).toBe(true);
      expect(clip.src).toMatch(/^\/footage\/[a-z0-9-]+\.mp4$/);
      expect(clip.source.pageUrl).toMatch(/^https:\/\//);
      expect(clip.source.licenseUrl).toMatch(/^https:\/\//);
      expect(clip.source.author.length).toBeGreaterThan(1);
      expect(clip.kinds.length).toBeGreaterThan(0);
    }
    const s = demo();
    if (FOOTAGE.length) for (const c of s.cameras) expect(clipsFor(c).length, c.id).toBeGreaterThan(0);
  });
});

describe("stock-outs", () => {
  it("are reported once when an item runs out, not on every tick", () => {
    const s = demo();
    for (let i = 0; i < 30 * 70; i++) advanceFactory(s, 1 / 30, { nowISO: NOW });
    const exhausted = s.audit.filter((e) => /exhausted/.test(e.title));
    const items = new Set(exhausted.map((e) => e.title));
    expect(exhausted.length).toBeGreaterThan(0);
    expect(exhausted.length).toBeLessThanOrEqual(items.size * 2);
  });
});
