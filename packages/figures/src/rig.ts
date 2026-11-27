/**
 * A person on a rig: the pieces of a skin (`Parts` in the kit's `skin.ts`: head, body, an arm, a
 * leg) put together at joints (neck, shoulders, hips) and posed, at the size the town draws people.
 * A `Stance` says how each piece is held; `rigPic` draws it, with the figure's dark edge.
 *
 * Each piece is the town's, at the town's width (`bake`), so standing at rest from the front a
 * person here is the town's front picture of them pixel for pixel. A limb swings at its joint as
 * the whole piece, turned to one of sixteen angles a pixel at a time, so it keeps its width and
 * never thins to a line; everything else moves by whole pixels. What a figure does over time is a
 * run of stances (`acts.ts`).
 */
import { INK } from "@sequoia-leaf/kit/palette.ts";
import { flipped, outlineInPlace } from "@sequoia-leaf/kit/pix.ts";
import type { Body, Parts } from "@sequoia-leaf/kit/skin.ts";
import { type Ctx, makeCanvas } from "@sequoia-leaf/kit/util.ts";

/**
 * How a person is held. Limbs are in sixteenths of a turn from hanging straight down: seen from the
 * front, out to its own side (4 is straight out, 8 straight up); seen from the side, forward (and
 * less than 0, back).
 */
export interface Stance {
  /** Seen from the front, or from the side, facing the way it goes. */
  readonly view: "front" | "side";
  /** The side it leads with: ours left, or right. */
  readonly left: boolean;
  /** The arm and the leg on the side it leads with, and the other two. */
  readonly arm: number;
  readonly offArm: number;
  readonly leg: number;
  readonly offLeg: number;
  /** From the front, how far the head is turned to the side it leads with: at us, half, or all the way. */
  readonly turn: 0 | 1 | 2;
  /** Pixels the head is dropped (chin down), or less than 0, lifted. */
  readonly nod: number;
  /** Pixels everything above the legs is lowered (knees bent), and moved toward the side it leads with (its weight). */
  readonly sink: number;
  readonly sway: number;
  /** Lying down, its head toward the side it leads with. */
  readonly lie: boolean;
}

export const REST: Stance = {
  view: "front",
  left: false,
  arm: 0,
  offArm: 0,
  leg: 0,
  offLeg: 0,
  turn: 0,
  nod: 0,
  sink: 0,
  sway: 0,
  lie: false,
};

/** The size of a posed picture, and the pixel in it under the figure's feet; how tall and wide a person stands. */
export const RIG = { w: 28, h: 24, ax: 14, ay: 22, tall: 19, wide: 8 } as const;
/** Where the shoulders, the hips and the head's top are above the feet, and how long an arm is. */
const SHOULDER = -11;
const HIP = -5;
const HEAD = -19;
const ARM = 6;

interface Pt {
  readonly x: number;
  readonly y: number;
}

/** How far down a limb its joint is: an arm turns a pixel into the shoulder, a leg at its top. */
const ARM_JOINT = 1;
const LEG_JOINT = 0;

/** Which way a limb points at an angle, a pixel along it, and a pixel across it (to our right at rest); `fwd` is which way a positive angle swings. */
function turned(angle: number, fwd: 1 | -1): { readonly along: Pt; readonly across: Pt } {
  const a = (Math.round(angle) * Math.PI) / 8;
  const sin = Math.round(Math.sin(a) * 1e9) / 1e9;
  const cos = Math.round(Math.cos(a) * 1e9) / 1e9;
  return { along: { x: fwd * sin, y: cos }, across: { x: cos, y: -fwd * sin } };
}

/**
 * Draws a limb turned about its joint as the whole piece it is: `pic` holds it two pixels wide and
 * hanging down (`sx` its first column), `lx`, `top` where its corner is at rest, `joint` how far
 * down it the joint is. Every pixel round the joint takes the limb's pixel that turning it back
 * puts under the pixel's middle, so the piece keeps its width at any angle and has no holes.
 */
function limb(
  g: Ctx,
  pic: HTMLCanvasElement,
  sx: number,
  lx: number,
  top: number,
  joint: number,
  angle: number,
  fwd: 1 | -1,
): void {
  const { along, across } = turned(angle, fwd);
  const jx = lx + 1;
  const jy = top + joint;
  const reach = pic.height + 2;
  for (let dy = -reach; dy <= reach; dy++)
    for (let dx = -reach; dx <= reach; dx++) {
      const px = dx + 0.5;
      const py = dy + 0.5;
      const u = Math.floor(px * across.x + py * across.y + 1);
      const v = Math.floor(px * along.x + py * along.y + joint);
      if (u < 0 || u > 1 || v < 0 || v >= pic.height) continue;
      g.drawImage(pic, sx + u, v, 1, 1, jx + dx, jy + dy, 1, 1);
    }
}

/** The head seen from the front, its corner at `sway`, `y`: at us, half turned or turned all the way to the side it leads with. */
function head(g: Ctx, p: Parts, s: Stance, sway: number, y: number): void {
  const beside = s.left ? p.headL : p.headR;
  if (s.turn === 2) g.drawImage(beside, -4 + sway, y);
  else if (s.turn === 1) {
    // Half turned: the face a pixel over, and a pixel of the side of the head come round behind it.
    g.drawImage(p.headF, s.left ? 1 : 0, 0, 7, 8, -4 + sway + (s.left ? 0 : 1), y, 7, 8);
    g.drawImage(beside, s.left ? 0 : 7, 0, 1, 8, sway + (s.left ? 3 : -4), y, 1, 8);
  } else g.drawImage(p.headF, -4 + sway, y);
}

