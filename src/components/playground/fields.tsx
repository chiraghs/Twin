"use client";

import { useEffect, useId, useState } from "react";
import { Input, Label, Select } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";

/** A text field that commits on blur or Enter (so every keystroke isn't an undo step). */
export function TextField({ label, value, onCommit, placeholder, className }: { label: string; value: string; onCommit: (v: string) => void; placeholder?: string; className?: string }) {
  const id = useId();
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const commit = () => {
    const t = v.trim();
    if (t && t !== value) onCommit(t);
    else setV(value);
  };
  return (
    <div className={className}>
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} value={v} placeholder={placeholder} onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} className="mt-1 h-8 text-[13px]" />
    </div>
  );
}

/** A number field that commits on blur or Enter; empty commits null when allowed. */
export function NumField({
  label,
  value,
  onCommit,
  placeholder,
  min,
  max,
  step,
  unit,
  allowEmpty = false,
  className,
}: {
  label: string;
  value: number | null;
  onCommit: (v: number | null) => void;
  placeholder?: string;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  allowEmpty?: boolean;
  className?: string;
}) {
  const id = useId();
  const [v, setV] = useState(value == null ? "" : String(value));
  useEffect(() => setV(value == null ? "" : String(value)), [value]);
  const commit = () => {
    if (!v.trim()) {
      if (allowEmpty && value != null) onCommit(null);
      else setV(value == null ? "" : String(value));
      return;
    }
    const n = Number(v);
    if (!Number.isFinite(n) || (min != null && n < min) || (max != null && n > max)) {
      setV(value == null ? "" : String(value));
      return;
    }
    if (n !== value) onCommit(n);
  };
  return (
    <div className={className}>
      <Label htmlFor={id}>{label}</Label>
      <div className="relative mt-1">
        <Input
          id={id}
          type="number"
          inputMode="decimal"
          value={v}
          placeholder={placeholder}
          min={min}
          max={max}
          step={step}
          onChange={(e) => setV(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          className={cn("h-8 text-[13px]", unit && "pr-12")}
        />
        {unit && <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-[11px] text-muted">{unit}</span>}
      </div>
    </div>
  );
}

/** A labelled select. */
export function SelectField({ label, value, onChange, children, className }: { label: string; value: string; onChange: (v: string) => void; children: React.ReactNode; className?: string }) {
  const id = useId();
  return (
    <div className={className}>
      <Label htmlFor={id}>{label}</Label>
      <Select id={id} value={value} onChange={(e) => onChange(e.target.value)} className="mt-1 h-8 w-full text-[13px]">
        {children}
      </Select>
    </div>
  );
}
