/**
 * The holders' way of playing, shared by every kind with a row in `holders` (a gatherer, the
 * machines, a crate, a boiler, a Study): taking a thing into its row, handing on what it has finished
 * to the tile ahead, and putting back, as the rules let it now, what a kept one held.
 */
import type { KeptPiece } from "../cells.ts";
import type { Wire, Yard } from "../yard.ts";
import type { Kit } from "./kit.ts";

/** A holder takes a thing into its row: a tile beside it may now have room, for a thing given may make room for another. */
export function keep(k: Kit, y: Yard, i: number, n: number, _side: number, _over: number, wire: Wire): void {
  k.put(y.holders, k.holderOf(y, i), n);
  k.roomBeside(y, i, wire.waiting);
}

/** A gatherer or a machine hands on its finished piece, when it has one, to the tile ahead. */
export function handOut(k: Kit, y: Yard, i: number, wire: Wire): void {
  const r = k.holderOf(y, i);
  if (y.holders.out[r] !== k.NONE) k.sendOut(y, i, r, wire);
}

/** Whether a holder has its finished piece out for the tile `to`, the one it hands to: a shut one lets nothing out (a crate). */
export function readyOut(k: Kit, y: Yard, i: number, to: number): boolean {
  if (k.nextOf(y, i) !== to) return false;
  const r = k.holderOf(y, i);
  return y.holders.out[r] !== k.NONE && y.holders.open[r] === 1;
}

/**
 * Puts back what a kept holder held into its row `r`: no more of each thing than it may hold now
 * (`Hooks.most`), and no more in all than `room`. It looks again at what it holds.
 */
export function stockOnto(k: Kit, y: Yard, i: number, r: number, o: KeptPiece, room: number): void {
  const h = y.holders;
  const has = k.counts();
  for (const [n, c] of o.held ?? []) if (k.isItem(n) && (k.whole(c, 1e6) ?? 0) > 0) has[n] = c;
  for (const n of k.ALL_ITEMS)
    for (let c = Math.min(Math.floor(has[n] ?? 0), k.mostHeld(y, i, n)); c > 0 && (h.count[r] ?? 0) < room; c--)
      k.put(h, r, n);
  h.idle[r] = 0;
}

/** The work toward what a kept holder makes, put back below what that takes (`below`). */
export function workOnto(k: Kit, y: Yard, r: number, o: KeptPiece, below: number): void {
  y.holders.work[r] = k.whole(o.work, below - 1) ?? 0;
}
