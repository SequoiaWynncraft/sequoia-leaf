/**
 * What moves on the page by itself, for the steadiness check (`steady.ts`), on the tours' page with
 * `?steady`. Two recorders, from the page's first script on:
 *
 * - the pages' own, since a page or the stall is drawn again whole (`renderPages` puts a new tree in
 *   `#modal`, a reroll a new stall in `#bottom`), and the browser does not count a new node as moved:
 *   every frame, each part of `#hud`, `#modal`, `#bottom`, `#rack` and `#picks` is found again by where it is in the
 *   page (its id, else its tag and classes and which of its kind it is under its parent), and one
 *   that was there the frame before and has moved by a pixel or more is a shift, scored as the
 *   browser scores one (the share of the window the parts moved over, times the furthest any moved,
 *   over the window's longer side). A part sliding or growing on a transform (a page rising into
 *   view, a figure hopping) is not looked at until it stands still;
 * - the browser's own `layout-shift` entries, for a part outside those that moves.
 *
 * The stage is watched too: its zoom and where the board sits must not change while the window does
 * not (the table is fitted above the bottom panel). Neither recorder counts a control's own press
 * look (a card or a button sinking under the finger), nor a different thing put in a part's place
 * (another figure on the stall, another mode's words); the bottom panel's frame must keep its size
 * as well.
 * `window.shifts.take(at)` gives every shift since the last one taken, as text; `hold(true)` stops
 * both while a moment is staged that a member reaches by another page, and `hold(false)` starts them
 * again from the next frame. A frame in which anything scrolled is not compared with the one before:
 * the walk never scrolls but to bring a button into view. Reads from Leaf answer `shifts.slow`
 * milliseconds late (in the tab's `sessionStorage`, by the start of the path), as over a real
 * connection, so that the page is drawn before they come back; `shifts.fake` answers a path with
 * what it holds instead of asking Leaf.
 */
import { isRecord, outside } from "@sequoia-leaf/kit/net.ts";

import { V } from "../src/screen/stage.ts";

/** A part's place on the page, in CSS pixels. */
interface Box {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}
/** A shift: its score, which recorder saw it, whether a press came just before it, and the parts that moved most. */
export interface Shift {
  readonly score: number;
  readonly by: "browser" | "page" | "stage" | "fit";
  readonly input: boolean;
  readonly parts: readonly string[];
}

declare global {
  interface Window {
    shifts?: { take(at: string): Promise<string>; hold(on: boolean): void };
  }
}

/** Classes that say how a part is, not which it is: the same part chosen or not, an offer of any tier, a room won or not. */
const STATES =
  /^(chosen|lit|done|on|off|down|cant|ready|k-rise|k-bump|woke|tlit|thop|tdim|t\d|won|lost|drawn|here|now)$/;
/**
 * The frame of the bottom panel, whose size must hold too, not only its place: the stage is fitted
 * above it, so a pixel more there re-frames the table. And each slot of the stall.
 */
const FRAME = /^#(bottom|shop|plan|stall|acorns|level|rustle|holdbtn|levelup|setout)$|^#stall\/[^/]+$/;
/** A part the browser says moved, and where it was and is (`LayoutShiftAttribution`). */
interface Source {
  readonly node: Node | null;
  readonly previousRect: DOMRectReadOnly;
  readonly currentRect: DOMRectReadOnly;
}
const isSource = (s: unknown): s is Source =>
  isRecord(s) && "node" in s && s.previousRect instanceof DOMRectReadOnly && s.currentRect instanceof DOMRectReadOnly;

/** The parts of the page drawn again whole, which the pages' recorder watches. */
const ROOTS = ["hud", "modal", "bottom", "rack", "picks"];
/** The parts that moved most, as a shift lists them. */
const MOST_PARTS = 4;

const boxOf = (r: DOMRectReadOnly): Box => ({ x: r.x, y: r.y, w: r.width, h: r.height });
const boxText = (b: Box): string => [b.x, b.y, b.w, b.h].map(Math.round).join(",");
/** The last three steps of a part's key: enough to find it. */
const short = (key: string): string => key.split("/").slice(-3).join("/");
/** A part's words, the first few, to tell it from others of its kind. */
const words = (node: Element): string => {
  const text = (node.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 28);
  return text ? ` "${text}"` : "";
};

