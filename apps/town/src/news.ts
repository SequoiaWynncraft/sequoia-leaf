/**
 * What the feed says about each of the guild's moments, in a line, and on the guild's own server
 * how often. Real members' news never says how much Leaf anybody was paid, nor more than the
 * server's event does.
 */

import type { Happening, Person, Tone } from "./guild.ts";

/** A line for the feed, and its colour. */
export type Line = readonly [string, Tone];

/** How many real players, members and guests together, are in the game besides the member, in a line for the feed. */
export function inTownLine(n: number): string {
  if (n <= 0) return "The town is quiet.";
  return n === 1 ? "1 is in town." : `${n} are in town.`;
}

/** Names in a line: the member first as "You", then up to three in all, and how many more. */
export function names(who: readonly Person[]): string {
  const said = who.map((p) => (p.you ? "You" : p.name));
  const shown = said.length > 3 ? [...said.slice(0, 2), `${said.length - 2} more`] : said;
  if (shown.length <= 1) return shown[0] ?? "Somebody";
  return `${shown.slice(0, -1).join(", ")} and ${shown.at(-1) ?? ""}`;
}

const one = (p: Person): string => (p.you ? "You" : p.name);

/** The feed's line for one of the made-up guild's moments, or null for one the feed does not tell. */
export function lineFor(h: Happening): Line | null {
  switch (h.kind) {
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

/** Another member's level is told in the feed only at a multiple of this. */
export const LEVELS_TOLD = 5;

/**
 * The feed's line for one of the guild's moments on its own server, which claims no more than the
 * server's event: a war event says who fought at a territory, not how it went; and another member's
 * level is told only at a multiple of five (the member's own always is, and is in their letter).
 */
export function liveLineFor(h: Happening): Line | null {
  if (h.kind === "war") return [`${names(h.who)} fought at ${h.land}.`, "rose"];
  if (h.kind === "reached" && !h.who.you && h.level % LEVELS_TOLD !== 0) return null;
  return lineFor(h);
}

/** On the guild's own server, the least time between two of its news's lines, in milliseconds. */
export const PACE = 20_000;
/** How long one of its lines waits its turn before it is dropped, in milliseconds. */
export const STALE = 5 * 60_000;

/**
 * The guild's news on its own server, kept to a pace: at most one line every twenty seconds, the
 * others waiting their turn, oldest first, and any that has waited more than five minutes dropped.
 * Only the line waits; whatever happens in the world for the event does not.
 */
export function makePace<T>(): { add(item: T, now: number): void; due(now: number): T[] } {
  const queue: { item: T; at: number }[] = [];
  let last = -Infinity;
  return {
    add(item, now) {
      queue.push({ item, at: now });
    },
    due(now) {
      while (queue[0] && now - queue[0].at > STALE) queue.shift();
      const next = queue[0];
      if (!next || now - last < PACE) return [];
      queue.shift();
      last = now;
      return [next.item];
    },
  };
}
