/**
 * The board's look (`RAID-BOARD.md`): every tone of it is a tone of the kit's palette with dusk on
 * it (`dusk`, mixed toward `SKY[0]`), and a hex is cut into planed wood: a flat face, a one-pixel
 * groove, and a lip under the groove's upper edges. The table round it, the bench and the light on
 * it take their tones from here too, so the whole value budget is in one place (`board.test.ts`).
 *
 * It moves to the kit when a second game needs it.
 */
import { BARK, CORAL, CREAM, EARTH, GOLD, GREEN, PAPER, SKY, WATER } from "@sequoia-leaf/kit/palette.ts";
import { paint, R, rgb } from "@sequoia-leaf/kit/pix.ts";
import { type Ctx, makeCanvas } from "@sequoia-leaf/kit/util.ts";
import type { ClothId } from "@sequoia-leaf/raid";
import { CELLS } from "@sequoia-leaf/raid/hex.ts";

import { BOARD_H, BOARD_W, cellXY, HEX_H, HEX_W, SLOPE } from "../geometry.ts";

/** Two tones mixed: `k` of the way from `a` to `b`, each channel rounded. */
export function mixTone(a: string, b: string, k: number): string {
  const p = rgb(a);
  const q = rgb(b);
  const ch = (i: 0 | 1 | 2): string =>
    Math.round(p[i] + (q[i] - p[i]) * k)
      .toString(16)
      .padStart(2, "0");
  return `#${ch(0)}${ch(1)}${ch(2)}`;
}
/** A tone with dusk on it: `k` of the way to the darkest of the sky. */
export const dusk = (tone: string, k: number): string => mixTone(tone, SKY[0], k);

/** What a half of the board is made of: its face, the lip under a groove, the groove, and its outer edge. */
export interface HexTones {
  readonly face: string;
  readonly lip: string;
  readonly groove: string;
  readonly edge: string;
}
/** The board's tones and the light on it. */
export interface BoardTones {
  readonly near: HexTones;
  readonly far: HexTones;
  /** The stump's top round the board: its wood, a ring's line (and a crack), a pale fleck in a ring. */
  readonly wood: string;
  readonly ring: string;
  readonly fleck: string;
  /** How strong the warm pool over the board's middle is, and how big the hole in the dusk over the table. */
  readonly pool: number;
  readonly hole: readonly [w: number, h: number];
}

/** The edge round a half, where it meets the wood: as dark as the ink band allows a board tone. */
const HALF_EDGE = dusk(BARK[0], 0.3);

/** The design's faces: a pale paper with dusk on it, nearly grey. */
const PAPER_NEAR: HexTones = {
  face: dusk(PAPER[1], 0.56),
  lip: dusk(PAPER[1], 0.44),
  groove: dusk(EARTH[0], 0.3),
  edge: HALF_EDGE,
};
const PAPER_FAR: HexTones = {
  face: dusk(PAPER[0], 0.62),
  lip: dusk(PAPER[0], 0.5),
  groove: dusk(EARTH[0], 0.46),
  edge: HALF_EDGE,
};
/** The warmest faces the fill check allows: a honey gold with dusk on it. */
const GOLD_NEAR: HexTones = {
  face: dusk(GOLD[2], 0.6),
  lip: dusk(GOLD[2], 0.5),
  groove: dusk(EARTH[0], 0.3),
  edge: HALF_EDGE,
};
const GOLD_FAR: HexTones = {
  face: dusk(GOLD[1], 0.66),
  lip: dusk(GOLD[1], 0.58),
  groove: dusk(EARTH[0], 0.46),
  edge: HALF_EDGE,
};
const WOOD = { wood: dusk(GOLD[0], 0.65), ring: dusk(BARK[3], 0.55), fleck: dusk(GOLD[0], 0.58) } as const;
const LIT = { pool: 0.13, hole: [320, 256] } as const;

/** TEMPORARY, while the owner picks: the three warmth settings side by side (`?warmth=a|b|c`), each one step on from the last. */
const WARM_NEAR: BoardTones = { near: GOLD_NEAR, far: PAPER_FAR, ...WOOD, ...LIT };
const WARMTH: Readonly<Record<string, BoardTones>> = {
  // The light alone: the pool and the hole raised, the design's faces.
  a: { near: PAPER_NEAR, far: PAPER_FAR, ...WOOD, ...LIT },
  // And your half warm.
  b: WARM_NEAR,
  // And both halves warm.
  c: { near: GOLD_NEAR, far: GOLD_FAR, ...WOOD, ...LIT },
};
const ASKED = new URLSearchParams(globalThis.location?.search ?? "").get("warmth") ?? "b";
export const BOARD: BoardTones = WARMTH[ASKED] ?? WARM_NEAR;

