/**
 * Seqwawa, the expansion's healer: a five-acorn figure on everyone's stall, the guild's own tree as
 * a living stump. It is written like any figure (`figures.ts` puts it among `FIGURES`) and kept here
 * so the twenty-eight's table does not grow. It never moves and never attacks (its own trait,
 * Rooted, in `traits.ts`); its reach only says where it sits, at the back, behind the party it heals.
 * What its ability does on the board is in `fight/abilities.ts`.
 */
import type { FigureSpec } from "./figures.ts";

export const SEQWAWA: FigureSpec = {
  name: "Seqwawa",
  tier: 5,
  kin: "moss",
  calling: "mender",
  extra: ["rooted"],
  hp: 850,
  attack: 0,
  speed: 0,
  range: 4,
  armour: 40,
  ward: 40,
  mana: [20, 115],
  rooted: true,
  ability: {
    name: "No GG Left Behind",
    shape: "ally",
    text: "Every friend gets {heal} health back. The last friend to fall, if it fell in the last {window} seconds, gets back up with {back} health.",
    n: { heal: [140, 245, 560], back: [200, 350, 800], window: [3, 3, 3] },
    short: "Heals every ally {heal}. The last to fall in {window}s rises with {back}.",
  },
  quip: "Sits where the tree was. Was the tree.",
};
