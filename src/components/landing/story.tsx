"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import Link from "next/link";
import {
  ArrowDown,
  ArrowRight,
  BrainCircuit,
  Check,
  Cloud,
  Database,
  Factory,
  FileText,
  FlaskConical,
  Gauge,
  Leaf,
  Network,
  Radio,
  ScanEye,
  ShieldCheck,
  Sparkles,
  Truck,
  Wrench,
} from "lucide-react";
import type { AgentId, AssetStatus } from "@/domain/types";
import type { StoryData } from "@/lib/contracts";
import { cn } from "@/lib/cn";
import { BrandMark, BrandName } from "../brand";
import { IsoScene, type IsoHighlight } from "../iso/iso-scene";
import { ThemeToggle } from "../theme-toggle";

/* ───────────────────────────── scroll helpers ───────────────────────────── */

const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const smooth = (t: number) => {
  const x = clamp(t);
  return x * x * (3 - 2 * x);
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function useScrollProgress(ref: RefObject<HTMLElement | null>) {
  const [p, setP] = useState(0);
  useEffect(() => {
    let raf = 0;
    const update = () => {
      raf = 0;
      const el = ref.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const total = r.height - window.innerHeight;
      setP(total > 0 ? clamp(-r.top / total) : 0);
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      cancelAnimationFrame(raf);
    };
  }, [ref]);
  return p;
}

function useMedia(query: string) {
  const [match, setMatch] = useState(false);
  useEffect(() => {
    const m = window.matchMedia(query);
    const on = () => setMatch(m.matches);
    on();
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, [query]);
  return match;
}

/** One-off intro: the factory assembles itself when the page loads. */
function useIntro(ms = 1700) {
  const [t, setT] = useState(0);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setT(1);
      return;
    }
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const v = clamp((now - start) / ms);
      setT(Math.round(v * 100) / 100);
      if (v < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [ms]);
  return t;
}

function useInView<T extends Element>(ref: RefObject<T | null>, threshold = 0.35) {
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setSeen(true), { threshold });
    io.observe(el);
    return () => io.disconnect();
  }, [ref, threshold]);
  return seen;
}

/* ───────────────────────────── chapters ───────────────────────────── */

const CHAPTERS = [
  {
    eyebrow: "Digital twin",
    tone: "text-accent-ink",
    title: "Every asset. Mirrored.",
    body: (s: StoryData) =>
      `Lines, machines, sensors, materials and customer orders become one living model — ${s.counts.machines} machines and ${s.counts.sensors} sensors streaming into a single source of truth.`,
  },
  {
    eyebrow: "Predictive maintenance",
    tone: "text-warning-ink",
    title: "It notices what people miss.",
    body: (s: StoryData) =>
      `A +${s.focus.step.toFixed(1)} mm/s step in ${s.focus.name}'s vibration. Invisible on the floor. Obvious to the twin — which projects a protective trip in ${Math.round(s.focus.hoursToTrip)} hours.`,
  },
  {
    eyebrow: "Agentic operations",
    tone: "text-agent-ink",
    title: "Six agents. One investigation.",
    body: () => "Maintenance, visual-quality, production, supply-chain and energy agents each bring evidence — the AOI camera corroborates what the accelerometer saw. An orchestrator weighs it all and resolves the conflicts.",
  },
  {
    eyebrow: "What-if simulation",
    tone: "text-accent-ink",
    title: "See tomorrow. Choose today.",
    body: (s: StoryData) => {
      const best = s.scenarios.find((x) => x.id === s.recommendedId)!;
      return `Every plan runs on the same plant model before anything changes. “${best.name}” keeps every due order on time — and avoids a ${Math.round(s.impact.downtimeAvoided)}-hour unplanned stop.`;
    },
  },
  {
    eyebrow: "Human in the loop",
    tone: "text-healthy-ink",
    title: "You stay in command.",
    body: () => "Nothing moves until you approve. Then the twin executes the plan — line re-allocation, maintenance window, return to service.",
  },
  {
    eyebrow: "Audit trail",
    tone: "text-ink-2",
    title: "Every decision, on the record.",
    body: () => "Alerts, agent findings, scenario runs, approvals and their outcomes — one explainable timeline you can hand to anyone.",
  },
] as const;