/** Seen from the front: both arms and both legs, the head at us or turned. */
function fromFront(g: Ctx, body: Body, s: Stance): void {
  const p = body.parts;
  const d = s.left ? -1 : 1;
  const sway = Math.round(s.sway) * d;
  const top = Math.round(s.sink);
  // The sheet holds the right-hand limbs, which seen from the front are on our left.
  const sides = [
    { on: -1, arm: p.armF, leg: p.legF, lx: -2, ax: -4 },
    { on: 1, arm: flipped(p.armF), leg: flipped(p.legF), lx: 0, ax: 2 },
  ] as const;
  for (const side of sides) limb(g, side.leg, 0, side.lx, HIP, LEG_JOINT, side.on === d ? s.leg : s.offLeg, side.on);
  g.drawImage(p.bodyF, -2 + sway, SHOULDER + top);
  head(g, p, s, sway, HEAD + top + Math.round(s.nod));
  for (const side of sides)
    limb(g, side.arm, 0, side.ax + sway, SHOULDER + top, ARM_JOINT, side.on === d ? s.arm : s.offArm, side.on);
}

/** Seen from the side it faces: the far arm and leg behind, the near ones in front, each swinging about its joint. */
function fromSide(g: Ctx, body: Body, s: Stance): void {
  const p = body.parts;
  const d = s.left ? -1 : 1;
  const sway = Math.round(s.sway) * d;
  const top = Math.round(s.sink);
  const arm = s.left ? flipped(p.armO) : p.armO;
  const leg = s.left ? flipped(p.legO) : p.legO;
  // The leg's picture is both legs side by side: its front half leads.
  limb(g, leg, s.left ? 2 : 0, s.left ? 0 : -2, HIP, LEG_JOINT, s.offLeg, d);
  limb(g, arm, 0, -1 + sway, SHOULDER + top, ARM_JOINT, s.offArm, d);
  limb(g, leg, s.left ? 0 : 2, s.left ? -2 : 0, HIP, LEG_JOINT, s.leg, d);
  g.drawImage(s.left ? p.bodyL : p.bodyR, -2 + sway, SHOULDER + top);
  g.drawImage(s.left ? p.headL : p.headR, -4 + sway, HEAD + top + Math.round(s.nod));
  limb(g, arm, 0, -1 + sway, SHOULDER + top, ARM_JOINT, s.arm, d);
}

/** Where the hand of an arm held at `angle` is, from the figure's feet: the leading arm's, or (`off`) the other. */
function hand(s: Stance, angle: number, off: boolean): Pt {
  const d = s.left ? -1 : 1;
  const side = off === s.left ? 1 : -1;
  const { along } = turned(angle, s.view === "front" ? side : d);
  const reach = ARM - ARM_JOINT - 0.5;
  const x = (s.view === "front" ? 3 * side : 0) + Math.round(s.sway) * d;
  return {
    x: Math.floor(x + along.x * reach),
    y: Math.floor(SHOULDER + Math.round(s.sink) + ARM_JOINT + along.y * reach),
  };
}

/** Where the hand of the leading arm is, from the figure's feet: where something it throws leaves it. */
export const handOf = (s: Stance): Pt => hand(s, s.arm, false);

/** Halfway between its two hands, from its feet: where it holds something in both. */
export function handsOf(s: Stance): Pt {
  const one = hand(s, s.arm, false);
  const other = hand(s, s.offArm, true);
  return { x: Math.round((one.x + other.x) / 2), y: Math.round((one.y + other.y) / 2) };
}

const keyOf = (s: Stance): string =>
  [s.view, s.left, s.arm, s.offArm, s.leg, s.offLeg, s.sink, s.sway, s.nod]
    .map((n) => (typeof n === "number" ? Math.round(n) : n))
    .join() + `,${s.turn}${s.lie}`;

/** Every picture drawn of a body so far, by its stance. A fight uses a few hundred. */
const drawn = new WeakMap<Body, Map<string, HTMLCanvasElement>>();
const MOST = 800;

/** A person in a stance, with the dark edge: `RIG.w` by `RIG.h`, its feet over the pixel at `RIG.ax`, `RIG.ay`. */
export function rigPic(body: Body, s: Stance): HTMLCanvasElement {
  let pics = drawn.get(body);
  if (!pics) {
    pics = new Map();
    drawn.set(body, pics);
  }
  const key = keyOf(s);
  const had = pics.get(key);
  if (had) return had;
  if (pics.size >= MOST) pics.clear();
  const up = makeCanvas(RIG.w, RIG.h);
  up.g.translate(RIG.ax, RIG.ay);
  if (s.view === "front") fromFront(up.g, body, s);
  else fromSide(up.g, body, s);
  const { c, g } = makeCanvas(RIG.w, RIG.h);
  if (s.lie) {
    // A quarter turn about the middle of the body, laid on the ground: every pixel stays a pixel.
    const d = s.left ? -1 : 1;
    g.setTransform(0, d, -d, 0, RIG.ax, RIG.ay - 4);
    g.drawImage(up.c, -RIG.ax, 9 - RIG.ay);
    g.setTransform(1, 0, 0, 1, 0, 0);
  } else g.drawImage(up.c, 0, 0);
  outlineInPlace(c, g, INK);
  pics.set(key, c);
  return c;
}