/** What a part shows: its words and the size of every picture in it, to tell a different thing in the same place. */
const shows = (node: Element): string =>
  [node, ...node.querySelectorAll("canvas")]
    .map((c) => (c instanceof HTMLCanvasElement ? `${c.width}x${c.height}` : ""))
    .join(",") + (node.textContent ?? "");

/** One step of a part's key: its id, else its tag, its classes and what its data says it is (`data-offer="2"`). */
function stepOf(node: Element): string {
  if (node.id) return `#${node.id}`;
  const classes = [...node.classList].filter((c) => !STATES.test(c)).join(".");
  // What it shows (`data-ref`, the figure on an offer) is not which it is.
  const data =
    node instanceof HTMLElement
      ? Object.entries(node.dataset).flatMap(([k, v]) => (k === "ref" ? [] : [`[${k}=${v ?? ""}]`]))
      : [];
  return `${node.tagName.toLowerCase()}${classes ? `.${classes}` : ""}${data.join("")}`;
}

/**
 * Every part under `root` by its key, with where it is now (those not laid out, hidden, left out),
 * and how far everything in it is scrolled, summed.
 */
function parts(
  root: Element,
  still: (node: Element) => boolean,
): { found: Map<string, { node: Element; box: Box }>; scrolled: number } {
  const found = new Map<string, { node: Element; box: Box }>();
  let scrolled = root.scrollTop + root.scrollLeft + scrollX + scrollY;
  const visit = (node: Element, key: string): void => {
    const seen = new Map<string, number>();
    for (const child of node.children) {
      const step = stepOf(child);
      const n = seen.get(step) ?? 0;
      seen.set(step, n + 1);
      const childKey = child.id ? step : `${key}/${step}:${n}`;
      if (!still(child)) continue;
      const box = boxOf(child.getBoundingClientRect());
      // Nothing to see (an empty bar of a tally, a part held unseen): nothing to move.
      if (box.w < 1 || box.h < 1 || getComputedStyle(child).visibility === "hidden") continue;
      found.set(childKey, { node: child, box });
      scrolled += child.scrollTop + child.scrollLeft;
      visit(child, childKey);
    }
  };
  found.set(stepOf(root), { node: root, box: boxOf(root.getBoundingClientRect()) });
  visit(root, stepOf(root));
  return { found, scrolled };
}

/** The parts sliding or growing in on a transform now: what is under them is not looked at until they stand still. */
function moving(): Element[] {
  return document.getAnimations().flatMap((a) => {
    const effect = a.effect;
    if (a.playState !== "running" || !(effect instanceof KeyframeEffect) || !effect.target) return [];
    const moves = effect.getKeyframes().some((k) => "transform" in k || "translate" in k || "scale" in k);
    return moves ? [effect.target] : [];
  });
}

/** How much of the window the boxes cover, as a share of it: counted on a grid of 4-pixel cells. */
function share(boxes: readonly Box[]): number {
  const cell = 4;
  const cols = Math.ceil(innerWidth / cell);
  const rows = Math.ceil(innerHeight / cell);
  const hit = new Uint8Array(cols * rows);
  let n = 0;
  for (const b of boxes) {
    const x0 = Math.max(0, Math.floor(b.x / cell));
    const x1 = Math.min(cols, Math.ceil((b.x + b.w) / cell));
    const y0 = Math.max(0, Math.floor(b.y / cell));
    const y1 = Math.min(rows, Math.ceil((b.y + b.h) / cell));
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) {
        if (hit[y * cols + x]) continue;
        hit[y * cols + x] = 1;
        n++;
      }
  }
  return n / (cols * rows);
}

/** Something kept in the tab's `sessionStorage` for the walk, or nothing. */
function kept(name: string): Record<string, unknown> {
  try {
    const v: unknown = JSON.parse(sessionStorage.getItem(name) ?? "{}");
    return isRecord(v) ? v : {};
  } catch {
    return {};
  }
}

/** Waits `n` frames. */
const frames = (n: number): Promise<void> =>
  new Promise((done) => {
    const next = (left: number): void => void (left <= 0 ? done() : requestAnimationFrame(() => next(left - 1)));
    next(n);
  });

/** The top bar's corner (help, settings, the front page) out of the window: not a move, but as bad. */
const corner = (): Shift[] => {
  const box = document.getElementById("corner")?.getBoundingClientRect();
  const out = box && box.width > 0 && (box.right > innerWidth + 0.5 || box.left < -0.5);
  return out ? [{ score: 1, by: "fit", input: false, parts: [`#corner ${boxText(boxOf(box))} in ${innerWidth}`] }] : [];
};

