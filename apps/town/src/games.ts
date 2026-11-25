/**
 * The games that are places in the town. Each is a page of its own beside the town's; the town
 * shows it in a frame over itself (see `doors.ts`). What a game's card says is waiting there is its
 * postcard, which Leaf keeps with the member's state in the game and gives the town in its view
 * (`TownView.doors`); a game the member has no state in has none, and gets a line of the town's.
 * What the member has won there reaches the camp through Leaf too (its awards).
 */

import type { Postcards } from "@sequoia-leaf/core";
import { WORKS_STATS } from "@sequoia-leaf/factory/stats.ts";
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
  /** What is waiting there, in a line, from the town's doors as Leaf gave them. */
  waiting: (doors: Postcards) => string;
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
    waiting: (doors) => doors.works?.waiting ?? "The yard is quiet. Somebody should start it up.",
    go: "Go in",
    shut: ["Door's stuck", "Fika has gone to find the key. The Works is not open yet."],
  },
  table: {
    id: "table",
    name: RAID_STATS.name,
    url: "../battler/index.html",
    about: "The guild's board game, cut into a great stump.",
    waiting: (doors) => doors.raid?.waiting ?? "The board is set out. One crab is uncounted.",
    go: "Sit down",
    shut: ["No game yet", "Somebody is still carving the figures. Not long now."],
  },
};

export const isGame = (id: string): id is GameId => id === "works" || id === "table";

/**
 * What the Works has waiting, as a line for the arrival letter; it pays nothing. Whatever the yard
 * earns gathers in its till (the depot's takings, and orders and goals handed over), which Leaf
 * keeps on the yard's postcard, the yard run on while the member is away; none of it reaches their
 * Coins until they go in (putting the Works' own letter away pays it in, or the page does within a
 * minute) or buy something there. So the line says what is waiting, not when it was made.
 */
export function worksWaiting(doors: Postcards): AwayLine | null {
  const till = doors.works?.till ?? 0;
  if (till < 1) return null;
  const coins = till === 1 ? "1 Coin" : `${till.toLocaleString("en-US")} Coins`;
  return {
    art: "coin",
    text: `Your Works has ${coins} waiting for you. Go in to collect ${till === 1 ? "it" : "them"}.`,
  };
}
