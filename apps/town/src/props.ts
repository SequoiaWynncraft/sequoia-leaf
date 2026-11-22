/**
 * Things that stand in a place and can be touched: what one is, the lights some of them give, how
 * to find the one under a point, and the flame several of them burn with. The town's furniture and
 * a camp's are both made of these.
 */

import { R } from "@sequoia-leaf/kit/pix.ts";
import { type Ctx, type Pt, type Rect } from "@sequoia-leaf/kit/util.ts";

import { G } from "./game.ts";
import type { Sprite } from "./sprites.ts";

export interface Prop {
  kind: string;
  /** Where its picture's foot goes, and where it sorts among the people (lower down is nearer). */
  x: number;
  y: number;
  z: number;
  sprite: Sprite | null;
  hit: Rect | null;
  /** The door it is part of: touching it goes there (`touch.ts`). */
  place: string | null;
  /** When it was last touched: things shiver or hop for a moment after. */
  bumpAt: number;
  hops: boolean;
  tap: ((p: Prop, wx: number, wy: number) => void) | null;
  /** Anything drawn over the picture each frame, given the picture's foot on screen. */
  extra: ((g: Ctx, sx: number, sy: number) => void) | null;
  /** What it is, for whoever points at it: a name and a line, or a card of its own. */
  tip: readonly [string, string] | null;
  ref: string | null;
}

export interface Light {
  x: number;
  y: number;
  r: number;
  power: number;
  /** Raised by a touch, and dying away. */
  boost: number;
  phase: number;
}

/** Something else that stands among the people and is drawn in its turn, far to near. */
export interface Standing {
  readonly z: number;
  paint(g: Ctx, cx: number, cy: number): void;
}

/** A prop with everything it may leave out filled in. */
export function makeProp(kind: string, sprite: Sprite | null, x: number, y: number, o: Partial<Prop> = {}): Prop {
  return {
    kind,
    x,
    y,
    z: y,
    sprite,
    hit: sprite ? { x: x - sprite.ax, y: y - sprite.ay, w: sprite.c.width, h: sprite.c.height } : null,
    place: null,
    bumpAt: -9,
    hops: false,
    tap: null,
    extra: null,
    tip: null,
    ref: null,
    ...o,
  };
}

const masks = new Map<HTMLCanvasElement, Uint8ClampedArray>();
function solidAt(s: Sprite, x: number, y: number): boolean {
  let m = masks.get(s.c);
  if (!m) {
    const g = s.c.getContext("2d");
    if (!g) return true;
    m = g.getImageData(0, 0, s.c.width, s.c.height).data;
    masks.set(s.c, m);
  }
  const px = Math.floor(x);
  const py = Math.floor(y);
  if (px < 0 || py < 0 || px >= s.c.width || py >= s.c.height) return false;
  return (m[(py * s.c.width + px) * 4 + 3] ?? 0) > 40;
}

/** How wide a member's head is, and how far down from the top of it their head and chest go, in a place's pixels. */
const HEAD_W = 8;
const CHEST = 12;

/**
 * How much of a member's head and chest something in front covers, 0 to 1: `solid` says where the
 * thing is, `foot` is the middle of the member's feet and `tall` how far above them their head
 * tops out. Legs behind a bush are none of it; a head and chest behind a canopy are all of it.
 */
export function covered(solid: (x: number, y: number) => boolean, foot: Pt, tall: number): number {
  let n = 0;
  for (let dy = 0; dy < CHEST; dy++)
    for (let dx = 0; dx < HEAD_W; dx++) if (solid(foot.x - HEAD_W / 2 + dx, foot.y - tall + dy)) n++;
  return n / (HEAD_W * CHEST);
}

/** How much of a member a thing's picture covers (`covered`). */
export function cover(p: Prop, foot: Pt, tall: number): number {
  const s = p.sprite;
  if (!s) return 0;
  const x = p.x - s.ax;
  const y = p.y - s.ay;
  // Nowhere near them: not looked at pixel by pixel.
  if (foot.x + HEAD_W <= x || foot.x - HEAD_W >= x + s.c.width || foot.y <= y || foot.y - tall >= y + s.c.height)
    return 0;
  return covered((wx, wy) => solidAt(s, wx - x, wy - y), foot, tall);
}

/**
 * Whether a member is hidden, by how much of their head and chest is covered: half or more. One
 * who was hidden a moment ago stays so down to a quarter, so that walking along an edge does not
 * open and close their window over and over.
 */
export const hidden = (share: number, was: boolean): boolean => share >= (was ? 0.25 : 0.5);

/** A member showing through what stands in front: the middle of their figure, and how far the window round them has opened, 0 to 1. */
export interface Through extends Pt {
  open: number;
}

/** How far a window reaches from the middle of a figure, across and up and down, to the outside of its edge. */
export const WINDOW = { w: 9, h: 16 } as const;

/**
 * Whether a pixel of something in front of members is left out of it, so that they show: a window
 * round each, the shape of a figure, with an edge dithered in the place's own pixels (every other
 * pixel, then every fourth). Windows that are near one another run together into one.
 */
export function parted(x: number, y: number, through: readonly Through[]): boolean {
  let f = 0;
  for (const t of through) {
    const dx = (x - t.x) / WINDOW.w;
    const dy = (y - t.y) / WINDOW.h;
    if (dx * dx + dy * dy < t.open * t.open) f += t.open - Math.sqrt(dx * dx + dy * dy);
  }
  return f > 0.26 || (f > 0.12 && (x + y) % 2 === 0) || (f > 0 && x % 2 === 0 && y % 2 === 0);
}

/** The thing under a point, nearest the eye first. Only what can be touched counts. */
export function propUnder(props: readonly Prop[], wx: number, wy: number): Prop | null {
  let best: Prop | null = null;
  for (const p of props) {
    if (!p.hit || !p.tap) continue;
    const small = p.hit.w < 16;
    const pad = small ? 3 : 0;
    if (wx < p.hit.x - pad || wy < p.hit.y - pad || wx >= p.hit.x + p.hit.w + pad || wy >= p.hit.y + p.hit.h + pad)
      continue;
    if (!small && p.sprite && !solidAt(p.sprite, wx - p.hit.x, wy - p.hit.y)) continue;
    if (!best || p.z > best.z) best = p;
  }
  return best;
}

/** A flame, licking: its foot at `x`, `y`, so wide at the foot and so tall. */
export function flame(g: Ctx, x: number, y: number, w: number, h: number, col: string, ph: number): void {
  for (let r = 0; r < h; r++) {
    const k = r / h;
    const half = w * (1 - k) ** 0.8 * (0.85 + 0.15 * Math.sin(G.t * 17 + r * 0.9 + ph));
    const sway = Math.sin(G.t * 9 + r * 0.55 + ph) * k * 2.2;
    const x0 = Math.round(x + sway - half);
    const x1 = Math.round(x + sway + half);
    if (x1 > x0) R(g, x0, Math.round(y - r), x1 - x0, 1, col);
  }
}
