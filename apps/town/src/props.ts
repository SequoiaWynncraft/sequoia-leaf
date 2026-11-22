/**
 * Things that stand in a place and can be touched: what one is, the lights some of them give, how
 * to find the one under a point, and the flame several of them burn with. The town's furniture and
 * a camp's are both made of these.
 */

import { R } from "@sequoia-leaf/kit/pix.ts";
import { type Ctx, type Rect } from "@sequoia-leaf/kit/util.ts";

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
  /** What it does when touched at a point: `own` when the member touched it, not another player in the room. */
  tap: ((p: Prop, wx: number, wy: number, own: boolean) => void) | null;
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