const STEPS = CHAPTERS.length + 1; // + hero

function useChapterVisibility(pos: number) {
  return (i: number) => {
    const d = pos - i;
    // Sequential crossfade: fade in over [-0.04, 0.10], fade out over [0.78, 0.92] — never two chapters at once.
    if (i === STEPS - 1) return smooth((d + 0.04) / 0.14);
    return Math.min(smooth((d + 0.04) / 0.14), 1 - smooth((d - 0.78) / 0.14));
  };
}

/* ───────────────────────────── overlays ───────────────────────────── */

function Glass({ children, className, style }: { children: ReactNode; className?: string; style?: React.CSSProperties }) {
  return (
    <div className={cn("rounded-2xl border border-line bg-surface/85 p-4 shadow-[var(--shadow-card)] backdrop-blur-xl", className)} style={style}>
      {children}
    </div>
  );
}

function Sparkline({ values, draw, alarm = 7.1, trip = 11.2 }: { values: number[]; draw: number; alarm?: number; trip?: number }) {
  const w = 300;
  const h = 96;
  const max = trip + 0.6;
  const min = 0;
  const x = (i: number) => (i / Math.max(1, values.length - 1)) * w;
  const y = (v: number) => h - ((v - min) / (max - min)) * h;
  const d = values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-24 w-full overflow-visible">
      <line x1={0} x2={w} y1={y(alarm)} y2={y(alarm)} stroke="#f59e0b" strokeOpacity={0.6} strokeWidth={1} />
      <line x1={0} x2={w} y1={y(trip)} y2={y(trip)} stroke="#ef4444" strokeOpacity={0.7} strokeWidth={1} />
      <text x={2} y={y(alarm) - 4} fontSize={10} fill="var(--color-warning-ink)">
        alarm {alarm}
      </text>
      <text x={2} y={y(trip) - 4} fontSize={10} fill="var(--color-critical-ink)">
        trip {trip}
      </text>
      <path d={d} fill="none" stroke="var(--color-series-1)" strokeWidth={2.2} strokeLinejoin="round" pathLength={1} strokeDasharray={1} strokeDashoffset={1 - draw} />
    </svg>
  );
}

const AGENT_ICON: Record<AgentId, typeof Wrench> = { maintenance: Wrench, quality: ScanEye, production: Factory, supply: Truck, energy: Leaf, orchestrator: BrainCircuit };

/* ───────────────────────────── pinned story ───────────────────────────── */

