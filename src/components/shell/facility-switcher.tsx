"use client";

import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import { Check, ChevronDown, Factory, Plus, Trash2, MapPin } from "lucide-react";
import { useFactory } from "@/client/store";
import { Badge } from "../ui/primitives";
import { cn } from "@/lib/cn";
import { api } from "@/client/api";

interface FacilitySummary {
  id: string;
  name: string;
  industry: string;
  location: string;
  productionType: string;
  isDemo: boolean;
  createdAt: string;
  updatedAt: string;
}

export function FacilitySwitcher() {
  const state = useFactory((s) => s.state);
  const switchFacility = useFactory((s) => s.switchFacility);
  const [open, setOpen] = useState(false);
  const [facilities, setFacilities] = useState<FacilitySummary[]>([]);
  const [activeId, setActiveId] = useState<string>("");
  const ref = useRef<HTMLDivElement>(null);

  const fetchFacilities = async () => {
    try {
      const res = await api<{ activeId: string; facilities: FacilitySummary[] }>("/api/facilities");
      setFacilities(res.facilities);
      setActiveId(res.activeId);
    } catch {
      // ignore transient load
    }
  };

  useEffect(() => {
    if (open) {
      void fetchFacilities();
    }
  }, [open, state?.profile.id]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const handleSelect = async (id: string) => {
    if (id === activeId) {
      setOpen(false);
      return;
    }
    await switchFacility(id);
    setActiveId(id);
    setOpen(false);
  };

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (!confirm("Are you sure you want to delete this custom twin from SQLite?")) return;
    try {
      await api(`/api/facilities/${id}`, { method: "DELETE" });
      await fetchFacilities();
      await useFactory.getState().load();
    } catch (err) {
      console.error("Failed to delete facility:", err);
    }
  };

  return (
    <div className="relative min-w-0 flex-1" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 rounded-lg p-1 text-left transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        aria-label="Switch digital factory twin"
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Factory className="h-4 w-4 shrink-0 text-accent" />
            <h1 className="truncate text-[14px] font-semibold text-ink">
              {state?.profile.name ?? "Loading factory…"}
            </h1>
            {state?.profile.isDemo && <Badge tone="accent">Demo</Badge>}
            <ChevronDown className={cn("h-3.5 w-3.5 text-muted transition-transform", open && "rotate-180")} />
          </div>
          {state && (
            <p className="flex items-center gap-1 truncate text-[11.5px] text-muted">
              <MapPin className="h-3 w-3 shrink-0" />
              {state.profile.location} · {state.profile.productionType}
            </p>
          )}
        </div>
      </button>

      {open && (
        <div className="absolute left-0 z-50 mt-2 w-80 rounded-xl border border-line-strong bg-shell p-2 shadow-2xl animate-fade-in">
          <div className="flex items-center justify-between px-2.5 py-1.5 text-xs font-semibold text-ink">
            <span>Saved Digital Twins (SQLite)</span>
            <span className="text-[11px] font-normal text-muted">{facilities.length} available</span>
          </div>

          <div className="my-1 max-h-64 space-y-1 overflow-y-auto">
            {facilities.map((f) => {
              const isSelected = f.id === (activeId || state?.profile.id);
              return (
                <div
                  key={f.id}
                  onClick={() => void handleSelect(f.id)}
                  className={cn(
                    "group flex cursor-pointer items-start justify-between gap-2 rounded-lg p-2 text-left transition-colors hover:bg-surface-2",
                    isSelected ? "bg-accent/10 border border-accent/30" : "border border-transparent"
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-[13px] font-medium text-ink">{f.name}</span>
                      {f.isDemo && <Badge tone="neutral">Demo</Badge>}
                    </div>
                    <p className="truncate text-[11px] text-muted">
                      {f.industry} · {f.location}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0 pt-0.5">
                    {isSelected && <Check className="h-4 w-4 text-accent" />}
                    {!f.isDemo && (
                      <button
                        onClick={(e) => void handleDelete(e, f.id)}
                        className="rounded p-1 text-muted opacity-0 group-hover:opacity-100 hover:bg-surface-3 hover:text-critical"
                        title="Delete custom twin"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="my-1.5 h-px bg-line" />

          <Link
            href="/onboarding"
            onClick={() => setOpen(false)}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-line bg-surface/60 py-2 text-[12.5px] font-medium text-ink hover:border-accent hover:bg-accent/5 hover:text-accent"
          >
            <Plus className="h-3.5 w-3.5" /> Create New Twin in Twin Builder
          </Link>
        </div>
      )}
    </div>
  );
}
