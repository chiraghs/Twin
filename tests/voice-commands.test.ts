import { describe, expect, it } from "vitest";
import { normalizeSpoken, parseVoiceCommand } from "@/domain/voice-commands";

describe("voice commands", () => {
  it("normalises spoken ids", () => {
    expect(normalizeSpoken("A rob zero three")).toBe("a rob 03");
    expect(normalizeSpoken("go to the press")).toBe("go to the press");
    expect(normalizeSpoken("A-ROB-03.")).toBe("a-rob-03");
  });

  it("recognises commands, targets and amounts", () => {
    expect(parseVoiceCommand("Go to A rob zero three")).toEqual({ kind: "goto", query: "a rob 03" });
    expect(parseVoiceCommand("show me the filler")).toEqual({ kind: "goto", query: "filler" });
    expect(parseVoiceCommand("Acknowledge the alarm")).toEqual({ kind: "ack", target: null });
    expect(parseVoiceCommand("acknowledge alarm on A-ROB-03")).toEqual({ kind: "ack", target: "a-rob-03" });
    expect(parseVoiceCommand("speed down")).toEqual({ kind: "speed", delta: -10, target: null });
    expect(parseVoiceCommand("Speed up 20 percent")).toEqual({ kind: "speed", delta: 20, target: null });
    expect(parseVoiceCommand("slow down the press")).toMatchObject({ kind: "speed", delta: -10 });
    expect(parseVoiceCommand("trip")).toEqual({ kind: "trip", target: null });
    expect(parseVoiceCommand("restore")).toEqual({ kind: "restore", target: null });
    expect(parseVoiceCommand("confirm")).toEqual({ kind: "confirm" });
    expect(parseVoiceCommand("cancel")).toEqual({ kind: "cancel" });
    expect(parseVoiceCommand("exit VR")).toEqual({ kind: "exit" });
    expect(parseVoiceCommand("mute")).toEqual({ kind: "mute" });
    expect(parseVoiceCommand("unmute")).toEqual({ kind: "unmute" });
  });

  it("sends questions to the copilot unchanged", () => {
    expect(parseVoiceCommand("Why is this robot vibrating?")).toEqual({ kind: "ask", text: "Why is this robot vibrating?" });
    expect(parseVoiceCommand("What is at risk today")).toMatchObject({ kind: "ask" });
  });
});

describe("overlay, bottleneck, what-if and replay commands", () => {
  it.each([
    ["show heat", { kind: "heat", metric: "temperature" }],
    ["Show the heatmap for vibration.", { kind: "heat", metric: "vibration" }],
    ["show energy", { kind: "heat", metric: "energy" }],
    ["show remaining life", { kind: "heat", metric: "life" }],
    ["heat map off", { kind: "heat", metric: null }],
    ["where is the bottleneck?", { kind: "bottleneck", target: null }],
    ["What's the bottleneck on line A", { kind: "bottleneck", target: "line a" }],
    ["What if A-ROB-03 runs at 80%?", { kind: "whatif", target: "a-rob-03", speedPct: 80, maintain: false }],
    ["what if a rob zero three runs at 120 percent", { kind: "whatif", target: "a rob 03", speedPct: 120, maintain: false }],
    ["what if we maintain it now", { kind: "whatif", target: null, speedPct: null, maintain: true }],
    ["Replay the last 6 hours.", { kind: "replay", hours: 6 }],
    ["rewind two hours", { kind: "replay", hours: 2 }],
    ["back to live", { kind: "replay", hours: null }],
    ["hide flow", { kind: "flow", on: false }],
    ["table view", { kind: "table", on: true }],
    ["go to table view", { kind: "table", on: true }],
    ["switch to table view", { kind: "table", on: true }],
    ["Show the table.", { kind: "table", on: true }],
    ["full size", { kind: "table", on: false }],
    ["Tableview.", { kind: "table", on: true }],
    ["recenter", { kind: "recenter" }],
    ["reset view", { kind: "recenter" }],
    ["seated mode", { kind: "seated", on: true }],
    ["standing mode", { kind: "seated", on: false }],
    ["performance mode", { kind: "perf", on: true }],
    ["quest perf mode off", { kind: "perf", on: false }],
  ])("%s", (text, cmd) => {
    expect(parseVoiceCommand(text)).toEqual(cmd);
  });

  it("questions go to the copilot, not to machine commands", () => {
    expect(parseVoiceCommand("why is line A slow?").kind).toBe("ask");
    expect(parseVoiceCommand("what if the order is late").kind).toBe("ask");
    expect(parseVoiceCommand("speed down 20 percent")).toEqual({ kind: "speed", delta: -20, target: null });
  });

  it("opens the website panel at a page, or closes it", () => {
    expect(parseVoiceCommand("open the website")).toEqual({ kind: "page", href: null, open: true });
    expect(parseVoiceCommand("close the website")).toEqual({ kind: "page", href: null, open: false });
    expect(parseVoiceCommand("open approvals")).toEqual({ kind: "page", href: "/approvals", open: true });
    expect(parseVoiceCommand("Show the AI operations page")).toEqual({ kind: "page", href: "/agents", open: true });
    expect(parseVoiceCommand("open supply chain")).toEqual({ kind: "page", href: "/analytics/supply", open: true });
    expect(parseVoiceCommand("go to the sustainability page")).toEqual({ kind: "page", href: "/sustainability", open: true });
    // Machines and views keep their own commands.
    expect(parseVoiceCommand("go to A rob zero three").kind).toBe("goto");
    expect(parseVoiceCommand("open table view").kind).toBe("table");
    expect(parseVoiceCommand("show vibration").kind).toBe("heat");
  });
});

describe("machine details command", () => {
  it("opens the selected machine's panel at a tab", () => {
    expect(parseVoiceCommand("details")).toEqual({ kind: "details", tab: "overview" });
    expect(parseVoiceCommand("show me the machine details")).toEqual({ kind: "details", tab: "overview" });
    expect(parseVoiceCommand("show telemetry")).toEqual({ kind: "details", tab: "telemetry" });
    expect(parseVoiceCommand("open the history tab")).toEqual({ kind: "details", tab: "maintenance" });
    expect(parseVoiceCommand("links")).toEqual({ kind: "details", tab: "deps" });
    expect(parseVoiceCommand("show docs")).toEqual({ kind: "details", tab: "docs" });
    expect(parseVoiceCommand("short telemetry.")).toEqual({ kind: "details", tab: "telemetry" });
    expect(parseVoiceCommand("shorter telemetry.")).toEqual({ kind: "details", tab: "telemetry" });
  });
  it("leaves other commands alone", () => {
    expect(parseVoiceCommand("show vibration").kind).toBe("heat");
    expect(parseVoiceCommand("open approvals").kind).toBe("page");
    expect(parseVoiceCommand("open maintenance").kind).not.toBe("details");
    expect(parseVoiceCommand("go to A rob zero three").kind).toBe("goto");
  });
});
