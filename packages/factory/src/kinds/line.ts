/**
 * The carriers' way of playing, shared by every kind that carries one thing across its tile at a
 * time (a belt, a joiner, a tunnel mouth, a splitter, a sorter): what such a tile takes and how, how
 * it hands on what has crossed it, and how it stands. A kind imports what it uses of this, and its
 * own module says the rest.
 */
import type { Wire, Yard } from "../yard.ts";
import type { Words } from "./kind.ts";
import type { Kit } from "./kit.ts";
import { as, asItem, cap, many, nowhere, stuckAs } from "./say.ts";

/** Every side but the one it faces: a belt, a joiner, a crate (two belts facing each other pass nothing). */
export const allButAhead = (_k: Kit, y: Yard, i: number): number => 15 & ~(1 << (y.dir[i] ?? 0));
/** The side behind it alone: a sorter, a tunnel's way-in mouth. */
export const behindOnly = (_k: Kit, y: Yard, i: number): number => 1 << (((y.dir[i] ?? 0) + 2) & 3);
/** Every side: the depot, a stop, a machine, a boiler, a Study. */
export const everySide = (): number => 15;
/** The tile ahead: where a piece that hands to one tile hands. */
export const aheadOf = (k: Kit, y: Yard, i: number): number => k.ahead(y, i);

/** Whether a piece takes the thing it is handed: a carrier, a crate and a sink take anything. */
export const anything = (): boolean => true;

/** Whether what a carrier carries has crossed its tile. */
export const crossed = (k: Kit, y: Yard, i: number): boolean => y.item[i] !== k.NONE && (y.prog[i] ?? 0) >= 8;

/** Room on a carrier: nothing on it. */
export const empty = (k: Kit, y: Yard, i: number): boolean => y.item[i] === k.NONE;

/** A carrier takes a thing in from its side `side`, `over` eighths along its tile already. */
export function lay(_k: Kit, y: Yard, i: number, n: number, side: number, over: number): void {
  y.item[i] = n;
  y.prog[i] = over;
  y.via[i] = 1 + side;
}

/** A belt, joiner or tunnel's far mouth hands on what it carries, once it has crossed the tile, to the tile ahead. */
export function carryOn(k: Kit, y: Yard, i: number, wire: Wire): void {
  if (!crossed(k, y, i)) return;
  const to = k.ahead(y, i);
  if (!k.passTo(y, i, to, ((y.dir[i] ?? 0) + 2) & 3, wire)) k.refused(y, i, to, wire);
}

/** Whether a carrier that hands to one tile has something there for `to`: it hands there, and what it carries has crossed. */
export const readyAhead = (k: Kit, y: Yard, i: number, to: number): boolean =>
  k.nextOf(y, i) === to && crossed(k, y, i);

/** How many things are under the ground in the tunnel going in on a tile: 0 for anything else. */
export function underground(k: Kit, y: Yard, i: number): number {
  const t = k.tunnelOf(y, i);
  if (t < 0) return 0;
  let under = 0;
  for (let s = 0; s < (y.span[i] ?? 0); s++) if (y.tunnels.under[t * k.SPAN_MOST + s] !== k.NONE) under++;
  return under;
}

/** How a carrier stands: a piece with every way closed can send nothing on, whether or not it holds anything yet. */
export function carrierCondition(k: Kit, y: Yard, i: number): number {
  const n = y.item[i] ?? k.NONE;
  if (k.closedOf(y, i) === 7) return as("blocked", true);
  if (!k.isItem(n)) return underground(k, y, i) > 0 ? as("carrying") : as("idle");
  if ((y.prog[i] ?? 0) < 8) return as("carrying");
  return k.tunnelOf(y, i) >= 0 ? as("waiting") : stuckAs(k, y, i, n);
}

/** What an empty carrier that can send nothing on says: every way shut, or some turned in too. */
const blockedLine = (y: Yard, i: number): string =>
  (y.ins[i] ?? 0) === 0 ? "All 3 ways out are shut." : "Every way out is shut or takes things in.";

/** The words for how a carrier stands. */
export function carrierWords(k: Kit, y: Yard, i: number, state: string): Words {
  const n = asItem(k, y.item[i] ?? k.NONE);
  if (n === null) {
    if (state === "blocked") return { line: blockedLine(y, i) };
    const under = underground(k, y, i);
    return { line: state === "carrying" ? `${under} thing${under === 1 ? "" : "s"} under the ground.` : "Empty." };
  }
  if (state === "carrying") return { line: `Carrying ${many(k, n)}.` };
  if (state === "blocked") return { line: nowhere(k, y, i, n), stuck: n };
  return { line: `${cap(many(k, n))} waiting to move on.` };
}
