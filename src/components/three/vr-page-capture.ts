/**
 * Draws what a same-origin page shows (its current viewport) onto a canvas, so the website can be
 * shown on a panel inside the headset. The live DOM is cloned with the page's own stylesheets and
 * rendered by the browser itself through an SVG foreignObject image: every CSS feature the page
 * uses (variables, oklch colors, grid) renders as on screen, with no extra library.
 */

/** The iframe's window name: the app hides its own shell (sidebar, top bar) when it sees it. */
export const VR_BROWSER_NAME = "twin-vr-browser";

let cssCache: { key: string; css: Promise<string> } | null = null;

const toDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });

/** The page's CSS as text. Latin web fonts are inlined (an SVG image may not load files). */
async function collectCss(doc: Document): Promise<string> {
  const parts: string[] = [];
  const fonts: Promise<string>[] = [];
  for (const sheet of Array.from(doc.styleSheets)) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue;
    }
    for (const rule of Array.from(rules)) {
      if (rule instanceof CSSFontFaceRule) {
        const range = rule.style.getPropertyValue("unicode-range");
        if (range && !range.includes("U+0000-00FF") && !range.includes("U+0-FF")) continue;
        const m = /url\(["']?([^"')]+)["']?\)/.exec(rule.cssText);
        if (!m) continue;
        const url = new URL(m[1], sheet.href ?? doc.baseURI).href;
        fonts.push(
          fetch(url)
            .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(String(r.status)))))
            .then(toDataUrl)
            .then((data) => rule.cssText.replace(/src:[^;]+;/, `src: url("${data}");`))
            .catch(() => ""),
        );
        continue;
      }
      parts.push(rule.cssText);
    }
  }
  return (await Promise.all(fonts)).join("\n") + "\n" + parts.join("\n");
}

function cssFor(doc: Document) {
  const key = Array.from(doc.styleSheets)
    .map((s) => s.href ?? `inline:${(s.ownerNode as HTMLElement | null)?.textContent?.length ?? 0}`)
    .join("|");
  if (!cssCache || cssCache.key !== key) cssCache = { key, css: collectCss(doc) };
  return cssCache.css;
}

/** Copies what cloneNode leaves behind: canvas pixels, images, typed form values. */
function freeze(live: HTMLElement, clone: HTMLElement) {
  const doc = live.ownerDocument;
  const lc = live.querySelectorAll("canvas");
  const cc = clone.querySelectorAll("canvas");
  lc.forEach((c, i) => {
    const img = doc.createElement("img");
    try {
      img.src = c.toDataURL();
    } catch {
      return;
    }
    const r = c.getBoundingClientRect();
    img.setAttribute("class", c.getAttribute("class") ?? "");
    img.setAttribute("style", `${c.getAttribute("style") ?? ""};width:${r.width}px;height:${r.height}px`);
    cc[i]?.replaceWith(img);
  });
  const li = live.querySelectorAll("img");
  const ci = clone.querySelectorAll("img");
  li.forEach((img, i) => {
    const target = ci[i];
    if (!target || img.src.startsWith("data:") || !img.complete || !img.naturalWidth) return;
    try {
      const c = doc.createElement("canvas");
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      c.getContext("2d")!.drawImage(img, 0, 0);
      target.src = c.toDataURL();
      target.removeAttribute("srcset");
    } catch {
      /* cross-origin image: leave it out */
    }
  });
  const lf = live.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("input, textarea, select");
  const cf = clone.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("input, textarea, select");
  lf.forEach((f, i) => {
    const t = cf[i];
    if (!t) return;
    if (f instanceof HTMLInputElement && (f.type === "checkbox" || f.type === "radio")) {
      if (f.checked) t.setAttribute("checked", "");
      else t.removeAttribute("checked");
    } else if (f instanceof HTMLTextAreaElement) t.textContent = f.value;
    else if (f instanceof HTMLSelectElement) t.querySelectorAll("option").forEach((o, k) => (k === f.selectedIndex ? o.setAttribute("selected", "") : o.removeAttribute("selected")));
    else t.setAttribute("value", f.value);
  });
  // Inner scroll areas keep their position.
  const ls = live.querySelectorAll<HTMLElement>("*");
  const cs = clone.querySelectorAll<HTMLElement>("*");
  ls.forEach((el, i) => {
    if (el.scrollTop > 0 && el !== doc.documentElement && el !== doc.body) {
      const first = cs[i]?.firstElementChild as HTMLElement | null;
      if (first) first.style.marginTop = `${-el.scrollTop}px`;
    }
  });
}

