"use client";

import { useEffect, useRef, useState } from "react";
import { Send, Sparkles } from "lucide-react";
import { aiShortName, useAiInfo } from "@/client/ai";
import { usePlayground } from "@/client/playground";
import { Badge, Button, Textarea } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";

const SUGGESTIONS = [
  "When the first process line stops, let the second line take over its work",
  "Reorder the first material when stock falls below 500, 2,000 per order",
  "Propose maintenance on any machine whose health drops below 45",
  "Add 2 kitting AMRs to the first line that run every 15 minutes",
  "Pause the first line when 300 units are waiting before packing",
];

/** Ask the AI to make edits. It proposes the same operations the canvas uses; they are checked in code. */
export function Assistant() {
  const chat = usePlayground((s) => s.chat);
  const busy = usePlayground((s) => s.busy.ai);
  const ask = usePlayground((s) => s.ask);
  const ai = useAiInfo();
  const [text, setText] = useState("");
  const end = useRef<HTMLDivElement>(null);
  const available = ai?.capabilities.available ?? false;
  const name = aiShortName(ai);

  useEffect(() => end.current?.scrollIntoView({ block: "nearest" }), [chat.length, busy]);

  const send = (t: string) => {
    const v = t.trim();
    if (!v || busy) return;
    setText("");
    void ask(v);
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-2" data-testid="pg-assistant">
      {ai && !available && (
        <div className="rounded-lg border border-warning/40 bg-warning/10 p-2.5 text-[12px] leading-relaxed text-warning-ink">
          AI help is off on this server{ai.disabled ? " (paused in Integrations)" : ""}. Everything here also works by hand: drag, connect and add rules directly.
        </div>
      )}
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
        {!chat.length && (
          <div className="space-y-1.5">
            <p className="text-[12px] text-muted">Describe a change in plain words. {available ? `${name} turns it into edits you can undo.` : ""}</p>
            {SUGGESTIONS.map((s) => (
              <button key={s} disabled={!available || busy} onClick={() => send(s)} className="block w-full rounded-lg border border-line bg-surface px-2.5 py-1.5 text-left text-[12px] text-ink-2 hover:border-agent/50 hover:text-ink disabled:opacity-50">
                {s}
              </button>
            ))}
          </div>
        )}
        {chat.map((t, i) => (
          <div key={i} className={cn("rounded-lg px-2.5 py-2 text-[12.5px] leading-relaxed", t.role === "user" ? "ml-6 bg-accent/10 text-ink" : "mr-2 border border-line bg-surface text-ink-2")}>
            {t.role === "agent" && (
              <span className="mb-1 flex items-center gap-1 text-[11px] font-medium text-agent-ink">
                <Sparkles className="h-3 w-3" /> {name}
              </span>
            )}
            {t.text}
            {!!t.applied?.length && (
              <ul className="mt-1.5 space-y-0.5">
                {t.applied.map((a, j) => (
                  <li key={j}>
                    <Badge tone="healthy">{a}</Badge>
                  </li>
                ))}
              </ul>
            )}
            {!!t.rejected?.length && (
              <ul className="mt-1.5 space-y-0.5">
                {t.rejected.map((a, j) => (
                  <li key={j} className="text-[11.5px] text-warning-ink">
                    Skipped: {a}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
        {busy && <p className="text-[12px] text-muted">{name} is working on it…</p>}
        <div ref={end} />
      </div>
      <form
        className="flex items-end gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          send(text);
        }}
      >
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send(text);
            }
          }}
          disabled={!available}
          placeholder={available ? "e.g. move the oven after the press and add a rule…" : "AI help is off"}
          aria-label="Ask the AI to change the playground"
          className="min-h-16 text-[13px]"
        />
        <Button type="submit" size="icon" variant="agent" disabled={!available || !text.trim()} loading={busy} aria-label="Send">
          {!busy && <Send className="h-3.5 w-3.5" />}
        </Button>
      </form>
    </div>
  );
}
