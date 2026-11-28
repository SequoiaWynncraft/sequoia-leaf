/**
 * The floor on the screen: the ground (`art/ground.ts`) kept whole on the graphics card, painted a
 * chunk at a time and never given back.
 *
 * What the view needs and lacks is painted before the frame is drawn, nearest its middle first: the
 * page's first view, a view that has outrun the painting, a plot that changed hands. No frame waits
 * for more than `SHOWN_MS` of it, though: a view that needs more (the furthest zoom on a page just
 * opened) shows the map's flat colours where it is not painted yet, and the frames after it go on.
 * Everything else is painted ahead of need, nearest the view first, a small step at a time in the
 * time frames have left, at the plan's zoom too; so a few seconds after the page opens the whole
 * land is painted, and from then on no frame paints anything but a plot bought.
 *
 * What a chunk shows depends only on which of the plots under it the yard has cleared. While a plot's
 * undergrowth comes down, its chunks as they will be are painted beside the ground, at once and
 * whole, and shown where the clearing has reached; they become the ground once it is done.
 */

import type { Land, Plot } from "@sequoia-leaf/factory";
import type { Painter, Sheet } from "@sequoia-leaf/kit/painter.ts";
import { WATER } from "@sequoia-leaf/kit/palette.ts";
import { makeCanvas } from "@sequoia-leaf/kit/util.ts";

import { TILE } from "./art/belts.ts";
import type { Box, Ground } from "./art/ground.ts";
import { DEEP } from "./art/pal.ts";
import type { Sign } from "./layout.ts";

/** A chunk of the ground: a whole number of tiles each way, and a plot (sixteen tiles by twelve) is two chunks by two. */
export const CHUNK = { w: 128, h: 96 } as const;
/** Painting ahead takes what is left of a frame until this many milliseconds after the frame began. */
const BUDGET = 6;
/** The longest a frame waits for the ground its view lacks, in milliseconds: past it, the chunk being painted is the last. */
const SHOWN_MS = 50;
/** The flat colours of ground not painted yet: grass on land the yard has cleared, the forest's floor, the stream, and the forest round the map. */
const ROUGH = { cleared: "#3d6b3a", wild: DEEP[2], water: WATER[0], margin: DEEP[1] } as const;
/** Frames in a row with no time left after which a step is painted anyway, so the land is painted where every frame is long. */
const STARVED = 8;
/** The longest side of one of the ground's sheets, where the card allows as much. */
const SHEET_MOST = 4096;

/** Which plots the yard has cleared (by their place in the land's list). */
export type Cleared = (plot: number) => boolean;

/**
 * Whose the land is this frame: the plots cleared, and those being cleared (owned a moment ago, their
 * undergrowth coming down).
 */
export interface Hands {
  readonly cleared: Cleared;
  readonly clearing: readonly number[];
}

/**
 * Whose the land is this frame, from the yard's layout and the plots being cleared (`S.clearing`).
 * A clearing is drawn only while its plot is the yard's: one that is not (Leaf refused the purchase
 * and put it back) stops at once, and is taken out of `clearing`.
 */
export function handsNow(
  L: { readonly owned: readonly boolean[]; readonly signs: readonly Sign[]; readonly yard: { readonly land: Land } },
  clearing: Map<Plot, unknown>,
): Hands {
  const { plots } = L.yard.land;
  plots.forEach((plot, n) => {
    if (clearing.has(plot.plot) && L.owned[n] !== true) clearing.delete(plot.plot);
  });
  const now = plots.flatMap((plot, n) => (clearing.has(plot.plot) ? [n] : []));
  return { cleared: (n) => L.owned[n] === true && !now.includes(n), clearing: now };
}

/** One of the ground's sheets, and the corner of the ground's chunks it holds, in chunks. */
interface Page {
  readonly sheet: Sheet;
  readonly col: number;
  readonly row: number;
}