/** Reads from Leaf answer late, or are answered here, as the tab's `sessionStorage` says (`shifts.slow`, `shifts.fake`). */
function slowReads(): void {
  const slow = kept("shifts.slow");
  const late = (path: string): number => {
    const best = Object.keys(slow)
      .filter((p) => path.startsWith(p))
      .toSorted((a, b) => b.length - a.length)[0];
    const ms = best === undefined ? 0 : slow[best];
    return typeof ms === "number" ? ms : 0;
  };
  // The kit's way out to Leaf (`net.ts`), which every read of the page goes by.
  const real = outside.fetch.bind(outside);
  outside.fetch = async (path, init) => {
    const at = new URL(path, location.href).pathname;
    const reading = (init?.method ?? "GET") === "GET";
    // Read on each ask, so that the walk can change an answer while the page is up.
    const fake = kept("shifts.fake");
    const res = reading && at in fake ? Response.json(fake[at]) : await real(path, init);
    const ms = reading ? late(at) : 0;
    if (ms > 0) await new Promise((r) => setTimeout(r, ms));
    return res;
  };
}

/** What a member presses: a control's own press look (a card or a button sinking under the finger) is not a shift. */
const CONTROLS = "button, a, input, [role=button], [role=tab], [role=radio]";
/** How long after a press is let go its control may still be rising back. */
const RISING_MS = 300;

