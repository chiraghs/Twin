"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { cn } from "@/lib/cn";

import { THEME_KEY } from "./theme-boot";

export type Theme = "dark" | "light";
export { THEME_KEY };

export function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setThemeState] = useState<Theme>("dark");
  useEffect(() => {
    setThemeState(document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark");
    const obs = new MutationObserver(() => setThemeState(document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark"));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => obs.disconnect();
  }, []);
  const setTheme = (t: Theme) => {
    document.documentElement.setAttribute("data-theme", t);
    try {
      localStorage.setItem(THEME_KEY, t);
    } catch {
      /* storage unavailable — theme still applies for this page view */
    }
  };
  return [theme, setTheme];
}

export function ThemeToggle({ className }: { className?: string }) {
  const [theme, setTheme] = useTheme();
  const next: Theme = theme === "dark" ? "light" : "dark";
  return (
    <button
      type="button"
      onClick={() => setTheme(next)}
      aria-label={`Switch to ${next} theme`}
      title={`Switch to ${next} theme`}
      className={cn(
        "relative inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-line bg-surface text-ink-2 transition-colors hover:text-ink",
        className,
      )}
    >
      <Sun className={cn("absolute h-4 w-4 transition-all duration-300", theme === "light" ? "scale-100 rotate-0 opacity-100" : "scale-50 -rotate-90 opacity-0")} />
      <Moon className={cn("absolute h-4 w-4 transition-all duration-300", theme === "dark" ? "scale-100 rotate-0 opacity-100" : "scale-50 rotate-90 opacity-0")} />
    </button>
  );
}
