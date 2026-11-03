"use client";

import { useState } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { useEnsureLoaded, useLiveClock } from "@/client/hooks";
import { useFactory } from "@/client/store";
import { DemoGuide } from "@/components/shell/demo-guide";
import { MobileNotice } from "@/components/shell/mobile-notice";
import { Sidebar } from "@/components/shell/sidebar";
import { Toaster } from "@/components/shell/toaster";
import { Topbar } from "@/components/shell/topbar";
import { Button, TooltipProvider } from "@/components/ui/primitives";
import { CameraDialogHost } from "@/components/vision/camera-panel";
import { CopilotPanel } from "@/components/copilot/copilot-panel";

export default function PlatformLayout({ children }: { children: React.ReactNode }) {
  const [navOpen, setNavOpen] = useState(false);
  useEnsureLoaded();
  useLiveClock();
  const state = useFactory((s) => s.state);
  const loadError = useFactory((s) => s.loadError);
  const load = useFactory((s) => s.load);

  return (
    <TooltipProvider>
      <div className="min-h-screen">
        <Sidebar open={navOpen} onNavigate={() => setNavOpen(false)} />
        {navOpen && <div className="fixed inset-0 z-30 bg-black/50 lg:hidden" onClick={() => setNavOpen(false)} />}
        <div className="lg:pl-60">
          <Topbar onMenu={() => setNavOpen(true)} />
          <main className="mx-auto w-full max-w-[1600px] px-4 py-5 lg:px-6">
            {state ? (
              children
            ) : loadError ? (
              <div className="mx-auto mt-24 max-w-md rounded-2xl border border-critical/40 bg-surface p-6 text-center">
                <AlertTriangle className="mx-auto h-6 w-6 text-critical" />
                <p className="mt-2 text-sm font-medium text-ink">Could not load the factory state</p>
                <p className="mt-1 text-xs text-muted">{loadError}</p>
                <Button className="mt-4" size="sm" onClick={() => load()}>
                  <RefreshCw className="h-3.5 w-3.5" /> Retry
                </Button>
              </div>
            ) : (
              <div className="grid gap-4">
                <div className="h-8 w-64 animate-pulse rounded-lg bg-surface" />
                <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                  {Array.from({ length: 8 }).map((_, i) => (
                    <div key={i} className="h-28 animate-pulse rounded-xl bg-surface" />
                  ))}
                </div>
                <div className="h-80 animate-pulse rounded-xl bg-surface" />
              </div>
            )}
          </main>
        </div>
        <DemoGuide />
        <CameraDialogHost />
        <CopilotPanel />
        <Toaster />
        <MobileNotice />
      </div>
    </TooltipProvider>
  );
}
