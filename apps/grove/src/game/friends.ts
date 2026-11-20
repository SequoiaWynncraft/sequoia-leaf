/**
 * The prototype's friends in the call: made-up names and faces, never real members (the guild's
 * line on likeness and consent). Each brings a companion spirit to the fire.
 */

export interface Friend {
  name: string;
  /** Their companion's cast id. */
  spirit: string;
  /** Rows they solved today's Leafle in, or 0 if they are still thinking. */
  leafle: number;
}

export const FRIENDS: readonly Friend[] = [
  { name: "Moss", spirit: "mossmote", leafle: 3 },
  { name: "Fern", spirit: "glurp", leafle: 4 },
  { name: "Cinder", spirit: "emberkit", leafle: 0 },
  { name: "Wren", spirit: "crab", leafle: 5 },
];

/** Members who hung a lantern in the Great Sequoia this week: the friends, and a few more. */
export const LANTERN_HANGERS: readonly string[] = [...FRIENDS.map((f) => f.name), "Alder", "Juniper"];