/** A cloth laid under the board: its halves' tones, the ground round and between them, the nap in it, and the trim two pixels in from its edge. */
export interface ClothTones {
  readonly near: HexTones;
  readonly far: HexTones;
  readonly ground: string;
  readonly nap: string;
  readonly trim: string;
}
/** The red of the gingham's checks. */
const CHECK_RED = "#b0483a";
/**
 * The cloths a member may buy, each the board's own material: its values in the board's band, its
 * hue and ornament its own. Baize is as dark as it is because the brambles sink into any mid green;
 * velvet is the one ground no figure sinks into; gingham's checks are round and between the halves
 * only, its faces the bare board's.
 */
export const CLOTHS = {
  baize: {
    near: {
      face: dusk(GREEN[3], 0.5),
      lip: dusk(GREEN[3], 0.4),
      groove: dusk(GREEN[0], 0.45),
      edge: dusk(GREEN[0], 0.6),
    },
    far: {
      face: dusk(GREEN[2], 0.5),
      lip: dusk(GREEN[2], 0.4),
      groove: dusk(GREEN[0], 0.55),
      edge: dusk(GREEN[0], 0.6),
    },
    ground: dusk(GREEN[0], 0.35),
    nap: dusk(GREEN[1], 0.4),
    trim: dusk(GREEN[3], 0.4),
  },
  plum: {
    near: { face: dusk(SKY[4], 0.42), lip: dusk(SKY[4], 0.32), groove: dusk(SKY[2], 0.4), edge: SKY[0] },
    far: { face: dusk(SKY[4], 0.58), lip: dusk(SKY[4], 0.48), groove: dusk(SKY[2], 0.5), edge: SKY[0] },
    ground: dusk(SKY[2], 0.35),
    nap: dusk(SKY[3], 0.45),
    trim: dusk(GOLD[0], 0.3),
  },
  gingham: {
    near: { ...BOARD.near, groove: dusk(CHECK_RED, 0.4), edge: dusk(CHECK_RED, 0.55) },
    far: { ...BOARD.far, groove: dusk(CHECK_RED, 0.5), edge: dusk(CHECK_RED, 0.55) },
    ground: dusk(PAPER[2], 0.5),
    nap: dusk(CORAL, 0.5),
    trim: dusk(CHECK_RED, 0.3),
  },
} as const satisfies Readonly<Record<Exclude<ClothId, "bare">, ClothTones>>;
/** The gingham's third check, the darkest. */
export const CHECK = dusk(CHECK_RED, 0.3);
/** The board's halves as a cloth has them, or the bare board's. */
export const halvesOf = (cloth: ClothId): { near: HexTones; far: HexTones } =>
  cloth === "bare" ? BOARD : CLOTHS[cloth];

/** The rim band round the stump's top (pale, dark). */
export const RIM = { pale: dusk(BARK[4], 0.25), dark: dusk(BARK[2], 0.2) } as const;
/** The bench: its plank, the plank's top line, its foot, the slats along it, and the nails at its ends. */
export const BENCH = {
  plank: dusk(BARK[3], 0.4),
  top: dusk(BARK[4], 0.34),
  foot: dusk(BARK[1], 0.4),
  slat: dusk(BARK[2], 0.4),
  nail: dusk(GOLD[0], 0.3),
} as const;

/** A fight's board: the lip gone into the face, and the groove mixed 45% of the way to it. */
export const quietOf = (t: HexTones): HexTones => ({ ...t, lip: t.face, groove: mixTone(t.groove, t.face, 0.45) });

// ---------- the hex ----------

/** Half the width of a hex at one of its rows, counted from its top point. */
export function halfWidth(row: number): number {
  if (row < 0 || row >= HEX_H) return 0;
  const steep = HEX_W / 2 / SLOPE;
  if (row < SLOPE) return (row + 1) * steep;
  if (row >= HEX_H - SLOPE) return (HEX_H - row) * steep;
  return HEX_W / 2;
}
/** Whether a pixel, counted from the hex's left edge and top point, is in the hex. */
const inside = (x: number, y: number): boolean => {
  const hw = halfWidth(y);
  return x >= HEX_W / 2 - hw && x < HEX_W / 2 + hw;
};
export type Part = "face" | "lip" | "groove";
/**
 * What a pixel of a hex is: groove where nothing of the hex is above it, below it or to its right
 * (the four slanted edges and the right side: the left side is the neighbour's right), lip just
 * under a groove of the upper edges, face the rest. Null outside the hex.
 */
