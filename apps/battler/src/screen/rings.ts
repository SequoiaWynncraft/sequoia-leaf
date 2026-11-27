/**
 * Graid's rings: each true form's own, lying flat on the ground round its hex, in its raid's idea,
 * tied by a gold stud at four points. Ours, not anybody else's frames:
 *
 * - Worm (the nest): broken eggshell, cream pieces on moss green, with gaps where it broke.
 * - Rock (the canyon): strata, bands of earth and coral like a cut cliff.
 * - Greg (the nameless one): a ring that is missing: near-black with static flicking in it, and
 *   scratched-out marks where a name would be.
 * - Orphion (the light): short gold rays pointing outward, a halo laid flat.
 * - Moth: torn pennant cloth, frayed at its edge, in Mist's purples and cream.
 *
 * A ring is drawn a quarter at a time, clockwise from the top stud, as a true form rises.
 */
import { CORAL, CREAM, EARTH, GOLD, GREEN, INK, SKY } from "@sequoia-leaf/kit/palette.ts";
import { R } from "@sequoia-leaf/kit/pix.ts";
import type { Ctx } from "@sequoia-leaf/kit/util.ts";
import type { TrueFormId } from "@sequoia-leaf/raid/content/graid.ts";

import { STUDS } from "./risetime.ts";

/** Half a ring's width and height on the ground: round one hex, wide enough to show between the figures beside it. */
export const RING = { rx: 18, ry: 11 } as const;

/** A whole number from a few, the same every time: which pixels of a ring are what. */
const hash = (a: number, b: number): number => {
  const n = Math.imul(a * 374761393 + b * 668265263, 1274126177);
  return ((n ^ (n >>> 13)) >>> 0) % 1000;
};

/**
 * The colour of a ring's pixel `i` (of `n` round it) on its band (`0` the outer edge, `1` the inner),
 * at the fight's clock `c`: null for none (a gap, a missing piece).
 */
type Paint = (i: number, n: number, band: 0 | 1, c: number) => string | null;

const PAINTS: Readonly<Record<TrueFormId, Paint>> = {
  // Moss green, with cream shell in pieces along it, and a few gaps where it broke.
  worm: (i, n, band) => {
    const piece = Math.floor((i / n) * 22);
    if (hash(piece, 1) < 120) return null;
    if (hash(piece, 2) < 380) return band === 0 ? CREAM : "#e9d8b8";
    return band === 0 ? GREEN[3] : GREEN[2];
  },
  // Strata: earth over coral, the bands stepping as a cliff's do.
  rock: (i, n, band) => {
    const step = hash(Math.floor((i / n) * 16), 3) < 500 ? 0 : 1;
    return (band + step) % 2 === 0 ? EARTH[0] : CORAL;
  },
  // Near-black, the static moving in it, and scratches where a name would be.
  greg: (i, n, band, c) => {
    const at = Math.floor((i / n) * 48);
    if (at % 12 === 5 || at % 12 === 6) return band === 0 ? "#e9d8b8" : INK;
    return hash(at * 2 + band, Math.floor(c / 2)) < 90 ? CREAM : band === 0 ? SKY[1] : SKY[0];
  },
  // A gold halo.
  whitefox: (_i, _n, band) => (band === 0 ? GOLD[2] : GOLD[1]),
  // Purple cloth with cream stripes, torn in places.
  moth: (i, n, band) => {
    const at = Math.floor((i / n) * 30);
    if (band === 0 && hash(at, 5) < 160) return null;
    return at % 5 === 0 ? CREAM : band === 0 ? SKY[3] : SKY[2];
  },
};

/** Where a point round a ring is, from its middle: the top first, clockwise. */
const pointAt = (a: number, out: number): { x: number; y: number } => ({
  x: Math.round(Math.cos(a - Math.PI / 2) * (RING.rx + out)),
  y: Math.round(Math.sin(a - Math.PI / 2) * (RING.ry + out * 0.6)),
});

/** What a ring has besides its band, outside it: Orphion's rays, the torn threads of the Moth's cloth, a cream chip off the Worm's shell. */
function outside(g: Ctx, kind: TrueFormId, x: number, y: number, a: number, i: number): void {
  if (kind === "whitefox" && i % 9 === 0) {
    for (const out of [3, 4]) {
      const p = pointAt(a, out);
      R(g, x + p.x, y + p.y, 1, 1, out === 3 ? GOLD[2] : GOLD[1]);
    }
  } else if (kind === "moth" && hash(i, 7) < 70) {
    const p = pointAt(a, 3);
    R(g, x + p.x, y + p.y + 1, 1, 1, SKY[3]);
  } else if (kind === "worm" && hash(i, 8) < 50) {
    const p = pointAt(a, 3);
    R(g, x + p.x, y + p.y, 1, 1, CREAM);
  }
}

/**
 * Draws a ring round the hex whose middle is at `x`, `y` on the screen: `quarters` of it (0 to 4)
 * clockwise from the top stud, each with its stud at its end lit; `snap` larger for the moment it
 * snaps shut.
 */
export function drawRing(g: Ctx, kind: TrueFormId, x: number, y: number, quarters: number, c: number, snap = 1): void {
  const paint = PAINTS[kind];
  const n = Math.round(RING.rx * 9 * snap);
  const shown = Math.round((n * quarters) / STUDS);
  const grow = Math.round(snap * 2) - 2;
  // A band three pixels wide, its outer pixel the outer paint and the two inside the inner, edged dark both sides.
  for (let i = 0; i < shown; i++) {
    const a = (i / n) * Math.PI * 2;
    for (const out of [2 + grow, -2 - grow]) {
      const p = pointAt(a, out);
      R(g, x + p.x, y + p.y, 1, 1, INK);
    }
  }
  for (let i = 0; i < shown; i++) {
    const a = (i / n) * Math.PI * 2;
    for (const [out, band] of [
      [1 + grow, 0],
      [0, 1],
      [-1 - grow, 1],
    ] as const) {
      const col = paint(i, n, band, c);
      const p = pointAt(a, out);
      if (col) R(g, x + p.x, y + p.y, 1, 1, col);
    }
    outside(g, kind, x, y, a, i);
  }
  // The four studs: gold, each lit once the ring has reached it.
  for (let s = 0; s < STUDS; s++) {
    const p = pointAt((s / STUDS) * Math.PI * 2, 0);
    const lit = s < quarters || (s === 0 && quarters > 0);
    R(g, x + p.x - 2, y + p.y - 1, 5, 3, INK);
    R(g, x + p.x - 1, y + p.y, 3, 1, lit ? GOLD[2] : GOLD[0]);
  }
}
