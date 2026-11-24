/**
 * An audit of the page as it is open in `drive.ts`, for what keeps a player from reading or reaching
 * it: the step `["audit"]` prints a short list, and `["audit", "name"]` saves it as
 * `<out-dir>/<name>.txt` too. It finds
 * - controls with no name (in Chromium's own accessibility tree), things that look pressable that
 *   Tab cannot reach, and things Tab reaches that look no different when it does;
 * - words under 10 CSS pixels, and sentences (in the reading face, or five words or more with a
 *   stop) under 12;
 * - words under 4.5:1 against what is painted behind them, or 3:1 for large words (24 pixels, or 19
 *   bold), from a screenshot with the words taken out; where what is behind is a picture, not one
 *   colour, it says "unknown";
 * - at a phone's width (500 CSS pixels or less), controls under 40 by 40 with another control in
 *   the 40 by 40 around them;
 * - dialogs with no name, and things that look like dialogs (on a scrim, or with a Close button)
 *   that are not one.
 * It focuses each control in turn, as Tab would, and puts the focus back as it was. Only the page
 * itself is audited, not a game in a frame on it: open that page on its own.
 */

/** Asks Chromium something over the DevTools protocol. */
export type Send = (method: string, params?: Record<string, unknown>) => Promise<unknown>;

export interface Box {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** One element's own words, as they are shown. */
export interface Words {
  readonly who: string;
  readonly text: string;
  /** Their size as drawn, in CSS pixels. */
  readonly px: number;
  readonly bold: boolean;
  /** In the reading face, or five words or more ending in a stop. */
  readonly sentence: boolean;
  /** Their colour as the page computes it, and the opacity of everything they are in. */
  readonly color: string;
  readonly opacity: number;
  /** On a control that is off, whose words are not held to a contrast. */
  readonly off: boolean;
  readonly boxes: readonly Box[];
}

/** Something to press: Tab reaches it, or it looks pressable. */
export interface Control {
  readonly who: string;
  readonly box: Box;
  readonly tab: boolean;
  /** Whether it looks different focused by the keyboard; null when Tab does not reach it. */
  readonly ring: boolean | null;
  /** Another control is in the 40 by 40 around it. */
  readonly crowded: boolean;
}

export interface Facts {
  readonly width: number;
  readonly height: number;
  readonly words: readonly Words[];
  readonly controls: readonly Control[];
  /** Things that look like dialogs and are not one, and why they look it. */
  readonly dialogs: readonly { readonly who: string; readonly why: string }[];
}

/** Something in the accessibility tree that needs a name and has none. */
export interface Unnamed {
  readonly who: string;
  readonly role: string;
}

export type Rgb = readonly [number, number, number];

export interface Finding {
  readonly kind:
    | "no name"
    | "no tab"
    | "no ring"
    | "dialog"
    | "tiny text"
    | "small sentence"
    | "contrast"
    | "contrast?"
    | "small target";
  readonly who: string;
  readonly detail: string;
  readonly text?: string;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const isBox = (v: unknown): v is Box =>
  isRecord(v) &&
  typeof v.x === "number" &&
  typeof v.y === "number" &&
  typeof v.w === "number" &&
  typeof v.h === "number";

/** A colour as `getComputedStyle` gives it, with its alpha; null for one it is not written as. */
export function rgba(css: string): readonly [number, number, number, number] | null {
  const rgb = /^rgba?\(([^)]*)\)$/.exec(css.trim());
  const srgb = /^color\(srgb ([^)]*)\)$/.exec(css.trim());
  const parts = (rgb?.[1] ?? srgb?.[1])
    ?.split(/[\s,/]+/)
    .filter(Boolean)
    .map(Number);
  if (!parts || parts.length < 3 || parts.some((n) => !Number.isFinite(n))) return null;
  const k = srgb ? 255 : 1;
  return [(parts[0] ?? 0) * k, (parts[1] ?? 0) * k, (parts[2] ?? 0) * k, parts[3] ?? 1];
}

/** One channel, 0 to 255, as light. */
const linear = (v: number): number => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const lum = ([r, g, b]: Rgb): number => 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);

