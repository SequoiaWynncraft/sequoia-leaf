/**
 * What every kind that burns for power shares (a boiler; a powerhouse later), from what its module
 * says it burns (`KindDef.burns`): it takes in its fuel from any side, up to what it holds, and stands
 * giving power while it burns and cold while it has none. The burning itself is the tick's
 * (`tick.ts`'s `power`), and what it needs a minute the yard's flow's (`status.ts`), from the same data.
 */
import type { KeptPiece } from "../cells.ts";
import type { Burns } from "../tables.ts";
import type { Yard } from "../yard.ts";
import { keep, stockOnto } from "./holder.ts";
import type { Hooks, Words } from "./kind.ts";
import type { Kit } from "./kit.ts";
import { everySide } from "./line.ts";
import { as, many, UNLINKED } from "./say.ts";

/** What the burner on a tile burns, as its kind says. */
const burnsAt = (k: Kit, y: Yard, i: number): Burns | null => k.BURNS[y.kind[i] ?? k.NONE] ?? null;

/** Whether it takes a thing: its fuel alone. */
const wants = (k: Kit, y: Yard, i: number, n: number): boolean => burnsAt(k, y, i)?.fuel === n;
/** Room for more of it: fewer than it holds. */
const room = (k: Kit, y: Yard, i: number, n: number): boolean =>
  k.held(y.holders, k.holderOf(y, i), n) < (burnsAt(k, y, i)?.holds ?? 0);

function condition(k: Kit, y: Yard, i: number, lit: boolean): number {
  if (!lit) return as("unpowered", true);
  return (y.holders.fuel[k.holderOf(y, i)] ?? 0) > 0 ? as("giving") : as("cold", true);
}

function words(k: Kit, y: Yard, i: number, state: string): Words {
  if (state === "unpowered") return { line: UNLINKED };
  const b = burnsAt(k, y, i);
  if (!b) return { line: "" };
  const fuel = many(k, b.fuel);
  const has = k.held(y.holders, k.holderOf(y, i), b.fuel);
  return {
    line:
      state === "giving"
        ? `Running. Makes ${b.halves / k.HALF} power. Holds ${has} of ${b.holds} ${fuel}.`
        : `Out of fuel. It makes power only while it has ${fuel}.`,
  };
}

/** A kept burner: its fuel, and what it was burning. */
function onto(k: Kit, y: Yard, i: number, r: number, o: KeptPiece): void {
  stockOnto(k, y, i, r, o, 1e6);
  y.holders.fuel[r] = k.whole(o.fuel, burnsAt(k, y, i)?.ticks ?? 0) ?? 0;
}

/** A burner: every hook a kind that burns for power plays with. */
export const BURNER: Hooks = {
  sides: everySide,
  wants,
  room,
  give: keep,
  condition,
  words,
  most: (k, y, i, n) => (burnsAt(k, y, i)?.fuel === n ? (burnsAt(k, y, i)?.holds ?? 0) : 0),
  onto,
};
