import {
  Activity,
  BrainCircuit,
  ClipboardCheck,
  Gauge,
  History,
  Leaf,
  Network,
  PlugZap,
  Boxes,
  Cctv,
  FlaskConical,
  ScanEye,
  Shapes,
  Wand2,
  Server,
  Wrench,
  PackageSearch,
  TrendingUp,
  ScanSearch,
  SlidersHorizontal,
  LockKeyhole,
} from "lucide-react";

export const NAV = [
  {
    section: "Operate",
    items: [
      { href: "/dashboard", label: "Command Center", icon: Gauge },
      { href: "/twin", label: "Digital Twin Studio", icon: Network },
      { href: "/assets", label: "Assets", icon: Boxes },
      { href: "/quality", label: "Visual Quality", icon: ScanEye },
      { href: "/playground", label: "Playground", icon: Shapes },
      { href: "/onboarding", label: "Twin Builder", icon: Wand2 },
    ],
  },
  {
    section: "Intelligence",
    items: [
      { href: "/agents", label: "AI Operations", icon: BrainCircuit },
      { href: "/simulator", label: "What-If Simulator", icon: FlaskConical },
      { href: "/approvals", label: "Approvals", icon: ClipboardCheck },
    ],
  },
  {
    section: "Analytics",
    items: [
      { href: "/analytics/maintenance", label: "Maintenance", icon: Wrench },
      { href: "/analytics/supply", label: "Supply Chain", icon: PackageSearch },
      { href: "/analytics/demand", label: "Demand", icon: TrendingUp },
      { href: "/analytics/quality", label: "Quality", icon: ScanSearch },
      { href: "/sustainability", label: "Sustainability", icon: Leaf },
      { href: "/audit", label: "Audit Trail", icon: History },
    ],
  },
  {
    section: "Plant-Private AI",
    items: [{ href: "/private-ai", label: "Blueprint to Twin", icon: LockKeyhole }],
  },
  {
    section: "Admin",
    items: [
      { href: "/control-room", label: "CCTV Control Room", icon: Cctv },
      { href: "/features", label: "Features", icon: SlidersHorizontal },
      { href: "/integrations", label: "Integrations", icon: PlugZap },
      { href: "/intelligence", label: "Intelligence Backend", icon: Server },
    ],
  },
] as const;

export const BRAND_ICON = Activity;
