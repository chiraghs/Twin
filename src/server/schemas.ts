import { z } from "zod";
import { ASSET_KINDS } from "@/domain/archetypes";
import { FAULT_MODES } from "@/domain/commands";
import { CAMERA_STREAM_KINDS } from "@/domain/vision";
import type { AssetKind } from "@/domain/types";

const assetKind = z.enum(ASSET_KINDS as [AssetKind, ...AssetKind[]]);
const priority = z.enum(["critical", "high", "standard"]);

export const BlueprintSchema = z.object({
  name: z.string().trim().min(2).max(80),
  industry: z.string().trim().min(2).max(80),
  location: z.string().trim().min(2).max(80),
  productionType: z.string().trim().min(2).max(120),
  dataSource: z.enum(["demo", "mqtt", "cloud"]),
  assemblyLines: z.number().int().min(1).max(3),
  assetKinds: z.array(assetKind).min(1).max(4),
  seedIncident: z.boolean().default(true),
});

export const LiveSchema = z.object({ enabled: z.boolean() });
export const AdvanceSchema = z.object({ hours: z.number().positive().max(24) });

export const NewAssetSchema = z.object({
  lineId: z.string().min(1),
  kind: assetKind,
  name: z.string().trim().max(60).optional(),
  position: z.number().int().min(0).max(20).optional(),
});

export const AssetPatchSchema = z
  .object({
    name: z.string().trim().min(2).max(60).optional(),
    speedPct: z.number().min(30).max(110).optional(),
    nominalRate: z.number().min(10).max(1000).optional(),
    criticality: z.enum(["A", "B", "C"]).optional(),
    vibrationAlarm: z.number().positive().optional(),
    temperatureAlarm: z.number().positive().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "At least one field is required");

export const ConnectionSchema = z.object({ source: z.string().min(1), target: z.string().min(1) });

export const FaultSchema = z.object({
  assetId: z.string().min(1),
  mode: z.enum(FAULT_MODES),
  severity: z.number().min(0).max(100).default(50),
});

const RerouteSchema = z.object({
  enabled: z.boolean(),
  toLineId: z.string().nullable(),
  sharePct: z.number().min(0).max(100),
  startHour: z.number().min(0).max(72),
  durationHours: z.number().min(0).max(72),
});

export const ScenarioParamsSchema = z.object({
  horizonHours: z.number().int().min(12).max(96),
  targetAssetId: z.string().min(1),
  targetSpeedPct: z.number().min(30).max(110),
  maintenanceStartHour: z.number().min(0).max(72).nullable(),
  maintenanceDurationHours: z.number().min(0).max(48),
  unplannedRepairHours: z.number().min(1).max(72),
  reroute: RerouteSchema,
  inventoryAvailabilityPct: z.record(z.string(), z.number().min(0).max(200)),
  expediteItemIds: z.array(z.string()),
  orderOverrides: z.record(z.string(), z.object({ quantity: z.number().int().min(0).max(100000).optional(), priority: priority.optional() })),
  energyPricePerKwh: z.number().min(0).max(2),
  idlePowerFactor: z.number().min(0).max(2),
  assumeHealthy: z.boolean().optional(),
});

export const ScenarioDefinitionSchema = z.object({
  id: z.string().min(1).max(40),
  kind: z.enum(["baseline", "continue", "preventive", "reroute", "custom"]),
  name: z.string().min(1).max(80),
  description: z.string().max(300),
  params: ScenarioParamsSchema,
});

export const ScenarioRunSchema = z.object({
  targetAssetId: z.string().min(1).optional(),
  definitions: z.array(ScenarioDefinitionSchema).min(1).max(8).optional(),
  persist: z.boolean().default(true),
});

export const CreateRecommendationSchema = z.object({ scenarioRunId: z.string().min(1), scenarioId: z.string().min(1) });
export const DecisionSchema = z.object({ by: z.string().trim().min(1).max(60).default("Operator"), note: z.string().trim().max(300).default("") });
export const IntegrationTestSchema = z.object({ id: z.string().min(1) });

const cameraStreamKind = z.enum(CAMERA_STREAM_KINDS);

export const CameraStreamSchema = z.object({
  kind: cameraStreamKind,
  url: z.string().trim().max(500).nullable().default(null),
  clipId: z.string().trim().max(60).nullable().default(null),
  by: z.string().trim().min(1).max(60).default("Operator"),
});
export const CameraStreamsSchema = z.object({
  streams: z
    .array(
      z.object({
        id: z.string().min(1).max(40),
        kind: cameraStreamKind,
        url: z.string().trim().max(500).nullable().default(null),
        clipId: z.string().trim().max(60).nullable().default(null),
      }),
    )
    .min(1)
    .max(60),
  by: z.string().trim().min(1).max(60).default("Operator"),
});
/** "ai" runs Muse Spark on Meta Model API; "opencv" the vision service. */
export const CameraAnalyzeSchema = z.object({ engine: z.enum(["ai", "opencv"]) });
export const CameraViewSchema = z.object({ by: z.string().trim().min(1).max(60).default("Operator") });
export const ReviewLogSchema = z.object({ cameraId: z.string().min(1) });
export const DispositionSchema = z.object({
  disposition: z.enum(["confirmed", "dismissed"]),
  note: z.string().trim().max(300).default(""),
  by: z.string().trim().min(1).max(60).default("Operator"),
});
