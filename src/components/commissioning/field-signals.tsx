"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Cpu, Link2, Plug, Search, Unlink } from "lucide-react";
import { api } from "@/client/api";
import { bk } from "@/client/backend";
import { useUi } from "@/client/store";
import { Badge, Button, Card, CardBody, CardHeader, Input, Select } from "@/components/ui/primitives";
import { assetSignals } from "@/domain/live";
import { MACHINE_STATE_CODE, cycleTime, electrical, machineStates } from "@/domain/process-signals";
import { linkAgrees, modbusAddress, type FieldProtocol, type FieldTag, type SignalLink } from "@/domain/signal-links";
import type { Asset, FactoryState } from "@/domain/types";
import { cn } from "@/lib/cn";

type PlcStatus = { running: boolean; opcuaEndpoint: string | null; modbus: { host: string; port: number; unit: number } | null; modbusMap: { tag: string; table: "holding" | "input" | "coil"; address: number; scale: number }[] };
type FieldValue = { value: number | boolean | string | null; quality: string; error?: string };
const DRAG_TYPE = "application/x-twin-field-tag";

const plcMachines = (s: FactoryState) =>
  s.assets.map((a) => {
    const ms = machineStates(s)[a.id];
    const ct = cycleTime(a);
    return {
      assetId: a.id,
      speedPct: a.speedPct,
      vibration: a.signal.vibration,
      temperature: a.signal.temperature,
      throughput: a.signal.throughput,
      running: a.mode === "running",
      powerKw: a.signal.powerKw,
      currentA: electrical(s, a).currentA,
      cycleTimeS: ct.actualS ?? 0,
      state: ms ? MACHINE_STATE_CODE[ms.state] : 0,
    };
  });

/**
 * Field signals: browse a PLC over OPC UA or read Modbus registers, then drag a field tag onto a
 * twin signal to link them. Linked signals show the field value beside the twin value, so wiring
 * and scaling can be checked. Read-only towards the PLC. A simulated PLC is built in for testing.
 */
