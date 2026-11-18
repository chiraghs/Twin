"use client";

import { useEffect, useRef, useState } from "react";
import { Box, Trash2, Upload } from "lucide-react";
import { useAdmin } from "@/client/admin";
import { api, apiForm } from "@/client/api";
import { useFactory, useUi } from "@/client/store";
import { useView3d } from "@/client/view3d";
import { Badge, Button, Card, CardBody, CardHeader } from "@/components/ui/primitives";
import { ASSET_KIND_LABEL } from "@/domain/archetypes";
import type { AssetKind } from "@/domain/types";

type Meta = { kind: string; fileName: string; size: number; uploadedAt: string; uploadedBy: string };

/** Your own 3D models per machine type (.glb): every machine of that type in the 3D twin uses it. */
export function ModelLibrary() {
  const state = useFactory((s) => s.state)!;
  const toast = useFactory((s) => s.toast);
  const admin = useAdmin((s) => s.admin);
  const adminLoaded = useAdmin((s) => s.loaded);
  const loadAdmin = useAdmin((s) => s.load);
  const operator = useUi((s) => s.operator);
  const loadModels = useView3d((s) => s.loadModels);
  const [models, setModels] = useState<Meta[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const target = useRef<string | null>(null);
  const kinds = [...new Set(state.assets.map((a) => a.kind))].sort() as AssetKind[];

  const load = async () => {
    setModels((await api<{ models: Meta[] }>("/api/models")).models);
    await loadModels(state.profile.id, true);
  };
  useEffect(() => {
    void load();
  }, [state.profile.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // This page has no admin sign-in control of its own; read the session once.
  useEffect(() => {
    if (!adminLoaded) void loadAdmin();
  }, [adminLoaded, loadAdmin]);

  const upload = async (file: File) => {
    const kind = target.current;
    if (!kind) return;
    setBusy(kind);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("by", operator);
      await apiForm(`/api/models/${kind}`, form);
      toast({ tone: "success", title: `3D model set for ${ASSET_KIND_LABEL[kind as AssetKind] ?? kind}` });
      await load();
    } catch (e) {
      toast({ tone: "error", title: "Upload failed", detail: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card className="mt-4">
      <CardHeader
        title="3D models per machine type"
        description="Upload a .glb (binary glTF, up to 15 MB) for a machine type and every machine of that type in the 3D twin uses it, scaled to the machine's footprint. Remove it to go back to the built-in shape."
        icon={<Box className="h-4 w-4" />}
      />
      <CardBody>
        <input
          ref={input}
          type="file"
          accept=".glb,model/gltf-binary"
          className="hidden"
          data-testid="model-file"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void upload(f);
          }}
        />
        <ul className="divide-y divide-line text-[12.5px]" data-testid="model-library">
          {kinds.map((k) => {
            const m = models.find((x) => x.kind === k);
            return (
              <li key={k} className="flex items-center gap-3 py-2">
                <span className="w-40 text-ink">{ASSET_KIND_LABEL[k] ?? k}</span>
                <span className="min-w-0 flex-1 truncate text-muted">
                  {m ? (
                    <>
                      <Badge tone="accent">custom</Badge> {m.fileName} · {(m.size / 1024).toFixed(0)} KB · {m.uploadedBy}
                    </>
                  ) : (
                    "Built-in shape"
                  )}
                </span>
                <Button
                  size="xs"
                  variant="secondary"
                  disabled={!admin}
                  loading={busy === k}
                  onClick={() => {
                    target.current = k;
                    input.current?.click();
                  }}
                  aria-label={`Upload a model for ${k}`}
                >
                  <Upload className="h-3 w-3" /> {m ? "Replace" : "Upload .glb"}
                </Button>
                {m && (
                  <button
                    aria-label={`Remove the model for ${k}`}
                    disabled={!admin}
                    className="text-muted hover:text-critical disabled:opacity-40"
                    onClick={async () => {
                      await api(`/api/models/${k}`, { method: "DELETE" });
                      await load();
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
        {!admin && <p className="mt-2 text-[11px] text-muted">Uploading and removing models needs admin (sign in from any admin page, e.g. Signals &amp; Commissioning).</p>}
      </CardBody>
    </Card>
  );
}
