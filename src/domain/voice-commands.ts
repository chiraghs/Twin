/**
 * Voice commands for the VR plant. Speech is transcribed first (Muse Voice Transcribe); this turns
 * the text into a command deterministically. Anything that isn't a command goes to the copilot.
 * Risky commands (trip) need a spoken "confirm" afterwards.
 */
export type VoiceCommand =
  | { kind: "goto"; query: string }
  | { kind: "ack"; target: string | null }
  | { kind: "speed"; delta: number; target: string | null }
  | { kind: "trip"; target: string | null }
  | { kind: "restore"; target: string | null }
  | { kind: "confirm" }
  | { kind: "cancel" }
  | { kind: "exit" }
  | { kind: "mute" }
  | { kind: "unmute" }
  | { kind: "help" }
  | { kind: "heat"; metric: HeatMetric | null }
  | { kind: "bottleneck"; target: string | null }
  | { kind: "whatif"; target: string | null; speedPct: number | null; maintain: boolean }
  | { kind: "replay"; hours: number | null }
  | { kind: "flow"; on: boolean }
  | { kind: "table"; on: boolean }
  | { kind: "recenter" }
  | { kind: "seated"; on: boolean }
  | { kind: "perf"; on: boolean }
  | { kind: "ask"; text: string };

/** What the VR heatmap colours machines by. */
export type HeatMetric = "temperature" | "vibration" | "energy" | "health" | "life" | "state" | "noise";

const HEAT_WORDS: [RegExp, HeatMetric][] = [
  [/\b(vibration|vibrations|shaking)\b/, "vibration"],
  [/\b(energy|power|electric|electricity|kw)\b/, "energy"],
  [/\b(health)\b/, "health"],
  [/\b(life|rul|remaining|failure|failures|wear)\b/, "life"],
  [/\b(state|states|status|blocked|starved|bottlenecks?)\b/, "state"],
  [/\b(noise|sound|loud|decibels?|environment)\b/, "noise"],
  [/\b(temperature|temp|hot|thermal)\b/, "temperature"],
];
const heatMetricOf = (t: string): HeatMetric | null => HEAT_WORDS.find(([re]) => re.test(t))?.[1] ?? null;

const HOURS_WORD: Record<string, string> = { eleven: "11", twelve: "12", fifteen: "15", eighteen: "18", couple: "2", few: "3" };

const NUM: Record<string, string> = { zero: "0", oh: "0", one: "1", two: "2", to: "2", too: "2", three: "3", four: "4", for: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9", ten: "10" };

/**
 * Make spoken ids searchable: "a rob zero three" → "a rob 03", "line a" stays, punctuation and
 * filler words go. Number words only become digits when they follow another number or a short
 * id-like token, so "go to the press" keeps its "to".
 */
export function normalizeSpoken(raw: string): string {
  const words = raw
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/[\s]+/)
    .filter(Boolean);
  const out: string[] = [];
  for (const w of words) {
    const prev = out[out.length - 1];
    const prevIsNumOrId = prev !== undefined && (/^\d+$/.test(prev) || /^[a-z]{1,4}$/.test(prev) || /^[a-z]+-[a-z0-9]+$/.test(prev));
    if (NUM[w] && (/^\d+$/.test(prev ?? "") || (prevIsNumOrId && !["go", "the", "it", "me", "up", "down"].includes(prev ?? "")))) {
      // Join consecutive digits: "zero three" → "03".
      if (/^\d+$/.test(prev ?? "")) out[out.length - 1] = `${prev}${NUM[w]}`;
      else out.push(NUM[w]);
    } else out.push(w);
  }
  return out.join(" ").trim();
}

const FILLER = /\b(please|now|the|this|that|machine|okay|ok|hey|twin)\b/g;
const strip = (s: string) => s.replace(FILLER, " ").replace(/\s+/g, " ").trim();
/** "speed down on A-ROB-03" / "for press two" → the target text, if any. */
const targetOf = (s: string) => {
  const m = s.match(/\b(?:on|for|of|at)\s+(.+)$/);
  return m ? strip(m[1]) || null : null;
};

