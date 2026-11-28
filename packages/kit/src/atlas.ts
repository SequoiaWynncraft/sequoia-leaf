/**
 * Where each small picture lies on one large one (an atlas), so that the graphics card draws them
 * all from a single texture (`painter.ts`). Pictures are packed in shelves: rows across the atlas,
 * each as tall as the first picture put on it. A picture goes on the shelf it fits that wastes least
 * height; if that would waste much, on a new shelf under the last while there is room for one.
 *
 * Nothing is ever taken out. When a picture does not fit, the atlas says so (`place` gives null) and
 * its owner starts it again, larger if it can be (`restart`); every picture is then placed afresh the
 * next time it is drawn. Nothing here touches the graphics card.
 */

/** A picture's corner on the atlas. */
export interface Place {
  readonly x: number;
  readonly y: number;
}

/** A row of pictures across the atlas: where it starts down the atlas, how tall it is, and how far along it is full. */
interface Shelf {
  readonly y: number;
  readonly h: number;
  used: number;
}

/** A shelf may be this much taller than the picture put on it: taller, and a new shelf wastes less while there is room for one. */
const SLACK = 1.25;

export class Atlas<Pic extends object> {
  #size: number;
  readonly #most: number;
  #shelves: Shelf[] = [];
  /** How far down the atlas the shelves reach. */
  #filled = 0;
  #places = new Map<Pic, Place>();
  /** Counts each time it started again: a place handed out before then is no longer the picture's. */
  #turn = 0;

  /** An atlas `size` pixels square, that may grow to `most`. */
  constructor(size: number, most: number) {
    this.#size = Math.min(size, most);
    this.#most = most;
  }

  get size(): number {
    return this.#size;
  }

  get turn(): number {
    return this.#turn;
  }

  /** How many pictures are placed. */
  get count(): number {
    return this.#places.size;
  }

  /** Where a picture lies, if it has been placed since the atlas last started. */
  at(pic: Pic): Place | undefined {
    return this.#places.get(pic);
  }

  /**
   * Places a picture of `w` by `h` and gives its corner, or null when there is no room left for it.
   * A picture larger than the atlas can ever be is nobody's to place: that throws.
   */
  place(pic: Pic, w: number, h: number): Place | null {
    if (w > this.#most || h > this.#most) throw new Error(`a picture of ${w} by ${h} is larger than the atlas`);
    let best: Shelf | null = null;
    for (const s of this.#shelves) if (s.h >= h && s.used + w <= this.#size && (!best || s.h < best.h)) best = s;
    if ((!best || best.h > h * SLACK) && w <= this.#size && this.#filled + h <= this.#size) {
      best = { y: this.#filled, h, used: 0 };
      this.#shelves.push(best);
      this.#filled += h;
    }
    if (!best) return null;
    const place = { x: best.used, y: best.y };
    best.used += w;
    this.#places.set(pic, place);
    return place;
  }

  /** Starts again with nothing placed: twice as large each way if it can be, else as large as it was. */
  restart(): void {
    this.#size = Math.min(this.#most, this.#size * 2);
    this.#shelves = [];
    this.#filled = 0;
    this.#places = new Map();
    this.#turn++;
  }

  /** Starts again at its size, with nothing placed: the texture it stands for was emptied. */
  empty(): void {
    this.#shelves = [];
    this.#filled = 0;
    this.#places = new Map();
    this.#turn++;
  }
}