function PinnedStory({ story }: { story: StoryData }) {
  const ref = useRef<HTMLElement>(null);
  const p = useScrollProgress(ref);
  const desktop = useMedia("(min-width: 1024px)");
  const intro = useIntro();
  const pos = p * STEPS; // 0..STEPS
  const step = Math.min(STEPS - 1, Math.floor(pos));
  const local = clamp(pos - step);
  const vis = useChapterVisibility(pos);
  const heroOut = smooth(pos / 0.7);
  const place = smooth((pos - 0.3) / 0.7); // hero → chapter layout

  // Scene state per chapter (statuses, model, highlight, camera)
  const chapter = step; // 0 hero, 1..6
  const model = chapter <= 1 || (chapter === 2 && local < 0.4) ? story.before : chapter === 6 || (chapter === 5 && local >= 0.8) ? story.after : story.crisis;
  const maint = chapter === 5 && local >= 0.45 && local < 0.8;
  const statusOverride = useMemo<Record<string, AssetStatus> | undefined>(() => (maint ? { [story.focus.id]: "maintenance" } : undefined), [maint, story.focus.id]);
  const showPlan = (chapter === 4 && local >= 0.55) || (chapter === 5 && local < 0.8);
  const highlight = useMemo<IsoHighlight | null>(
    () => (showPlan ? { ...story.highlight, targetLabel: maint ? "maintenance in progress" : "maintenance window" } : null),
    [showPlan, maint, story.highlight],
  );
  const camera = useMemo(() => {
    if (chapter === 2) return { focusId: story.focus.id, zoom: desktop ? 1.75 : 1.6 };
    if (chapter === 3) return { focusId: story.focus.id, zoom: 1.3 };
    return { zoom: 1 };
  }, [chapter, desktop, story.focus.id]);

  // Scene placement: centred under the hero, then docked to the right for chapters
  const scene = desktop
    ? { left: lerp(12, 37, place), top: lerp(50, 9, place), width: lerp(76, 59, place), height: lerp(52, 82, place) }
    : { left: 3, top: lerp(50, 10, place), width: 94, height: lerp(44, 46, place) };

  const best = story.scenarios.find((s) => s.id === story.recommendedId)!;
  const maxLate = Math.max(1, ...story.scenarios.map((s) => s.lateUnits));
  const maxCost = Math.max(1, ...story.scenarios.map((s) => s.cost));

  return (
    <section ref={ref} style={{ height: `${STEPS * 115 + 30}vh` }} className="relative" aria-label="Twin AI product story">
      <div className="sticky top-0 h-screen overflow-hidden">
        <div className="pointer-events-none absolute inset-0 grid-bg [mask-image:radial-gradient(ellipse_at_center,black_30%,transparent_75%)]" aria-hidden />

        {/* Hero copy */}
        <div
          className="absolute inset-x-0 top-[13vh] z-10 px-6 text-center lg:top-[14vh]"
          style={{ opacity: 1 - heroOut, transform: `translateY(${-heroOut * 70}px) scale(${1 - heroOut * 0.06})`, pointerEvents: heroOut > 0.5 ? "none" : "auto" }}
        >
          <p className="text-[13px] font-semibold tracking-[0.18em] text-accent-ink uppercase">Twin AI</p>
          <h1 className="mx-auto mt-4 max-w-5xl text-[44px] leading-[1.02] font-semibold tracking-[-0.03em] text-ink sm:text-[64px] lg:text-[84px]">
            Your factory.
            <br />
            <span className="bg-gradient-to-r from-accent-ink via-agent-ink to-accent-ink bg-clip-text text-transparent">Reimagined before reality.</span>
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-[16px] leading-relaxed text-ink-2 sm:text-[19px]">
            A living digital twin with six AI agents that see trouble coming, simulate the fix — and wait for your go.
          </p>
          <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
            <Link href="/dashboard" className="flex h-11 items-center gap-2 rounded-full bg-accent px-6 text-[15px] font-semibold text-white shadow-[0_10px_30px_-10px_var(--color-accent)] hover:bg-accent-strong">
              Launch Factory Demo <ArrowRight className="h-4 w-4" />
            </Link>
            <Link href="/onboarding" className="flex h-11 items-center rounded-full border border-line-strong px-6 text-[15px] font-medium text-ink hover:bg-surface">
              Create your twin
            </Link>
          </div>
        </div>
        <div className="absolute inset-x-0 bottom-6 z-10 flex justify-center" style={{ opacity: 1 - smooth(pos / 0.25) }}>
          <span className="flex items-center gap-2 text-[12.5px] text-muted">
            Scroll to see it work <ArrowDown className="h-3.5 w-3.5 animate-bounce" />
          </span>
        </div>

        {/* The factory */}
        <div
          className="absolute z-0"
          style={{
            left: `${scene.left}vw`,
            top: `${scene.top}vh`,
            width: `${scene.width}vw`,
            height: `${scene.height}vh`,
            maskImage: desktop && place > 0.5 ? "linear-gradient(to right, transparent 0%, black 14%)" : undefined,
            WebkitMaskImage: desktop && place > 0.5 ? "linear-gradient(to right, transparent 0%, black 14%)" : undefined,
          }}
        >
          <IsoScene
            model={model}
            build={intro}
            statusOverride={statusOverride}
            highlight={highlight}
            labels={chapter === 0 ? "none" : "smart"}
            sensors={chapter === 1 && local > 0.25}
            camera={camera}
            className="h-full w-full"
            title="Isometric digital twin of the demo factory"
          />
        </div>

        {/* Scrim keeps chapter copy legible over the scene */}
        <div
          className={cn("pointer-events-none absolute z-[5]", desktop ? "inset-y-0 left-0 w-[46vw] bg-gradient-to-r from-canvas via-canvas/90 to-transparent" : "inset-x-0 bottom-0 h-[50vh] bg-gradient-to-t from-canvas via-canvas/95 to-transparent")}
          style={{ opacity: smooth((pos - 0.6) / 0.4) }}
        />

        {/* Chapter copy */}
        {CHAPTERS.map((c, i) => {
          const v = vis(i + 1);
          if (v <= 0.001) return null;
          return (
            <div
              key={c.title}
              className={cn("absolute z-10", desktop ? "top-1/2 left-[6vw] w-[30vw] max-w-[460px]" : "inset-x-5 top-[58vh]")}
              style={{ opacity: v, transform: `translateY(${desktop ? `calc(-50% + ${(1 - v) * 28}px)` : `${(1 - v) * 24}px`})` }}
            >
              <p className={cn("text-[13px] font-semibold tracking-[0.14em] uppercase", c.tone)}>{c.eyebrow}</p>
              <h2 className="mt-3 text-[34px] leading-[1.05] font-semibold tracking-[-0.02em] text-ink lg:text-[52px]">{c.title}</h2>
              <p className="mt-4 text-[15.5px] leading-relaxed text-ink-2 lg:text-[18px]">{c.body(story)}</p>
            </div>
          );
        })}

        {/* Chapter 1 — mirrored */}
        {vis(1) > 0.01 && desktop && (
          <div className={cn("absolute z-10 flex flex-wrap gap-2", desktop ? "right-[4vw] bottom-[6vh] max-w-[54vw] justify-end" : "inset-x-5 top-[57vh]")} style={{ opacity: vis(1) }}>
            {[
              [story.counts.machines, "machines"],
              [story.counts.sensors, "sensors"],
              [story.counts.lines, "production lines"],
              [story.counts.materials, "materials"],
              [story.counts.readings.toLocaleString("en-US"), "telemetry readings"],
            ].map(([n, l], k) => (
              <div
                key={l}
                className="rounded-full border border-line bg-surface/85 px-3.5 py-1.5 text-[13px] text-ink-2 shadow-[var(--shadow-card)] backdrop-blur"
                style={{ opacity: smooth((local - k * 0.1) / 0.2) * (step === 1 ? 1 : 1), transform: `translateY(${(1 - smooth((local - k * 0.1) / 0.2)) * 10}px)` }}
              >
                <span className="font-semibold text-ink">{n}</span> {l}
              </div>
            ))}
          </div>
        )}

        {/* Chapter 2 — telemetry */}
        {vis(2) > 0.01 && desktop && (
          <Glass className="absolute right-[4vw] bottom-[7vh] z-10 w-[340px]" style={{ opacity: vis(2) }}>
            <div className="flex items-center justify-between">
              <p className="font-mono text-[12px] text-ink">{story.focus.id} · vibration</p>
              <span className="text-[11px] text-muted">last {story.vibration.length} readings</span>
            </div>
            <div className="h-3" />
            <Sparkline values={story.vibration} draw={step === 2 ? smooth(local / 0.6) : 1} />
            <div className="mt-2 space-y-1.5 text-[12.5px]">
              {[
                { t: 0.45, k: "Step change", v: `+${story.focus.step.toFixed(2)} mm/s`, tone: "text-critical-ink" },
                { t: 0.6, k: "Trip predicted in", v: `${story.focus.hoursToTrip.toFixed(0)} h`, tone: "text-critical-ink" },
                { t: 0.75, k: "P(trip ≤ 24 h)", v: `${Math.round(story.focus.p24 * 100)}%`, tone: "text-warning-ink" },
              ].map((r) => (
                <div key={r.k} className="flex justify-between" style={{ opacity: step > 2 ? 1 : smooth((local - r.t) / 0.1) }}>
                  <span className="text-muted">{r.k}</span>
                  <span className={cn("tabular font-semibold", r.tone)}>{r.v}</span>
                </div>
              ))}
            </div>
          </Glass>
        )}

        {/* Chapter 3 — agents */}
        {vis(3) > 0.01 && desktop && (
          <div className={cn("absolute z-10 space-y-2", desktop ? "right-[4vw] bottom-[6vh] w-[380px]" : "inset-x-5 top-[57vh]")} style={{ opacity: vis(3) }}>
            {story.agents.slice(0, desktop ? 6 : 3).map((a, k) => {
              const Icon = AGENT_ICON[a.id];
              const on = step > 3 ? 1 : smooth((local - k * 0.11) / 0.13);
              return (
                <Glass key={a.id} className="flex items-start gap-3 p-3" style={{ opacity: on, transform: `translateX(${(1 - on) * 24}px)` }}>
                  <span className={cn("rounded-lg border p-1.5", a.id === "orchestrator" ? "border-agent/50 bg-agent/15 text-agent-ink" : "border-line bg-surface-2 text-ink-2")}>
                    <Icon className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-[12.5px] font-semibold text-ink">{a.name}</p>
                    <p className="line-clamp-2 text-[11.5px] leading-snug text-ink-2">{a.summary}</p>
                  </div>
                </Glass>
              );
            })}
          </div>
        )}

        {/* Chapter 4 — scenarios */}
        {vis(4) > 0.01 && desktop && (
          <Glass className={cn("absolute z-10", desktop ? "right-[4vw] bottom-[7vh] w-[400px]" : "inset-x-5 top-[57vh]")} style={{ opacity: vis(4) }}>
            <p className="text-[12px] font-semibold tracking-wide text-muted uppercase">Outcome · 48 h</p>
            <div className="mt-3 space-y-3">
              {story.scenarios.map((sc) => {
                const grow = step > 4 ? 1 : smooth(local / 0.5);
                const rec = sc.id === story.recommendedId && (step > 4 || local > 0.55);
                return (
                  <div key={sc.id} className={cn("rounded-xl p-2.5 transition-colors", rec ? "bg-healthy/10 ring-1 ring-healthy/40" : "")}>
                    <div className="flex items-center justify-between text-[12.5px]">
                      <span className="font-medium text-ink">{sc.name}</span>
                      {rec ? (
                        <span className="flex items-center gap-1 text-[11px] font-semibold text-healthy-ink">
                          <Check className="h-3 w-3" /> Recommended
                        </span>
                      ) : sc.failureHour !== null ? (
                        <span className="text-[11px] text-critical-ink">trips at h+{sc.failureHour.toFixed(0)}</span>
                      ) : null}
                    </div>
                    <div className="mt-1.5 grid grid-cols-[70px_1fr_64px] items-center gap-2 text-[11px] text-muted">
                      <span>Late units</span>
                      <div className="h-1.5 rounded-full bg-surface-3">
                        <div className="h-full rounded-full bg-critical" style={{ width: `${(sc.lateUnits / maxLate) * 100 * grow}%` }} />
                      </div>
                      <span className="tabular text-right text-ink">{Math.round(sc.lateUnits * grow).toLocaleString("en-US")}</span>
                      <span>Est. cost</span>
                      <div className="h-1.5 rounded-full bg-surface-3">
                        <div className="h-full rounded-full bg-accent" style={{ width: `${(sc.cost / maxCost) * 100 * grow}%` }} />
                      </div>
                      <span className="tabular text-right text-ink">${Math.round((sc.cost * grow) / 1000)}K</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </Glass>
        )}

        {/* Chapter 5 — approval */}
        {vis(5) > 0.01 && desktop && (
          <Glass className={cn("absolute z-10", desktop ? "right-[4vw] bottom-[7vh] w-[380px]" : "inset-x-5 top-[57vh]")} style={{ opacity: vis(5) }}>
            <p className="text-[12px] font-semibold tracking-wide text-muted uppercase">Recommendation</p>
            <p className="mt-1.5 text-[13.5px] leading-snug font-semibold text-ink">{story.recommendationTitle}</p>
            <div
              className={cn(
                "mt-3 flex h-10 items-center justify-center gap-2 rounded-full text-[14px] font-semibold transition-colors duration-500",
                step > 5 || local > 0.3 ? "bg-healthy text-white" : "bg-accent text-white",
              )}
            >
              {step > 5 || local > 0.3 ? (
                <>
                  <Check className="h-4 w-4" /> Approved by shift lead
                </>
              ) : (
                "Approve & execute"
              )}
            </div>
            <div className="mt-3 space-y-1.5 text-[12.5px]">
              {[
                { t: 0.4, text: `${best.name.includes("Line B") ? "Line B" : "Alternate line"} re-allocated to the critical product` },
                { t: 0.52, text: `Work order started on ${story.focus.id} (lock-out)` },
                { t: 0.8, text: `${story.focus.id} back in service · health ${Math.round(story.afterHealth)}` },
              ].map((r) => (
                <div key={r.text} className="flex items-center gap-2 text-ink-2" style={{ opacity: step > 5 ? 1 : smooth((local - r.t) / 0.08) }}>
                  <Check className="h-3.5 w-3.5 shrink-0 text-healthy" /> {r.text}
                </div>
              ))}
            </div>
            <p className="mt-3 flex items-center gap-1.5 text-[11px] text-muted">
              <ShieldCheck className="h-3.5 w-3.5 text-healthy" /> Approved by a person, executed by the twin
            </p>
          </Glass>
        )}

        {/* Chapter 6 — audit */}
        {vis(6) > 0.01 && desktop && (
          <Glass className={cn("absolute z-10", desktop ? "right-[4vw] bottom-[7vh] w-[380px]" : "inset-x-5 top-[57vh]")} style={{ opacity: vis(6) }}>
            <p className="text-[12px] font-semibold tracking-wide text-muted uppercase">Audit trail</p>
            <ol className="mt-2 space-y-2 border-l border-line pl-3.5">
              {story.audit.slice(0, desktop ? 7 : 4).map((t, k) => (
                <li key={t + k} className="relative text-[12px] text-ink-2" style={{ opacity: smooth((local - k * 0.09) / 0.12) }}>
                  <span className="absolute top-1.5 -left-[18px] h-2 w-2 rounded-full border-2 border-surface bg-accent" />
                  {t}
                </li>
              ))}
            </ol>
          </Glass>
        )}

        {/* Progress */}
        <div className="absolute bottom-6 left-1/2 z-10 hidden -translate-x-1/2 items-center gap-2 lg:flex" style={{ opacity: smooth((pos - 0.6) / 0.3) }}>
          {CHAPTERS.map((c, i) => (
            <span key={c.title} className={cn("h-1.5 rounded-full transition-all duration-300", step === i + 1 ? "w-8 bg-accent" : step > i + 1 ? "w-1.5 bg-ink-2" : "w-1.5 bg-line-strong")} />
          ))}
        </div>
      </div>
    </section>
  );
}

/* ───────────────────────────── after the story ───────────────────────────── */

function CountUp({ to, decimals = 0, prefix = "", suffix = "", run }: { to: number; decimals?: number; prefix?: string; suffix?: string; run: boolean }) {
  const [v, setV] = useState(0);
  useEffect(() => {
    if (!run) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setV(to);
      return;
    }
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = clamp((now - start) / 1400);
      setV(to * (1 - Math.pow(1 - t, 3)));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [run, to]);
  return (
    <span className="tabular">
      {prefix}
      {v.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}
      {suffix}
    </span>
  );
}

function Numbers({ story }: { story: StoryData }) {
  const ref = useRef<HTMLDivElement>(null);
  const seen = useInView(ref);
  const items = [
    { to: story.impact.downtimeAvoided, suffix: " h", label: "of unplanned downtime avoided" },
    { to: story.impact.lateAvoided, label: "late units avoided on a critical order" },
    { to: story.impact.costAvoided / 1000, prefix: "$", suffix: "K", label: "estimated operating cost avoided" },
    { to: 0, label: "commands sent to real machines" },
  ];
  return (
    <section className="border-t border-line/70 px-6 py-28">
      <div ref={ref} className="mx-auto max-w-6xl">
        <p className="text-center text-[13px] font-semibold tracking-[0.14em] text-accent-ink uppercase">The crisis, by the numbers</p>
        <h2 className="mx-auto mt-3 max-w-3xl text-center text-[36px] leading-tight font-semibold tracking-[-0.02em] text-ink lg:text-[52px]">One bearing. One decision. Measured.</h2>
        <div className="mt-14 grid gap-px overflow-hidden rounded-3xl border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
          {items.map((it) => (
            <div key={it.label} className="bg-surface p-8">
              <p className="text-[48px] leading-none font-semibold tracking-[-0.03em] text-ink lg:text-[56px]">
                <CountUp to={it.to} prefix={it.prefix} suffix={it.suffix} run={seen} />
              </p>
              <p className="mt-3 text-[14px] leading-snug text-ink-2">{it.label}</p>
            </div>
          ))}
        </div>
        <p className="mt-5 text-center text-[12px] text-muted">
          Computed by the Twin engine for the demo scenario: reroute + maintain vs. continuing unchanged, over 48 hours.
        </p>
      </div>
    </section>
  );
}

function Reveal({ children, className, delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const seen = useInView(ref, 0.2);
  return (
    <div ref={ref} className={cn("transition-all duration-700 ease-out", seen ? "translate-y-0 opacity-100" : "translate-y-6 opacity-0", className)} style={{ transitionDelay: `${delay}ms` }}>
      {children}
    </div>
  );
}

const FEATURES = [
  { icon: Network, title: "Living digital twin", body: "Topology, isometric and floor-plan views of lines, machines, sensors, materials and orders — every element backed by live state." },
  { icon: Wrench, title: "Predictive maintenance", body: "Trend and change-point detection with time-to-trip and failure probability — and the uncertainty stated." },
  { icon: FlaskConical, title: "What-if simulation", body: "The plant engine compares plans on output, delivery, downtime, energy, scrap and cost." },
  { icon: BrainCircuit, title: "Agentic operations", body: "Six agents investigate together and propose one plan — with evidence, risks and rollback." },
];

function Platform() {
  return (
    <section className="border-t border-line/70 bg-shell/40 px-6 py-28">
      <div className="mx-auto max-w-6xl">
        <Reveal>
          <p className="text-[13px] font-semibold tracking-[0.14em] text-accent-ink uppercase">The platform</p>
          <h2 className="mt-3 max-w-3xl text-[36px] leading-tight font-semibold tracking-[-0.02em] text-ink lg:text-[52px]">One shared model of the plant. Four ways to act on it.</h2>
        </Reveal>
        <div className="mt-12 grid gap-4 md:grid-cols-2">
          {FEATURES.map((f, i) => (
            <Reveal key={f.title} delay={i * 80}>
              <div className="h-full rounded-3xl border border-line bg-surface p-7">
                <span className="inline-flex rounded-2xl border border-line bg-surface-2 p-3 text-accent">
                  <f.icon className="h-6 w-6" />
                </span>
                <h3 className="mt-5 text-[20px] font-semibold tracking-tight text-ink">{f.title}</h3>
                <p className="mt-2 text-[15px] leading-relaxed text-ink-2">{f.body}</p>
              </div>
            </Reveal>
          ))}
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          {[
            { icon: Gauge, t: "Numbers come from the twin", b: "The plant model computes every figure. Language models only explain — and their figures are checked against the twin." },
            { icon: ShieldCheck, t: "Humans stay in control", b: "Recommendations list actions, evidence, risks and rollback. Nothing changes until a person approves." },
            { icon: FileText, t: "Everything is auditable", b: "Alerts, findings, scenario runs, decisions and outcomes form one explainable timeline." },
          ].map((x, i) => (
            <Reveal key={x.t} delay={i * 80}>
              <div className="h-full rounded-3xl border border-line/70 p-6">
                <x.icon className="h-5 w-5 text-accent" />
                <p className="mt-3 text-[15px] font-semibold text-ink">{x.t}</p>
                <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-2">{x.b}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

function CloudSection() {
  return (
    <section className="border-t border-line/70 px-6 py-28">
      <div className="mx-auto max-w-6xl">
        <Reveal>
          <p className="text-[13px] font-semibold tracking-[0.14em] text-accent-ink uppercase">Built for Google Cloud</p>
          <h2 className="mt-3 max-w-3xl text-[36px] leading-tight font-semibold tracking-[-0.02em] text-ink lg:text-[52px]">Built on Google Cloud. Ready to scale with your plant.</h2>
        </Reveal>
        <div className="mt-12 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {[
            { icon: Sparkles, t: "Meta Muse models", b: "Muse Wonder briefings, a Muse Spark copilot and Twin Builder, SAM 3.1 vision, all with grounded output" },
            { icon: Database, t: "BigQuery", b: "Telemetry, health history and scenario outcomes" },
            { icon: Radio, t: "Pub/Sub", b: "Streaming telemetry ingestion" },
            { icon: FileText, t: "Cloud Storage", b: "Manuals and inspection reports per asset" },
            { icon: Cloud, t: "Cloud Run", b: "One container for UI and API" },
          ].map((x, i) => (
            <Reveal key={x.t} delay={i * 60}>
              <div className="h-full rounded-2xl border border-line bg-surface p-5">
                <x.icon className="h-5 w-5 text-ink-2" />
                <p className="mt-3 text-[14px] font-semibold text-ink">{x.t}</p>
                <p className="mt-1 text-[12.5px] text-muted">{x.b}</p>
              </div>
            </Reveal>
          ))}
        </div>
        <p className="mt-6 text-[13px] text-muted">Each integration switches on from the Integrations page and shows Connected only after a real check.</p>
      </div>
    </section>
  );
}

function FinalCta() {
  return (
    <section className="relative overflow-hidden border-t border-line/70 px-6 py-36 text-center">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,color-mix(in_oklab,var(--color-accent)_16%,transparent),transparent_60%)]" aria-hidden />
      <Reveal className="relative">
        <h2 className="mx-auto max-w-4xl text-[44px] leading-[1.02] font-semibold tracking-[-0.03em] text-ink lg:text-[76px]">Meet your factory&apos;s twin.</h2>
        <p className="mx-auto mt-5 max-w-xl text-[17px] text-ink-2">No credentials. No setup. The crisis demo runs in your browser in under five minutes.</p>
        <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
          <Link href="/dashboard" className="flex h-12 items-center gap-2 rounded-full bg-accent px-7 text-[15px] font-semibold text-white shadow-[0_12px_32px_-10px_var(--color-accent)] hover:bg-accent-strong">
            Launch Factory Demo <ArrowRight className="h-4 w-4" />
          </Link>
          <Link href="/onboarding" className="flex h-12 items-center rounded-full border border-line-strong px-7 text-[15px] font-medium text-ink hover:bg-surface">
            Create your twin
          </Link>
        </div>
      </Reveal>
    </section>
  );
}

function Nav() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 12);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  return (
    <header className={cn("fixed inset-x-0 top-0 z-50 transition-colors duration-300", scrolled ? "border-b border-line/70 bg-canvas/75 backdrop-blur-xl" : "bg-transparent")}>
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-5 lg:px-8">
        <Link href="/" className="flex items-center gap-2.5">
          <BrandMark className="h-7 w-7" />
          <BrandName className="text-[15px]" />
        </Link>
        <nav className="hidden items-center gap-7 text-[13px] text-ink-2 md:flex">
          <a href="#numbers" className="hover:text-ink">
            Impact
          </a>
          <a href="#platform" className="hover:text-ink">
            Platform
          </a>
          <a href="#cloud" className="hover:text-ink">
            Google Cloud
          </a>
        </nav>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Link href="/dashboard" className="flex h-8 items-center gap-1.5 rounded-full bg-accent px-4 text-[13px] font-medium text-white hover:bg-accent-strong">
            Launch demo <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>
    </header>
  );
}

export function LandingExperience({ story }: { story: StoryData }) {
  return (
    <div className="min-h-screen overflow-x-clip bg-canvas text-ink">
      <Nav />
      <PinnedStory story={story} />
      <div id="numbers">
        <Numbers story={story} />
      </div>
      <div id="platform">
        <Platform />
      </div>
      <div id="cloud">
        <CloudSection />
      </div>
      <FinalCta />
      <footer className="border-t border-line/70">
        <div className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-2 px-5 py-6 text-[12px] text-muted sm:flex-row sm:items-center lg:px-8">
          <span className="flex items-center gap-2">
            <BrandMark className="h-5 w-5" /> Twin AI
          </span>
          <span>Built on Google Cloud</span>
        </div>
      </footer>
    </div>
  );
}
