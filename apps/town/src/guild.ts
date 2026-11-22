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
import type { PetId, Placed } from "@sequoia-leaf/town/camp.ts";

import { makeLive, prepared } from "./live.ts";

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
  /** The ranks of the guild, lowest first; `rank` is one of them. None for a guest, who has no rank. */
  ranks: readonly string[];
  /** What they have done with the guild this week, as a few short counts; nothing for a guest. */
  week: readonly string[];
}

/** A quest on the board: it pays its Leaf by itself once done. */
export interface Quest {
  id: string;
  title: string;
  have: number;
  need: number;
  unit: string;
  reward: number;
  /** When it ends, in milliseconds since 1970, if it ends at a set time. */
  ends: number | null;
}

/** Somebody who lives in a camp. */
export interface Pet {
  kind: PetId;
  name: string;
}

/** A member's own camp, as a visitor would find it. */
export interface MateCamp {
  owner: string;
  placed: readonly Placed[];
  /** The trophies on their shelf. */
  earned: readonly string[];
  pets: readonly Pet[];
  /** Whether they are at home just now. */
  home: boolean;
  /** The note on their door for when they are out. */
  note: string;
  /** What they say to a visitor. */
  hello: readonly string[];
}

/** Somebody a piece of the guild's news is about: a real member, or the member themself. */
export interface Person {
  id: string;
  name: string;
  you: boolean;
}

/** A real member who is in the game just now, as the town shows them. */
export interface Visitor {
  id: string;
  name: string;
  /** Their rank, when the server says. */
  rank: string | null;
  /** About the town, by the Works' door, or watching at the stump. */
  at: "town" | "works" | "table";
  /** Where their skin sheet is served. */
  skin: string;
}

/** A real member who has gone, and whose character stays in town for a day, dozing where they were. */
export interface Rester extends Visitor {
  /** When the game last saw them, in milliseconds since 1970. */
  seen: number;
}

/** Somebody else in the game now, or gone in the last day and staying, as "Who is about" lists them. */
export interface Mate {
  id: string;
  name: string;
  /** Their rank as the town shows it, `GUEST` for a guest, or null when nobody has said. */
  rank: string | null;
  /** Where they are, or were last. */
  at: "town" | "camp" | "works" | "table";
  /** When the game last saw them, in milliseconds since 1970: for somebody gone; null for somebody in the game now. */
  seen: number | null;
}

export type Tone = "gold" | "leaf" | "coral" | "rose";

/** Something that has just happened out in the guild. */
export type Happening =
  /** Real members back from a raid together. */
  | { kind: "party"; who: readonly Person[]; raid: string }
  /** Real members fought a war over a territory: the server's events say who fought where, not how it went. */
  | { kind: "war"; who: readonly Person[]; land: string }
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
  /** Real members in the game just now, never the member themself; at most twelve. */
  visitors(): readonly Visitor[];
  /** Real members who have gone in the last day, dozing in town, most recent first; never anybody in `visitors`. */
  resting(): readonly Rester[];
  /**
   * Everybody else in the game now, wherever they are (their own camp too), and everybody gone in the
   * last day whose character stays, newest first, wherever they were last: as many as the guild
   * says, for "Who is about".
   */
  about(): { present: readonly Mate[]; resting: readonly Mate[] };
  /** Whether anybody has said yet who is about: the first answer takes a moment. */
  heard(): boolean;
  /** Where the member is: in town, at their camp, or (null) in a game over the town. */
  here(place: "town" | "camp" | null): void;
  /** Whether the member's own character stays in town, dozing, for a day after they go. */
  stay(on: boolean): void;
  /** How far the member's own news has been told, for Leaf's town to keep so that the next letter starts after it. */
  told(): number;
}

/** The guild, from what the town fetched before it opened (`open.ts`). */
export const guild: Guild = makeLive(must(prepared(), "the guild's news"));
