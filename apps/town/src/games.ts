/**
 * The games that are places in the town. Each is a page of its own beside the town's; the town
 * shows it in a frame over itself (see `doors.ts`). What a game's card says is waiting there comes
 * from a small function per game, so that the day a game can say for itself, its real numbers go
 * in here and nowhere else.
 */

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
    name: "The Works",
    url: "../works/index.html",
    about: "Your yard, behind the workshop. Coins are made here.",
    waiting: () => "Three orders are up on the depot's board.",
    go: "Go in",
    shut: ["Door's stuck", "Embertoe has gone to find the key. The Works is not open yet."],
  },
  table: {
    id: "table",
    name: "The Little Raid",
    url: "../battler/index.html",
    about: "The guild's board game, cut into a great stump.",
    waiting: () => "The first wing is set out. One crab is uncounted.",
    go: "Sit down",
    shut: ["No game yet", "Somebody is still carving the figures. Not long now."],
  },
};

export const isGame = (id: string): id is GameId => id === "works" || id === "table";

/** The most hours of being away that the Works is paid for. */
const WORKS_HOURS = 8;
const PLANKS_AN_HOUR = 11;
const COINS_A_PLANK = 2;

/**
 * What the Works made while the member was away, as a line for the arrival letter. It is made up
 * from the time alone until the Works can report what its yard really did.
 */
export function worksAway(hours: number, first: boolean): AwayLine | null {
  const planks = Math.floor(Math.min(WORKS_HOURS, first ? WORKS_HOURS : Math.max(0, hours)) * PLANKS_AN_HOUR);
  if (planks < 1) return null;
  return {
    art: "coin",
    text: `${planks} plank${planks === 1 ? "" : "s"} off your Works`,
    pay: { kind: "coins", amount: planks * COINS_A_PLANK },
  };
}

/**
 * What the member has won in The Little Raid: the bosses they have beaten, by the game's own names
 * for them. Made up until the game can say for itself.
 */
export function raidWon(): readonly string[] {
  return ["oldbramble"];
}

/** The capstones the member has built in the Works, by the Works' own names for them. Made up for now. */
export function worksBuilt(): readonly string[] {
  return ["crab"];
}

/** The camp things those have earned: a carved figure for each boss, a model of each capstone. */
export function trophies(): string[] {
  return [...raidWon().map((boss) => `trophy-${boss}`), ...worksBuilt().map((made) => `model-${made}`)];
}
