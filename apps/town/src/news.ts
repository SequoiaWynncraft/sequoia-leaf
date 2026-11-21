/**
 * What the feed says about each of the guild's moments, in a line. Real members' news never says
 * how much Leaf anybody was paid.
 */

import type { Happening, Person, Tone } from "./guild.ts";

/** Names in a line: the member first as "You", then up to three in all, and how many more. */
export function names(who: readonly Person[]): string {
  const said = who.map((p) => (p.you ? "You" : p.name));
  const shown = said.length > 3 ? [...said.slice(0, 2), `${said.length - 2} more`] : said;
  if (shown.length <= 1) return shown[0] ?? "Somebody";
  return `${shown.slice(0, -1).join(", ")} and ${shown.at(-1) ?? ""}`;
}

const one = (p: Person): string => (p.you ? "You" : p.name);

/** The feed's line for a moment and its colour, or null for one the feed does not tell. */
export function lineFor(h: Happening): readonly [string, Tone] | null {
  switch (h.kind) {
    case "raidOut":
      return [`${h.who[0] ?? "A"}'s party set out for ${h.raid}.`, "coral"];
    case "raidBack":
      return [`Raid cleared: ${h.raid}. ${h.leaf} Leaf each.`, "coral"];
    case "land":
      return [`The guild has taken ${h.name}.`, "rose"];
    case "level":
      return [`${h.who} reached level ${h.level}.`, "leaf"];
    case "quest":
      return [h.text, h.tone];
    case "call":
      return null;
    case "party":
      return [`${names(h.who)} came back from ${h.raid}.`, "coral"];
    case "war":
      return [
        h.held ? `${names(h.who)} held ${h.land} for the guild.` : `${names(h.who)} fought for ${h.land}.`,
        "rose",
      ];
    case "reached":
      return [`${one(h.who)} reached level ${h.level}.`, "leaf"];
    case "milestone":
      return [`${one(h.who)} reached a milestone: ${h.label}.`, "gold"];
  }
}
