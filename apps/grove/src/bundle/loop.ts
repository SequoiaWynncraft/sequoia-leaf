/**
 * One animated loop of the art bundle, decoded lazily. Frames are composited in order, a few at a
 * time, whenever there is time: `frame` asks for one within a budget and settles for the latest
 * frame ready if the budget runs out, and the loader decodes ahead in idle time (`ahead`). The
 * first frame is ready as soon as the bytes are, and after one pass through the loop every frame is
 * a ready-to-draw copy, so steady state costs a copy per frame.
 */

import { Compositor, type Gif, parseGif } from "./gif.ts";

export class Loop {
  readonly width: number;
  readonly height: number;
  readonly count: number;
  /** Milliseconds per frame (the first frame's delay; the bundle's loops are even). */
  readonly frameMs: number;
  private readonly frames: Uint32Array[] = [];
  private readonly compositor: Compositor;

  constructor(gif: Gif) {
    if (gif.frames.length === 0) throw new Error("loop: no frames");
    this.width = gif.width;
    this.height = gif.height;
    this.count = gif.frames.length;
    this.frameMs = gif.frames[0]?.delay || 100;
    this.compositor = new Compositor(gif);
  }

  static fromBytes(bytes: Uint8Array): Loop {
    return new Loop(parseGif(bytes));
  }

  /** How many frames are ready. */
  get decoded(): number {
    return this.frames.length;
  }

  get complete(): boolean {
    return this.frames.length >= this.count;
  }

  /** The frame index showing `ms` into the loop. */
  indexAt(ms: number): number {
    const i = Math.floor(ms / this.frameMs) % this.count;
    return i < 0 ? i + this.count : i;
  }

  /**
   * Frame `i`, decoding toward it until `deadline` (on `now`'s clock); if it is not ready by then,
   * the latest frame that is. Null only before the first frame exists.
   */
  frame(i: number, deadline = Infinity, now: () => number = () => 0): Uint32Array | null {
    const want = Math.max(0, Math.min(this.count - 1, i));
    while (this.frames.length <= want) {
      this.frames.push(this.compositor.next());
      if (now() >= deadline) break;
    }
    return this.frames[Math.min(want, this.frames.length - 1)] ?? null;
  }

  /** Decodes ahead until `deadline`; true when the whole loop is ready. */
  ahead(deadline: number, now: () => number): boolean {
    while (!this.complete && now() < deadline) this.frames.push(this.compositor.next());
    return this.complete;
  }
}
