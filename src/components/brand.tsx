import { cn } from "@/lib/cn";

export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn("h-7 w-7", className)} aria-hidden>
      <rect width="32" height="32" rx="8" fill="#0f1a33" />
      <rect x="0.5" y="0.5" width="31" height="31" rx="7.5" fill="none" stroke="#2b3b5e" />
      <path d="M8 9.5h16" stroke="#4c8dff" strokeWidth="2.6" strokeLinecap="round" />
      <path d="M16 9.5v10" stroke="#4c8dff" strokeWidth="2.6" strokeLinecap="round" />
      <path d="M16 19.5l-5 4M16 19.5l5 4" stroke="#6f7d99" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="10.5" cy="24" r="2.4" fill="#10b981" />
      <circle cx="21.5" cy="24" r="2.4" fill="#9085e9" />
    </svg>
  );
}

export function BrandName({ className }: { className?: string }) {
  return (
    <span className={cn("font-semibold tracking-tight text-ink", className)}>
      Twin<span className="text-accent"> AI</span>
    </span>
  );
}