/** The contrast of two colours, 1 to 21. */
export function contrast(a: Rgb, b: Rgb): number {
  const [x, y] = [lum(a), lum(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** A colour seen through `alpha` over another. */
const over = (fg: Rgb, alpha: number, bg: Rgb): Rgb => [
  fg[0] * alpha + bg[0] * (1 - alpha),
  fg[1] * alpha + bg[1] * (1 - alpha),
  fg[2] * alpha + bg[2] * (1 - alpha),
];

const hex = (c: Rgb): string => `#${c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
const cut = (text: string): string => (text.length > 40 ? `${text.slice(0, 39)}…` : text);

/**
 * The colour behind words, from what was sampled there: the middle one by brightness, if most of
 * the rest look the same; null for a picture (a gradient, the world).
 */
export function behind(samples: readonly Rgb[]): Rgb | null {
  if (samples.length === 0) return null;
  const sorted = samples.toSorted((a, b) => lum(a) - lum(b));
  const mid = sorted[Math.floor(sorted.length / 2)];
  if (!mid) return null;
  const alike = samples.filter((s) => contrast(s, mid) < 1.15).length;
  return alike >= samples.length * 0.7 ? mid : null;
}

/** What is wrong, from what the page said of itself (`behindWords` in the order of `facts.words`). */
export function judge(facts: Facts, behindWords: readonly (readonly Rgb[])[], unnamed: readonly Unnamed[]): Finding[] {
  const found: Finding[] = [];
  for (const u of unnamed)
    found.push({
      kind: u.role.endsWith("dialog") ? "dialog" : "no name",
      who: u.who,
      detail: `${u.role} with no name`,
    });
  for (const d of facts.dialogs) found.push({ kind: "dialog", who: d.who, detail: d.why });
  for (const c of facts.controls) {
    if (!c.tab) found.push({ kind: "no tab", who: c.who, detail: "looks pressable; Tab does not reach it" });
    if (c.ring === false) found.push({ kind: "no ring", who: c.who, detail: "looks the same focused" });
    if (facts.width <= 500 && (c.box.w < 40 || c.box.h < 40) && c.crowded)
      found.push({ kind: "small target", who: c.who, detail: `${c.box.w}x${c.box.h} with another control by it` });
  }
  for (const [i, w] of facts.words.entries()) {
    const px = Math.round(w.px * 10) / 10;
    if (w.px < 9.5) found.push({ kind: "tiny text", who: w.who, detail: `${px}px`, text: cut(w.text) });
    else if (w.sentence && w.px < 11.5)
      found.push({ kind: "small sentence", who: w.who, detail: `${px}px`, text: cut(w.text) });
    const fg = rgba(w.color);
    const samples = behindWords[i] ?? [];
    if (w.off || !fg || samples.length === 0) continue;
    const need = w.px >= 24 || (w.px >= 18.6 && w.bold) ? 3 : 4.5;
    const seenOn = (bg: Rgb): Rgb => over([fg[0], fg[1], fg[2]], fg[3] * w.opacity, bg);
    const ratios = samples.map((bg) => contrast(seenOn(bg), bg));
    const [low, high] = [Math.min(...ratios), Math.max(...ratios)];
    if (low >= need) continue;
    const bg = behind(samples);
    const text = cut(w.text);
    if (bg) {
      const ratio = contrast(seenOn(bg), bg);
      if (ratio < need)
        found.push({
          kind: "contrast",
          who: w.who,
          detail: `${ratio.toFixed(1)}:1, needs ${need} (${hex(seenOn(bg))} on ${hex(bg)})`,
          text,
        });
    } else {
      const range = `${low.toFixed(1)} to ${high.toFixed(1)}:1 over a picture, needs ${need}`;
      if (high < need) found.push({ kind: "contrast", who: w.who, detail: range, text });
      else found.push({ kind: "contrast?", who: w.who, detail: `unknown: ${range}`, text });
    }
  }
  return found;
}

const ORDER: readonly Finding["kind"][] = [
  "no name",
  "no tab",
  "no ring",
  "dialog",
  "tiny text",
  "small sentence",
  "contrast",
  "small target",
  "contrast?",
];

/** The findings as lines, the same thing found on several alike elements said once, with how many. */
export function report(found: readonly Finding[]): string[] {
  const groups = new Map<string, { f: Finding; n: number }>();
  for (const f of found) {
    const key = `${f.kind}|${f.who}|${f.detail}`;
    const g = groups.get(key);
    if (g) g.n++;
    else groups.set(key, { f, n: 1 });
  }
  const lines = [...groups.values()]
    .toSorted((a, b) => ORDER.indexOf(a.f.kind) - ORDER.indexOf(b.f.kind))
    .map(
      ({ f, n }) =>
        `${f.kind.padEnd(14)} ${f.who}: ${f.detail}${f.text ? ` "${f.text}"` : ""}${n > 1 ? ` (${n} alike)` : ""}`,
    );
  return lines.length > 0 ? lines : ["nothing found"];
}

// ---------- in the page ----------
// These run in the page itself (passed as their source), so each holds all it uses.

/** A short way to point at an element: the nearest id over it, its tag, id, classes and label. */
function whoOf(el: Element): string {
  let at = "";
  for (let a = el.parentElement; a && a !== document.body; a = a.parentElement)
    if (a.id) {
      at = `#${a.id} `;
      break;
    }
  const classes = [...el.classList]
    .slice(0, 3)
    .map((c) => `.${c}`)
    .join("");
  const label = el.getAttribute("aria-label");
  return `${at}${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}${classes}${label ? ` "${label}"` : ""}`;
}

/** Whether Tab reaches an element. */
function reach(e: Element): boolean {
  return e instanceof HTMLElement && e.tabIndex >= 0 && !e.matches(":disabled");
}

/** Whether an element shows the pointing hand. */
function pointing(e: Element): boolean {
  return getComputedStyle(e).cursor === "pointer";
}

/** Whether an element draws a ring round itself that can be seen. */
function outlined(el: Element): boolean {
  const cs = getComputedStyle(el);
  return (
    cs.outlineStyle !== "none" &&
    parseFloat(cs.outlineWidth) > 0 &&
    !/^rgba\(.*,\s*0\)$|^transparent$/.test(cs.outlineColor)
  );
}

const PAGE = { whoOf, reach, pointing, outlined };
/** The helpers above as one object's source, for a page to be given. */
const pageHelpers = `{ ${Object.entries(PAGE)
  .map(([k, f]) => `${k}: ${f.toString()}`)
  .join(", ")} }`;

/** Everything the audit needs from the page as it is now. */
function collect(page: typeof PAGE): Facts {
  const W = window.innerWidth;
  const H = window.innerHeight;
  // While the page is read, everything is hit by a point, so that what is on top is what is seen.
  const force = document.createElement("style");
  force.textContent = "*, *::before, *::after { pointer-events: auto !important; }";
  document.head.append(force);
  /** The part of an element's box that can be seen: in the window and in whatever it scrolls in; null for none. */
  const shown = (el: Element, r: DOMRect): Box | null => {
    let [l, t, rt, b] = [Math.max(0, r.left), Math.max(0, r.top), Math.min(W, r.right), Math.min(H, r.bottom)];
    for (let a = el.parentElement; a; a = a.parentElement) {
      const cs = getComputedStyle(a);
      if (cs.overflowX === "visible" && cs.overflowY === "visible") continue;
      const c = a.getBoundingClientRect();
      [l, t, rt, b] = [Math.max(l, c.left), Math.max(t, c.top), Math.min(rt, c.right), Math.min(b, c.bottom)];
    }
    if (rt - l < 1 || b - t < 1) return null;
    // On top there, too: nothing covers it.
    const hit = document.elementFromPoint((l + rt) / 2, (t + b) / 2);
    if (hit === null || !(el.contains(hit) || hit.contains(el))) return null;
    return { x: Math.round(l), y: Math.round(t), w: Math.round(rt - l), h: Math.round(b - t) };
  };
  try {
    const runs = new Map<Element, { text: string[]; boxes: Box[] }>();
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      const el = n.parentElement;
      const text = (n.textContent ?? "").replace(/\s+/g, " ").trim();
      if (!el || !text || el.closest("script, style, noscript, template")) continue;
      if (getComputedStyle(el).visibility !== "visible") continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      const boxes = [...range.getClientRects()].flatMap((r) => shown(el, r) ?? []);
      if (boxes.length === 0) continue;
      const run = runs.get(el) ?? { text: [], boxes: [] };
      run.text.push(text);
      run.boxes.push(...boxes.slice(0, 3));
      runs.set(el, run);
    }
    const words: Words[] = [];
    for (const [el, run] of runs) {
      let opacity = 1;
      for (let a: Element | null = el; a; a = a.parentElement) opacity *= Number(getComputedStyle(a).opacity);
      if (opacity < 0.05) continue;
      const cs = getComputedStyle(el);
      const text = run.text.join(" ");
      const r = el.getBoundingClientRect();
      const scale = el instanceof HTMLElement && el.offsetHeight > 0 ? r.height / el.offsetHeight : 1;
      words.push({
        who: page.whoOf(el),
        text,
        px: parseFloat(cs.fontSize) * (Math.abs(scale - 1) < 0.02 ? 1 : scale),
        bold: Number(cs.fontWeight) >= 700,
        sentence: /^"?Inter/.test(cs.fontFamily) || (text.split(" ").length >= 5 && /[.?!]$/.test(text)),
        color: cs.color,
        opacity,
        off: el.closest(':disabled, [aria-disabled="true"], .k-btn.off') !== null,
        boxes: run.boxes.slice(0, 3),
      });
    }

    const found: { el: HTMLElement; box: Box; tab: boolean }[] = [];
    for (const el of document.body.querySelectorAll("*")) {
      if (!(el instanceof HTMLElement) || el.closest("[inert]")) continue;
      const box = getComputedStyle(el).visibility === "visible" ? shown(el, el.getBoundingClientRect()) : null;
      if (!box) continue;
      const tab = page.reach(el);
      if (!tab) {
        // Looks pressable: the top of what has the pointing hand, and no part of something Tab reaches.
        const up = el.parentElement;
        if (!page.pointing(el) || el instanceof HTMLCanvasElement || (up && page.pointing(up))) continue;
        let part = false;
        for (let a = up; a && !part; a = a.parentElement) part = page.reach(a);
        if (part || [...el.querySelectorAll("*")].some(page.reach)) continue;
      }
      found.push({ el, box, tab });
    }

    // How each looks focused by the keyboard, against how it looks now.
    const PROPS = [
      "box-shadow",
      "border-top-color",
      "border-image-source",
      "background-color",
      "background-image",
      "color",
      "filter",
      "text-decoration-line",
      "transform",
      "translate",
      "scale",
    ];
    const look = (el: Element): string =>
      [
        [el, null],
        [el, "::before"],
        [el, "::after"],
        [el.parentElement, null],
      ]
        .map(([e, pseudo]) =>
          e instanceof Element
            ? PROPS.map((prop) =>
                getComputedStyle(e, typeof pseudo === "string" ? pseudo : null).getPropertyValue(prop),
              ).join("|")
            : "",
        )
        .join("/");
    const was = document.activeElement;
    const rings = found.map(({ el, tab }) => {
      if (!tab) return null;
      // Seen unfocused first, even if it has the focus now.
      if (document.activeElement === el) el.blur();
      const before = look(el);
      const ringBefore = page.outlined(el);
      el.focus({ preventScroll: true, focusVisible: true });
      if (document.activeElement !== el || !el.matches(":focus-visible")) return null;
      const ring = (page.outlined(el) && !ringBefore) || look(el) !== before;
      el.blur();
      return ring;
    });
    if (was instanceof HTMLElement && was !== document.body) was.focus({ preventScroll: true });
    else if (document.activeElement instanceof HTMLElement) document.activeElement.blur();

    const controls: Control[] = found.map(({ el, box, tab }, i) => {
      const cx = box.x + box.w / 2;
      const cy = box.y + box.h / 2;
      const crowded =
        (box.w < 40 || box.h < 40) &&
        found.some(
          (o) =>
            o.el !== el &&
            !o.el.contains(el) &&
            !el.contains(o.el) &&
            o.box.x < cx + Math.max(20, box.w / 2) &&
            o.box.x + o.box.w > cx - Math.max(20, box.w / 2) &&
            o.box.y < cy + Math.max(20, box.h / 2) &&
            o.box.y + o.box.h > cy - Math.max(20, box.h / 2),
        );
      return { who: page.whoOf(el), box, tab, ring: rings[i] ?? null, crowded };
    });

    const DIALOG = 'dialog, [role="dialog"], [role="alertdialog"]';
    const dialogs: { who: string; why: string }[] = [];
    const noted = new Set<Element>();
    const note = (el: Element, why: string): void => {
      if (noted.has(el)) return;
      noted.add(el);
      dialogs.push({ who: page.whoOf(el), why });
    };
    for (const scrim of document.querySelectorAll(".k-scrim"))
      for (const c of scrim.children)
        if (c.getClientRects().length > 0 && !c.closest(DIALOG)) note(c, "on a scrim; not a dialog");
    for (const b of document.querySelectorAll("button, [role='button']")) {
      const name = (b.getAttribute("aria-label") ?? b.textContent ?? "").trim();
      if (!/^(close|×|✕)$/i.test(name) || b.getClientRects().length === 0 || b.closest(DIALOG)) continue;
      note(
        b.closest(".k-panel, .k-paper, .k-tip, aside, section") ?? b.parentElement ?? b,
        "has a Close button; not a dialog",
      );
    }
    return { width: W, height: H, words, controls, dialogs };
  } finally {
    force.remove();
  }
}