export class Floor {
  readonly #gr: Ground;
  readonly #p: Painter;
  /** The ground's chunks: the first column and row (in chunks from the map's corner), and how many across and down. */
  readonly #c0: number;
  readonly #r0: number;
  readonly #cols: number;
  readonly #rows: number;
  /** The sheets the ground is kept on (one, unless the land is larger than the card's largest texture), and how many chunks each holds across and down. */
  readonly #pages: Page[] = [];
  readonly #across: number;
  readonly #down: number;
  /** What each chunk is painted for (`#keyOf`), or null for one not painted. */
  readonly #painted: (string | null)[];
  /** The plots each chunk lies on, by their place in the land's list. */
  readonly #under: (readonly number[])[];
  /** A chunk is painted on one of these, and then copied to its sheet: one for what a frame waits for, one for what is painted ahead. */
  readonly #now = makeCanvas(CHUNK.w, CHUNK.h);
  readonly #ahead = makeCanvas(CHUNK.w, CHUNK.h);
  /** The chunks of plots being cleared, as they will be once it is done. */
  readonly #next = new Map<number, { readonly c: HTMLCanvasElement; readonly key: string }>();
  /** The chunk being painted ahead, a step at a time, and what it is for. */
  #busy: { n: number; key: string; steps: Generator<void, void, undefined> } | null = null;
  /** Frames in a row that had no time left to paint ahead in. */
  #starved = 0;
  /** Whose the land was (`#handsKey`) when every chunk was last found painted for it: nothing is looked for until that changes. */
  #settled: string | null = null;
  /** Whose the land was at the last frame, for `waiting`. */
  #hands: Hands | null = null;
  /** The clock, in milliseconds. */
  readonly #clock: () => number;

