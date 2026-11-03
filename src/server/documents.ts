import "server-only";
import { cloudStorage } from "./integrations/adapters";
import { DOC_CONTENT } from "./docs-content";

export interface DocumentMeta {
  id: string;
  title: string;
  kind: "manual" | "bulletin" | "procedure";
  assetKinds: string[];
  source: "local" | "gcs";
  path: string;
}

const LOCAL_DOCS: Omit<DocumentMeta, "source" | "path">[] = [
  { id: "ax6-maintenance-manual", title: "AX-6 Assembly Cell — Maintenance Manual", kind: "manual", assetKinds: ["robot"] },
  { id: "ax6-gearbox-bearing-bulletin", title: "SB-AX6-114 Joint-4 Gearbox Bearing Wear", kind: "bulletin", assetKinds: ["robot"] },
  { id: "pf60-press-manual", title: "PF-60 Servo Press — Maintenance Guide", kind: "manual", assetKinds: ["press"] },
  { id: "cp280-seal-heater-guide", title: "CP-280 Seal Heater Troubleshooting", kind: "manual", assetKinds: ["packager"] },
  { id: "changeover-sop-ecu200-line-b", title: "SOP-CHG-031 Changeover: ECU-200 on Line B", kind: "procedure", assetKinds: [] },
];

export async function listDocuments(asset?: { id: string; kind: string; documentIds: string[] }) {
  const local: DocumentMeta[] = LOCAL_DOCS.filter((d) => !asset || asset.documentIds.includes(d.id) || d.assetKinds.includes(asset.kind)).map((d) => ({
    ...d,
    source: "local",
    path: `content/docs/${d.id}.md`,
  }));
  let remote: DocumentMeta[] = [];
  let remoteError: string | null = null;
  if (cloudStorage.configured() && asset) {
    try {
      const items = await cloudStorage.list(`assets/${asset.id}/`);
      remote = items.map((o: { name: string }) => ({
        id: o.name,
        title: o.name.split("/").pop() ?? o.name,
        kind: "manual" as const,
        assetKinds: [asset.kind],
        source: "gcs" as const,
        path: `gs://${cloudStorage.bucket()}/${o.name}`,
      }));
    } catch (e) {
      remoteError = e instanceof Error ? e.message : String(e);
    }
  }
  return {
    documents: [...local, ...remote],
    store: cloudStorage.configured() ? "Cloud Storage and built-in documents" : "Built-in documents",
    remoteError,
  };
}

export function readLocalDocument(id: string) {
  const meta = LOCAL_DOCS.find((d) => d.id === id);
  const content = meta ? DOC_CONTENT[meta.id] : undefined;
  if (!meta || !content) return null;
  return { ...meta, source: "local" as const, content };
}
