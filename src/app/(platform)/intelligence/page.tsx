"use client";

import { Database, Factory, ScanEye, Settings2, Truck, Wrench } from "lucide-react";
import { useBackend } from "@/client/backend";
import { useUi } from "@/client/store";
import { BackendDown, ConfigPanel, InspectionPanel, MaintenancePanel, OverviewPanel, PlanningPanel, SupplyPanel } from "@/components/intelligence/panels";
import { PageHeader } from "@/components/page";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/primitives";

/** The Python intelligence backend in the UI: every read and write goes through /api/backend → FastAPI → SQLite. */
export default function IntelligencePage() {
  const operator = useUi((s) => s.operator);
  const ready = useBackend<{ status: string }>("ready");
  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Intelligence Backend"
        description="Predictive maintenance, AOI inspection, supply chain, demand planning and operations copilots from the Python backend. Its demo plants (Bangalore, Stuttgart, Detroit) are separate from the twin above. Everything you do here is stored in SQLite."
      />
      {ready.error ? (
        <BackendDown error={ready.error} />
      ) : (
        <Tabs defaultValue="overview">
          <TabsList className="mb-3 flex-wrap">
            <TabsTrigger value="overview"><Database className="mr-1.5 h-3.5 w-3.5" />Overview &amp; data</TabsTrigger>
            <TabsTrigger value="maintenance"><Wrench className="mr-1.5 h-3.5 w-3.5" />Maintenance</TabsTrigger>
            <TabsTrigger value="inspection"><ScanEye className="mr-1.5 h-3.5 w-3.5" />AOI inspection</TabsTrigger>
            <TabsTrigger value="supply"><Truck className="mr-1.5 h-3.5 w-3.5" />Supply chain</TabsTrigger>
            <TabsTrigger value="planning"><Factory className="mr-1.5 h-3.5 w-3.5" />Planning &amp; operations</TabsTrigger>
            <TabsTrigger value="config"><Settings2 className="mr-1.5 h-3.5 w-3.5" />Configuration</TabsTrigger>
          </TabsList>
          <TabsContent value="overview"><OverviewPanel /></TabsContent>
          <TabsContent value="maintenance"><MaintenancePanel operator={operator} /></TabsContent>
          <TabsContent value="inspection"><InspectionPanel operator={operator} /></TabsContent>
          <TabsContent value="supply"><SupplyPanel operator={operator} /></TabsContent>
          <TabsContent value="planning"><PlanningPanel /></TabsContent>
          <TabsContent value="config"><ConfigPanel /></TabsContent>
        </Tabs>
      )}
    </div>
  );
}
