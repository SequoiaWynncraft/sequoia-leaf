/**
 * The guild, as the town knows it. Everything of the guild's that comes from its server is asked
 * for here and nowhere else (`live.ts` asks): who the member is, which real members are in the game
 * or dozing in town, what the guild has just done, what is pinned on the board, and the member's
 * own news since the town last told them any. The member's town and camp are Leaf's play service's
 * (`leaf.ts`); the town's own creatures and keepers, and what is for sale, are the town's rules'
 * (`@sequoia-leaf/town`).
 */

import type { Look } from "@sequoia-leaf/kit/skin.ts";
import { must } from "@sequoia-leaf/kit/util.ts";
import type { Stand } from "@sequoia-leaf/town/map/rows.ts";

import { makeLive, prepared } from "./live.ts";
import type { InRoom, Where } from "./where.ts";

export interface Member {
  name: string;
  rank: string;
  level: number;
  /** How high their voice is, for the blips when they speak. */
  voice: number;
  look: Look;
}

export interface Me extends Member {
  /** How far through their level they are. */
  xp: number;
  next: number;
  /** Where their own skin sheet is served, if it is. */
  skin: string;
  /** What they have done with the guild this week, a line of a sheet each; nothing for a guest. */
  week: readonly Count[];
}

/** A line of a sheet: what is counted, and the number as it is written. */
export type Count = readonly [label: string, value: string];

/** One way to finish a quest, and how far along it is. */
export interface Goal {
  have: number;
  need: number;
  unit: string;
}

/** A quest on the board: it pays its Leaf by itself once done. */
export interface Quest {
  id: string;
  /** Its kind, as Leaf's slots are: `daily`, `weekly`, `timed` or `repeatable`. */
  slot: string;
  title: string;
  /** Every way to finish it while it is open, when Leaf sends each; otherwise the nearest, and for a quest done, the one that did it. */
  goals: readonly Goal[];
  reward: number;
  /** When an open quest ends, in milliseconds since 1970, if it ends at a set time. */
  ends: number | null;
  /** What rerolling it costs now: 0 when free, null when it cannot be rerolled. */
  reroll: number | null;
}

/** Somebody a piece of the guild's news is about: a real member, or the member themself. */
export interface Person {
  id: string;
  name: string;
  you: boolean;
}

/** A real member who is in one of the games just now, as the town shows them. */
export interface Visitor {
  id: string;
  name: string;
  /** Their rank, when the server says. */
  rank: string | null;
  /** By the Works' door, at the stump, or before the Grove's stone. */
  at: Stand;
  /** Where their skin sheet is served. */
  skin: string;
  /**
   * When they last did something, as far as anybody knows, or with nothing heard, when they came
   * there; null when nothing says. Away is Leaf's rule on it, as `awayFor` has it for a game.
   */
  acted: number | null;
}

/** A real member who has gone in the last day: one who stays dozes in town where they were, and one who does not goes. */
export interface Rester extends Omit<Visitor, "at" | "acted"> {
  /** Where they were: about the town, by the Works' door, at the stump, or in the Grove. */
  at: "town" | Stand;
  /** When they left, as Leaf says, in milliseconds since 1970. */
  seen: number;
  /** Whether their character stays in town. */
  stays: boolean;
}

/**
 * What the town's live room tells the guild of who is in it: everybody with the member, or null out
 * of it; their ranks; and when the page last saw each do something there (a move somewhere, an act).
 */
export interface RoomSays {
  room(): readonly InRoom[] | null;
  readonly ranks: ReadonlyMap<string, string>;
  readonly stirred: ReadonlyMap<string, number>;
}

export type Tone = "gold" | "leaf" | "coral" | "rose";

/**
 * One of the guild's moments the town stages: real members home from a raid together, or a war
 * they fought over a territory (the server's events say who fought where, not how it went).
 */
export interface Moment {
  kind: "party" | "war";
  /** The raid, or the territory. */
  what: string;
  /** Who was in it, as Leaf told of them, first told first. */
  who: readonly Person[];
  /** When it happened, as the guild's own record has it, in milliseconds since 1970. */
  happened: number;
  /** When the town begins to stage it, by Leaf's clock: the same on every page; 0 for one from before the page. */
  at: number;
}