export function FieldSignals({ state, asset }: { state: FactoryState; asset: Asset }) {
  const operator = useUi((s) => s.operator);
  const [plc, setPlc] = useState<PlcStatus | null>(null);
  const [backendError, setBackendError] = useState<string | null>(null);
  const [protocol, setProtocol] = useState<FieldProtocol>("opcua");
  const [endpoint, setEndpoint] = useState("opc.tcp://127.0.0.1:4841/twin-plc/");
  const [tags, setTags] = useState<FieldTag[]>([]);
  const [filter, setFilter] = useState("");
  const [picked, setPicked] = useState<FieldTag | null>(null);
  const [links, setLinks] = useState<SignalLink[]>([]);
  const [values, setValues] = useState<Record<string, FieldValue>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mb, setMb] = useState({ host: "127.0.0.1", port: 5021, unit: 1, table: "holding" as "holding" | "input" | "coil", register: 0, scale: 1 });

  const loadLinks = useCallback(async () => setLinks((await api<{ links: SignalLink[] }>("/api/signal-links")).links), []);
  const [checking, setChecking] = useState(false);
  const connect = useCallback(async () => {
    setChecking(true);
    try {
      setPlc(await bk<PlcStatus>("api/v1/field/plc"));
      setBackendError(null);
    } catch (e) {
      setBackendError(e instanceof Error ? e.message : String(e));
    } finally {
      setChecking(false);
    }
  }, []);
  useEffect(() => {
    void loadLinks();
    void connect();
  }, [loadLinks, connect]);

  // Keep the simulated PLC following the twin.
  useEffect(() => {
    if (plc?.running) void bk("api/v1/field/plc/update", { json: { machines: plcMachines(state) } }).catch(() => undefined);
  }, [state, plc?.running]);

  // Poll linked field values every 2 s.
  useEffect(() => {
    if (!links.length || backendError) return;
    let alive = true;
    const poll = async () => {
      try {
        const r = await bk<{ values: Record<string, FieldValue> }>("api/v1/field/links/read", { json: { links: links.map((l) => ({ id: l.id, protocol: l.protocol, endpoint: l.endpoint, address: l.address, scale: l.scale })) } });
        if (alive) setValues(r.values);
      } catch {
        /* backend busy or gone: keep the last values */
      }
    };
    void poll();
    const t = setInterval(poll, 2000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [links, backendError]);

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const togglePlc = () =>
    run("plc", async () => {
      const p = plc?.running ? await bk<PlcStatus>("api/v1/field/plc/stop", { json: {} }) : await bk<PlcStatus>("api/v1/field/plc/start", { json: { machines: plcMachines(state) } });
      setPlc(p);
      if (p.opcuaEndpoint) setEndpoint(p.opcuaEndpoint);
    });

  const browse = () =>
    run("browse", async () => {
      const r = await bk<{ variables: { nodeId: string; path: string; value: FieldTag["value"] }[] }>("api/v1/field/opcua/browse", { json: { endpoint } });
      setTags(r.variables.map((v) => ({ protocol: "opcua", endpoint, address: v.nodeId, label: v.path, scale: 1, value: v.value })));
    });

  const modbusTags = useMemo<FieldTag[]>(() => {
    const p = plc?.modbus;
    if (!p || !plc?.modbusMap) return [];
    return plc.modbusMap.map((m) => ({ protocol: "modbus", endpoint: `${p.host}:${p.port}`, address: modbusAddress(p.host, p.port, p.unit, m.table, m.address), label: `${m.tag} · ${m.table} ${m.address}`, scale: m.scale }));
  }, [plc]);
  const custom: FieldTag = { protocol: "modbus", endpoint: `${mb.host}:${mb.port}`, address: modbusAddress(mb.host, mb.port, mb.unit, mb.table, mb.register), label: `${mb.host}:${mb.port} unit ${mb.unit} ${mb.table} ${mb.register}`, scale: mb.scale };
  const shown = (protocol === "opcua" ? tags : modbusTags).filter((t) => !filter || t.label.toLowerCase().includes(filter.toLowerCase())).slice(0, 80);

  const link = (signalId: string, tag: FieldTag) =>
    run(`link-${signalId}`, async () => {
      await api("/api/signal-links", { body: { signalId, protocol: tag.protocol, endpoint: tag.endpoint, address: tag.address, scale: tag.scale, label: tag.label, by: operator } });
      setPicked(null);
      await loadLinks();
    });
  const unlink = (id: string) =>
    run(`unlink-${id}`, async () => {
      await api(`/api/signal-links/${encodeURIComponent(id)}`, { method: "DELETE" });
      await loadLinks();
    });

  const signals = assetSignals(state, asset);
  const linkFor = (sid: string) => links.find((l) => l.signalId === sid);
  const fmt = (v: FieldValue["value"] | number | boolean | undefined) => (v === null || v === undefined ? "—" : typeof v === "number" ? (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(2)) : String(v));

  return (
    <Card className="mt-3">
      <CardHeader
        title="Field signals · link PLC tags"
        description="Browse a PLC over OPC UA or read Modbus registers, then drag a tag onto a twin signal (or pick a tag and press Link). Linked signals show the field value next to the twin value. Read-only: nothing is written to the PLC."
        icon={<Plug className="h-4 w-4" />}
        actions={
          <Button size="sm" variant={plc?.running ? "primary" : "secondary"} loading={busy === "plc"} disabled={!!backendError} onClick={togglePlc} data-testid="plc-toggle">
            <Cpu className="h-3.5 w-3.5" /> {plc?.running ? "Stop simulated PLC" : "Start simulated PLC"}
          </Button>
        }
      />
      <CardBody className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
        <div className="min-w-0 space-y-2 text-[12px]">
          {backendError && (
            <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-2 py-1.5 text-ink-2" data-testid="backend-unreachable">
              <p className="min-w-0 flex-1">Field connectors run in the Python backend, which isn&apos;t reachable: {backendError}</p>
              <Button size="xs" variant="secondary" loading={checking} onClick={() => void connect()}>
                Retry
              </Button>
            </div>
          )}
          <div className="flex gap-1.5">
            <Select aria-label="Protocol" value={protocol} onChange={(e) => setProtocol(e.target.value as FieldProtocol)}>
              <option value="opcua">OPC UA</option>
              <option value="modbus">Modbus TCP</option>
            </Select>
            {protocol === "opcua" ? (
              <>
                <Input aria-label="OPC UA endpoint" value={endpoint} onChange={(e) => setEndpoint(e.target.value)} />
                <Button size="sm" variant="secondary" loading={busy === "browse"} disabled={!!backendError} onClick={browse}>
                  <Search className="h-3.5 w-3.5" /> Browse
                </Button>
              </>
            ) : (
              <p className="self-center text-muted">{plc?.running ? "Registers of the simulated PLC, or enter any register below." : "Enter a register, or start the simulated PLC."}</p>
            )}
          </div>
          {protocol === "modbus" && (
            <div className="grid grid-cols-[2fr_1fr_0.8fr_1.6fr_1fr] gap-1.5" aria-label="Modbus register">
              <Input aria-label="Host" value={mb.host} onChange={(e) => setMb({ ...mb, host: e.target.value })} />
              <Input aria-label="Port" type="number" value={mb.port} onChange={(e) => setMb({ ...mb, port: Number(e.target.value) })} />
              <Input aria-label="Unit" type="number" value={mb.unit} onChange={(e) => setMb({ ...mb, unit: Number(e.target.value) })} />
              <Select aria-label="Table" value={mb.table} onChange={(e) => setMb({ ...mb, table: e.target.value as typeof mb.table })}>
                <option value="holding">holding</option>
                <option value="input">input</option>
                <option value="coil">coil</option>
              </Select>
              <Input aria-label="Register" type="number" value={mb.register} onChange={(e) => setMb({ ...mb, register: Number(e.target.value) })} />
              <Input aria-label="Scale" type="number" step="any" value={mb.scale} onChange={(e) => setMb({ ...mb, scale: Number(e.target.value) })} />
              <div className="col-span-4">
                <TagChip tag={custom} picked={picked?.address === custom.address} onPick={setPicked} />
              </div>
            </div>
          )}
          <Input aria-label="Filter tags" placeholder="Filter tags (e.g. A-ROB-03)" value={filter} onChange={(e) => setFilter(e.target.value)} />
          <ul className="max-h-64 space-y-1 overflow-auto" data-testid="field-tags">
            {shown.length === 0 && <li className="text-muted">{protocol === "opcua" ? "Browse an endpoint to list its tags." : "No registers listed."}</li>}
            {shown.map((t) => (
              <li key={t.address}>
                <TagChip tag={t} picked={picked?.address === t.address} onPick={setPicked} />
              </li>
            ))}
          </ul>
          {error && <p className="text-critical-ink">{error}</p>}
        </div>
        <div className="min-w-0">
          <p className="mb-1.5 text-[12px] text-muted">
            Twin signals of <span className="font-mono text-ink">{asset.id}</span>
            {picked && (
              <>
                {" "}
                · picked <Badge tone="accent">{picked.label}</Badge>
              </>
            )}
          </p>
          <ul className="space-y-1" data-testid="link-targets">
            {signals.map((sig) => {
              const l = linkFor(sig.id);
              const fv = l ? values[l.id] : undefined;
              const agree = l && fv ? linkAgrees(sig.value, fv.value, sig.limits?.alarm) : null;
              return (
                <li
                  key={sig.id}
                  onDragOver={(e) => {
                    if (e.dataTransfer.types.includes(DRAG_TYPE)) e.preventDefault();
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    const raw = e.dataTransfer.getData(DRAG_TYPE);
                    if (raw) void link(sig.id, JSON.parse(raw) as FieldTag);
                  }}
                  className={cn("flex items-center gap-2 rounded-md border px-2 py-1.5 text-[12px]", l ? "border-accent/40 bg-accent/5" : "border-dashed border-line")}
                  data-signal={sig.id}
                >
                  <span className="w-28 shrink-0 text-ink">{sig.name}</span>
                  <span className="tabular w-16 shrink-0 text-right text-ink-2" title="Twin value">
                    {fmt(sig.value)}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-muted">{l ? <span title={l.address}>← {l.label}</span> : "drop a tag here"}</span>
                  {l && (
                    <span className="tabular w-16 shrink-0 text-right" title="Field value" data-testid={`field-value-${sig.name}`}>
                      {fv ? fmt(fv.value) : "…"}
                    </span>
                  )}
                  {l && fv && <Badge tone={fv.quality !== "GOOD" ? "critical" : agree === false ? "warning" : "healthy"}>{fv.quality !== "GOOD" ? "bad" : agree === false ? "differs" : "ok"}</Badge>}
                  {!l && picked && (
                    <Button size="xs" variant="secondary" loading={busy === `link-${sig.id}`} onClick={() => void link(sig.id, picked)}>
                      <Link2 className="h-3 w-3" /> Link
                    </Button>
                  )}
                  {l && (
                    <button aria-label={`Unlink ${sig.name}`} className="text-muted hover:text-critical" onClick={() => void unlink(l.id)}>
                      <Unlink className="h-3.5 w-3.5" />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      </CardBody>
    </Card>
  );
}

function TagChip({ tag, picked, onPick }: { tag: FieldTag; picked: boolean; onPick: (t: FieldTag | null) => void }) {
  return (
    <button
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(DRAG_TYPE, JSON.stringify(tag));
        e.dataTransfer.effectAllowed = "link";
      }}
      onClick={() => onPick(picked ? null : tag)}
      aria-pressed={picked}
      className={cn("flex w-full cursor-grab items-center gap-2 rounded-md border px-2 py-1 text-left", picked ? "border-accent bg-accent/12 text-accent-ink" : "border-line bg-surface hover:bg-surface-2")}
    >
      <span className="min-w-0 flex-1 truncate font-mono text-[11px]">{tag.label}</span>
      {tag.value !== undefined && <span className="tabular shrink-0 text-[11px] text-muted">{String(tag.value)}</span>}
    </button>
  );
}
