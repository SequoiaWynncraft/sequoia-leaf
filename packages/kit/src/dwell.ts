/**
 * A pointer resting on one thing drawn on a canvas: after `ms` on it, its tip shows. The thing is
 * the same thing by its id, however it is described from one frame to the next (a pet's hover is
 * made anew each frame, and its box moves as it walks), so drawing again never starts the wait
 * over. Another thing, or none, puts the tip away and starts the wait again.
 */

/** What the pointer is on: a thing named by an id that stays the same while it is the same thing. */
export interface Rested {
  readonly id: string;
}

/** What a dwell does with the thing rested on. */
export interface DwellOf<T extends Rested> {
  /** How long the pointer rests before the tip shows, in milliseconds. */
  readonly ms: number;
  /** The tip shows, for the thing as it is now. */
  readonly show: (on: T) => void;
  /** While the tip is up, each time it is told again, the thing as it is now: the tip goes with it. */
  readonly follow: (on: T) => void;
  readonly hide: () => void;
}

/** Gives back what the page tells each frame: the thing the pointer is on, or nothing, and the time in milliseconds. */
export function dwell<T extends Rested>(of: DwellOf<T>): (on: T | null, now: number) => void {
  let rest: { readonly id: string; readonly since: number; shown: boolean } | null = null;
  return (on, now) => {
    if (on && rest?.id === on.id) {
      if (rest.shown) of.follow(on);
      else if (now - rest.since >= of.ms) {
        rest.shown = true;
        of.show(on);
      }
      return;
    }
    if (rest?.shown) of.hide();
    rest = on ? { id: on.id, since: now, shown: false } : null;
  };
}
