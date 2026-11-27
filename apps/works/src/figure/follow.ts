/**
 * The view going with the player's figure, as the town's does: eased, and the same at any frame rate.
 * Dragging the view looks round without moving the figure, and a view that was dragged stays where it
 * was put: a figure sent somewhere by a tap walks through it. Walking with the keys takes hold of the
 * figure again from where the view is, so nothing moves at that moment; what lies between the two
 * then closes gently while the figure walks, or at once and all the way when the player asks for the
 * view back (`home`). A figure that is off the screen is brought onto it by a glide. The view never
 * jumps. While it goes with the figure, the view keeps a whole number of pixels from the pixel the
 * figure is drawn on, so neither the figure nor the ground ever shimmers against the other.
 *
 * Carried over from Outworks (`apps/page/src/camera.ts`); the Works' camera (`camera.ts`) asks it
 * where the middle of the view goes. Places are in the yard's pixels.
 */
import type { Place } from "@sequoia-leaf/factory";

import { VIEW } from "./feel.ts";

/** How far the whole-pixel distance between the view and the figure may be from the true one before it is changed: more than half, so it does not flicker. */
const STEADY = 0.75;

/** A whole number of pixels kept until the true number has left it by more than `STEADY`. */
const steady = (had: number, exact: number): number => (Math.abs(exact - had) > STEADY ? Math.round(exact) : had);

/** The part of the view the interface leaves clear, in the yard's pixels. */
export interface Clear {
  readonly w: number;
  readonly h: number;
}

/** The view going with a figure. */
export class Follow {
  /** Whether the view goes with the figure. Dragging the view, or sending it elsewhere, lets go; `hold` and `home` take hold again. */
  following = true;
  /** The figure the view goes with, where it was last seen. */
  #with: Place | null = null;
  /** The point that goes after the figure as the town's view does; the view is that point and what is `#left`. */
  readonly #after = { x: 0, y: 0 };
  /** What is left between the view and that point since the view took hold away from the figure. */
  readonly #left = { x: 0, y: 0 };
  /** How far the middle of the view is from the pixel the figure is drawn on, in whole pixels. */
  readonly #apart = { x: 0, y: 0 };
  /** Whether what is left closes while the figure stands too: the player asked for the view back. */
  #homing = false;

  /** The view is dragged, or sent somewhere: it lets go of the figure. */
  letGo(): void {
    this.following = false;
    this.#homing = false;
  }

  /**
   * Takes hold of the figure again from where the view is (its middle at `mid`): nothing moves now,
   * and what lies between the two closes as the figure walks (`track`). A view that has hold keeps it.
   */
  hold(mid: Place): void {
    if (this.following) return;
    this.following = true;
    const c = this.#with;
    if (c === null) return;
    [this.#after.x, this.#after.y] = [c.x, c.y];
    [this.#left.x, this.#left.y] = [mid.x - c.x, mid.y - c.y];
    this.#apart.x = Math.round(this.#left.x);
    this.#apart.y = Math.round(this.#left.y);
  }

  /**
   * The view was moved under the figure it goes with, about the figure (a step of zoom): it goes on
   * with the figure from where it is now, nothing moving at the next frame, as if it had taken hold here.
   */
  rebase(mid: Place): void {
    if (!this.following) return;
    this.following = false;
    this.hold(mid);
  }

  /** The player asks for the view back: it takes hold, and closes on the figure whether or not the figure walks. */
  home(mid: Place): void {
    this.hold(mid);
    this.#homing = this.#left.x !== 0 || this.#left.y !== 0;
  }

  /**
   * Each frame, with where the figure stands and `dt` seconds since the last: where the middle of the
   * view goes, or null while it has let go. The closing is worked out for the whole of the time passed
   * with the figure moving evenly through it, so the view is as far behind at any frame rate; and it
   * closes faster when the figure runs, so as never to be left further behind than a walk leaves it.
   * Only the first frame puts the view on the figure at once; a frame in which no time has passed
   * changes nothing. `walking` says whether the figure is on its way somewhere.
   */
  track(x: number, y: number, dt: number, walking: boolean, clear: Clear): Place | null {
    const was = this.#with;
    this.#with = { x, y };
    if (!this.following) return null;
    const after = this.#after;
    if (was === null) {
      [after.x, after.y] = [x, y];
      [this.#left.x, this.#left.y] = [0, 0];
    } else if (dt > 0) {
      const [vx, vy] = [(x - was.x) / dt, (y - was.y) / dt];
      const rate = Math.max(VIEW.catchUp, Math.hypot(vx, vy) / VIEW.behindMost);
      const k = Math.exp(-rate * dt);
      // Behind a point that moves evenly, the view settles at its speed over the rate.
      after.x = x - vx / rate - (was.x - after.x - vx / rate) * k;
      after.y = y - vy / rate - (was.y - after.y - vy / rate) * k;
      // Near enough is there: the closing never quite ends by itself.
      if (Math.abs(x - after.x) < 0.01) after.x = x;
      if (Math.abs(y - after.y) < 0.01) after.y = y;
      this.#close(x, y, walking, dt, clear);
    }
    this.#apart.x = steady(this.#apart.x, after.x + this.#left.x - x);
    this.#apart.y = steady(this.#apart.y, after.y + this.#left.y - y);
    return { x: Math.round(x) + this.#apart.x, y: Math.round(y) + this.#apart.y };
  }

  /**
   * Closes what is left between a view that took hold away from its figure and the figure: gently
   * while the figure walks, quicker when the player asked for the view back, quicker still while the
   * figure is off the screen, and not at all while it stands in sight unasked. It ends exactly on the
   * figure once less than half a pixel is left.
   */
  #close(x: number, y: number, walking: boolean, dt: number, clear: Clear): void {
    const left = this.#left;
    if (left.x === 0 && left.y === 0) return;
    const [dx, dy] = [this.#after.x + left.x - x, this.#after.y + left.y - y];
    const unseen = Math.abs(dx) > clear.w / 2 - VIEW.inSight || Math.abs(dy) > clear.h / 2 - VIEW.inSight;
    if (!walking && !this.#homing && !unseen) return;
    const k = Math.exp(-(unseen ? VIEW.bringIn : this.#homing ? VIEW.home : VIEW.gather) * dt);
    left.x *= k;
    left.y *= k;
    if (Math.hypot(left.x, left.y) >= 0.5) return;
    [left.x, left.y] = [0, 0];
    this.#homing = false;
  }
}
