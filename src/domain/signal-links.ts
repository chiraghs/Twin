/**
 * A signal link maps a field tag (an OPC UA node or a Modbus register on a PLC) to one of the
 * twin's signals, e.g. `PLC1.A-ROB-03.Vibration` → `A-ROB-03.Vibration`. Linked signals show the
 * field value next to the twin's value, so commissioning can check the wiring and the scaling.
 */
export type FieldProtocol = "opcua" | "modbus";

export interface SignalLink {
  id: string;
  facilityId: string;
  /** Twin signal id: `<assetId>.<Signal>`. */
  signalId: string;
  protocol: FieldProtocol;
  /** opc.tcp://… for OPC UA; host:port for Modbus. */
  endpoint: string;
  /** OPC UA node id, or `host:port/unit/table/register` for Modbus. */
  address: string;
  /** Engineering value = field value × scale. */
  scale: number;
  label: string;
  createdAt: string;
  createdBy: string;
}

/** A field tag offered for linking (from an OPC UA browse or the Modbus register map). */
export interface FieldTag {
  protocol: FieldProtocol;
  endpoint: string;
  address: string;
  label: string;
  scale: number;
  value?: number | boolean | string | null;
}

export const LINK_LIMIT = 300;

/** Twin value and field value agree when within 5 % of the alarm limit (or 5 % of the value). */
export function linkAgrees(twin: number | boolean, field: number | boolean | string | null | undefined, alarm?: number): boolean | null {
  if (field === null || field === undefined) return null;
  if (typeof twin === "boolean") return Boolean(field) === twin;
  if (typeof field !== "number") return null;
  const tol = Math.max(0.05 * Math.abs(alarm ?? twin), 0.05);
  return Math.abs(field - twin) <= tol;
}

export function modbusAddress(host: string, port: number, unit: number, table: "holding" | "input" | "coil", register: number) {
  return `${host}:${port}/${unit}/${table}/${register}`;
}
