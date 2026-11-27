/**
 * The floor on the screen: the ground (`art/ground.ts`) kept in patches (`patches.ts`) and painted
 * only where it is needed. A patch is painted when it comes into view, or into the ring of patches
 * round the view, nearest the middle first, a small step at a time and only in the time a frame has
 * left once everything else is drawn, so painting never makes a frame long however large the land.
 * Only the page's first frame paints before it lays, so the page opens painted. A patch not painted
 * yet shows the map's flat colours until it is. Patches are kept up to a budget, those seen longest
 * ago given back first: today's whole land stays painted once seen, and on a larger one what was
 * seen a moment ago is still there on coming back.
 *
 * What a patch shows depends only on which of the plots under it the yard has cleared: buying a plot
 * paints again only the patches of that plot, and until it has, they show the flat colours, never
 * what the plot was before. While its undergrowth comes down, the plot's patches
 * as they will be are painted beside those on the screen, shown where the clearing has reached, and
 * put in their place once it is done.
 */

import { WATER } from "@sequoia-leaf/kit/palette.ts";
import { type Ctx, makeCanvas } from "@sequoia-leaf/kit/util.ts";

import { TILE } from "./art/belts.ts";
import { BEYOND, type Box, type Ground, pack } from "./art/ground.ts";
import { DEEP } from "./art/pal.ts";
import { inSpan, PATCH, type Patch, Patches, placeOf, type Span, spanOf } from "./patches.ts";

/**
 * Painting's time, in milliseconds: on the page's first frame, before anything is laid, so the view
 * opens painted; and on every frame, what is left until this long after the frame began.
 */
const BUDGET = { first: 120, frame: 6 } as const;
/**
 * Patches kept at most, but never fewer than the view and the ring round it need: 80 of 48 KiB, under
 * 4 MiB, more than today's whole land (64 patches with the forest round it).
 */
const KEPT = 80;
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
  /** Frames laid, to know which patches were seen longest ago. */
  #frame = 0;
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
   * is missing is painted after the frame is drawn (`paintSpare`), but on the page's first frame
   * (`opening`), before.
   */
  lay(g: Ctx, view: Box, cleared: Cleared, clearing: readonly number[], after: Cleared, opening: boolean): void {
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
    if (opening) this.#work(this.#wanted, performance.now() + BUDGET.first);
    this.#layPatches(g, view, seen, cleared);
    this.#frame++;
    for (const p of this.#now.kept) if (inSpan(near, p.col, p.row)) p.seen = this.#frame;
    this.#now.trim(Math.max(KEPT, (near.c1 - near.c0 + 1) * (near.r1 - near.r0 + 1)));
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

  /**
   * Each patch of the view as the yard has it now, over the map's flat colours laid once under the
   * whole view where any patch is not painted for what it must show (not yet, or painted when a plot
   * under it was someone else's). A patch covers its box whole, so nothing of the flat colours shows
   * through one that is painted.
   */
  #layPatches(g: Ctx, view: Box, s: Span, cleared: Cleared): void {
    const shown: Patch[] = [];
    for (let row = s.r0; row <= s.r1; row++)
      for (let col = s.c0; col <= s.c1; col++) {
        const p = this.#now.get(col, row);
        if (p && p.key === this.#keyOf(col, row, cleared)) shown.push(p);
      }
    if (shown.length < (s.c1 - s.c0 + 1) * (s.r1 - s.r0 + 1)) this.#layRough(g, view, cleared);
    for (const p of shown) g.drawImage(p.c, p.x - view.x, p.y - view.y);
  }

  /** The map's flat colours over a whole view: past the ground, the forest's floor round the map, and the map a tile a pixel. */
  #layRough(g: Ctx, view: Box, cleared: Cleared): void {
    const gr = this.#gr;
    const { land } = gr;
    g.imageSmoothingEnabled = false;
    g.fillStyle = BEYOND;
    g.fillRect(0, 0, view.w, view.h);
    g.fillStyle = ROUGH.margin;
    g.fillRect(gr.x - view.x, gr.y - view.y, gr.w, gr.h);
    g.drawImage(this.#roughFor(cleared), -view.x, -view.y, land.w * TILE, land.h * TILE);
  }

  /** The map's flat colours, painted again when the plots cleared are not those they were painted for. */
  #roughFor(cleared: Cleared): HTMLCanvasElement {
    const { land } = this.#gr;
    const r = this.#rough;
    const key = land.plots.map((_, n) => (cleared(n) ? "1" : "0")).join("");
    if (r.key === key) return r.c;
    r.key = key;
    // A pixel a tile, written straight in: a land has thousands of tiles.
    const img = r.g.createImageData(land.w, land.h);
    const px = new Uint32Array(img.data.buffer);
    const [water, owned, wild] = [ROUGH.water, ROUGH.owned, ROUGH.wild].map(pack);
    for (let i = 0; i < px.length; i++)
      px[i] = (land.water[i] === 1 ? water : cleared(land.plot[i] ?? -1) ? owned : wild) ?? 0;
    r.g.putImageData(img, 0, 0);
    return r.c;
  }
}
