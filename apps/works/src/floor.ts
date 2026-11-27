/**
 * The floor on the screen: the ground (`art/ground.ts`) kept in patches (`patches.ts`) and painted
 * only where it is needed. A patch is painted when it comes into view, or into the ring of patches
 * round the view, nearest the middle first, a small step at a time and only in the time a frame has
 * left once everything else is drawn, so painting never makes a frame long however large the land;
 * a patch not painted yet shows the map's flat colours until it is. Patches far from the view are
 * given back, so what is kept grows with the screen and not with the land.
 *
 * What a patch shows depends only on which of the plots under it the yard has cleared: buying a plot
 * paints again only the patches of that plot. While its undergrowth comes down, the plot's patches
 * as they will be are painted beside those on the screen, shown where the clearing has reached, and
 * put in their place once it is done.
 */

import { WATER } from "@sequoia-leaf/kit/palette.ts";
import { type Ctx, makeCanvas } from "@sequoia-leaf/kit/util.ts";

import { TILE } from "./art/belts.ts";
import { BEYOND, type Box, type Ground } from "./art/ground.ts";
import { DEEP } from "./art/pal.ts";
import { inSpan, PATCH, Patches, placeOf, type Span, spanOf } from "./patches.ts";

/**
 * Painting's time, in milliseconds: on the first frame, before anything is laid, so the view opens
 * painted; and on every frame after, what is left until this long after the frame began.
 */
const BUDGET = { first: 120, frame: 6 } as const;
/** Frames in a row with no time left after which a step is painted anyway, so the floor is painted where every frame is long. */
const STARVED = 8;
/** The flat colours of a patch not painted yet: grass on the yard's own land, the forest's floor, the stream, and past the map. */
const ROUGH = { owned: "#3d6b3a", wild: DEEP[2], water: WATER[0], margin: DEEP[1] } as const;

/** Which plots the yard has cleared (by their place in the land's list). */
export type Cleared = (plot: number) => boolean;

/** A patch to be painted: the store it goes in, where it is, and what it is to show. */
interface Job {
  readonly into: Patches;
  readonly col: number;
  readonly row: number;
  readonly key: string;
  readonly cleared: Cleared;
  readonly far: number;
}

const sameJob = (a: Job, b: Job): boolean => a.into === b.into && a.col === b.col && a.row === b.row && a.key === b.key;

export class Floor {
  readonly #gr: Ground;
  /** The patches on the screen, and those of plots being cleared as they will be. */
  readonly #now: Patches;
  readonly #next: Patches;
  /** A picture on the CPU each patch is painted on first, as the whole ground was. */
  readonly #scratch = makeCanvas(PATCH.w, PATCH.h);
  /** The plots each patch lies on, by place, worked out once. */
  readonly #under = new Map<number, readonly number[]>();
  /** The map's flat colours, a pixel a tile, and the plots cleared they were painted for. */
  readonly #rough: { c: HTMLCanvasElement; g: Ctx; key: string };
  /** Nothing has been painted since the floor was opened or its pictures were lost. */
  #fresh = true;
  /** The patch being painted, a step at a time, and what it is for. */
  #busy: { job: Job; steps: Generator<void, void, undefined> } | null = null;
  /** What the last frame wanted painted, first first; and frames in a row that had no time left for it. */
  #wanted: readonly Job[] = [];
  #starved = 0;

  constructor(gr: Ground, lost: () => void) {
    this.#gr = gr;
    this.#now = new Patches(lost);
    this.#next = new Patches(lost);
    this.#rough = { ...makeCanvas(gr.land.w, gr.land.h), key: "\u0000" };
  }

  /** How many patches are kept, on the screen and for plots being cleared. */
  get kept(): number {
    return this.#now.size + this.#next.size;
  }

  /** Everything painted is forgotten: the browser emptied the pictures, or the page was put away. */
  wipe(): void {
    this.#busy?.steps.return();
    this.#busy = null;
    this.#now.clear();
    this.#next.clear();
    this.#rough.key = "\u0000";
    this.#fresh = true;
  }