/** The colours at a few points in each run of words' boxes, from a screenshot in device pixels. */
async function sample(png: string, runs: readonly (readonly Box[])[], ratio: number): Promise<number[][][]> {
  const img = new Image();
  img.src = `data:image/png;base64,${png}`;
  await img.decode();
  const c = document.createElement("canvas");
  c.width = img.width;
  c.height = img.height;
  const g = c.getContext("2d", { willReadFrequently: true });
  if (!g) return runs.map(() => []);
  g.drawImage(img, 0, 0);
  const data = g.getImageData(0, 0, c.width, c.height).data;
  return runs.map((boxes) =>
    boxes.flatMap((b) => {
      const out: number[][] = [];
      for (let i = 0; i < 5; i++)
        for (let j = 0; j < 3; j++) {
          const x = Math.floor((b.x + (b.w * (i + 0.5)) / 5) * ratio);
          const y = Math.floor((b.y + (b.h * (j + 0.5)) / 3) * ratio);
          if (x < 0 || y < 0 || x >= c.width || y >= c.height) continue;
          const k = (y * c.width + x) * 4;
          out.push([data[k] ?? 0, data[k + 1] ?? 0, data[k + 2] ?? 0]);
        }
      return out;
    }),
  );
}

// ---------- over the protocol ----------