/** Renders the iframe's current viewport (w × h CSS pixels) into `out`. */
export async function capturePage(win: Window, out: HTMLCanvasElement, w: number, h: number): Promise<void> {
  const doc = win.document;
  const css = await cssFor(doc);
  const live = doc.documentElement;
  const clone = live.cloneNode(true) as HTMLElement;
  freeze(live, clone);
  clone.querySelectorAll("script, link, style, noscript, iframe, template, next-route-announcer").forEach((n) => n.remove());
  const body = clone.querySelector("body");
  if (body) {
    // The window's scroll: shift the content up; fixed elements (dialogs) stay where they are.
    body.style.position = "relative";
    body.style.top = `${-win.scrollY}px`;
    const style = doc.createElement("style");
    style.textContent = css;
    body.prepend(style);
  }
  clone.style.width = `${w}px`;
  clone.style.height = `${h}px`;
  clone.style.overflow = "hidden";
  const xhtml = new XMLSerializer().serializeToString(clone);
  const theme = live.getAttribute("data-theme") ?? "dark";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" data-theme="${theme}"><foreignObject x="0" y="0" width="100%" height="100%">${xhtml}</foreignObject></svg>`;
  const img = new Image();
  img.decoding = "async";
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await img.decode();
  const g = out.getContext("2d")!;
  g.fillStyle = getComputedStyle(doc.body).backgroundColor || "#070b14";
  g.fillRect(0, 0, out.width, out.height);
  g.drawImage(img, 0, 0, out.width, out.height);
}

/** Clicks the page at (x, y) CSS pixels of its viewport the way a mouse would (pointer, mouse and click events). */
export function clickPage(win: Window, x: number, y: number): Element | null {
  const doc = win.document;
  const el = doc.elementFromPoint(x, y);
  if (!el) return null;
  const W = win as unknown as typeof globalThis;
  const base = { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, screenX: x, screenY: y, view: win, button: 0 };
  const ptr = { ...base, pointerId: 1, isPrimary: true, pointerType: "mouse" };
  el.dispatchEvent(new W.PointerEvent("pointerdown", { ...ptr, buttons: 1 }));
  el.dispatchEvent(new W.MouseEvent("mousedown", { ...base, buttons: 1 }));
  const focusable = (el as HTMLElement).closest?.("input, textarea, select, button, a, [tabindex]") as HTMLElement | null;
  focusable?.focus?.();
  el.dispatchEvent(new W.PointerEvent("pointerup", ptr));
  el.dispatchEvent(new W.MouseEvent("mouseup", base));
  el.dispatchEvent(new W.MouseEvent("click", base));
  return el;
}

/** Scrolls whatever is scrollable under (x, y), or the page itself. */
export function scrollPage(win: Window, x: number, y: number, dy: number) {
  const doc = win.document;
  let el = doc.elementFromPoint(x, y) as HTMLElement | null;
  while (el && el !== doc.body && el !== doc.documentElement) {
    const s = win.getComputedStyle(el);
    if (/(auto|scroll)/.test(s.overflowY) && el.scrollHeight > el.clientHeight + 2) {
      const before = el.scrollTop;
      el.scrollTop += dy;
      if (el.scrollTop !== before) return;
    }
    el = el.parentElement;
  }
  win.scrollBy(0, dy);
}

/**
 * Runs before paint inside the VR panel's iframe: marks the page as embedded (the shell hides its
 * sidebar and top bar) and keeps animation frames running while a headset session pauses the page's
 * own requestAnimationFrame.
 */
export const vrEmbedBootScript = `(function(){try{if(window.name!=="${VR_BROWSER_NAME}")return;document.documentElement.setAttribute("data-vr-embed","");window.requestAnimationFrame=function(cb){return setTimeout(function(){cb(performance.now())},16)};window.cancelAnimationFrame=function(id){clearTimeout(id)};}catch(e){}})();`;
