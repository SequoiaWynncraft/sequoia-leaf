/**
 * You: the player's own figure in their own yard, drawn from their own skin (the kit's figure, as
 * the town draws them), standing at the depot's door when the Works opens. You walk it round the
 * yard by the keys or by a tap on the ground (`character.ts`), round whatever stands (the rules'
 * `footing.ts`), and the view goes with you (`camera.ts`, by `follow.ts`). In a visit there is no
 * figure of yours, nor on a review page's own yard: the view moves as it always has.
 *
 * Nothing here touches the camera, the input or the scene: they ask this module where you are, step
 * you each frame, and draw you among what stands.
 */
import { type Land, NONE, type Place, type Solid, TILE_PX, type Yard, yardSolid } from "@sequoia-leaf/factory";
import { bake, type Body, FOOT_X, FOOT_Y, lookFor, paintSkin, posed, skinFigure } from "@sequoia-leaf/kit/skin.ts";
import { makeCanvas, must } from "@sequoia-leaf/kit/util.ts";

import type { Ground } from "../art/ground.ts";
import { S } from "../state.ts";
import { Character } from "./character.ts";
import { dot, Dust, floorOf } from "./dust.ts";
import { SHADE } from "./feel.ts";
import { squaresOf } from "./way.ts";

/** Your figure, its look (once it has come), the dust its feet raise, and the plot it stands on (a place in the land's list, or `NONE`). */
interface You {
  readonly character: Character;
  body: Body | null;
  readonly dust: Dust | null;
  plot: number;
}

const here: { you: You | null } = { you: null };

/** Your figure, or nothing: in a visit, on a review page's own yard, or before the yard has opened. */
export const you = (): Character | null => here.you?.character ?? null;

/** Where you stand when the Works opens: on the doorstep of the depot. */
export const doorOf = (land: Land): Place => ({ x: land.depot[0] * TILE_PX + 8, y: (land.depot[1] + 2) * TILE_PX + 3 });

/** What is solid in each yard the page has held, read from it as it stands now (`yardSolid`). */
const solids = new WeakMap<Yard, Solid>();
function solidOf(y: Yard): Solid {
  let s = solids.get(y);
  if (!s) {
    s = yardSolid(y);
    solids.set(y, s);
  }
  return s;
}

/** The plot a place is on, as a place in the land's list; `NONE` off the map. */
function plotAt(land: Land, p: Place): number {
  const [tx, ty] = [Math.floor(p.x / TILE_PX), Math.floor(p.y / TILE_PX)];
  return tx < 0 || ty < 0 || tx >= land.w || ty >= land.h ? NONE : (land.plot[ty * land.w + tx] ?? NONE);
}

/** The plot you stand on, as the land has it, or nothing without a figure. */
export function yourPlot(): number | null {
  const y = here.you;
  return y ? plotAt(S.world.land, y.character) : null;
}

/**
 * Puts you at a place of the yard, with no look yet and nothing raised by your feet: what `arrive`
 * does on a page, and the tests do without one. Gives back your figure.
 */
export function placeYou(at: Place, ground: Ground | null = null): Character {
  const dust = ground ? new Dust(floorOf(ground)) : null;
  const character = new Character(at.x, at.y, () => {}, {
    step: (run) => dust?.footfall(character, run),
    pullUp: () => dust?.pullUp(character),
    bump: () => dust?.bump(character),
    aside: () => dust?.aside(character),
  });
  here.you = { character, body: null, dust, plot: plotAt(S.world.land, at) };
  return character;
}

/** You leave the yard: there is no figure of yours (a test's own yard, put back). */
export function leave(): void {
  here.you = null;
}

/**
 * You come into your own yard, at the depot's door: wearing a look of your own at once (`lookFor`,
 * the one the town gives somebody with no skin) and your own skin once it has come. Not in a visit,
 * nor on a review page's own yard. Gives back whether you came.
 */
export function arrive(who: { readonly id: string; readonly name: string }, ground: Ground): boolean {
  if (S.visiting || S.alone) return false;
  const mine = comeIn(who.name, ground);
  skinFigure(who.id, (body) => {
    mine.body = body;
  });
  return true;
}

/** You stand at the depot's door wearing the look the town gives `name` with no skin: as you arrive, and on a review page's own yard. */
export function comeIn(name: string, ground: Ground | null): You {
  placeYou(doorOf(S.world.land), ground);
  const mine = must(here.you, "you, just placed");
  mine.body = bake(paintSkin(lookFor(name)));
  return mine;
}

