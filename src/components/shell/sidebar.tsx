"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useFactory } from "@/client/store";
import { cn } from "@/lib/cn";
import { BrandMark, BrandName } from "../brand";
import { NAV } from "./nav";

export function Sidebar({ open, onNavigate }: { open: boolean; onNavigate: () => void }) {
  const pathname = usePathname();
  const pending = useFactory((s) => s.state?.recommendations.filter((r) => r.status === "pending").length ?? 0);
  const incidents = useFactory((s) => s.state?.incidents.filter((i) => i.status !== "resolved" && i.severity === "critical").length ?? 0);
  const analyzing = useFactory((s) => !!s.analysis?.running);

  const counter = (href: string) => {
    if (href === "/approvals" && pending) return { n: pending, tone: "bg-warning/20 text-warning-ink" };
    if (href === "/dashboard" && incidents) return { n: incidents, tone: "bg-critical/20 text-critical-ink" };
    return null;
  };

  return (
    <aside
      className={cn(
        "fixed inset-y-0 left-0 z-40 flex w-60 flex-col border-r border-line bg-shell transition-transform lg:translate-x-0",
        open ? "translate-x-0" : "-translate-x-full",
      )}
    >
      <Link href="/" className="flex h-14 items-center gap-2.5 border-b border-line px-4" onClick={onNavigate}>
        <BrandMark />
        <BrandName className="text-[15px]" />
      </Link>
      <nav className="flex-1 overflow-y-auto px-2.5 py-3">
        {NAV.map((group) => (
          <div key={group.section} className="mb-4">
            <p className="px-2 pb-1.5 text-[10.5px] font-semibold tracking-[0.08em] text-muted uppercase">{group.section}</p>
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const active = pathname === item.href || pathname.startsWith(item.href + "/");
                const c = counter(item.href);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "group flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-[13px] font-medium transition-colors",
                        active ? "bg-surface-2 text-ink shadow-[inset_2px_0_0_var(--color-accent)]" : "text-ink-2 hover:bg-surface/70 hover:text-ink",
                      )}
                    >
                      <item.icon className={cn("h-4 w-4", active ? "text-accent" : "text-muted group-hover:text-ink-2")} />
                      <span className="flex-1 truncate">{item.label}</span>
                      {item.href === "/agents" && analyzing && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-agent" />}
                      {c && <span className={cn("rounded px-1.5 py-px text-[10.5px] font-semibold", c.tone)}>{c.n}</span>}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
    </aside>
  );
}
