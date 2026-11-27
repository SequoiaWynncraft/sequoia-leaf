/**
 * A press on the world: one finger or the mouse down on the town's canvas, known by its pointer.
 * Only that pointer's moves and its lifting count, and a second finger while it is down does
 * nothing. Lifted, what it holds is let go of where it lifted (`release`). Cancelled, or its hold on
 * the canvas lost, or let go of by the stage (the window left, a game gone into, another place), it
 * goes without being let go of anywhere (`cancel`): a drag cut short is put back, never set down.
 *
 * Every press knows how far it has gone from where it went down. Once past `MOVES` it is moving for
 * good: on bare ground it steers; on a thing it no longer asks, and drags as before.
 *
 * A finger resting on a thing, not on bare ground, asks what it is (`asked`); the thing stays marked
 * for `CLEAR_MS` (`cleared`), unless another long press marks its own first, or the place changes
 * and takes it away. What it said stays until it is put away.
 */
import { LONG_PRESS } from "@sequoia-leaf/kit/press.ts";
import type { Release, Scope } from "@sequoia-leaf/kit/scope.ts";
import type { Pt } from "@sequoia-leaf/kit/util.ts";

/** How long the thing a long press asked about stays marked, in milliseconds. */
export const CLEAR_MS = 2200;
/** How far a press goes from where it went down before it is moving, in CSS pixels. */
const MOVES = 10;

/** What a press on the world tells the stage, at points of the page. */
export interface World {
  /** Down at a point, with a finger or the mouse. Says whether it was bare ground, so that a drag there steers. */
  down(x: number, y: number, finger: boolean): boolean;
  /** Moved, still down. */
  drag(x: number, y: number): void;
  /** Lifted at a point: what it holds is let go of there. */
  release(x: number, y: number): void;
  /** Gone without lifting: what it holds goes back. */
  cancel(): void;
  /** A finger has rested on a thing at a point. */
  asked(x: number, y: number): void;
  /** The thing asked about is no longer marked. */
  cleared(): void;
}

/** Where a press went down, where it is, and whether it has gone far enough to be moving. */
interface Track {
  readonly sx: number;
  readonly sy: number;
  x: number;
  y: number;
  moving: boolean;
}

/**
 * Nothing down; or one pointer down, with its scope, whether it went down on bare ground, how far it
 * has gone, and how to stop it asking (a finger on a thing waits to ask until it moves).
 */
type Press =
  | { readonly at: "up" }
  | {
      readonly at: "down";
      readonly pointer: number;
      readonly scope: Scope;
      readonly ground: boolean;
      readonly track: Track;
      readonly ask: Release;
    };

const UP: Press = { at: "up" };

export interface WorldPress {
  /** Where a finger held on bare ground steers to, on the page. */
  toward(): Pt | null;
  /** The press is let go of without being let go of anywhere: the window lost the keyboard, a game was gone into. */
  letGo(): void;
  /** Another place is on the stage: the press is let go of, and the mark a long press left goes with the old place. */
  newPlace(): void;
}

export function worldPress(
  owner: Scope,
  canvas: EventTarget & Pick<HTMLCanvasElement, "setPointerCapture">,
  world: World,
): WorldPress {
  let press: Press = UP;
  /** The mark a long press left, and its wait to go. */
  let line = owner.child();

  /** The press ends, lifted at a point, or gone (null). Whatever way, its scope goes with it. */
  const end = (lifted: Pt | null): void => {
    if (press.at === "up") return;
    press.scope.close();
    press = UP;
    if (lifted) world.release(lifted.x, lifted.y);
    else world.cancel();
  };
  const ours = (e: PointerEvent): boolean => press.at === "down" && e.pointerId === press.pointer;

  owner.on(canvas, "pointerdown", (e) => {
    if (press.at === "down") return;
    const finger = e.pointerType !== "mouse";
    const x = e.clientX;
    const y = e.clientY;
    const ground = world.down(x, y, finger);
    const scope = owner.child();
    const ask =
      finger && !ground
        ? scope.after(LONG_PRESS, () => {
            line.close();
            line = owner.child();
            world.asked(x, y);
            line.after(CLEAR_MS, () => world.cleared());
          })
        : () => undefined;
    press = { at: "down", pointer: e.pointerId, scope, ground, track: { sx: x, sy: y, x, y, moving: false }, ask };
    canvas.setPointerCapture(e.pointerId);
  });
  owner.on(canvas, "pointermove", (e) => {
    if (press.at !== "down" || e.pointerId !== press.pointer) return;
    world.drag(e.clientX, e.clientY);
    const t = press.track;
    t.x = e.clientX;
    t.y = e.clientY;
    if (t.moving || Math.hypot(t.x - t.sx, t.y - t.sy) <= MOVES) return;
    t.moving = true;
    press.ask();
  });
  owner.on(canvas, "pointerup", (e) => {
    if (ours(e)) end({ x: e.clientX, y: e.clientY });
  });
  const gone = (e: PointerEvent): void => {
    if (ours(e)) end(null);
  };
  owner.on(canvas, "pointercancel", gone);
  owner.on(canvas, "lostpointercapture", gone);

  return {
    toward: () =>
      press.at === "down" && press.ground && press.track.moving ? { x: press.track.x, y: press.track.y } : null,
    letGo: () => end(null),
    newPlace() {
      end(null);
      line.close();
    },
  };
}