/** You are put back at the depot's door, as when the Works opens: a yard was put in place of the one you stood in. */
export function backToDoor(): void {
  const at = doorOf(S.world.land);
  here.you?.character.put(at.x, at.y);
}

/**
 * Sets off for a point of the yard, round whatever stands, looking at every square of the land for
 * the way: as near as there is a way to. Gives back whether there is anywhere to go.
 */
export function walkTo(x: number, y: number): boolean {
  const { land } = S.world;
  return here.you?.character.goTo(solidOf(S.world), x, y, squaresOf(land.w, land.h)) ?? false;
}

/** You stop where you were going: the yard is put away behind the settings menu, or the window lost the focus. */
export function halt(): void {
  here.you?.character.halt();
}

/** A frame of `dt` seconds: you go where the keys or your way take you, and your dust lives. Gives back whether the plot you stand on changed. */
export function stepYou(dt: number): boolean {
  const y = here.you;
  if (!y) return false;
  y.character.step(dt, solidOf(S.world));
  y.dust?.step(dt);
  const plot = plotAt(S.world.land, y.character);
  if (plot === y.plot) return false;
  y.plot = plot;
  return true;
}

/** Lists a picture among what stands: its corner in the picture, how near it stands, and how much of it shows. */
export type Put = (c: HTMLCanvasElement, x: number, y: number, z: number, a?: number) => void;

/** The shade under you, as the town lays one under somebody standing: whole, or smaller while a hop has you off the ground. */
const shades = new Map<boolean, HTMLCanvasElement>();
function shadeOf(up: boolean): HTMLCanvasElement {
  let c = shades.get(up);
  if (!c) {
    const { c: made, g } = makeCanvas(8, 4);
    const lift = up ? 1 : 0;
    g.fillStyle = SHADE;
    g.fillRect(lift, 1, 8 - lift * 2, 2);
    g.fillRect(1 + lift, 0, 6 - lift * 2, 1);
    g.fillRect(1 + lift, 3, 6 - lift * 2, 1);
    c = made;
    shades.set(up, c);
  }
  return c;
}

/** The ring where you are walking to, at each of its sizes, a pixel at a time round it. */
const rings = new Map<number, HTMLCanvasElement>();
function ringOf(r: number): HTMLCanvasElement {
  let c = rings.get(r);
  if (!c) {
    const size = r * 2 + 3;
    const { c: made, g } = makeCanvas(size, size);
    const dots = Math.max(8, Math.round(r * 3));
    g.fillStyle = "#ffd98a";
    for (let i = 0; i < dots; i++) {
      const a = (i / dots) * Math.PI * 2;
      g.fillRect(Math.round(r + 1 + Math.cos(a) * r), Math.round(r + 1 + Math.sin(a) * r * 0.55), 1, 1);
    }
    c = made;
    rings.set(r, c);
  }
  return c;
}

/**
 * Draws you among what stands (`put`, with the picture's corner at `cx`, `cy` in the yard): the ring
 * where you are walking to, on the ground; the shade at your feet; you, ordered by the row of your
 * feet; and the dust your feet raised, each bit just behind whatever stands on the row it rose from.
 */
export function drawYou(put: Put, cx: number, cy: number): void {
  const y = here.you;
  if (!y?.body) return;
  const c = y.character;
  const bound = c.bound;
  if (bound) {
    const ring = ringOf(3 + Math.round(Math.sin(S.t * 9)));
    const r = (ring.width - 3) / 2;
    put(ring, Math.round(bound.x) - r - 1 - cx, Math.round(bound.y) - r - 1 - cy, bound.y - TILE_PX);
  }
  const [x, foot] = [Math.round(c.x), Math.round(c.y)];
  put(shadeOf(c.lift > 2), x - 4 - cx, foot - 2 - cy, c.y - 3);
  const frame = posed(y.body, c.way, c.pose);
  if (frame) put(frame, x - FOOT_X - cx, Math.round(c.y - c.lift) - FOOT_Y - cy, c.y);
  for (const b of y.dust?.bits ?? []) {
    const size = Dust.sizeOf(b);
    const inset = (b.size - size) / 2;
    put(dot(b.colour, size), Math.round(b.x + inset) - cx, Math.round(b.y + inset) - cy, b.row - 0.5);
  }
}