/** Starts both recorders and the late reads, and puts `window.shifts` on the page. */
export function recordShifts(): void {
  slowReads();
  const shifts: Shift[] = [];
  /** The frame before (its parts, and how far it was scrolled), and whether the recorders are held. */
  const last: { at: Map<string, { node: Element; box: Box }> | null; scrolled: number; held: boolean } = {
    at: null,
    scrolled: 0,
    held: false,
  };
  const keyOf = new WeakMap<Element, string>();
  /** The control pressed (and its key), from when it went down until it has risen back, and when the last press was. */
  const press: { control: Element | null; key: string | null; until: number; at: number } = {
    control: null,
    key: null,
    until: 0,
    at: -Infinity,
  };
  /** The control pressed: the outermost, as a press on a line inside a card is a press on the card too (`:active`). */
  const outermost = (node: Element | null): Element | null => {
    const outer = node?.parentElement?.closest(CONTROLS) ?? null;
    return outer ? outermost(outer) : node;
  };
  const down = (target: EventTarget | null): void => {
    const control = outermost(target instanceof Element ? target.closest(CONTROLS) : null);
    Object.assign(press, {
      control,
      key: control ? (keyOf.get(control) ?? null) : null,
      until: Infinity,
      at: performance.now(),
    });
  };
  const up = (): void => void (press.until = performance.now() + RISING_MS);
  addEventListener("pointerdown", (e) => down(e.target), { capture: true });
  addEventListener("keydown", () => down(document.activeElement), { capture: true });
  addEventListener("pointerup", up, { capture: true });
  addEventListener("keyup", up, { capture: true });
  const pressing = (): boolean => performance.now() < press.until;
  const ownPress = (key: string): boolean =>
    pressing() && press.key !== null && (key === press.key || key.startsWith(`${press.key}/`));
  const recent = (): boolean => performance.now() - press.at < 500;

  const described = (node: Node | null): string => {
    const part = node instanceof Element ? node : (node?.parentElement ?? null);
    if (!part) return "?";
    return `${short(keyOf.get(part) ?? stepOf(part))}${words(part)}`;
  };
  // The browser's own, for what is outside the roots (the pages' recorder has everything in them): a
  // part that moved under the finger (a control sinking, or one the browser cannot name then) is not counted.
  const counted = (node: Node | null): boolean =>
    node !== null &&
    !ROOTS.some((id) => document.getElementById(id)?.contains(node)) &&
    !(pressing() && press.control?.contains(node));
  /** The browser's entries, as they are delivered or drained by `take`: each heard once. */
  const heard = (entries: PerformanceEntryList): void => {
    for (const e of entries) {
      if (last.held || !("value" in e) || typeof e.value !== "number" || e.value <= 0) continue;
      const all = "sources" in e && Array.isArray(e.sources) ? e.sources.filter(isSource) : [];
      const sources = all.filter((s) => counted(s.node));
      if (all.length > 0 ? sources.length === 0 : pressing()) continue;
      shifts.push({
        score: e.value,
        by: "browser",
        input: "hadRecentInput" in e && e.hadRecentInput === true,
        parts: sources.map(
          (s) => `${described(s.node)} ${boxText(boxOf(s.previousRect))}>${boxText(boxOf(s.currentRect))}`,
        ),
      });
    }
  };
  const observer = new PerformanceObserver((list) => heard(list.getEntries()));
  observer.observe({ type: "layout-shift", buffered: true });

  /**
   * The stage as fitted (its zoom and where the board is), the window it was fitted to, and when that
   * last changed: from the page's load, so that the first window seen is a resize too, settling.
   */
  const stage = { fit: "", window: "", resized: performance.now() };
  /** The stage fitted again while the window stayed as it was: the whole table moves. */
  const watchStage = (): void => {
    // From when the page is up (its handle is opened after the stage is first fitted).
    if (!window.raid) return;
    const size = `${innerWidth}x${innerHeight}`;
    const fit = `zoom ${V.z}, board at ${V.bx},${V.by} of ${V.w}x${V.h}`;
    // A window other than the last (the first one seen too) is a resize: the stage is fitted again within a second.
    if (size !== stage.window) Object.assign(stage, { window: size, resized: performance.now() });
    if (stage.fit && fit !== stage.fit && !last.held && performance.now() - stage.resized > 1000)
      shifts.push({ score: 1, by: "stage", input: recent(), parts: [`${stage.fit} > ${fit}`] });
    stage.fit = fit;
  };
  /** A part that moved since the frame before; for the bottom panel's frame, one that changed size too. */
  const movedSince = (
    before: Map<string, { node: Element; box: Box }>,
    key: string,
    p: { node: Element; box: Box },
  ) => {
    const was = before.get(key);
    const frame = FRAME.test(key);
    const pressed = ownPress(key);
    if (!was || (!frame && pressed)) return [];
    // A frame's part under the finger may sink (its press look), never change size.
    const far = pressed ? 0 : Math.max(Math.abs(p.box.x - was.box.x), Math.abs(p.box.y - was.box.y));
    const grew = Math.max(Math.abs(p.box.w - was.box.w), Math.abs(p.box.h - was.box.h));
    // A different thing in the same place (another figure on the stall, another mode's words) is not a move.
    if (!frame && was.node !== p.node && shows(was.node) !== shows(p.node)) return [];
    const by = frame ? Math.max(far, grew) : far;
    return by >= 1 ? [{ key, p, was: was.box, far: by }] : [];
  };
  const frame = (): void => {
    requestAnimationFrame(frame);
    watchStage();
    if (last.held) {
      last.at = null;
      return;
    }
    const busy = moving();
    const still = (node: Element): boolean => !busy.some((m) => m === node || m.contains(node));
    const now = new Map<string, { node: Element; box: Box }>();
    let scrolled = innerWidth * 1e6 + innerHeight;
    for (const id of ROOTS) {
      const root = document.getElementById(id);
      if (!root || root.hidden || root.getClientRects().length === 0) continue;
      const seen = parts(root, still);
      for (const [key, p] of seen.found) now.set(key, p);
      scrolled += seen.scrolled;
    }
    for (const [key, p] of now) keyOf.set(p.node, key);
    const before = last.scrolled === scrolled ? last.at : null;
    last.at = now;
    last.scrolled = scrolled;
    if (!before) return;
    const moved = [...now].flatMap(([key, p]) => movedSince(before, key, p));
    if (moved.length === 0) return;
    const far = Math.max(...moved.map((m) => m.far)) / Math.max(innerWidth, innerHeight);
    const score = share(moved.flatMap((m) => [m.was, m.p.box])) * Math.min(1, far);
    if (score <= 0) return;
    const largest = moved.toSorted((a, b) => b.p.box.w * b.p.box.h - a.p.box.w * a.p.box.h).slice(0, MOST_PARTS);
    shifts.push({
      score,
      by: "page",
      input: recent(),
      parts: largest.map((m) => `${short(m.key)}${words(m.p.node)} ${boxText(m.was)}>${boxText(m.p.box)}`),
    });
  };
  requestAnimationFrame(frame);

  window.shifts = {
    async take(at) {
      await frames(3);
      // What the browser has seen and not yet delivered, through the same path: nothing is left for the next moment.
      heard(observer.takeRecords());
      return JSON.stringify({ at, shifts: [...shifts.splice(0), ...corner()] });
    },
    hold(on) {
      last.held = on;
      last.at = null;
    },
  };
}
