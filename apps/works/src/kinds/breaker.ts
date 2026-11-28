/**
 * The breaker on the page (tier 5): a brick-footed iron hopper of two tiles by two, seen from above
 * with two toothed drums in it that turn toward each other while it breaks, and a short chute at the
 * left tile of its front, its way out. Stopped, the drums stand still and the thing it holds sits in
 * the chute's mouth, so what is stuck can be seen. Each thing it breaks lets go a small grey puff, the
 * one sign of the smog it makes: at grade III a steady thread. Its card says how much salvage it
 * breaks a minute and shows its mix of 20, the next picked out.
 */
import { BREAKER, isItem, MIX_OF, mixPerMinute, outsAs } from "@sequoia-leaf/factory";
import type { Row, Stat } from "@sequoia-leaf/kit/card.ts";
import { lessMotion } from "@sequoia-leaf/kit/dom.ts";
import { perMinute } from "@sequoia-leaf/kit/say.ts";
import { makeCanvas } from "@sequoia-leaf/kit/util.ts";

import { TILE } from "../art/belts.ts";
import { CLAY, IRON } from "../art/pal.ts";
import { puff } from "../fx.ts";
import { itemRef } from "../ui/refs.ts";
import type { KindPage } from "./kind.ts";

/** How far the picture reaches past the piece's box on each side, for its chute, and above it, for its height. */
const PAD = 6;
const TALL = 6;
const BOX = TILE * 2;
/** The drums' frames while it breaks. */
const FRAMES = 3;

/** A filled box. */
const box = (g: CanvasRenderingContext2D, col: string, x: number, y: number, w: number, h: number): void => {
  g.fillStyle = col;
  g.fillRect(x, y, w, h);
};

/** A drum seen from above: iron, its teeth bars that slide `toward` the gap between the two by `phase`. */
function drum(g: CanvasRenderingContext2D, x: number, y: number, toward: 1 | -1, phase: number): void {
  box(g, IRON[2], x, y, 8, 14);
  box(g, IRON[3], x, y, 8, 1);
  for (let k = 0; k < 4; k++) {
    const bx = x + ((k * 3 + phase * toward + 30) % 9);
    if (bx >= x && bx < x + 8) box(g, IRON[4], bx, y + 1, 1, 13);
  }
  box(g, IRON[1], x, y + 13, 8, 1);
}

/** The chute at the way out: on the out tile's side `way`, a short iron trough with a dark mouth. */
function chute(g: CanvasRenderingContext2D, tx: number, ty: number, way: number): void {
  const [x, y, w, h] =
    way === 0
      ? [tx + 15, ty + 4, 6, 7]
      : way === 1
        ? [tx + 4, ty + 15, 7, 6]
        : way === 2
          ? [tx - 5, ty + 4, 6, 7]
          : [tx + 4, ty - 5, 7, 6];
  box(g, IRON[1], x, y, w, h);
  box(g, IRON[3], x + 1, y + 1, w - 2, h - 2);
  box(g, IRON[0], x + 2, y + 2, w - 4, h - 4);
}

/** The bands round its hopper by grade: plain iron, copper rivets, a copper band and rivets. */
function grade(g: CanvasRenderingContext2D, at: number, n: number): void {
  if (n >= 3) box(g, CLAY[0], PAD + 2, at + 2, BOX - 4, 1);
  if (n >= 2) for (let x = PAD + 4; x < PAD + BOX - 4; x += 5) box(g, CLAY[1], x, at + 3, 1, 1);
}

