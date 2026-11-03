"use client";

import { Bot, Forklift, GripVertical, Truck } from "lucide-react";
import { ARCHETYPES, ASSET_KINDS } from "@/domain/archetypes";
import type { AssetKind } from "@/domain/types";
import { SectionLabel } from "@/components/page";
import { DRAG_TYPE, type PaletteItem } from "./floor";
import { KIND_SHORT } from "./model";

const FLEETS: { label: string; hint: string; item: Extract<PaletteItem, { type: "fleet" }>; Icon: typeof Bot }[] = [
  { label: "Kitting AMR", hint: "Stores → a process line", item: { type: "fleet", mission: "kitting", robotType: "amr" }, Icon: Bot },
  { label: "Transfer AMR", hint: "Process line → packing", item: { type: "fleet", mission: "line-transfer", robotType: "amr" }, Icon: Bot },
  { label: "Pallet AGV", hint: "Packing → shipping dock", item: { type: "fleet", mission: "finished-goods", robotType: "agv" }, Icon: Truck },
  { label: "Forklift AGV", hint: "Packing → shipping dock", item: { type: "fleet", mission: "finished-goods", robotType: "forklift-agv" }, Icon: Forklift },
];

/**
 * Everything that can go on the floor. Drag an item onto the plan, or click it to add it to the
 * selected line (or a new line when none is selected).
 */
export function Palette({ onAdd }: { onAdd: (item: PaletteItem) => void }) {
  const start = (item: PaletteItem) => (e: React.DragEvent) => {
    e.dataTransfer.setData(DRAG_TYPE, JSON.stringify(item));
    e.dataTransfer.effectAllowed = "copy";
  };
  return (
    <div className="space-y-4" data-testid="playground-palette">
      <div>
        <SectionLabel>Machines</SectionLabel>
        <ul className="mt-1.5 grid grid-cols-2 gap-1 lg:grid-cols-1">
          {ASSET_KINDS.map((k: AssetKind) => (
            <li key={k}>
              <button
                type="button"
                draggable
                onDragStart={start({ type: "machine", archetype: k })}
                onClick={() => onAdd({ type: "machine", archetype: k })}
                title={`${ARCHETYPES[k].name}: ${ARCHETYPES[k].covers}`}
                data-testid={`pg-palette-${k}`}
                className="group flex w-full cursor-grab items-center gap-1.5 rounded-lg border border-line bg-surface px-2 py-1 text-left text-[12.5px] text-ink hover:border-accent/50 hover:bg-surface-2 active:cursor-grabbing"
              >
                <GripVertical className="h-3.5 w-3.5 shrink-0 text-muted group-hover:text-ink-2" />
                <span className="truncate">{KIND_SHORT[k]}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <SectionLabel>Mobile robots</SectionLabel>
        <ul className="mt-1.5 grid grid-cols-2 gap-1 lg:grid-cols-1">
          {FLEETS.map((f) => (
            <li key={f.label}>
              <button
                type="button"
                draggable
                onDragStart={start(f.item)}
                onClick={() => onAdd(f.item)}
                title={f.hint}
                className="group flex w-full cursor-grab items-center gap-1.5 rounded-lg border border-line bg-surface px-2 py-1.5 text-left text-[12.5px] text-ink hover:border-agent/50 hover:bg-surface-2 active:cursor-grabbing"
              >
                <f.Icon className="h-3.5 w-3.5 shrink-0 text-agent-ink" />
                <span className="min-w-0">
                  <span className="block truncate">{f.label}</span>
                  <span className="block truncate text-[10.5px] text-muted">{f.hint}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
      <p className="text-[11.5px] leading-relaxed text-muted">Drag onto the floor, or click to add to the selected line. Drop away from every line to start a new one.</p>
    </div>
  );
}