async function evaluate(send: Send, expression: string): Promise<unknown> {
  const res = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (isRecord(res) && isRecord(res.exceptionDetails))
    throw new Error(`audit: ${JSON.stringify(res.exceptionDetails)}`);
  return isRecord(res) && isRecord(res.result) ? res.result.value : null;
}

const readFacts = (v: unknown): Facts | null =>
  isRecord(v) &&
  typeof v.width === "number" &&
  typeof v.height === "number" &&
  Array.isArray(v.words) &&
  Array.isArray(v.controls) &&
  Array.isArray(v.dialogs)
    ? {
        width: v.width,
        height: v.height,
        words: v.words.filter(
          (w): w is Words =>
            isRecord(w) &&
            typeof w.who === "string" &&
            typeof w.text === "string" &&
            typeof w.px === "number" &&
            typeof w.color === "string" &&
            Array.isArray(w.boxes) &&
            w.boxes.every(isBox),
        ),
        controls: v.controls.filter((c): c is Control => isRecord(c) && typeof c.who === "string" && isBox(c.box)),
        dialogs: v.dialogs.filter(
          (d): d is { who: string; why: string } =>
            isRecord(d) && typeof d.who === "string" && typeof d.why === "string",
        ),
      }
    : null;

const toRgb = (v: unknown): Rgb | null => {
  if (!Array.isArray(v)) return null;
  const [r, g, b] = v;
  return typeof r === "number" && typeof g === "number" && typeof b === "number" ? [r, g, b] : null;
};

