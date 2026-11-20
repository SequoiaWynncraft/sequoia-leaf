/**
 * Who the cast are: each member's stable id (the bundle's cast sheets use the same ids), the name
 * cards and the spirit book show, its family and its book line, in the order of the spirit book.
 * Their pictures are the bundle's (`../bundle/cast.ts`); this is only what they are called.
 */

/** Which family a member belongs to: the gacha lines, plus the grove's folk who are never pulled. */
export type Line = "glorp" | "critter" | "raid" | "legend" | "folk";

export interface CastMember {
  /** Stable id, lower case: `glorp`, `crab`, `white-fox`. */
  readonly id: string;
  /** As shown on cards and in the spirit book. */
  readonly name: string;
  readonly line: Line;
  /** One line for the spirit book. */
  readonly note: string;
}

export const CAST: readonly CastMember[] = [
  { id: "glarp", name: "Glarp", line: "glorp", note: "Tucked a blossom behind one ear and forgot it was there." },
  { id: "glerp", name: "Glerp", line: "glorp", note: "Tongue out. Has been for some time." },
  { id: "glirp", name: "Glirp", line: "glorp", note: "Growing something. Will not say what." },
  { id: "glorp", name: "Glorp", line: "glorp", note: "The original. Has seen something and cannot unsee it." },
  { id: "glurp", name: "Glurp", line: "glorp", note: "Blows a bubble, watches it go, blows another." },
  { id: "glyrp", name: "Glyrp", line: "glorp", note: "Content. Suspiciously content." },
  { id: "gleep", name: "Gleep", line: "glorp", note: "Ready for bed at all hours." },
  {
    id: "chickaree",
    name: "Chickaree",
    line: "critter",
    note: "Plants seedlings round your tree. Keeps one cone back.",
  },
  { id: "crab", name: "Crab", line: "critter", note: "Keeps the shop. Rule 2: no crabellions." },
  { id: "crab-08", name: "Crab No. 08", line: "critter", note: "Whereabouts unknown." },
  {
    id: "mossmote",
    name: "Mossmote",
    line: "critter",
    note: "A puff of moss that hops. Leaves a little green where it lands.",
  },
  { id: "slug", name: "Banana Slug", line: "critter", note: "Spreads moss. Wears the leaf with confidence." },
  { id: "fog-owl", name: "Fog Owl", line: "critter", note: "Brings the morning mist. Refills a care charge." },
  { id: "emberkit", name: "Emberkit", line: "critter", note: "Keeps the campfire lit and warm." },
  { id: "rock", name: "Rock", line: "raid", note: "The Canyon Colossus, in spirit. Stoic. Mossy." },
  { id: "worm", name: "Worm", line: "raid", note: "Nest of the Grootslangs, in spirit. Delighted to see you." },
  { id: "greg", name: "Greg", line: "raid", note: "The Nameless Anomaly, in spirit. He eats offerings." },
  { id: "moth", name: "Moth", line: "raid", note: "The Wartorn Palace, in spirit. Fuzzy." },
  { id: "white-fox", name: "The White Fox", line: "legend", note: "Nexus of Light. Sleeps by the campfire." },
  { id: "gnome", name: "Gnome Herald", line: "folk", note: "Announces level-ups and rare finds, at volume." },
  { id: "cinfy", name: "Cinfy", line: "folk", note: "Treasurer. Runs the shop. Knows what you borrowed." },
];

export function castMember(id: string): CastMember | undefined {
  return CAST.find((m) => m.id === id);
}