  /** `clock` is the time in milliseconds: the page's own, unless a test gives one. */
  constructor(gr: Ground, p: Painter, clock: () => number = () => performance.now()) {
    this.#gr = gr;
    this.#p = p;
    this.#clock = clock;
    // The card took everything back and has returned: nothing painted is on it.
    p.restored(() => this.wipe());
    this.#c0 = Math.floor(gr.x / CHUNK.w);
    this.#r0 = Math.floor(gr.y / CHUNK.h);
    this.#cols = Math.floor((gr.x + gr.w - 1) / CHUNK.w) - this.#c0 + 1;
    this.#rows = Math.floor((gr.y + gr.h - 1) / CHUNK.h) - this.#r0 + 1;
    const most = Math.min(p.most, SHEET_MOST);
    this.#across = Math.max(1, Math.floor(most / CHUNK.w));
    this.#down = Math.max(1, Math.floor(most / CHUNK.h));
    for (let row = 0; row < this.#rows; row += this.#down)
      for (let col = 0; col < this.#cols; col += this.#across) {
        const w = Math.min(this.#across, this.#cols - col) * CHUNK.w;
        const h = Math.min(this.#down, this.#rows - row) * CHUNK.h;
        this.#pages.push({ sheet: p.sheet(w, h), col, row });
      }
    const count = this.#cols * this.#rows;
    this.#painted = Array.from({ length: count }, () => null);
    this.#under = Array.from({ length: count }, (_, n) => this.#plotsUnder(n));
  }

  /** Nothing painted is on the card any more: it took everything back, and has returned. */
  wipe(): void {
    this.#busy?.steps.return();
    this.#busy = null;
    this.#painted.fill(null);
    this.#next.clear();
    this.#settled = null;
  }

  /** Gives the ground's memory on the card back: this floor is not laid again. */
  drop(): void {
    for (const page of this.#pages) this.#p.drop(page.sheet);
    this.#pages.length = 0;
  }

  /** How many chunks are still to be painted, for a review page waiting for the land to be whole. */
  get waiting(): number {
    const h = this.#hands;
    return h ? this.#painted.filter((key, n) => key !== this.#keyOf(n, h.cleared)).length : this.#painted.length;
  }

  /** A chunk's box of the yard, in the yard's pixels. */
  #boxOf(n: number): Box {
    return {
      x: ((n % this.#cols) + this.#c0) * CHUNK.w,
      y: (Math.floor(n / this.#cols) + this.#r0) * CHUNK.h,
      w: CHUNK.w,
      h: CHUNK.h,
    };
  }

  /** The plots under a chunk, by their place in the land's list. */
  #plotsUnder(n: number): readonly number[] {
    const { land } = this.#gr;
    const b = this.#boxOf(n);
    const found = new Set<number>();
    for (let ty = b.y / TILE; ty < (b.y + b.h) / TILE; ty++)
      for (let tx = b.x / TILE; tx < (b.x + b.w) / TILE; tx++)
        if (tx >= 0 && ty >= 0 && tx < land.w && ty < land.h) found.add(land.plot[ty * land.w + tx] ?? -1);
    return [...found].toSorted((a, b2) => a - b2);
  }

  /** What a chunk shows: which of the plots under it are cleared. */
  #keyOf(n: number, cleared: Cleared): string {
    let key = "";
    for (const plot of this.#under[n] ?? []) if (cleared(plot)) key += `${plot},`;
    return key;
  }

  /** Whose the land is, as one line: it differs whenever any chunk's key may. */
  #handsKey(cleared: Cleared): string {
    let key = "";
    for (let n = 0; n < this.#gr.land.plots.length; n++) key += cleared(n) ? "1" : "0";
    return key;
  }

  /** Copies a chunk's picture onto its sheet, painted for `key`. */
  #keep(n: number, c: HTMLCanvasElement, key: string): void {
    const col = n % this.#cols;
    const row = Math.floor(n / this.#cols);
    const page =
      this.#pages[Math.floor(row / this.#down) * Math.ceil(this.#cols / this.#across) + Math.floor(col / this.#across)];
    page?.sheet.put(c, (col - page.col) * CHUNK.w, (row - page.row) * CHUNK.h);
    this.#painted[n] = key;
    if (this.#busy?.n === n) {
      this.#busy.steps.return();
      this.#busy = null;
    }
  }

  /**
   * Brings a chunk to what it must show, at once: from the picture made while its plot was being
   * cleared, if that is what it shows now, else painted.
   */
  #bring(n: number, cleared: Cleared, key: string): void {
    const next = this.#next.get(n);
    if (next?.key === key) return this.#keep(n, next.c, key);
    this.#gr.paint(this.#now.g, this.#boxOf(n), cleared);
    this.#keep(n, this.#now.c, key);
  }

  /** The chunks a box of the yard's pixels covers: the first and last column and row, among the ground's own. */
  #span(b: Box): { c0: number; r0: number; c1: number; r1: number } {
    return {
      c0: Math.max(0, Math.floor(b.x / CHUNK.w) - this.#c0),
      r0: Math.max(0, Math.floor(b.y / CHUNK.h) - this.#r0),
      c1: Math.min(this.#cols - 1, Math.floor((b.x + b.w - 1) / CHUNK.w) - this.#c0),
      r1: Math.min(this.#rows - 1, Math.floor((b.y + b.h - 1) / CHUNK.h) - this.#r0),
    };
  }

  /** The chunks of a view that are not painted for what they must show, with what that is, nearest the view's middle first. */
  #lacking(view: Box, cleared: Cleared): { n: number; key: string }[] {
    const s = this.#span(view);
    const out: { n: number; key: string; far: number }[] = [];
    for (let row = s.r0; row <= s.r1; row++)
      for (let col = s.c0; col <= s.c1; col++) {
        const n = row * this.#cols + col;
        const key = this.#keyOf(n, cleared);
        if (this.#painted[n] === key) continue;
        const b = this.#boxOf(n);
        out.push({ n, key, far: Math.hypot(b.x + b.w / 2 - view.x - view.w / 2, b.y + b.h / 2 - view.y - view.h / 2) });
      }
    return out.toSorted((a, b) => a.far - b.far);
  }

  /**
   * Lays the floor under a view of the yard (its corner the picture's): the yard's own floor on each
   * plot `hands.cleared` says, the forest's elsewhere. Whatever of it is not painted for what it must
   * show is painted first, for as long as a frame may wait (`SHOWN_MS`), and the rest is laid in the
   * map's flat colours; the chunks of a plot being cleared, as they will be, are painted first of all.
   */
  lay(view: Box, hands: Hands): void {
    const { cleared, clearing } = hands;
    this.#hands = hands;
    const began = this.#clock();
    if (clearing.length > 0) this.#paintNext(hands);
    const lacking = this.#lacking(view, cleared);
    const rough = lacking.filter((c, k) => {
      if (k > 0 && this.#clock() - began >= SHOWN_MS) return true;
      this.#bring(c.n, cleared, c.key);
      return false;
    });
    if (clearing.length === 0 && this.#next.size > 0) {
      // The clearing is done: what was painted for it becomes the ground, out of view too.
      for (const [n, next] of this.#next)
        if (this.#painted[n] !== next.key && next.key === this.#keyOf(n, cleared)) this.#keep(n, next.c, next.key);
      this.#next.clear();
    }
    for (const page of this.#pages) {
      const px = (page.col + this.#c0) * CHUNK.w;
      const py = (page.row + this.#r0) * CHUNK.h;
      const x0 = Math.max(view.x, px);
      const y0 = Math.max(view.y, py);
      const x1 = Math.min(view.x + view.w, px + page.sheet.w);
      const y1 = Math.min(view.y + view.h, py + page.sheet.h);
      if (x1 > x0 && y1 > y0) this.#p.from(page.sheet, x0 - px, y0 - py, x1 - x0, y1 - y0, x0 - view.x, y0 - view.y);
    }
    for (const c of rough) this.#layRough(c.n, view, cleared);
  }

  /** A chunk not painted yet, in the map's flat colours: the forest round the map, and on the map a colour a tile. */
  #layRough(n: number, view: Box, cleared: Cleared): void {
    const gr = this.#gr;
    const { land } = gr;
    const b = this.#boxOf(n);
    const x0 = Math.max(b.x, gr.x);
    const y0 = Math.max(b.y, gr.y);
    const x1 = Math.min(b.x + b.w, gr.x + gr.w);
    const y1 = Math.min(b.y + b.h, gr.y + gr.h);
    this.#p.rect(x0 - view.x, y0 - view.y, x1 - x0, y1 - y0, ROUGH.margin);
    for (let ty = Math.max(0, b.y / TILE); ty < Math.min(land.h, (b.y + b.h) / TILE); ty++)
      for (let tx = Math.max(0, b.x / TILE); tx < Math.min(land.w, (b.x + b.w) / TILE); tx++) {
        const i = ty * land.w + tx;
        const colour = land.water[i] === 1 ? ROUGH.water : cleared(land.plot[i] ?? -1) ? ROUGH.cleared : ROUGH.wild;
        this.#p.rect(tx * TILE - view.x, ty * TILE - view.y, TILE, TILE, colour);
      }
  }

  /** Paints the chunks under the plots being cleared as they will be once cleared, each once, at once. */
  #paintNext(hands: Hands): void {
    const after: Cleared = (plot) => hands.cleared(plot) || hands.clearing.includes(plot);
    for (let n = 0; n < this.#under.length; n++) {
      if (this.#next.has(n) || !this.#under[n]?.some((plot) => hands.clearing.includes(plot))) continue;
      const made = makeCanvas(CHUNK.w, CHUNK.h);
      this.#gr.paint(made.g, this.#boxOf(n), after);
      this.#next.set(n, { c: made.c, key: this.#keyOf(n, after) });
    }
  }

  /** Lays what a plot being cleared will be, within the plot, over what `lay` laid: the caller masks it to where the clearing has reached. */
  layClearing(view: Box, plot: number): void {
    const p = this.#gr.land.plots[plot];
    if (!p) return;
    const box: Box = { x: p.x * TILE, y: p.y * TILE, w: p.w * TILE, h: p.h * TILE };
    for (const [n, next] of this.#next) {
      const at = this.#boxOf(n);
      const x0 = Math.max(box.x, at.x);
      const y0 = Math.max(box.y, at.y);
      const x1 = Math.min(box.x + box.w, at.x + CHUNK.w);
      const y1 = Math.min(box.y + box.h, at.y + CHUNK.h);
      if (x1 > x0 && y1 > y0) this.#p.part(next.c, x0 - at.x, y0 - at.y, x1 - x0, y1 - y0, x0 - view.x, y0 - view.y);
    }
  }

  /** The chunk nearest a point that is not painted for what it must show, with what that is; or null when all are. */
  #nearestStale(cleared: Cleared, mid: { x: number; y: number }): { n: number; key: string } | null {
    let best: { n: number; key: string } | null = null;
    let least = Number.POSITIVE_INFINITY;
    for (let n = 0; n < this.#painted.length; n++) {
      const key = this.#keyOf(n, cleared);
      if (this.#painted[n] === key) continue;
      const b = this.#boxOf(n);
      const far = Math.hypot(b.x + b.w / 2 - mid.x, b.y + b.h / 2 - mid.y);
      if (far < least) {
        least = far;
        best = { n, key };
      }
    }
    return best;
  }

  /**
   * Paints ahead of need in what is left of a frame that began at `began` (the clock's time): the
   * chunk nearest `mid` first, a step at a time (`Ground.painting`); nothing once the frame has run
   * long, but a step after `STARVED` such frames.
   */
  paintAhead(hands: Hands, mid: { x: number; y: number }, began: number): void {
    this.#hands = hands;
    const whose = this.#handsKey(hands.cleared);
    if (this.#settled === whose && !this.#busy) return;
    const until = began + BUDGET;
    const late = this.#clock() >= until;
    if (late && ++this.#starved < STARVED) return;
    this.#starved = 0;
    for (let first = late; first || this.#clock() < until; first = false) {
      if (this.#busy && this.#keyOf(this.#busy.n, hands.cleared) !== this.#busy.key) {
        this.#busy.steps.return();
        this.#busy = null;
      }
      if (!this.#busy) {
        const stale = this.#nearestStale(hands.cleared, mid);
        if (!stale) {
          this.#settled = whose;
          return;
        }
        const steps = this.#gr.painting(this.#ahead.g, this.#boxOf(stale.n), hands.cleared);
        this.#busy = { ...stale, steps };
      }
      const b = this.#busy;
      if (!b.steps.next().done) continue;
      this.#busy = null;
      this.#keep(b.n, this.#ahead.c, b.key);
    }
  }
}
