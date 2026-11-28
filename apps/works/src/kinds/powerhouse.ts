/**
 * The powerhouse on the page (tier 6): a brick block with a tall stack and one arched window, two tiles
 * by two (`art/powerhouse.ts`). Burning, its window is warm and grey smoke drifts from its stack,
 * thicker on pitch than on creosote, and thinnest on spirit; cold, its window is dark and it makes no
 * smoke. Its card says what it burns a minute of each fuel, heaviest first, and the smog each makes.
 */
import { BURNS, holderOf, kind, MINUTE, type Yard } from "@sequoia-leaf/factory";
import type { Row } from "@sequoia-leaf/kit/card.ts";
import { STONE } from "@sequoia-leaf/kit/palette.ts";
import { perMinute } from "@sequoia-leaf/kit/say.ts";
import { hash } from "@sequoia-leaf/kit/util.ts";

import { CLAY, IRON } from "../art/pal.ts";
import { PAD, powerhouseIcon, powerhouseOf, STACK_TOP, TALL } from "../art/powerhouse.ts";
import { smoke } from "../fx.ts";
import { itemRef } from "../ui/refs.ts";
import type { KindPage } from "./kind.ts";

const POWERHOUSE = kind("powerhouse");
const FUELS = BURNS[POWERHOUSE]?.fuels ?? [];
/** Its smoke by its fuel, heaviest first: how long between puffs, how many, and how dark. */
const SMOKE: readonly (readonly [number, number, string])[] = [
  [0.16, 2, IRON[3]],
  [0.3, 1, IRON[4]],
  [0.55, 1, STONE[2]],
];
/** Its brick, on the map and in a blueprint's picture. */
const BRICK = ["#9a4a3c", CLAY[0]] as const;

/** Its fuels a minute, heaviest first: what it burns of each, and the smog each makes. */
function fuelRows(): Row[] {
  const each = (f: (typeof FUELS)[number], per: number): { ref: ReturnType<typeof itemRef>; note: string } => ({
    ref: itemRef(f.fuel),
    note: perMinute(per * (MINUTE / f.ticks)),
  });
  return [
    { label: "Burns, heaviest first", things: FUELS.map((f) => each(f, 1)) },
    { label: "Smog made", things: FUELS.map((f) => each(f, f.smog)) },
  ];
}

/** Whether the powerhouse with a holder's row `r` is burning: power reaches it and a piece is alight. */
const burning = (y: Yard, r: number, powered: boolean): boolean => powered && r >= 0 && (y.holders.fuel[r] ?? 0) > 0;

export const powerhouse: KindPage = {
  picture: () => powerhouseIcon(),
  draw(_art, y, at) {
    const lit = at.real && burning(y, at.r, at.powered);
    at.put(powerhouseOf(lit ? 1 + (Math.floor(at.t * 5) % 2) : 0), at.x - PAD, at.top - PAD - TALL, at.z, at.a);
    if (lit && at.t > (at.mem.puffAt[at.i] ?? 0)) {
      const f = Math.max(
        0,
        FUELS.findIndex((fuel) => fuel.fuel === at.making),
      );
      const [every, count, col] = SMOKE[f] ?? SMOKE[0] ?? [0.3, 1, IRON[3]];
      at.mem.puffAt[at.i] = at.t + every * (0.8 + hash(at.i, Math.floor(at.t * 3), 7) * 0.4);
      const [u, v] = STACK_TOP;
      smoke(at.x + u + at.seenX, at.top + v - 2 + at.seenY, col, count);
    }
    return at.top - TALL;
  },
  lamps: (y, i, x, foot, _at, out) => {
    if (burning(y, holderOf(y, i), true)) out.push({ x, y: foot - 10, r: 24, power: 0.8, reach: false });
  },
  rows: fuelRows,
  holdsUp: () => BURNS[POWERHOUSE]?.holds ?? 8,
  map: BRICK,
  dot: BRICK[0],
  dock: 19,
};