/** The breaker's picture, its box at (PAD, PAD + TALL), its chute on tile (`ox`, `oy`) of its box toward `way`. */
function picture(n: number, ox: number, oy: number, way: number, phase: number): HTMLCanvasElement {
  const { c, g } = makeCanvas(BOX + PAD * 2, BOX + PAD * 2 + TALL);
  const top = PAD;
  const foot = PAD + TALL + BOX;
  // The brick foot: three courses, the joints staggered.
  box(g, CLAY[1], PAD + 1, foot - 7, BOX - 2, 7);
  for (let row = 0; row < 3; row++) {
    box(g, CLAY[0], PAD + 1, foot - 7 + row * 2 + 1, BOX - 2, 1);
    for (let x = PAD + 2 + (row % 2) * 3; x < PAD + BOX - 2; x += 6) box(g, CLAY[0], x, foot - 7 + row * 2, 1, 1);
  }
  // The hopper: its front wall, its rim and the dark opening the drums turn in.
  box(g, IRON[2], PAD + 2, foot - 13, BOX - 4, 6);
  grade(g, foot - 13, n);
  box(g, IRON[4], PAD + 2, top, BOX - 4, BOX + TALL - 13);
  box(g, IRON[3], PAD + 4, top + 2, BOX - 8, BOX + TALL - 17);
  box(g, IRON[0], PAD + 6, top + 3, BOX - 12, BOX + TALL - 20);
  drum(g, PAD + 7, top + 4, 1, phase);
  drum(g, PAD + BOX - 15, top + 4, -1, phase);
  chute(g, PAD + ox * TILE, PAD + TALL + oy * TILE, way);
  return c;
}

/** Each picture, made once: by grade, way out and frame of the drums. */
const pictures = new Map<string, HTMLCanvasElement>();
function pictureOf(n: number, ox: number, oy: number, way: number, phase: number): HTMLCanvasElement {
  const key = `${n}:${ox}:${oy}:${way}:${phase}`;
  const had = pictures.get(key);
  if (had) return had;
  const made = picture(n, ox, oy, way, phase);
  pictures.set(key, made);
  return made;
}

/** Where its way out is, facing `d`, standing or about to be placed: as tiles of its box from its own tile (its box's corner), and the way things leave. */
export function outOf(d: number): readonly [number, number, number] {
  const o = outsAs(BREAKER, d)[0];
  return o ? [o.dx, o.dy, o.way] : [1, 0, d];
}

/** Where the chute's mouth is in the yard's pixels, from its box's corner. */
function mouth(x: number, top: number, ox: number, oy: number, way: number): readonly [number, number] {
  const tx = x + ox * TILE + TILE / 2;
  const ty = top + oy * TILE + TILE / 2;
  return [tx + (way === 0 ? 10 : way === 2 ? -10 : 0), ty + (way === 1 ? 10 : way === 3 ? -10 : 0)];
}

/** The 20 things of its mix in order, as a card's row of pictures; on a standing one, the next picked out. */
const mixRow = (label: string, next: number | null): Row[] => [
  {
    label,
    look: "icons",
    things: (MIX_OF[BREAKER]?.gives ?? []).map((k, n) => ({ ref: itemRef(k), lit: n === next })),
  },
];

export const breaker: KindPage = {
  picture: (_p, n) => pictureOf(n, 1, 0, 0, 0),
  draw(art, _y, at) {
    const [ox, oy, way] = outOf(at.d);
    const phase = at.working ? Math.floor(at.t * 10) % FRAMES : 0;
    at.put(pictureOf(at.grade, ox, oy, way, phase), at.x - PAD, at.top - PAD - TALL, at.z, at.a);
    // Stopped with a thing finished, it sits in the chute's mouth.
    if (at.real && !at.working && isItem(at.out)) {
      const [mx, my] = mouth(at.x, at.top, ox, oy, way);
      const pic = art.item(at.out);
      at.put(pic, Math.round(mx - pic.width / 2), Math.round(my - pic.height / 2), at.z + 0.01, at.a);
    }
    // Each thing it breaks lets go a puff of the smog it makes.
    if (at.real && at.working && !lessMotion() && at.t > (at.mem.puffAt[at.i] ?? 0)) {
      at.mem.puffAt[at.i] = at.t + 60 / Math.max(1, mixPerMinute(BREAKER, at.grade)) / Math.max(0.1, at.pace);
      puff(at.cx + at.seenX, at.top - TALL + 4 + at.seenY, 1, IRON[3], 6);
    }
    return at.top - TALL;
  },
  pointer: "bare",
  pace: (k, n): Stat => ({ label: "Breaks", value: perMinute(mixPerMinute(k, n)) }),
  rows: () => mixRow("Gives, in this order", null),
  standing: { rows: (p) => mixRow("Gives, in this order", p.mix) },
  holdsUp: () => MIX_OF[BREAKER]?.holds ?? 8,
  map: [CLAY[1], CLAY[0]],
  dot: CLAY[1],
  dock: 16,
  faces: true,
};
