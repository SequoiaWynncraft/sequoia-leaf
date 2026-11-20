/**
 * What every scene gives the app: where its world sits on the screen and at what scale, the world
 * it draws there, the HUD it draws on the HUD's grid, and how it answers taps and keys. The app owns
 * the canvases, the clock, the routes, the transitions, the menus and the art bundle; a scene owns
 * everything inside its world.
 */

import type { Art } from "../bundle/art.ts";
import { ambianceAt } from "../bundle/manifest.ts";
import type { Ambiance } from "../bundle/palette.ts";
import type { Grid, Point } from "../engine/view.ts";
import type { Params } from "../game/params.ts";
import type { Pull } from "../game/rules.ts";
import type { Store } from "../game/store.ts";

export type SceneId = "glade" | "forest" | "campfire";

export type PointerKind = "down" | "move" | "up" | "leave";

/** What a scene can ask of the app. */
export interface App {
  readonly params: Params;
  readonly store: Store;
  /** The art bundle (`grove-art/`, or `?art=`). */
  readonly art: Art;
  /** Go to a route (`glade`, `cones`, `spirits`...). */
  go(route: string): void;
  /** A short message in the mod's toast, read out to screen readers too. */
  say(text: string): void;
}

/** One opened cone, as a scene plays it. */
export type Opening = Pull & { verdant: boolean; fresh: boolean; count: number };

/** The screen a scene lays its world out on, in device pixels (on a phone, above the dock). */
export interface Screen {
  devW: number;
  devH: number;
  dpr: number;
  phone: boolean;
  /** The HUD's grid, which the world keeps clear of where it must. */
  hud: Grid;
}

export interface Scene {
  readonly id: SceneId;
  /** The world's grid on this screen. */
  grid(screen: Screen, t: number): Grid;
  /** Changes when the world must be laid out again (the glade's bundle arriving, say). */
  layoutKey?(): string;
  /** The page's colour round the world, when the world does not fill the screen. */
  pageColour?(): string;
  /** The grids changed: rebuild whatever depends on the screen's size. */
  resize(world: Grid, hud: Grid, t: number): void;
  /** One frame: the world into `world`, the HUD (on a transparent layer) into `hud`. */
  render(t: number, world: Uint32Array, hud: Uint32Array, fonts: boolean): void;
  /** A pointer event, in the world's grid and in the HUD's. */
  pointer(world: Point, hud: Point, kind: PointerKind, t: number, touch: boolean): void;
  key(key: string, t: number): void;
  /** The pointer's look over the scene. */
  readonly cursor: "default" | "pointer" | "grab" | "grabbing";
  /** A moment is playing (a reveal, a ceremony): the navigation steps back. */
  busy(t: number): boolean;
}

/** The light every scene plays in: `?time=` if given (`day` is dusk), otherwise the member's own clock. */
export function lightOf(params: Params, now: Date = new Date()): Ambiance {
  if (params.timeFromUrl) return params.time === "night" ? "night" : "dusk";
  return ambianceAt(now.getHours());
}