export function parseVoiceCommand(transcript: string): VoiceCommand {
  const raw = transcript.trim();
  const t = normalizeSpoken(raw);
  if (!t) return { kind: "help" };
  if (/^(confirm|confirmed|yes confirm|yes do it|do it)$/.test(t)) return { kind: "confirm" };
  if (/^(cancel|no|stop|never ?mind|abort)$/.test(t)) return { kind: "cancel" };
  if (/^(exit|leave|quit|close) (vr|virtual reality)$|^exit$/.test(t)) return { kind: "exit" };
  if (/^(mute|be quiet|quiet|stop talking|silence)( voice| sound)?$/.test(t)) return { kind: "mute" };
  if (/^(unmute|sound on|speak|talk to me|voice on)$/.test(t)) return { kind: "unmute" };
  if (/^(help|what can i say|commands)$/.test(t)) return { kind: "help" };
  if (/\b(acknowledge|ack)\b.*\balarms?\b|^(acknowledge|ack)\b/.test(t)) return { kind: "ack", target: targetOf(t) };
  // Questions ("why is line A slow?") go to the copilot, never to a machine command.
  const question = /^(why|how|what|when|which|who|is|are|does|do|can|could|should|will|would)\b/.test(t);
  const speed = question ? null : t.match(/\b(speed|slow|faster|slower)\b/);
  if (speed) {
    const pct = t.match(/\b(\d{1,2})\s*(?:percent|%)?/);
    const step = pct ? Math.min(50, Math.max(5, Number(pct[1]))) : 10;
    const down = /\b(down|slow|slower|decrease|reduce|lower)\b/.test(t);
    const up = /\b(up|faster|increase|raise)\b/.test(t);
    if (down || up) return { kind: "speed", delta: down ? -step : step, target: targetOf(t) };
  }
  if (/^(?:recenter|re-center|reset (?:view|camera|pose)|center (?:view|camera)|center)$/.test(t)) return { kind: "recenter" };
  if (/^(trip|stop|shut ?down|emergency stop)\b/.test(t)) return { kind: "trip", target: targetOf(t) };
  if (/^(restore|restart|start|reset|resume)\b/.test(t)) return { kind: "restore", target: targetOf(t) };
  // Heatmap: "show heat", "heatmap vibration", "show energy heat", "heat off".
  if (/\b(heat ?maps?|heat|overlay|colou?r by)\b/.test(t) && !/\bwhat if\b/.test(t)) {
    if (/\b(off|hide|clear|remove|stop|none)\b/.test(t)) return { kind: "heat", metric: null };
    return { kind: "heat", metric: heatMetricOf(t.replace(/\bheat ?maps?|heat\b/g, " ")) ?? "temperature" };
  }
  if (/^(show|colou?r)( me)?( the)? (energy|power|vibration|health|remaining life|failure risk|machine states?|states|noise)( map)?$/.test(t)) return { kind: "heat", metric: heatMetricOf(t) };
  // Bottleneck: answered from the twin directly.
  if (/\bbottleneck\b|\bconstraint\b|\bwhat(s| is) (slowing|limiting|holding)\b/.test(t)) return { kind: "bottleneck", target: targetOf(t) };
  // What-if: "what if A-ROB-03 runs at 80 percent", "what if we maintain the robot now".
  const wi = t.match(/^what if\s+(.+)$/);
  if (wi) {
    const body = wi[1];
    const maintain = /\b(maintain|maintenance|service|repair|fix)\b/.test(body);
    const pm = body.match(/\b(?:at|to)\s+(\d{2,3})(?:\s*percent)?\b/) ?? body.match(/\b(\d{2,3})\s*percent\b/);
    const rest = pm ? body.replace(pm[0], " ") : body;
    const tgt = strip(rest.replace(/\b(we|i|you|maintain|maintenance|service|repair|fix|stop|for|now|today|it|runs?|ran|running|goes|go|went|is|was|were|at|speed|slowed|set|percent)\b/g, " "));
    if (maintain || pm) return { kind: "whatif", target: tgt || null, speedPct: pm ? Number(pm[1]) : null, maintain };
    return { kind: "ask", text: raw };
  }
  // Replay: "replay the last 6 hours", "rewind 2 hours", "go back 3 hours"; "back to live".
  if (/^(back (to|2) live|live|go live|stop replay|end replay|exit replay)$/.test(t)) return { kind: "replay", hours: null };
  const rp = t.match(/^(?:replay|rewind|go back|play back|playback)\b(?:.*?\b(\d{1,2}|[a-z]+)\s*(?:hours?|h)\b)?/);
  if (rp) {
    const n = rp[1] ? Number(/^\d+$/.test(rp[1]) ? rp[1] : (NUM[rp[1]] ?? HOURS_WORD[rp[1]] ?? 6)) : 6;
    return { kind: "replay", hours: Math.min(18, Math.max(1, n)) };
  }
  if (/^(?:show |switch to |go to |open )?(?:the )?(?:table ?view|tabletop|table|miniature)(?: view| mode)?$|^(?:table|tabletop) ?(?:view|mode) on$/.test(t)) return { kind: "table", on: true };
  if (/^(?:full size|full scale|life size|exit table(?: view)?|table (?:view|mode) off|switch to (?:full size|full scale))$/.test(t)) return { kind: "table", on: false };
  if (/^(?:recenter|re-center|reset view|center view|center)$/.test(t)) return { kind: "recenter" };
  if (/^(?:seated(?: mode)?|sit down|chair mode)$/.test(t)) return { kind: "seated", on: true };
  if (/^(?:standing(?: mode)?|stand up)$/.test(t)) return { kind: "seated", on: false };
  if (/^(?:quest )?perf(?:ormance)?(?: mode)?(?: on)?$/.test(t)) return { kind: "perf", on: true };
  if (/^(?:quest )?perf(?:ormance)?(?: mode)? off$/.test(t)) return { kind: "perf", on: false };
  if (/^(show|hide|turn on|turn off)( the)? (product )?flow( on| off)?$|^flow (on|off)$/.test(t)) return { kind: "flow", on: !/\b(hide|off)\b/.test(t) };
  if (question) return { kind: "ask", text: raw };
  const go = t.match(/^(?:go to|goto|take me to|show me|show|find|where is|where s|navigate to|teleport to|walk to)\s+(.+)$/);
  if (go) {
    const q = strip(go[1]);
    if (q) return { kind: "goto", query: q };
  }
  return { kind: "ask", text: raw };
}

/** What to say for "help". */
export const VOICE_HELP =
  "Say: go to A-ROB-03, show heat or show vibration, where is the bottleneck, what if A-ROB-03 runs at 80 percent, replay the last 6 hours, table view, recenter, seated mode, performance mode, acknowledge alarm, speed down, trip, restore, mute, or exit VR. Anything else goes to the copilot.";
