/**
 * The assembler: a crafting hall of 3 by 3 tiles, the bench and the workshop made big. It makes what
 * either makes, as fast as 9 of them at its grade, and keeps 9 times their parts by it (`as`): one
 * block to feed in place of nine machines, making no more a tile than they do.
 */
import { BIG_MAKER } from "./big.ts";
import { kind } from "./kind.ts";
import { backAndSides, front } from "./ports.ts";

export const assembler = kind({
  name: "assembler",
  info: {
    name: "Assembler",
    cost: 400,
    draw: 36,
    gives: 0,
    what: "A crafting hall of 3 by 3 tiles. It makes anything a bench or a workshop makes, as fast as 9 of them.",
  },
  graded: true,
  holds: true,
  as: { bench: 9, workshop: 9 },
  size: [3, 3],
  ports: { in: backAndSides(3, 3), out: [{ at: front(3, 1), sends: "out" }] },
  rules: BIG_MAKER,
});
