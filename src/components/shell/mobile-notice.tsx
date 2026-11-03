"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, Check, Link2, Monitor } from "lucide-react";
import { BrandMark, BrandName } from "../brand";
import { MOBILE_OK_KEY } from "./mobile-boot";


/**
 * Full-page notice on phones (small screens, or touch screens narrower than a laptop): the demo is
 * built for a computer, but the visitor can continue. Shown and hidden by CSS (globals.css), so
 * desktop visitors never see it and there is no flash.
 */
export function MobileNotice() {
  const [copied, setCopied] = useState(false);
  const proceed = () => {
    try {
      sessionStorage.setItem(MOBILE_OK_KEY, "1");
    } catch {
      /* storage unavailable: the notice still closes for this page view */
    }
    document.documentElement.setAttribute("data-mobile-ok", "");
  };
  const copy = async () => {
    const url = window.location.href;
    try {
      if (navigator.share) await navigator.share({ title: "Twin AI", url });
      else {
        await navigator.clipboard.writeText(url);
        setCopied(true);
      }
    } catch {
      /* the visitor closed the share sheet */
    }
  };
  return (
    <div className="mobile-gate fixed inset-0 z-[200] flex-col overflow-y-auto bg-canvas px-6 py-8" role="dialog" aria-modal="true" aria-labelledby="mobile-gate-title" data-testid="mobile-notice">
      <div className="flex items-center gap-2">
        <BrandMark />
        <BrandName className="text-[15px]" />
      </div>
      <div className="my-auto py-8">
        <span className="inline-flex rounded-2xl border border-line bg-surface p-3 text-accent">
          <Monitor className="h-7 w-7" />
        </span>
        <h1 id="mobile-gate-title" className="mt-5 text-[22px] leading-tight font-semibold text-ink">
          Twin is best viewed on a computer
        </h1>
        <p className="mt-3 text-[14px] leading-relaxed text-ink-2">
          The digital twin, the 3D view, the what-if simulator and the CCTV control room are built for a larger screen and a mouse. On a phone some views are cramped, but everything still works.
        </p>
        <div className="mt-7 space-y-2.5">
          <button
            onClick={proceed}
            className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-accent px-4 text-[14px] font-semibold text-white shadow-lg hover:brightness-110"
            data-testid="mobile-continue"
          >
            Continue on this device <ArrowRight className="h-4 w-4" />
          </button>
          <button onClick={() => void copy()} className="flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-line bg-surface px-4 text-[14px] font-medium text-ink">
            {copied ? <Check className="h-4 w-4 text-healthy" /> : <Link2 className="h-4 w-4" />} {copied ? "Link copied" : "Send the link to my computer"}
          </button>
          <Link href="/" className="block py-2 text-center text-[13px] text-muted hover:text-ink">
            Back to the home page
          </Link>
        </div>
      </div>
    </div>
  );
}
