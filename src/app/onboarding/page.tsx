"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Sparkles, Wand2 } from "lucide-react";
import { useBuilder } from "@/client/builder";
import { useFactory } from "@/client/store";
import { BrandMark, BrandName } from "@/components/brand";
import { AgentStages } from "@/components/builder/progress";
import { ReviewWorkspace } from "@/components/builder/review";
import { StartPanel } from "@/components/builder/start-panel";
import { MobileNotice } from "@/components/shell/mobile-notice";
import { Toaster } from "@/components/shell/toaster";
import { ThemeToggle } from "@/components/theme-toggle";
import { Badge, Button, TooltipProvider } from "@/components/ui/primitives";

/** Twin Builder: blueprint + requirements → agent draft → human review → deterministic build. */
export default function TwinBuilderPage() {
  const router = useRouter();
  const meta = useBuilder((s) => s.meta);
  const loadMeta = useBuilder((s) => s.loadMeta);
  const phase = useBuilder((s) => s.phase);
  const spec = useBuilder((s) => s.spec);
  const research = useBuilder((s) => s.research);
  const reset = useFactory((s) => s.reset);
  const resetting = useFactory((s) => s.busy.reset);
  const [file, setFile] = useState<File | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    void loadMeta();
    setHydrated(true);
  }, [loadMeta]);

  const loadDemo = async () => {
    await reset();
    router.push("/dashboard");
  };

  return (
    <TooltipProvider>
      <div className="min-h-screen bg-canvas">
        <MobileNotice />
        <div className="pointer-events-none fixed inset-0 grid-bg [mask-image:radial-gradient(ellipse_at_top,black_30%,transparent_70%)]" aria-hidden />
        <header className="relative mx-auto flex h-16 max-w-[1500px] items-center justify-between gap-2 px-4">
          <Link href="/" className="flex items-center gap-2.5">
            <BrandMark />
            <BrandName className="text-[15px]" />
          </Link>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Button size="sm" variant="secondary" onClick={loadDemo} loading={resetting}>
              <Wand2 className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Open the demo factory instead</span>
              <span className="sm:hidden">Demo</span>
            </Button>
          </div>
        </header>
        <main className="relative mx-auto max-w-[1500px] px-4 pt-4 pb-16">
          <div className="mb-5 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
            <div>
              <h1 className="text-[28px] font-semibold tracking-tight text-ink">Twin Builder</h1>
              <p className="mt-1 max-w-3xl text-[14px] text-muted">
                Give the agent your factory&apos;s drawing and tell it what you need. It reads the layout, researches how plants like yours are set up, and drafts the twin. You review every
                element, with where it came from, before anything is built.
              </p>
            </div>
            {meta && (
              <Badge tone={meta.ai.available ? "agent" : "warning"} className="self-start md:self-auto">
                <Sparkles className="h-3 w-3" /> {meta.ai.available ? `Agent: ${meta.ai.model}` : "Template mode"}
              </Badge>
            )}
          </div>

          {!hydrated ? null : phase === "review" && spec ? (
            <ReviewWorkspace />
          ) : phase === "running" ? (
            <div className="mx-auto max-w-2xl space-y-3">
              <AgentStages />
              {research && research.references.length > 0 && (
                <p className="text-[12px] text-muted">
                  Reading {research.references.length} source(s): {research.references.slice(0, 4).map((r) => r.title).join(" · ")}
                </p>
              )}
            </div>
          ) : (
            <StartPanel file={file} setFile={setFile} />
          )}
        </main>
        <Toaster />
      </div>
    </TooltipProvider>
  );
}
