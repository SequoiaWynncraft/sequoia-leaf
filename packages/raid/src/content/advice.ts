/**
 * Advice for the cards, which the fight never reads: what kind of fighter each calling makes and
 * where it stands, and three finished items that suit each figure.
 *
 * The items follow the calling first: tanks take what Bark and Chestnut make, fighters and
 * assassins Thorn with Chestnut or Plume, ranged Thorn and Plume, casters and healers Glowcap
 * (with Plume where the ability comes round often, with Chestnut for healers). A figure whose own
 * ability wants something else has its own three. `bun review/balance.ts 200 0 suits` plays sample
 * fights again with each figure given each item, and none of these is among a figure's three worst.
 */
import type { FigureId } from "./figures.ts";
import type { FinishedId } from "./items.ts";
import { type CallingId, traitDraw } from "./traits.ts";

export interface Role {
  /** The kind of fighter, in a word. */
  readonly role: string;
  /** Where it fights from. */
  readonly place: string;
}

export const ROLES: Readonly<Record<CallingId, Role>> = {
  bulwark: { role: "Tank", place: "front row" },
  fang: { role: "Fighter", place: "front row" },
  slinger: { role: "Ranged", place: "back row" },
  sage: { role: "Caster", place: "back row" },
  mender: { role: "Healer", place: "back row" },
  sneak: { role: "Assassin", place: "leaps to the enemy back row" },
};

/** What a figure's draw is called on its card: "Draws fire", "Draws fire ×2", "Avoids fire"; nothing for 0. */
export function drawName(draw: number): string | null {
  if (draw === 0) return null;
  if (draw < 0) return draw === -1 ? "Avoids fire" : `Avoids fire ×${-draw}`;
  return draw === 1 ? "Draws fire" : `Draws fire ×${draw}`;
}
/** How far a draw moves a figure in its enemies' eyes, as a number: "1 hex nearer", "2 hexes further". */
export const drawReach = (draw: number): string =>
  `${Math.abs(draw)} ${Math.abs(draw) === 1 ? "hex" : "hexes"} ${draw > 0 ? "nearer" : "further"}`;
/** What a draw means, in a sentence, for the chip's tip. */
export const drawTip = (draw: number): string =>
  `Enemies pick their target as if this figure stood ${drawReach(draw)}.`;

/** The line a card shows under a figure's name: `Tank · front row · draws fire`. */
export function roleLine(calling: CallingId): string {
  const draw = drawName(traitDraw(calling));
  return [ROLES[calling].role, ROLES[calling].place, ...(draw ? [draw.toLowerCase()] : [])].join(" · ");
}

export type Three = readonly [FinishedId, FinishedId, FinishedId];

export const GOOD_WITH: Readonly<Record<FigureId, Three>> = {
  // Tanks: what Bark and Chestnut make.
  barrowgnome: ["hoard", "hollowlog", "lichen"],
  slug: ["hoard", "hollowlog", "hedgehog"],
  glorp: ["hoard", "hollowlog", "lichen"],
  rock: ["hedgehog", "hoard", "hollowlog"],
  crab40: ["hedgehog", "hoard", "hollowlog"],
  greg: ["hoard", "hollowlog", "lichen"],
  // Fighters: Thorn with Chestnut or Plume.
  emberkit: ["conker", "honeycake", "wasptail"],
  crab7: ["conker", "honeycake", "wasptail"],
  jay: ["wasptail", "honeycake", "conker"],
  badger: ["conker", "honeycake", "wasptail"],
  whitefox: ["mothlantern", "honeycake", "glowthorn"],
  // Assassins: the same, though the ones that leap into the back row live longer for a shield.
  worm: ["honeycake", "conker", "wasptail"],
  fogowl: ["honeycake", "wasptail", "conker"],
  bushgnome: ["honeycake", "lichen", "hollowlog"],
  hearthcat: ["honeycake", "conker", "lichen"],
  // Ranged: Thorn and Plume.
  finch: ["wasptail", "honeycake", "hummingbird"],
  chickaree: ["wasptail", "mothlantern", "conker"],
  crab12: ["wasptail", "mothlantern", "conker"],
  drizzlefrog: ["wasptail", "mothlantern", "honeycake"],
  heron: ["wasptail", "mothlantern", "conker"],
  // Casters: Glowcap, with Plume where the ability comes round often.
  moth: ["mothlantern", "glowthorn", "lichen"],
  lanterngnome: ["fairyring", "mothlantern", "glowthorn"],
  leafling: ["stewpot", "lichen", "glowthorn"],
  cindernewt: ["glowthorn", "lichen", "stewpot"],
  // Healers: Glowcap, with Chestnut.
  mossmote: ["stewpot", "glowthorn", "mothlantern"],
  kettle: ["stewpot", "glowthorn", "lichen"],
  crab23: ["stewpot", "glowthorn", "lichen"],
  apothecary: ["glowthorn", "stewpot", "mothlantern"],
  "banner-1": ["stewpot", "glowthorn", "lichen"],
};
