"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import type { TwinSpec } from "@/domain/builder/spec";
import type { FactoryState } from "@/domain/types";

// three.js is loaded only when the preview is opened.
const Twin3D = dynamic(() => import("@/components/three/twin-3d").then((m) => m.Twin3D), {
  ssr: false,
  loading: () => <Note>Loading the 3D view…</Note>,
});

/**
 * The draft compiled in the browser with the same deterministic compiler Apply uses, shown in the
 * 3D view. Nothing is sent to the server.
 */
export function Preview3D({ spec, ok }: { spec: TwinSpec; ok: boolean }) {
  const [state, setState] = useState<FactoryState | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!ok) return;
    let alive = true;
    const t = setTimeout(() => {
      import("@/domain/builder/compile")
        .then(({ compileSpec }) => {
          const now = new Date().toISOString();
          const s = compileSpec(spec, now, 7, now, "Playground preview");
          if (alive) {
            setState(s);
            setError(null);
          }
        })
        .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)));
    }, 250);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [spec, ok]);

  if (!ok) return <Note>Fix the errors listed under Checks to preview in 3D.</Note>;
  if (error) return <Note>{error}</Note>;
  if (!state) return <Note>Building the preview…</Note>;
  return (
    <div className="h-full min-h-[420px] overflow-hidden rounded-xl border border-line" data-testid="pg-preview-3d">
      <Twin3D state={state} highlight={null} selectedId={null} onSelect={() => {}} orderRisk={{}} />
    </div>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return <div className="flex h-full min-h-[420px] items-center justify-center rounded-xl border border-line text-[12.5px] text-muted">{children}</div>;
}
