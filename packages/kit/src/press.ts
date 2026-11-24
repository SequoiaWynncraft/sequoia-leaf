/**
 * A long press with a finger: resting on a thing for `LONG_PRESS` asks what it is, and the click
 * that ends such a press is the press's, not the thing's. Cards (`card.ts`) and tips (`tip.ts`)
 * ask with it.
 *
 * Each press is a child of the thing's scope, holding the wait and the listeners for its finger
 * moving away or lifting, so however a press ends, nothing of it is left on the thing for the next.
 * A press whose thing has left the page by the time it has lasted asks nothing.
 */
import type { Scope } from "./scope.ts";

/** How long a finger must rest before it asks. */
export const LONG_PRESS = 450;
/** How far a resting finger may wander, in CSS pixels. */
const STILL = 9;

/** Where a press is: none; a finger down and resting; or a press that has asked, whose click is its own. */
type Press =
  | { readonly at: "idle" }
  | { readonly at: "held"; readonly pointer: number; readonly scope: Scope }
  | { readonly at: "asked" };

const IDLE: Press = { at: "idle" };
const ASKED: Press = { at: "asked" };

/** What a press needs of its thing: its events, and whether it is on the page. */
export type Pressable = EventTarget & { readonly isConnected: boolean };

export interface PressOpts {
  /** Whether a pointer going down begins a press: a finger, on a thing that asks this way. */
  starts(e: PointerEvent): boolean;
  /** The press has lasted, still, on a thing on the page. */
  asked(): void;
}

/**
 * Lets a finger ask about `target` by resting on it. Gives back, for the thing's own click handler,
 * whether the click now is the end of a press that asked (and so not the thing's to act on).
 */
export function longPress(owner: Scope, target: Pressable, opts: PressOpts): () => boolean {
  let press: Press = IDLE;
  /** Every change to the press goes through here: a press no longer held lets go of all it held. */
  const to = (now: Press): void => {
    const was = press;
    press = now;
    if (was.at === "held" && now !== was) was.scope.close();
    if (was.at === "held" && now.at === "asked") opts.asked();
  };
  const ours = (e: PointerEvent): boolean => press.at === "held" && e.pointerId === press.pointer;
  const lift = (e: PointerEvent): void => {
    if (ours(e)) to(IDLE);
  };
  /** A finger goes down to rest: the wait, and the ways it ends early, in a scope of its own. */
  const hold = (e: PointerEvent): Press => {
    const scope = owner.child();
    const [x, y] = [e.clientX, e.clientY];
    scope.on(target, "pointermove", (m) => {
      if (ours(m) && Math.hypot(m.clientX - x, m.clientY - y) > STILL) to(IDLE);
    });
    scope.on(target, "pointerup", lift);
    scope.on(target, "pointercancel", lift);
    scope.after(LONG_PRESS, () => to(target.isConnected ? ASKED : IDLE));
    return { at: "held", pointer: e.pointerId, scope };
  };
  owner.on(target, "pointerdown", (e) => to(opts.starts(e) ? hold(e) : IDLE));
  return () => {
    const asked = press.at === "asked";
    if (asked) to(IDLE);
    return asked;
  };
}
