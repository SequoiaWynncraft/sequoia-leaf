/**
 * A press on the sheet's map (`views.ts`), owned by the pointer that began it. Lifted where it went
 * down, it is a tap; moved further than a finger rests, it drags, at each move, and is no tap. While
 * it lasts, another pointer going down is not the press's and does nothing. Cancelled, or losing its
 * hold on the pointer, it is over, and its lift is no tap. The press and its listeners are the
 * scope's: closed, it hears nothing more.
 */
import type { Scope } from "@sequoia-leaf/kit/scope.ts";

/** How far a press may wander and still be a tap, in CSS pixels. */
const STILL = 4;

/** Where the map's press is: none, or one pointer's, which has moved or not. */
type Press =
  | { readonly at: "idle" }
  | { readonly at: "down"; readonly pointer: number; readonly x: number; readonly y: number; moved: boolean };

const IDLE: Press = { at: "idle" };

/** What a press on the map asks of it. */
export interface MapHands {
  /** A press lifted where it went down. */
  tap(e: PointerEvent): void;
  /** A press that has moved, at each move. */
  drag(e: PointerEvent): void;
}

/** What a press needs of the map's canvas: its events, and holding a pointer. */
export type MapSurface = EventTarget & { setPointerCapture(pointerId: number): void };

export function mapPress(owner: Scope, target: MapSurface, hands: MapHands): void {
  let press: Press = IDLE;
  owner.on(target, "pointerdown", (e) => {
    if (press.at === "down") return;
    press = { at: "down", pointer: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
    target.setPointerCapture(e.pointerId);
  });
  owner.on(target, "pointermove", (e) => {
    if (press.at !== "down" || e.pointerId !== press.pointer) return;
    if (!press.moved && Math.hypot(e.clientX - press.x, e.clientY - press.y) > STILL) press.moved = true;
    if (press.moved) hands.drag(e);
  });
  owner.on(target, "pointerup", (e) => {
    if (press.at !== "down" || e.pointerId !== press.pointer) return;
    const moved = press.moved;
    press = IDLE;
    if (!moved) hands.tap(e);
  });
  /** The press is over without a lift: cancelled, or its hold on the pointer lost. */
  const gone = (e: PointerEvent): void => {
    if (press.at === "down" && e.pointerId === press.pointer) press = IDLE;
  };
  owner.on(target, "pointercancel", gone);
  owner.on(target, "lostpointercapture", gone);
}
