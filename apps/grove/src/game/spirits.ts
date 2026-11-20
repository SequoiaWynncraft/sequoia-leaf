/**
 * The spirits a cone can hold. Rarity is the guild's own rank ladder; the rate card below is the
 * one the game shows the player, and the only one it rolls by.
 */
export const RANKS = ["Leafkin", "Sapling", "Sprite", "Dryad", "Druid", "Treant", "Yggdrasil"] as const;
/** Chance of each rank, in percent, as published. */
export const RATES = [40, 27, 16, 9, 5, 2.5, 0.5] as const;
export const RANK_COLOUR = ["#8bbf5a", "#5fc7a0", "#5aa9e6", "#b07ae6", "#e67fb0", "#f5b95e", "#fff3cf"] as const;
/** How much a spirit of each rank adds to what the tree makes: 0.15 is fifteen percent. */
export const RANK_BONUS = [0.15, 0.25, 0.4, 0.7, 1.1, 2, 4] as const;
/** A Treant or better within this many cones. */
export const PITY = 40;
export const TREANT = 5;
/** More of the same spirit deepen its bond, up to this many hearts; each heart adds a quarter of its bonus. */
export const HEARTS = 4;

export interface Kind {
  readonly id: string;
  readonly name: string;
  readonly rank: number;
  readonly says: string;
}
export const KINDS: readonly Kind[] = [
  { id: "leafling", name: "Leafling", rank: 0, says: "A sprout with opinions." },
  { id: "mossmote", name: "Mossmote", rank: 0, says: "Soft. Damp. Proud of it." },
  { id: "glorp", name: "Glorp", rank: 0, says: "Glorp." },
  { id: "slug", name: "Slug", rank: 1, says: "In no hurry at all." },
  { id: "chickaree", name: "Chickaree", rank: 1, says: "Buries cones and forgets where. That is how forests happen." },
  { id: "emberkit", name: "Emberkit", rank: 2, says: "Sleeps in the fire. Do not move it." },
  { id: "rock", name: "Rock", rank: 2, says: "It is a rock. It came anyway." },
  { id: "worm", name: "Worm", rank: 3, says: "Knows what is under the grove and will not say." },
  { id: "owl", name: "Fog Owl", rank: 3, says: "Brings the mist in with it." },
  { id: "moth", name: "Moth", rank: 4, says: "Came for the lantern. Stayed for you." },
  { id: "greg", name: "Greg", rank: 5, says: "Eats offerings. All of them." },
  { id: "fox", name: "White Fox", rank: 6, says: "Gold in its antlers. Nobody has seen it twice." },
];
export const kind = (id: string): Kind | undefined => KINDS.find((k) => k.id === id);
