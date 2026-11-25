/**
 * The games that are places in the town. Each is a page of its own beside the town's; the town
 * shows it in a frame over itself (see `doors.ts`). What a game's card says is waiting there comes
 * from the postcard each game leaves for the town (the kit's `postcard.ts`); a game that has never
 * been opened has sent none, and gets a line of the town's. What the member has won there reaches
 * the camp through Leaf (its awards).
 */

import { WORKS_STATS } from "@sequoia-leaf/factory/stats.ts";
import { read } from "@sequoia-leaf/kit/postcard.ts";
import { RAID_STATS } from "@sequoia-leaf/raid/stats.ts";

import type { AwayLine } from "./guild.ts";

export type GameId = "works" | "table";

export interface Game {
  /** Also the name of its place in the town. */
  id: GameId;
  name: string;
  /** Where its page is, from the town's. Named in full so that a plain file server finds it too. */
  url: string;
  /** What it is, in a line. */
  about: string;
  /** What is waiting there just now, in a line. */
  waiting: () => string;
  /** The words on the button that goes in. */
  go: string;
  /** The note for when it will not open: a title, and a line that says why not, kindly. */
  shut: readonly [string, string];
}

/** How long a game has to say it is ready before the town stops waiting, in milliseconds. */
export const READY_WAIT = 4500;

export const GAMES: Readonly<Record<GameId, Game>> = {
  works: {
    id: "works",
    name: WORKS_STATS.name,
    url: "../works/index.html",
    about: "Your yard, behind the workshop. Coins are made here.",
    waiting: () => read("works")?.waiting ?? "The yard is quiet. Somebody should start it up.",
    go: "Go in",
    shut: ["Door's stuck", "Fika has gone to find the key. The Works is not open yet."],
  },
  table: {
    id: "table",
    name: RAID_STATS.name,
    url: "../battler/index.html",
    about: "The guild's board game, cut into a great stump.",
    waiting: () => read("raid")?.waiting ?? "The board is set out. One crab is uncounted.",
    go: "Sit down",
    shut: ["No game yet", "Somebody is still carving the figures. Not long now."],
  },
};

export const isGame = (id: string): id is GameId => id === "works" || id === "table";

/**
 * What the Works has waiting, as a line for the arrival letter; it pays nothing. What the yard
 * earns gathers in its till, on Leaf, for as long as it works on after the member's last command;
 * none of it reaches their Coins until they go in (putting the Works' own letter away pays it in, or
 * the page does within a minute) or buy something there. The `till` is the postcard's: what this
 * browser last saw, at most a minute's earnings, since the page pays it in once a minute. It only
 * says Coins are there; how many, Leaf alone knows, so the line gives no number.
 */
export function worksWaiting(till = read("works")?.till ?? 0): AwayLine | null {
  if (till < 1) return null;
  return { art: "coin", text: "Your Works has Coins waiting. Go in to collect them." };
}