  /** The plots under a patch, by their place in the land's list. */
  #plotsUnder(col: number, row: number): readonly number[] {
    const place = placeOf(col, row);
    let under = this.#under.get(place);
    if (!under) {
      const { land } = this.#gr;
      const found = new Set<number>();
      const tw = PATCH.w / TILE;
      const th = PATCH.h / TILE;
      for (let ty = row * th; ty < (row + 1) * th; ty++)
        for (let tx = col * tw; tx < (col + 1) * tw; tx++)
          if (tx >= 0 && ty >= 0 && tx < land.w && ty < land.h) found.add(land.plot[ty * land.w + tx] ?? -1);
      under = [...found].toSorted((a, b) => a - b);
      this.#under.set(place, under);
    }
    return under;
  }

  /** What a patch shows: which of the plots under it are cleared. */
  #keyOf(col: number, row: number, cleared: Cleared): string {
    let key = "";
    for (const n of this.#plotsUnder(col, row)) if (cleared(n)) key += `${n},`;
    return key;
  }

  /**
   * Paints patches, the first wanted first, a step at a time (`Ground.painting`) until the clock
   * reaches `until` (one step at least, with `one`): carrying on with the patch begun at an earlier
   * frame while it is still wanted, and putting each in its store once its last step is done.
   */
  #work(jobs: readonly Job[], until: number, one = false): void {
    const busy = this.#busy;
    if (busy && !jobs.some((j) => sameJob(j, busy.job))) {
      busy.steps.return();
      this.#busy = null;
    }
    const left = jobs.filter((j) => (!busy || !sameJob(j, busy.job)) && j.into.get(j.col, j.row)?.key !== j.key);
    for (let first = one; first || performance.now() < until; first = false) {
      if (!this.#busy) {
        const job = left.shift();
        if (!job) return;
        const box = { x: job.col * PATCH.w, y: job.row * PATCH.h, w: PATCH.w, h: PATCH.h };
        this.#busy = { job, steps: this.#gr.painting(this.#scratch.g, box, job.cleared) };
      }
      const b = this.#busy;
      if (!b.steps.next().done) continue;
      const p = b.job.into.take(b.job.col, b.job.row);
      p.g.clearRect(0, 0, PATCH.w, PATCH.h);
      p.g.drawImage(this.#scratch.c, 0, 0);
      p.key = b.job.key;
      this.#busy = null;
    }
  }

  /**
   * Paints what the last `lay` wanted, in what is left of a frame that began at `began` (the clock's
   * time): nothing once it has run long, but a step after `STARVED` such frames.
   */
  paintSpare(began: number): void {
    const until = began + BUDGET.frame;
    const late = performance.now() >= until;
    if (late && ++this.#starved < STARVED) return;
    this.#starved = 0;
    this.#work(this.#wanted, until, late);
  }

  /** The jobs for the patches of a span that are missing from a store, or show something else, nearest `mid` first. */
  #jobs(
    into: Patches,
    s: Span,
    cleared: Cleared,
    mid: { x: number; y: number },
    only?: (col: number, row: number) => boolean,
  ): Job[] {
    const jobs: Job[] = [];
    for (let row = s.r0; row <= s.r1; row++)
      for (let col = s.c0; col <= s.c1; col++) {
        if (only && !only(col, row)) continue;
        const key = this.#keyOf(col, row, cleared);
        if (into.get(col, row)?.key === key) continue;
        // A plot cleared a moment ago: its patches were painted as they are now while it was cleared.
        if (into === this.#now && this.#next.get(col, row)?.key === key && into.swap(this.#next, col, row)) continue;
        const far = Math.hypot((col + 0.5) * PATCH.w - mid.x, (row + 0.5) * PATCH.h - mid.y);
        jobs.push({ into, col, row, key, cleared, far });
      }
    return jobs.toSorted((a, b) => a.far - b.far);
  }

  /**
   * Lays the floor on a picture whose corner is (`view.x`, `view.y`) of the yard: the yard's own floor
   * on each plot `cleared` says, the forest's elsewhere. `clearing` are plots being cleared, with what
   * clears them (`cleared` and them): their patches are painted first, ready for `layClearing`. What
   * is missing is painted after the frame is drawn (`paintSpare`), but on the first frame, before.
   */
  lay(g: Ctx, view: Box, cleared: Cleared, clearing: readonly number[], after: Cleared): void {
    const mid = { x: view.x + view.w / 2, y: view.y + view.h / 2 };
    const seen = spanOf(view);
    const near = spanOf(view, 1);
    const onClearing = (col: number, row: number): boolean =>
      this.#plotsUnder(col, row).some((n) => clearing.includes(n));
    // The plots being cleared first, then the view, then the ring round it, so a pan finds it painted.
    this.#wanted = [
      ...(clearing.length > 0 ? this.#jobs(this.#next, seen, after, mid, onClearing) : []),
      ...this.#jobs(this.#now, seen, cleared, mid),
      ...this.#jobs(this.#now, near, cleared, mid, (col, row) => !inSpan(seen, col, row)),
    ];
    if (this.#fresh) this.#work(this.#wanted, performance.now() + BUDGET.first);
    this.#fresh = false;
    this.#layRough(g, view, seen, cleared);
    this.#now.lay(g, view.x, view.y, view.w, view.h);
    this.#now.keep(near);
    if (clearing.length === 0) this.#next.clear();
    else this.#next.keep(near);
  }

  /** Lays what a plot being cleared will be, within the plot, on what `lay` laid: the caller clips it to where the clearing has reached. */
  layClearing(g: Ctx, view: Box, plot: number): void {
    const p = this.#gr.land.plots[plot];
    if (!p) return;
    const box: Box = { x: p.x * TILE, y: p.y * TILE, w: p.w * TILE, h: p.h * TILE };
    for (const patch of this.#next.kept) {
      const x0 = Math.max(box.x, patch.x, view.x);
      const y0 = Math.max(box.y, patch.y, view.y);
      const x1 = Math.min(box.x + box.w, patch.x + PATCH.w, view.x + view.w);
      const y1 = Math.min(box.y + box.h, patch.y + PATCH.h, view.y + view.h);
      if (x1 > x0 && y1 > y0)
        g.drawImage(patch.c, x0 - patch.x, y0 - patch.y, x1 - x0, y1 - y0, x0 - view.x, y0 - view.y, x1 - x0, y1 - y0);
    }
  }

  /** The map's flat colours under the patches of the view not painted yet. */
  #layRough(g: Ctx, view: Box, s: Span, cleared: Cleared): void {
    const missing: { x: number; y: number }[] = [];
    for (let row = s.r0; row <= s.r1; row++)
      for (let col = s.c0; col <= s.c1; col++)
        if (!this.#now.get(col, row)) missing.push({ x: col * PATCH.w, y: row * PATCH.h });
    if (missing.length === 0) return;
    const rough = this.#roughFor(cleared);
    const gr = this.#gr;
    const { land } = gr;
    g.imageSmoothingEnabled = false;
    for (const m of missing) {
      const x = m.x - view.x;
      const y = m.y - view.y;
      g.fillStyle = BEYOND;
      g.fillRect(x, y, PATCH.w, PATCH.h);
      // The ground's part of it, the forest's floor, and over that the map's part, a tile a pixel.
      const gx0 = Math.max(m.x, gr.x);
      const gy0 = Math.max(m.y, gr.y);
      const gx1 = Math.min(m.x + PATCH.w, gr.x + gr.w);
      const gy1 = Math.min(m.y + PATCH.h, gr.y + gr.h);
      if (gx1 <= gx0 || gy1 <= gy0) continue;
      g.fillStyle = ROUGH.margin;
      g.fillRect(gx0 - view.x, gy0 - view.y, gx1 - gx0, gy1 - gy0);
      const tx0 = Math.max(0, m.x / TILE);
      const ty0 = Math.max(0, m.y / TILE);
      const tx1 = Math.min(land.w, (m.x + PATCH.w) / TILE);
      const ty1 = Math.min(land.h, (m.y + PATCH.h) / TILE);
      if (tx1 > tx0 && ty1 > ty0)
        g.drawImage(
          rough,
          tx0,
          ty0,
          tx1 - tx0,
          ty1 - ty0,
          tx0 * TILE - view.x,
          ty0 * TILE - view.y,
          (tx1 - tx0) * TILE,
          (ty1 - ty0) * TILE,
        );
    }
  }

  /** The map's flat colours, painted again when the plots cleared are not those they were painted for. */
  #roughFor(cleared: Cleared): HTMLCanvasElement {
    const { land } = this.#gr;
    const r = this.#rough;
    const key = land.plots.map((_, n) => (cleared(n) ? "1" : "0")).join("");
    if (r.key === key) return r.c;
    r.key = key;
    for (let ty = 0; ty < land.h; ty++)
      for (let tx = 0; tx < land.w; tx++) {
        const i = ty * land.w + tx;
        r.g.fillStyle = land.water[i] === 1 ? ROUGH.water : cleared(land.plot[i] ?? -1) ? ROUGH.owned : ROUGH.wild;
        r.g.fillRect(tx, ty, 1, 1);
      }
    return r.c;
  }
}