export function partAt(x: number, y: number): Part | null {
  if (!inside(x, y)) return null;
  if (!inside(x, y - 1) || !inside(x, y + 1) || !inside(x + 1, y)) return "groove";
  if (!inside(x, y - 2) || !inside(x - 1, y - 1) || !inside(x + 1, y - 1)) return "lip";
  return "face";
}

/** One hex cut into the wood, its middle at `cx`, `cy`. */
export function cutHex(g: Ctx, cx: number, cy: number, t: HexTones): void {
  const x0 = cx - HEX_W / 2;
  const y0 = cy - HEX_H / 2;
  for (let y = 0; y < HEX_H; y++)
    for (let x = 0; x < HEX_W; x++) {
      const part = partAt(x, y);
      if (part) R(g, x0 + x, y0 + y, 1, 1, t[part]);
    }
}

/** Whether a pixel of a hex is face or lip: what a sign laid on the hex covers. */
const covered = (x: number, y: number): boolean => {
  const p = partAt(x, y);
  return p === "face" || p === "lip";
};

/** Each sign made, by its colours: there are a few dozen. */
const SIGNS = new Map<string, HTMLCanvasElement>();
/**
 * A sign laid over one hex: its face and lip filled with `fill` (or left clear), and the one pixel
 * just inside its groove in `rim` (or none). Made once for its colours and shared: draw it, never into it.
 */
export function hexSign(fill: string | null, rim: string | null): HTMLCanvasElement {
  const key = `${fill} ${rim}`;
  const kept = SIGNS.get(key);
  if (kept) return kept;
  const { c, g } = makeCanvas(HEX_W, HEX_H);
  SIGNS.set(key, c);
  for (let y = 0; y < HEX_H; y++)
    for (let x = 0; x < HEX_W; x++) {
      if (!covered(x, y)) continue;
      const edge = !covered(x - 1, y) || !covered(x + 1, y) || !covered(x, y - 1) || !covered(x, y + 1);
      const col = edge ? rim : fill;
      if (col) R(g, x, y, 1, 1, col);
    }
  return c;
}

/**
 * The line round some of the board's hexes taken as one shape, a picture the board's size: one pixel
 * wide, in the grooves round the shape and never between two of its hexes. Hexes overlap at their
 * points, so each pixel is the hex the board paints last there, as `paintHalf` does.
 */
export function lineRound(cells: readonly number[], colour: string): HTMLCanvasElement {
  const w = BOARD_W;
  const h = BOARD_H;
  const own = new Set(cells);
  const mask = new Uint8Array(w * h);
  for (let cell = 0; cell < CELLS; cell++) {
    const at = cellXY(cell);
    for (let y = 0; y < HEX_H; y++)
      for (let x = 0; x < HEX_W; x++) {
        const px = at.x - HEX_W / 2 + x;
        const py = at.y - HEX_H / 2 + y;
        if (partAt(x, y) && px >= 0 && py >= 0 && px < w && py < h) mask[py * w + px] = own.has(cell) ? 1 : 0;
      }
  }
  const of = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < w && y < h && mask[y * w + x] === 1;
  return paint(w, h, (x, y) =>
    of(x, y) && (!of(x - 1, y) || !of(x + 1, y) || !of(x, y - 1) || !of(x, y + 1)) ? colour : null,
  );
}

/** The colours of what is laid on the board for the hand: a seat it may go to, the zone it belongs in, where it is aimed, a figure it would change places with. */
export const SIGN = {
  free: dusk(GOLD[0], 0.25),
  zone: GOLD[1],
  zoneLine: GOLD[2],
  aim: CREAM,
  aimFill: GOLD[2],
  swap: WATER[3],
} as const;
/** How strongly each is laid: the rims, the zone's fill, the fill of the seat aimed at (its cream rim is whole). */
export const SIGN_ALPHA = { free: 0.85, zoneRim: 0.55, zoneFill: 0.2, aimFill: 0.45, swap: 0.75 } as const;

/** The shadow a figure standing on the board throws: two rows under its base, the lower shorter; wider under a big one. */
export function drawShadow(g: Ctx, x: number, y: number, big = false): void {
  const half = big ? 13 : 8;
  const under = big ? 5 : 3;
  const x0 = Math.round(x) - half;
  const y0 = Math.round(y) + under;
  g.fillStyle = "rgba(26,15,30,0.42)";
  g.fillRect(x0, y0, half * 2 + 1, 1);
  g.fillStyle = "rgba(26,15,30,0.24)";
  g.fillRect(x0 + 2, y0 + 1, half * 2 - 3, 1);
}
