/**
 * The cracker, two tiles by two (tier 6): a machine, as a bench is (`BIG_MAKER`), that makes 1 creosote
 * from 2 pitch or 1 spirit from 2 creosote, told which on its card or by what it is fed. It takes its
 * parts in on the six tile-sides of its back and sides, and sends what it makes out of the left tile
 * of its front. Each it makes adds 1 to the smog on its plot.
 */
import type { Wire, Yard } from "../yard.ts";
import { BIG_MAKER } from "./big.ts";
import { kind } from "./kind.ts";
import type { Kit } from "./kit.ts";
import { work as make } from "./maker.ts";
import { backAndSides, front } from "./ports.ts";

/** A machine's step, and a thing finished adds its kind's smog to its plot. */
function work(k: Kit, y: Yard, i: number, r: number, speed: number, wire: Wire): boolean {
  const was = y.holders.out[r];
  const worked = make(k, y, i, r, speed, wire);
  if (was === k.NONE && y.holders.out[r] !== k.NONE) k.smogged(y, i, k.SMOG_OF[y.kind[i] ?? k.NONE] ?? 0);
  return worked;
}

export const cracker = kind({
  name: "cracker",
  info: {
    name: "Cracker",
    cost: 3000,
    draw: 30,
    gives: 0,
    smog: 1,
    what: "Makes 1 creosote from 2 pitch, or 1 spirit from 2 creosote.",
  },
  graded: true,
  holds: true,
  size: [2, 2],
  ports: { in: backAndSides(2, 2), out: [{ at: front(2, 0), sends: "out" }] },
  rules: { ...BIG_MAKER, work },
});