/** Roles that are pressed or typed into, and so need a name. */
const CONTROLS = new Set([
  "button",
  "link",
  "checkbox",
  "radio",
  "switch",
  "tab",
  "menuitem",
  "option",
  "textbox",
  "searchbox",
  "combobox",
  "slider",
  "spinbutton",
  "listbox",
  "dialog",
  "alertdialog",
]);

/** What in Chromium's accessibility tree needs a name and has none. */
async function unnamedOf(send: Send): Promise<Unnamed[]> {
  const tree = await send("Accessibility.getFullAXTree");
  const nodes = isRecord(tree) && Array.isArray(tree.nodes) ? tree.nodes : [];
  const text = (v: unknown): string => (isRecord(v) && typeof v.value === "string" ? v.value : "");
  const asked = nodes.flatMap((n) => {
    if (!isRecord(n) || n.ignored === true || typeof n.backendDOMNodeId !== "number") return [];
    const role = text(n.role);
    if (text(n.name).trim() !== "" || role === "RootWebArea") return [];
    const focusable =
      Array.isArray(n.properties) &&
      n.properties.some((p) => isRecord(p) && p.name === "focusable" && isRecord(p.value) && p.value.value === true);
    return CONTROLS.has(role) || focusable ? [{ role, id: n.backendDOMNodeId }] : [];
  });
  const said = await Promise.all(
    asked.map(async ({ role, id }): Promise<Unnamed | null> => {
      const node = await send("DOM.resolveNode", { backendNodeId: id });
      const objectId = isRecord(node) && isRecord(node.object) ? node.object.objectId : undefined;
      if (typeof objectId !== "string") return null;
      const res = await send("Runtime.callFunctionOn", {
        objectId,
        functionDeclaration: `function () { return { who: (${whoOf.toString()})(this), tab: this.tabIndex >= 0 }; }`,
        returnByValue: true,
      });
      const v = isRecord(res) && isRecord(res.result) ? res.result.value : null;
      return isRecord(v) && typeof v.who === "string" && (CONTROLS.has(role) || v.tab === true)
        ? { who: v.who, role }
        : null;
    }),
  );
  return said.filter((u): u is Unnamed => u !== null);
}

