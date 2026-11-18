/**
 * Asset Administration Shell export (IDTA "Details of the AAS", part 1, metamodel v3, JSON).
 * Each machine becomes a shell with three submodels: Nameplate, TechnicalData and OperationalData
 * (live values at export time). Plain JSON, so any AAS-capable tool (AASX Package Explorer,
 * Eclipse BaSyx) can import it.
 */
import { round } from "./math";
import type { Asset, FactoryState } from "./types";

type ValueType = "xs:string" | "xs:double" | "xs:int" | "xs:boolean";
interface Property {
  modelType: "Property";
  idShort: string;
  valueType: ValueType;
  value: string;
  description?: { language: string; text: string }[];
}
interface Submodel {
  modelType: "Submodel";
  id: string;
  idShort: string;
  kind: "Instance";
  semanticId?: { type: "ExternalReference"; keys: { type: "GlobalReference"; value: string }[] };
  submodelElements: Property[];
}
interface Shell {
  modelType: "AssetAdministrationShell";
  id: string;
  idShort: string;
  description: { language: string; text: string }[];
  assetInformation: { assetKind: "Instance"; globalAssetId: string; assetType: string };
  submodels: { type: "ModelReference"; keys: { type: "Submodel"; value: string }[] }[];
}
export interface AasEnvironment {
  assetAdministrationShells: Shell[];
  submodels: Submodel[];
  conceptDescriptions: never[];
}

/** idShort: letters, digits and underscores, starting with a letter. */
export const idShort = (s: string) => {
  const clean = s.replace(/[^A-Za-z0-9_]/g, "_").replace(/_+/g, "_");
  return /^[A-Za-z]/.test(clean) ? clean : `A_${clean}`;
};

const prop = (name: string, value: string | number | boolean, unitNote?: string): Property => ({
  modelType: "Property",
  idShort: idShort(name),
  valueType: typeof value === "boolean" ? "xs:boolean" : typeof value === "number" ? (Number.isInteger(value) ? "xs:int" : "xs:double") : "xs:string",
  value: String(value),
  ...(unitNote ? { description: [{ language: "en", text: unitNote }] } : {}),
});

const semantic = (value: string) => ({ type: "ExternalReference" as const, keys: [{ type: "GlobalReference" as const, value }] });

/** The plant's machines as an AAS environment (all machines, or the given ones). */
export function aasEnvironment(state: FactoryState, assetIds?: string[]): AasEnvironment {
  const base = `urn:twin:${idShort(state.profile.id)}`;
  const assets = state.assets.filter((a) => !assetIds || assetIds.includes(a.id));
  const shells: Shell[] = [];
  const submodels: Submodel[] = [];
  for (const a of assets) {
    const ids = { shell: `${base}:aas:${a.id}`, asset: `${base}:asset:${a.id}`, np: `${base}:sm:${a.id}:nameplate`, td: `${base}:sm:${a.id}:technical`, op: `${base}:sm:${a.id}:operational` };
    submodels.push(
      {
        modelType: "Submodel",
        id: ids.np,
        idShort: "Nameplate",
        kind: "Instance",
        semanticId: semantic("https://admin-shell.io/zvei/nameplate/2/0/Nameplate"),
        submodelElements: [
          prop("ManufacturerName", a.manufacturer),
          prop("ManufacturerProductDesignation", a.model),
          prop("SerialNumber", a.id),
          prop("YearOfConstruction", String(a.installedYear)),
          prop("AssetName", a.name),
          prop("AssetKind", a.kind),
        ],
      },
      {
        modelType: "Submodel",
        id: ids.td,
        idShort: "TechnicalData",
        kind: "Instance",
        semanticId: semantic("https://admin-shell.io/ZVEI/TechnicalData/Submodel/1/2"),
        submodelElements: [
          prop("NominalRate", a.nominalRate, "units per hour at 100 % speed"),
          prop("RatedPower", round(a.ratedPowerKw, 2), "kW"),
          prop("IdlePower", round(a.idlePowerKw, 2), "kW"),
          prop("VibrationAlarmLimit", a.thresholds.vibrationAlarm, "mm/s RMS"),
          prop("VibrationTripLimit", a.thresholds.vibrationTrip, "mm/s RMS"),
          prop("TemperatureAlarmLimit", a.thresholds.temperatureAlarm, "°C"),
          prop("TemperatureTripLimit", a.thresholds.temperatureTrip, "°C"),
          prop("MaintenanceInterval", a.maintenanceIntervalHours, "hours"),
          prop("Criticality", a.criticality),
          prop("Line", a.lineId),
        ],
      },
      {
        modelType: "Submodel",
        id: ids.op,
        idShort: "OperationalData",
        kind: "Instance",
        submodelElements: [
          prop("Mode", a.mode),
          prop("Status", a.status),
          prop("HealthScore", round(a.healthScore, 1), "0–100"),
          prop("SpeedSetpoint", a.speedPct, "% of nameplate"),
          prop("Throughput", round(a.signal.throughput, 1), "units per hour"),
          prop("Vibration", round(a.signal.vibration, 2), "mm/s RMS"),
          prop("Temperature", round(a.signal.temperature, 1), "°C"),
          prop("Power", round(a.signal.powerKw, 2), "kW"),
          prop("SnapshotPlantHour", round(state.clock.hour, 2), "simulated plant hour of this export"),
        ],
      },
    );
    shells.push({
      modelType: "AssetAdministrationShell",
      id: ids.shell,
      idShort: idShort(a.id),
      description: [{ language: "en", text: `${a.name} (${a.manufacturer} ${a.model}) in ${state.profile.name}` }],
      assetInformation: { assetKind: "Instance", globalAssetId: ids.asset, assetType: a.kind },
      submodels: [ids.np, ids.td, ids.op].map((value) => ({ type: "ModelReference" as const, keys: [{ type: "Submodel" as const, value }] })),
    });
  }
  return { assetAdministrationShells: shells, submodels, conceptDescriptions: [] };
}

export type { Asset };