/**
 * What the guild has done, as Leaf said when the page opened and as the page has heard since: the
 * same on every page, however long each has been open.
 */
export interface Deeds {
  /**
   * The raid parties and wars the town may still be staging, the newest fifty; and with them the
   * last war of all before those, for the banner.
   */
  moments: readonly Moment[];
  /** A UTC day (when it began), the newest heard of, and how many raids (`party`) and wars the guild finished in it, each once. */
  day: { from: number; party: number; war: number };
}

/** Something that has just happened out in the guild. */
export type Happening =
  /** Real members back from a raid together, the member first; `at` is when the town begins to stage it, by Leaf's clock. */
  | { kind: "party"; who: readonly Person[]; raid: string; at: number }
  /** Real members fought a war over a territory. */
  | { kind: "war"; who: readonly Person[]; land: string; at: number }
  /** A real member reached a level of their own with the guild. */
  | { kind: "reached"; who: Person; level: number }
  /** A real member reached one of the guild's milestones. */
  | { kind: "milestone"; who: Person; label: string };

/** One line of the letter that meets a returning member. */
export interface AwayLine {
  art: "leaf" | "coin" | "folk" | "crab" | "banner";
  text: string;
  /** Leaf the guild's ledger has already paid for it: shown, and not paid again. */
  got?: number;
  /** The town's own the line is about, by name. */
  who?: readonly string[];
}

export interface Guild {
  me(): Me;
  /** What is pinned on the board, with how far along each is. */
  quests(): readonly Quest[];
  /**
   * Swaps a quest on the board for another, for the Leaf the member was shown (`leaf`, 0 when
   * free); the new one takes its place at once. Gives back the Leaf it took, or Leaf's words for why
   * it did not happen; null, sending nothing, while another is on its way or for a quest no longer
   * on the board.
   */
  reroll(id: string, leaf: number): Promise<{ spent: number } | { said: string } | null>;
  /** A note pinned on the board in place of quests, for somebody quests are not for (a guest); null for anybody else. */
  boardNote(): string | null;
  /** The arrival letter's lines from the member's own news since the town last told them any. */
  news(): readonly AwayLine[];
  /** Hears each thing as it happens. Returns how to stop. */
  hear(fn: (h: Happening) => void): () => void;
  /** Puts the feed's line for one of the guild's moments in the feed, if the feed tells it, when its turn comes (`news.ts`). */
  say(h: Happening, feed: (text: string, tone: Tone) => void): void;
  /** Time passing in town, in seconds. */
  step(dt: number): void;
  /** The guild's raid parties and wars: what the town shows of them follows from these and Leaf's clock. */
  deeds(): Deeds;
  /** Real members standing at one of the games just now (`whereabouts`), never the member themself; at most twelve. */
  visitors(): readonly Visitor[];
  /** Real members who have gone in the last day, those who stay and those who do not (`whereabouts`); never anybody in the game now. */
  resting(): readonly Rester[];
  /**
   * Where everybody else is, one record each by id (`where.ts`), from the town's live room and
   * Leaf's list, by Leaf's clock: what "Who is about", its count, the figures in town and every card
   * show.
   */
  whereabouts(): ReadonlyMap<string, Where>;
  /** Hears who is in the town's live room from the page that keeps it (`players.ts`). */
  followRoom(says: RoomSays): void;
  /** Where the member is: in town, at a camp (whose: `camp`, its owner's id), in the Grove, or (null) in a game over the town. */
  here(place: "town" | "camp" | "grove" | null, camp?: string | null): void;
  /** Whether the member's own character stays in town, dozing, for a day after they go. */
  stay(on: boolean): void;
  /** How far the member's own news has been told, for Leaf's town to keep so that the next letter starts after it. */
  told(): number;
}

/** The guild, from what the town fetched before it opened (`open.ts`). */
export const guild: Guild = makeLive(must(prepared(), "the guild's news"));