/** Audits the page open on the other end of `send`, as lines to print. */
export async function audit(send: Send): Promise<string[]> {
  await send("DOM.enable");
  await send("Accessibility.enable");
  const facts = readFacts(await evaluate(send, `(${collect.toString()})(${pageHelpers})`));
  if (!facts) throw new Error("audit: the page said nothing readable");
  // What is behind the words: the page drawn with every word taken out.
  const hide =
    "(() => { const s = document.createElement('style'); s.id = 'k-audit-hide'; s.textContent = '*, *::before, *::after { color: transparent !important; -webkit-text-fill-color: transparent !important; text-shadow: none !important; text-decoration-color: transparent !important; caret-color: transparent !important; }'; document.head.append(s); return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); })()";
  await evaluate(send, hide);
  const shot = await send("Page.captureScreenshot", { format: "png" });
  await evaluate(send, "document.getElementById('k-audit-hide')?.remove()");
  const png = isRecord(shot) && typeof shot.data === "string" ? shot.data : "";
  const ratio = Number(await evaluate(send, "window.devicePixelRatio")) || 1;
  const sampled = png
    ? await evaluate(
        send,
        `(${sample.toString()})(${JSON.stringify(png)}, ${JSON.stringify(facts.words.map((w) => w.boxes))}, ${ratio})`,
      )
    : [];
  const behindWords = (Array.isArray(sampled) ? sampled : []).map((run) =>
    Array.isArray(run) ? run.map(toRgb).filter((c): c is Rgb => c !== null) : [],
  );
  return [`audit at ${facts.width}x${facts.height}`, ...report(judge(facts, behindWords, await unnamedOf(send)))];
}
