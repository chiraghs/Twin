/**
 * The website's pages as the VR browser panel and voice know them: grouped like the sidebar, with
 * labels short enough for a button in the headset. The 3D twin itself is left out (it is the VR view).
 */
export const VR_PAGES = [
  {
    section: "Operate",
    pages: [
      { href: "/dashboard", label: "Command Center" },
      { href: "/assets", label: "Assets" },
      { href: "/commissioning", label: "Signals" },
      { href: "/quality", label: "Visual Quality" },
      { href: "/guided-maintenance", label: "Guided Maint." },
      { href: "/sequencer", label: "Sequencer" },
      { href: "/fleet-traffic", label: "Fleet Traffic" },
      { href: "/playground", label: "Playground" },
    ],
  },
  {
    section: "Intelligence",
    pages: [
      { href: "/agents", label: "AI Operations" },
      { href: "/simulator", label: "What-If" },
      { href: "/approvals", label: "Approvals" },
    ],
  },
  {
    section: "Analytics",
    pages: [
      { href: "/analytics/maintenance", label: "Maintenance" },
      { href: "/analytics/supply", label: "Supply Chain" },
      { href: "/analytics/demand", label: "Demand" },
      { href: "/analytics/quality", label: "Quality" },
      { href: "/sustainability", label: "Sustainability" },
      { href: "/audit", label: "Audit Trail" },
    ],
  },
  {
    section: "Admin",
    pages: [
      { href: "/control-room", label: "CCTV" },
      { href: "/private-ai", label: "Private AI" },
      { href: "/features", label: "Features" },
      { href: "/integrations", label: "Integrations" },
      { href: "/intelligence", label: "AI Backend" },
    ],
  },
] as const;

const ALL_PAGES = VR_PAGES.flatMap((s) => s.pages.map((p) => ({ ...p, section: s.section })));
export const pageLabel = (href: string) => ALL_PAGES.find((p) => href === p.href || href.startsWith(`${p.href}/`))?.label ?? href;
export const sectionOf = (href: string) => ALL_PAGES.find((p) => href === p.href || href.startsWith(`${p.href}/`))?.section ?? "Operate";

/** Finds a page by spoken name ("approvals", "AI operations", "supply chain"). */
export function findPage(words: string): string | null {
  const q = words.toLowerCase().replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();
  if (!q) return null;
  const alias: [RegExp, string][] = [
    [/command|dashboard|home/, "/dashboard"],
    [/agent|ai operation|operations/, "/agents"],
    [/approv/, "/approvals"],
    [/what if|simulat/, "/simulator"],
    [/supply|stock|inventor/, "/analytics/supply"],
    [/demand|forecast/, "/analytics/demand"],
    [/sustainab|energy|carbon/, "/sustainability"],
    [/audit|history/, "/audit"],
    [/cctv|camera|control room/, "/control-room"],
    [/signal|commission|plc/, "/commissioning"],
    [/maintenance analytic/, "/analytics/maintenance"],
    [/guided|work instruction/, "/guided-maintenance"],
    [/visual quality|inspection/, "/quality"],
    [/quality/, "/analytics/quality"],
    [/maintenance/, "/analytics/maintenance"],
    [/asset/, "/assets"],
    [/sequenc/, "/sequencer"],
    [/fleet|traffic|robot/, "/fleet-traffic"],
    [/integration/, "/integrations"],
    [/feature/, "/features"],
    [/private|blueprint/, "/private-ai"],
    [/playground/, "/playground"],
  ];
  return alias.find(([re]) => re.test(q))?.[1] ?? null;
}
