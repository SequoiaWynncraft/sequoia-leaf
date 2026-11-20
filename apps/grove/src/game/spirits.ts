/**
 * The spirit book: every spirit a cone can give, with its rank, its number in the guild's book, its
 * job in your glade and its book line. The name and the book line come from the cast (`cast.ts`; its
 * pictures are the bundle's cast sheets); the rank comes from the banner's pools in rules.ts, so the
 * book and the odds can never disagree.
 */

import { CAST, type CastMember, castMember } from "./cast.ts";
import { POOLS, type RankName, RANKS } from "./rules.ts";

/** What each spirit does in your glade, visibly. */
const JOBS: Readonly<Record<string, string>> = {
  glarp: "Waters the mushrooms. Mostly.",
  glerp: "Licks the dew off the ferns.",
  glirp: "Tends a sprout by the gate.",
  glorp: "Guards the cone stone. Stares.",
  glurp: "Blows bubbles over the clearing.",
  glyrp: "Naps in the warm spot. Raises morale.",
  gleep: "Tucks the seedlings in at night.",
  chickaree: "Seedlings come up round your tree.",
  crab: "Keeps the path tidy, sideways.",
  "crab-08": "Turns up somewhere new each day.",
  mossmote: "Leaves moss where it hops.",
  slug: "Moss creeps over the roots.",
  "fog-owl": "Mist at dawn: one more care charge.",
  emberkit: "Your fire never goes out.",
  rock: "Holds the glade down in a storm.",
  worm: "Turns the soil round your tree.",
  greg: "Eats your offerings. Looks satisfied.",
  moth: "Dusts the lanterns with light at night.",
  "white-fox": "Guides lost spirits back to your glade.",
};

export interface Spirit {
  member: CastMember;
  id: string;
  name: string;
  rank: RankName;
  /** Its number in the guild's book: its place in the cast, from 1. */
  number: number;
  job: string;
  note: string;
}

const rankOf = (id: string): RankName | null => RANKS.find((r) => POOLS[r.name].includes(id))?.name ?? null;

/** Every spirit, in book order. */
export const SPIRITS: readonly Spirit[] = CAST.flatMap((member, i): Spirit[] => {
  const rank = rankOf(member.id);
  if (!rank) return [];
  return [
    {
      member,
      id: member.id,
      name: member.name,
      rank,
      number: i + 1,
      job: JOBS[member.id] ?? member.note,
      note: member.note,
    },
  ];
});

export function spirit(id: string): Spirit {
  const found = SPIRITS.find((s) => s.id === id) ?? SPIRITS[0];
  if (!found) throw new Error("the spirit book is empty");
  return found;
}

/** The spirit each rank shows in a still (`?scene=cone&rank=`), when no roll chose one. */
const SHOWCASE: Readonly<Record<RankName, string>> = {
  Leafkin: "glorp",
  Sapling: "mossmote",
  Sprite: "chickaree",
  Dryad: "fog-owl",
  Druid: "moth",
  Treant: "greg",
  Yggdrasil: "white-fox",
};

export function spiritForRank(rank: RankName): Spirit {
  const id = SHOWCASE[rank];
  return spirit(castMember(id) && POOLS[rank].includes(id) ? id : (POOLS[rank][0] ?? "glorp"));
}
