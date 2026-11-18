import { z } from "zod";
import { appendAudit } from "@/domain/audit";
import { DomainError } from "@/domain/errors";
import { assetSignals } from "@/domain/live";
import { json, nowISO, parseBody, route } from "@/server/http";
import { listLinks, saveLink } from "@/server/db/signal-links";
import { getState, mutate } from "@/server/store";

export const dynamic = "force-dynamic";

/** Field-tag links of the active twin. */
export const GET = route(async () => {
  const id = getState().profile.id;
  return json({ facilityId: id, links: listLinks(id) });
});

const LinkSchema = z.object({
  signalId: z.string().min(3).max(80),
  protocol: z.enum(["opcua", "modbus"]),
  endpoint: z.string().min(3).max(200),
  address: z.string().min(1).max(200),
  scale: z.number().finite().min(-1e6).max(1e6).default(1),
  label: z.string().trim().min(1).max(160),
  by: z.string().trim().min(1).max(60).default("Operator"),
});

/** Link a field tag to a twin signal (replaces that signal's previous link). Audited. */
export const POST = route(async (req: Request) => {
  const { by, ...input } = await parseBody(req, LinkSchema);
  if (input.protocol === "opcua" && !input.endpoint.startsWith("opc.tcp://")) throw new DomainError("OPC UA endpoints start with opc.tcp://", 400);
  if (input.protocol === "modbus" && !/^[^/\s]+:\d+\/\d+\/(holding|input|coil)\/\d+$/.test(input.address)) throw new DomainError("Modbus addresses look like host:port/unit/holding/40", 400);
  const s = getState();
  const assetId = input.signalId.split(".")[0];
  const asset = s.assets.find((a) => a.id === assetId);
  if (!asset || !assetSignals(s, asset).some((x) => x.id === input.signalId)) throw new DomainError(`Unknown twin signal ${input.signalId}`, 404);
  const at = nowISO();
  const link = saveLink(s.profile.id, input, by, at);
  mutate((st) => appendAudit(st, at, { category: "system", actor: by, title: `Signal linked: ${input.signalId}`, detail: `${input.protocol.toUpperCase()} ${input.label} (scale ${input.scale}).`, severity: "info", refs: { assetIds: [assetId] } }));
  return json({ link }, 201);
});
