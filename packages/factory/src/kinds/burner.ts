/**
 * What every kind that burns for power shares (a boiler; a powerhouse), from what its module says it
 * burns (`KindDef.burns`): it takes in each of its fuels from any side, up to what it holds of each,
 * and stands giving power while it burns and cold while it has nothing to burn. The burning itself is
 * the tick's (`tick.ts`'s `power`, which takes the first of its fuels it holds), and what it needs a
 * minute the yard's flow's (`status.ts`, `fuelNow`), from the same data.
 */
import type { KeptPiece } from "../cells.ts";
import type { Burns, Fuel } from "../tables.ts";
import type { Yard } from "../yard.ts";
import { keep, stockOnto } from "./holder.ts";
import type { Hooks, Words } from "./kind.ts";
import type { Kit } from "./kit.ts";
import { everySide } from "./line.ts";
import { as, many, UNLINKED } from "./say.ts";

/** What the burner on a tile burns, as its kind says. */
const burnsAt = (k: Kit, y: Yard, i: number): Burns | null => k.BURNS[y.kind[i] ?? k.NONE] ?? null;
/** What a burner burns of a thing, if it burns it. Makes nothing: the tick asks it of what is handed in. */
function fuelFor(b: Burns | null, n: number): Fuel | undefined {
  const fuels = b?.fuels ?? NO_FUELS;
  for (let f = 0; f < fuels.length; f++) if (fuels[f]?.fuel === n) return fuels[f];
  return undefined;
}
const NO_FUELS: readonly Fuel[] = [];
/** Whether a burner burns a thing. */
const burnsThing = (b: Burns | null, n: number): boolean => fuelFor(b, n) !== undefined;

/** Whether it takes a thing: one of its fuels. */
const wants = (k: Kit, y: Yard, i: number, n: number): boolean => burnsThing(burnsAt(k, y, i), n);
/** Room for more of it: fewer than it holds of each. */
const room = (k: Kit, y: Yard, i: number, n: number): boolean => {
  const b = burnsAt(k, y, i);
  return burnsThing(b, n) && k.held(y.holders, k.holderOf(y, i), n) < (b?.holds ?? 0);
};

/**
 * What a burner on a tile burns now, as a screen counts what it needs a minute: what it is burning
 * (one of more than one fuel notes it), else the first of its fuels it holds, else its first.
 */
export function fuelNow(k: Kit, y: Yard, i: number): Fuel | undefined {
  const b = burnsAt(k, y, i);
  if (!b) return undefined;
  const h = y.holders;
  const r = k.holderOf(y, i);
  const burning = (h.fuel[r] ?? 0) > 0 ? fuelFor(b, h.making[r] ?? k.NONE) : undefined;
  if (burning) return burning;
  for (let f = 0; f < b.fuels.length; f++) {
    const fuel = b.fuels[f];
    if (fuel && k.held(h, r, fuel.fuel) > 0) return fuel;
  }
  return b.fuels[0];
}

/**
 * Whether the burner on a tile is burning: a piece alight, or one of its fuels held, which it takes
 * the moment the last burns out (`tick.ts`'s `power`), so that it gives power on every tick with no
 * gap. One that holds nothing to burn, with the last piece burnt out, is cold. Makes nothing.
 */
export function alight(k: Kit, y: Yard, i: number): boolean {
  const r = k.holderOf(y, i);
  if ((y.holders.fuel[r] ?? 0) > 0) return true;
  const fuels = burnsAt(k, y, i)?.fuels ?? NO_FUELS;
  for (let f = 0; f < fuels.length; f++) {
    const fuel = fuels[f];
    if (fuel && k.held(y.holders, r, fuel.fuel) > 0) return true;
  }
  return false;
}

function condition(k: Kit, y: Yard, i: number, lit: boolean): number {
  if (!lit) return as("unpowered", true);
  return alight(k, y, i) ? as("giving") : as("cold", true);
}

/** Things by how many it holds of each: "5 pitch, 2 creosote and 0 spirit". */
function holdsList(k: Kit, y: Yard, i: number, b: Burns): string {
  const r = k.holderOf(y, i);
  const each = b.fuels.map((f) => `${k.held(y.holders, r, f.fuel)} ${many(k, f.fuel)}`);
  const last = each.pop() ?? "";
  return each.length === 0 ? last : `${each.join(", ")} and ${last}`;
}

/** Its fuels as one says any will do: "deadfall", "pitch, creosote or spirit". */
function anyOf(k: Kit, b: Burns): string {
  const names = b.fuels.map((f) => many(k, f.fuel));
  const last = names.pop() ?? "";
  return names.length === 0 ? last : `${names.join(", ")} or ${last}`;
}

function words(k: Kit, y: Yard, i: number, state: string): Words {
  if (state === "unpowered") return { line: UNLINKED };
  const b = burnsAt(k, y, i);
  const first = b?.fuels[0];
  if (!b || !first) return { line: "" };
  const power = b.halves / k.HALF;
  if (state !== "giving") return { line: `Out of fuel. It makes power only while it has ${anyOf(k, b)}.` };
  if (b.fuels.length === 1) {
    const has = k.held(y.holders, k.holderOf(y, i), first.fuel);
    return { line: `Running. Makes ${power} power. Holds ${has} of ${b.holds} ${many(k, first.fuel)}.` };
  }
  const burning = fuelNow(k, y, i)?.fuel ?? first.fuel;
  return { line: `Running. Makes ${power} power. Burning ${many(k, burning)}; holds ${holdsList(k, y, i, b)}.` };
}

/** A kept burner: its fuel, how long the piece burning has left, and for one of more than one fuel which it burns. */
function onto(k: Kit, y: Yard, i: number, r: number, o: KeptPiece): void {
  const b = burnsAt(k, y, i);
  stockOnto(k, y, i, r, o, 1e6);
  y.holders.fuel[r] = k.whole(o.fuel, Math.max(0, ...(b?.fuels ?? []).map((f) => f.ticks))) ?? 0;
  if (b && b.fuels.length > 1 && o.making !== undefined && burnsThing(b, o.making)) y.holders.making[r] = o.making;
}

/** A burner: every hook a kind that burns for power plays with. */
export const BURNER: Hooks = {
  sides: everySide,
  wants,
  room,
  give: keep,
  condition,
  words,
  most: (k, y, i, n) => (burnsThing(burnsAt(k, y, i), n) ? (burnsAt(k, y, i)?.holds ?? 0) : 0),
  onto,
};
