/**
 * The lights the member's own Works has put in the town's sky (SPEC-2 section 7: after a yard's first
 * launch, a cream point crosses the sky). Their Works' postcard names them (`Postcard.sky`, as Leaf
 * keeps it with the yard and gives the town in its view); the town draws each over its painted sky,
 * under the far trees and the ground, so the dusk falls over it as over the sky: a point of cream one
 * pixel wide with a fainter pixel round it, no wider, that crosses slowly in a low arc from the far
 * trees on the left to those on the right, and is gone a while before it comes again. Asked for less
 * motion, it stands still where it would be most of the way across.
 */
import { lessMotion } from "@sequoia-leaf/kit/dom.ts";
import { CREAM } from "@sequoia-leaf/kit/palette.ts";
import { R } from "@sequoia-leaf/kit/pix.ts";
import type { Ctx } from "@sequoia-leaf/kit/util.ts";

import { G } from "./game.ts";
import { SKYLINE } from "./ground.ts";
import { town } from "./leaf.ts";

/** The first launch's light, as the Works names it. */
const BEACON = "sky-beacon";
/** Seconds it takes to cross, and seconds between one crossing's start and the next. */
const CROSS = 38;
const EVERY = 55;
/** Where it crosses in the painted sky, from its top-left corner: from left to right, low over the far trees at either end and highest in the middle, in the band of open sky a member at the gate sees. */
const PATH = { from: -10, to: SKYLINE.w + 10, low: SKYLINE.horizon - 26, high: SKYLINE.horizon - 58 } as const;

/** Where the light is, `u` of the way across (0 to 1), in the painted sky's own pixels. */
const along = (u: number): readonly [number, number] => [
  Math.round(PATH.from + (PATH.to - PATH.from) * u),
  Math.round(PATH.low + (PATH.high - PATH.low) * Math.sin(Math.PI * u)),
];

/** One point of the light at (x, y): cream, with a fainter pixel above, below and to either side. */
function point(g: Ctx, x: number, y: number, alpha: number): void {
  g.globalAlpha = alpha * 0.3;
  for (const [dx, dy] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const)
    R(g, x + dx, y + dy, 1, 1, CREAM);
  g.globalAlpha = alpha;
  R(g, x, y, 1, 1, CREAM);
  g.globalAlpha = 1;
}

/** Draws the lights in the sky the member's Works has put there, over the painted sky at the camera's (cx, cy). */
export function drawSkyLights(g: Ctx, cx: number, cy: number): void {
  if (!(town().doors.works?.sky ?? []).includes(BEACON)) return;
  const u = lessMotion() ? 0.62 : (G.t % EVERY) / CROSS;
  if (u > 1) return;
  const [x, y] = along(u);
  const left = SKYLINE.worldX - cx;
  const top = SKYLINE.worldY - SKYLINE.horizon - cy;
  // A short fading wake behind it, a pixel each, and the light itself.
  for (let k = 3; k >= 1; k--) {
    const [wx, wy] = along(Math.max(0, u - k * 0.004));
    if (wx !== x) point(g, left + wx, top + wy, 0.12 * (4 - k));
  }
  point(g, left + x, top + y, 0.85);
}
