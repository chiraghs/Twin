import { Blend, Bot, Camera, Container, Cylinder, Drill, Fan, Flame, Hammer, Layers, Milk, Package, Rows3, Tag, UserCog, Zap } from "lucide-react";
import type { AssetKind } from "@/domain/types";

/** One icon per machine archetype, shared by the twin, the asset views and the builder. */
export const KIND_ICON: Record<AssetKind, typeof Bot> = {
  conveyor: Rows3,
  press: Hammer,
  robot: Bot,
  camera: Camera,
  packager: Package,
  labeler: Tag,
  cnc: Drill,
  mixer: Blend,
  oven: Flame,
  filler: Milk,
  molder: Container,
  welder: Zap,
  palletizer: Layers,
  pump: Fan,
  workstation: UserCog,
  extruder: Cylinder,
};
