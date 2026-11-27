/**
 * What a piece of more than one tile that holds things hands on by: its ways out (`KindDef.ports`),
 * each sending the thing it finished or what was made beside it, to the tile ahead of that way. It
 * stops while either cannot leave: a machine begins nothing more until both have (`maker.ts`).
 */
import type { Wire, Yard } from "../yard.ts";
import type { Hooks } from "./kind.ts";
import type { Kit } from "./kit.ts";
import { MAKER } from "./maker.ts";

/** It hands on by each of its ways out what that way sends, where it has it and the tile there takes it. */
export function handPorts(k: Kit, y: Yard, i: number, wire: Wire): void {
  const r = k.holderOf(y, i);
  const n = k.outsOf(y, i).length;
  for (let p = 0; p < n; p++) k.sendPort(y, i, r, p, wire);
}

/** Whether it has something for the tile `to`: a way out to it, holding what that way sends. */
export function readyPorts(k: Kit, y: Yard, i: number, to: number): boolean {
  const r = k.holderOf(y, i);
  const outs = k.outsOf(y, i);
  for (let p = 0; p < outs.length; p++)
    if (k.portTo(y, i, p) === to && (outs[p]?.also ? y.holders.also[r] : y.holders.out[r]) !== k.NONE) return true;
  return false;
}

/** The tile its first way out sends to, for what asks of a piece the one tile it hands to. */
export const firstOut = (k: Kit, y: Yard, i: number): number => k.portTo(y, i, 0);

/** A machine of more than one tile: a machine's hooks, handing on by its ways out. */
export const BIG_MAKER: Hooks = { ...MAKER, next: firstOut, hands: handPorts, ready: readyPorts };
