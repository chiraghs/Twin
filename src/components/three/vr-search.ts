import { ARCHETYPES } from "@/domain/archetypes";
import type { Layout } from "@/domain/layout";
import { robotBatteries } from "@/domain/process-signals";
import type { FactoryState } from "@/domain/types";
import type { AmrPath } from "./amr-paths";

/** Everything you can find and go to in the VR plant. Positions are layout (floor) coordinates. */
export type FindKind = "machine" | "line" | "robot" | "camera" | "stock" | "order";

export interface FindEntry {
  key: string;
  kind: FindKind;
  label: string;
  sub: string;
  x: number;
  y: number;
  /** Machines: selecting the result also selects the machine (board and control panel). */
  assetId?: string;
  /** Lower-case text searched over. */
  hay: string;
}

export const FIND_KIND_LABEL: Record<FindKind, string> = {
  machine: "Machines",
  line: "Lines",
  robot: "Mobile robots",
  camera: "Cameras",
  stock: "Stock",
  order: "Orders",
};

const entry = (e: Omit<FindEntry, "hay">, extra: string[] = []): FindEntry => ({ ...e, hay: [e.label, e.sub, ...extra].join(" ").toLowerCase() });

/** Build the search index for the active plant. */
export function findIndex(state: FactoryState, layout: Layout, paths: AmrPath[]): FindEntry[] {
  const out: FindEntry[] = [];
  const lineName = new Map(state.lines.map((l) => [l.id, l.name]));
  const assetById = new Map(state.assets.map((a) => [a.id, a]));
  const pos = new Map(layout.machines.map((m) => [m.m.id, m]));

  for (const pm of layout.machines) {
    const a = assetById.get(pm.m.id);
    const kindName = ARCHETYPES[pm.m.kind]?.name ?? pm.m.kind;
    out.push(
      entry(
        { key: `m:${pm.m.id}`, kind: "machine", label: `${pm.m.id} · ${pm.m.name}`, sub: `${kindName} · ${lineName.get(pm.lineId) ?? pm.lineId} · ${pm.m.status}`, x: pm.x, y: pm.y, assetId: pm.m.id },
        [pm.m.kind, a?.model ?? "", a?.manufacturer ?? "", ARCHETYPES[pm.m.kind]?.covers ?? ""],
      ),
    );
  }
  for (const l of state.lines) {
    const ms = layout.machines.filter((m) => m.lineId === l.id);
    if (!ms.length) continue;
    const mid = ms[Math.floor(ms.length / 2)];
    out.push(entry({ key: `l:${l.id}`, kind: "line", label: l.name, sub: `${l.kind} line · ${l.state} · ${ms.length} machines`, x: mid.x, y: mid.y }, [l.id]));
  }
  const battery = new Map(robotBatteries(state, paths.map((p) => p.amr)).map((b) => [b.id, b]));
  for (const p of paths) {
    const [x, y] = p.points[0] ?? [0, 0];
    const bt = battery.get(p.amr.id);
    const charge = bt ? ` · battery ${bt.pct}%${bt.charging ? " charging" : bt.low ? " low" : ""}` : "";
    out.push(entry({ key: `r:${p.amr.id}`, kind: "robot", label: `${p.amr.id} · ${p.amr.name}`, sub: `${p.amr.fleetName} · ${p.amr.status}${p.amr.reason ? ` (${p.amr.reason})` : ""}${charge}`, x, y }, ["amr", "agv", "robot", p.amr.robotType, p.amr.mission]));
  }
  for (const c of state.cameras) {
    const near = (c.assetId && pos.get(c.assetId)) || (c.covers[0] && pos.get(c.covers[0])) || null;
    if (!near) continue;
    out.push(entry({ key: `c:${c.id}`, kind: "camera", label: `${c.id} · ${c.name}`, sub: `${c.kind} camera · ${c.zone}`, x: near.x, y: near.y }, ["camera", "cctv", c.purpose]));
  }
  for (const r of layout.racks) {
    const item = state.inventory.find((i) => i.id === r.id);
    out.push(entry({ key: `s:${r.id}`, kind: "stock", label: `${r.id} · ${r.name}`, sub: `${item ? `${Math.round(item.onHand)} ${item.unit} on hand` : "stores"}${r.low ? " · below reorder point" : ""}`, x: r.x, y: r.y }, ["stock", "inventory", "rack", item?.supplier ?? ""]));
  }
  for (const t of layout.trucks) {
    out.push(entry({ key: `o:${t.id}`, kind: "order", label: `${t.id} · ${t.customer}`, sub: `${Math.round(t.progress * 100)}% loaded · ${t.priority}${t.atRisk ? " · at risk" : ""}`, x: t.x, y: t.y }, ["order", "truck", "dock", "shipment"]));
  }
  return out;
}

const compact = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * All words must match; exact id and label-prefix matches rank first. Ids also match with their
 * punctuation and spaces removed, as speech transcription often returns them ("arob03", "a rob 03"
 * → A-ROB-03).
 */
export function findEntries(index: FindEntry[], query: string, limit = 12): FindEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const words = q.split(/\s+/);
  const cq = compact(q);
  const scored: { e: FindEntry; s: number }[] = [];
  for (const e of index) {
    const id = compact(e.label.split(" · ")[0]);
    const idHit = cq.length >= 3 && (id === cq || (cq.length >= 4 && id.startsWith(cq)));
    if (!idHit && !words.every((w) => e.hay.includes(w) || compact(e.hay).includes(compact(w)))) continue;
    const label = e.label.toLowerCase();
    const s = (idHit && id === cq ? -1 : label.startsWith(q) ? 0 : label.includes(q) ? 1 : 2) * 10 + (e.kind === "machine" ? 0 : 1);
    scored.push({ e, s });
  }
  return scored.sort((a, b) => a.s - b.s || a.e.label.localeCompare(b.e.label)).slice(0, limit).map((x) => x.e);
}

/**
 * Where to stand to look at (x, y): try 8 directions at two distances and take the spot farthest
 * from every other machine (so you don't land inside a neighbouring cell), preferring the
 * plant-front side, inside the given bounds. Layout coordinates.
 */
export function standPoint(layout: Layout, x: number, y: number, bounds: { x0: number; x1: number; y0: number; y1: number }, exceptId?: string) {
  const others = layout.machines.filter((m) => m.m.id !== exceptId && Math.hypot(m.x - x, m.y - y) > 0.3);
  let best = { x, y: Math.min(bounds.y1, y + 3.5), score: -Infinity };
  for (const dist of [3.4, 4.4]) {
    for (let k = 0; k < 8; k++) {
      const a = Math.PI / 2 + (k * Math.PI) / 4; // start at +y (towards the plant front)
      const sx = x + Math.cos(a) * dist;
      const sy = y + Math.sin(a) * dist;
      if (sx < bounds.x0 || sx > bounds.x1 || sy < bounds.y0 || sy > bounds.y1) continue;
      const clear = others.length ? Math.min(...others.map((m) => Math.hypot(m.x - sx, m.y - sy))) : 10;
      const score = Math.min(clear, 3) + (k === 0 ? 0.4 : 0) - (dist > 4 ? 0.2 : 0);
      if (score > best.score) best = { x: sx, y: sy, score };
    }
  }
  return { x: best.x, y: best.y };
}
