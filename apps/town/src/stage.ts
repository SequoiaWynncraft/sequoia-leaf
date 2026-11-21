/**
 * The stage: what `main.ts` needs from whatever place is on screen. The town is one such place
 * (`townscene.ts`); a camp, the member's own (or one day somebody else's), is another (`campscene.ts`). `main.ts` owns the canvas, the camera, the
 * keys and fingers, the loop and the doors into the games, and asks everything else of a scene, so
 * a second scene can be put on without `main.ts` knowing what is in it.
 *
 * A scene draws itself small, with `G.cam` as the top-left of what is on screen and `G.view` as
 * its size (both in `game.ts`, and both set by `main.ts`), and moves the member itself.
 */

import type { Ctx, Pt, Rect } from "@sequoia-leaf/kit/util.ts";

import type { GameId } from "./games.ts";

/** Which way the member is steering by hand: with the keys, or towards a finger held on the world. */
export interface Steer {
  dx: number;
  dy: number;
  /** A point in the world being dragged towards, if a finger is down. */
  toward: Pt | null;
}

/** What the pointer is resting on: a box to mark, and words about it if it has any. */
export interface Hover {
  box: Rect;
  tip: readonly [string, string] | null;
  /** A thing with a card of its own (a camp thing), which explains itself in place of the tip. */
  ref?: string | null;
}

export interface Scene {
  /** How far the camera may travel, in the scene's pixels: its width, and its top and bottom edges. */
  readonly bounds: { readonly w: number; readonly top: number; readonly bottom: number };
  /** The picture is to be this many of the scene's pixels across and down. */
  resize(w: number, h: number): void;
  /** The point the camera keeps in view. */
  focus(): Pt;
  /** A moment of time passing. */
  step(dt: number, steer: Steer | null): void;
  /** The scene as it is this moment, small: one of its pixels to a pixel. */
  draw(): HTMLCanvasElement;
  /** Its words, written over the enlarged picture at `px` canvas pixels to a font pixel. */
  words(ctx: Ctx, px: number): void;
  /**
   * A touch at a point in the scene, with a finger or the mouse. Says whether it was bare ground,
   * so that a drag may steer.
   */
  tap(x: number, y: number, finger: boolean): boolean;
  /** Where the pointer is resting, if anywhere. Says what is under it, and marks it in the picture. */
  point(at: Pt | null): Hover | null;
  /** The key for "use what I am standing at". */
  act(): void;
  /** The key for "put this away". */
  back(): void;
  /** Any other key, in lower case. Says whether the scene had a use for it. */
  key(k: string): boolean;
  /** A finger or the mouse, still down, has moved to a point in the scene. */
  drag(at: Pt): void;
  /** It has been lifted, at a point in the scene and over this part of the page. */
  release(at: Pt, over: Element | null): void;
  /** Whether the member may move about yet. */
  awake(): boolean;
  /** The member has come back out of a game. */
  cameBack(game: GameId): void;
}

/** What a scene asks of the stage it is on. */
export interface Stage {
  /**
   * Take the member into a game: the view closes in on `at` (a point in the scene), and the game
   * opens out of it.
   */
  goInside(game: GameId, at: Pt): void;
  /** Point the camera now, without easing. */
  snap(): void;
  /** Put another scene on in this one's place, at once. */
  put(next: Scene): void;
  /**
   * Walk from this place to another: night closes in on whoever is walking off, at its darkest
   * `swap` sets the next place up and it is put on, and then the night lifts on them walking in.
   */
  travel(next: Scene, swap: () => void): void;
}
