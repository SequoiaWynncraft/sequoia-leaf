/** The crate: stores items and lets them out, whatever it holds most of first. Shut, it takes items in and lets none out. */
import type { KeptPiece } from "../cells.ts";
import type { Wire, Yard } from "../yard.ts";
import { keep, readyOut, stockOnto } from "./holder.ts";
import { kind, type Words } from "./kind.ts";
import type { Kit } from "./kit.ts";
import { aheadOf, allButAhead, anything } from "./line.ts";
import { as, holding } from "./say.ts";

/** Room for one more: what it holds and what it has out, under what a crate holds. */
function room(k: Kit, y: Yard, i: number): boolean {
  const h = y.holders;
  const r = k.holderOf(y, i);
  return (h.count[r] ?? 0) + (h.out[r] === k.NONE ? 0 : 1) < y.open.crate;
}

/** An open crate lets out whatever it holds most of, one at a time. */
function hands(k: Kit, y: Yard, i: number, wire: Wire): void {
  const h = y.holders;
  const r = k.holderOf(y, i);
  if (h.open[r] === 0) return;
  if (h.out[r] === k.NONE && (h.count[r] ?? 0) > 0) {
    let most: number = k.NONE;
    let mostHas = 0;
    for (let n = 0; n < k.ITEM_COUNT; n++) {
      const has = h.stock[r * k.ITEM_COUNT + n] ?? 0;
      if (has > mostHas) {
        most = n;
        mostHas = has;
      }
    }
    if (most !== k.NONE) {
      k.take(h, r, most);
      h.out[r] = most;
      k.roomBeside(y, i, wire.waiting);
    }
  }
  if (h.out[r] !== k.NONE) k.sendOut(y, i, r, wire);
}

function condition(k: Kit, y: Yard, i: number): number {
  const r = k.holderOf(y, i);
  return y.holders.open[r] === 1 ? as((y.holders.count[r] ?? 0) > 0 ? "carrying" : "idle") : as("shut");
}

function words(k: Kit, y: Yard, i: number, state: string): Words {
  const r = k.holderOf(y, i);
  const count = y.holders.count[r] ?? 0;
  const line = `Holds ${count} of ${y.open.crate}${count > 0 ? `: ${holding(k, y, r)}` : ""}.`;
  return { line: state === "shut" ? `Shut: it lets no items out. ${line}` : line };
}

/** Opens or shuts it: shut, it takes things in and lets nothing out. */
function open(k: Kit, y: Yard, i: number, to: boolean): void {
  const r = k.holderOf(y, i);
  if ((y.holders.open[r] === 1) === to) return;
  y.holders.open[r] = to ? 1 : 0;
  k.changed(y);
}

/** A kept crate: what it held, up to what a crate holds now, anything it had out, and shut if it was. */
function onto(k: Kit, y: Yard, i: number, r: number, o: KeptPiece): void {
  stockOnto(k, y, i, r, o, y.open.crate);
  if (o.out !== undefined && k.isItem(o.out)) y.holders.out[r] = o.out;
  y.holders.open[r] = o.closed === true ? 0 : 1;
}

export const crate = kind({
  name: "crate",
  info: {
    name: "Crate",
    cost: 20,
    draw: 0,
    gives: 0,
    what: "Stores items and passes them on. Tap it to shut it and keep what comes in.",
  },
  holds: true,
  shuts: true,
  rules: {
    sides: allButAhead,
    next: aheadOf,
    wants: anything,
    room,
    give: keep,
    hands,
    ready: readyOut,
    condition,
    words,
    set: { open },
    most: () => 1e6,
    onto,
    keeps: (_k, _kind, v) => (v.open === false ? { open: false } : {}),
  },
});
