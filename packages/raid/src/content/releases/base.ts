/**
 * The base release: everything the raid had before its first expansion, open from the first. Its
 * figures, traits, items and boons are written where they always were (`figures.ts`, `traits.ts`,
 * `items.ts`, `boons.ts`), and this patch is the only reader of those tables. The figures carry the
 * names they have now; Greg's own trait is his feeding by hand, which the rules do on every table.
 */
import { BASE_BOONS } from "../boons.ts";
import type { Rarity } from "../catalog.ts";
import { BASE_FIGURES, type FigureId } from "../figures.ts";
import { BASE_COMPONENTS, BASE_EMBLEMS, BASE_FINISHED } from "../items.ts";
import type { Arrival, Patch } from "../patch.ts";
import { BASE_TRAITS } from "../traits.ts";

/** What the pulls give each of the base's figures as. The first banner's member is its headliner, the top prize. */
const PRIZES: readonly (readonly [Rarity, readonly FigureId[]])[] = [
  ["Leafkin", ["emberkit", "mossmote", "moth", "worm", "finch", "crab7", "barrowgnome"]],
  ["Sapling", ["kettle", "slug", "glorp", "chickaree", "jay", "crab12", "lanterngnome"]],
  ["Sprite", ["leafling", "cindernewt", "drizzlefrog", "rock", "bushgnome", "crab23"]],
  ["Dryad", ["badger", "fogowl", "heron"]],
  ["Druid", ["crab40", "apothecary"]],
  ["Treant", ["greg", "whitefox", "hearthcat"]],
  ["Yggdrasil", ["banner-1"]],
];

function arrivals(): Partial<Record<FigureId, Arrival>> {
  const out: Partial<Record<FigureId, Arrival>> = {};
  for (const [prize, ids] of PRIZES) {
    for (const id of ids) {
      const spec = BASE_FIGURES[id];
      if (!spec) throw new Error(`The base has no figure ${id} to give as a prize`);
      out[id] = { ...spec, prize };
    }
  }
  return out;
}

export const BASE: Patch = {
  release: "base",
  figures: { add: arrivals() },
  traits: { add: BASE_TRAITS },
  components: { add: BASE_COMPONENTS },
  finished: { add: BASE_FINISHED },
  emblems: { add: BASE_EMBLEMS },
  boons: { add: BASE_BOONS },
};
