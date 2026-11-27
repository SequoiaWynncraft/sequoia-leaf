import type { KeptPiece } from "../cells.ts";
/** The boiler: makes a lot of power where power reaches it, but only while it has deadfall to burn, a piece every 20 ticks. */
import { FUEL, TICKS } from "../content/machines.ts";
import type { Counts, Yard } from "../yard.ts";
import { keep, stockOnto } from "./holder.ts";
import { kind, type KindInfo, type Words } from "./kind.ts";
import type { Kit } from "./kit.ts";
import { everySide } from "./line.ts";
import { as, UNLINKED } from "./say.ts";

const INFO: KindInfo = {
  name: "Boiler",
  cost: 90,
  draw: 0,
  gives: 30,
  what: "Makes a lot of power, but only while it has deadfall to burn.",
};

/** Its power while it burns, in halves. */
const burns = (k: Kit): number => INFO.gives * k.HALF;

/** It takes a piece of deadfall to burn once the last has burned out, and burns: the power it gives this tick. */
function burn(k: Kit, y: Yard, i: number, waiting: Uint8Array): number {
  const h = y.holders;
  const r = k.holderOf(y, i);
  if ((h.fuel[r] ?? 0) <= 0 && (h.stock[r * k.ITEM_COUNT + k.DEADFALL] ?? 0) > 0) {
    k.take(h, r, k.DEADFALL);
    h.fuel[r] = TICKS.burn;
    k.roomBeside(y, i, waiting);
  }
  if ((h.fuel[r] ?? 0) <= 0) return 0;
  h.fuel[r] = (h.fuel[r] ?? 1) - 1;
  return burns(k);
}

const burning = (k: Kit, y: Yard, i: number): number => ((y.holders.fuel[k.holderOf(y, i)] ?? 0) > 0 ? burns(k) : 0);

function condition(k: Kit, y: Yard, i: number, lit: boolean): number {
  if (!lit) return as("unpowered", true);
  return (y.holders.fuel[k.holderOf(y, i)] ?? 0) > 0 ? as("giving") : as("cold", true);
}

function words(k: Kit, y: Yard, i: number, state: string): Words {
  if (state === "unpowered") return { line: UNLINKED };
  const fuel = k.held(y.holders, k.holderOf(y, i), k.DEADFALL);
  return {
    line:
      state === "giving"
        ? `Running. Makes ${INFO.gives} power. Holds ${fuel} of ${FUEL} deadfall.`
        : "Out of fuel. It makes power only while it has deadfall.",
  };
}

/** What it needs a minute where power reaches it: the deadfall it burns. */
const flow = (k: Kit, _y: Yard, _i: number, _made: Counts, needed: Counts): void =>
  void (needed[k.DEADFALL] = (needed[k.DEADFALL] ?? 0) + k.burned());

/** A kept boiler: its deadfall, and what it was burning. */
function onto(k: Kit, y: Yard, i: number, r: number, o: KeptPiece): void {
  stockOnto(k, y, i, r, o, 1e6);
  y.holders.fuel[r] = k.whole(o.fuel, TICKS.burn) ?? 0;
}

export const boiler = kind({
  name: "boiler",
  info: INFO,
  holds: true,
  rules: {
    sides: everySide,
    wants: (k, _y, _i, n) => n === k.DEADFALL,
    room: (k, y, i, n) => k.held(y.holders, k.holderOf(y, i), n) < FUEL,
    give: keep,
    burn,
    burning,
    condition,
    words,
    flow,
    most: (k, _y, _i, n) => (n === k.DEADFALL ? FUEL : 0),
    onto,
  },
});
