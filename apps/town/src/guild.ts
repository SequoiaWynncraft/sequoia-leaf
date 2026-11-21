/**
 * The guild, as the town knows it. Everything that will one day come from the guild's server is
 * asked for here and nowhere else: who the member is, who is in town and what they are up to, what
 * the guild has just done, what is pinned on the board, what is for sale. Today the only answer is
 * the made-up guild in `madeup.ts`; the day there is a server, it answers these same questions.
 */

import type { Look } from "@sequoia-leaf/kit/skin.ts";

import type { PetId, Placed } from "./camp.ts";
import { keepText, kept } from "./keep.ts";
import { makeGuild } from "./madeup.ts";
import type { Letter } from "./mail.ts";

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
  /** The ranks of the guild, lowest first; `rank` is one of them. */
  ranks: readonly string[];
  /** What they have done with the guild this week, as a few short counts. */
  week: readonly string[];
}

export interface Quest {
  id: string;
  title: string;
  have: number;
  need: number;
  unit: string;
  reward: number;
  pays: "leaf" | "coins";
}

/** Something the Treasury sells for Leaf. */
export interface Ware {
  id: string;
  name: string;
  about: string;
  price: number;
  /** Bought once and kept, or as often as wanted. */
  once: boolean;
  /** Something that shows on the member, and so can be taken off again. */
  worn: boolean;
  /** What the keeper says when it is bought: at the counter, and out loud. */
  thanks: readonly [string, string];
}

/** A camp thing and what it costs: Coins at a stall, Leaf at the Treasury. */
export interface Stock {
  thing: string;
  price: number;
}

/** One of the market's stalls: who keeps it, and the camp things it sells for Coins. Nothing ever sells out. */
export interface Stall {
  id: string;
  by: string;
  name: string;
  /** What the keeper says when something goes. */
  words: readonly string[];
  stock: readonly Stock[];
}

/** Somebody who lives in a camp. */
export interface Pet {
  kind: PetId;
  name: string;
}

/** A guild-mate's own camp, as a visitor finds it. */
export interface MateCamp {
  owner: string;
  placed: readonly Placed[];
  pets: readonly Pet[];
  /** Whether they are at home just now. */
  home: boolean;
  /** The note on their door for when they are out. */
  note: string;
  /** What they say to a visitor. */
  hello: readonly string[];
}

/** What a guild-mate in town may be doing: sitting somewhere (`fire`, `bench`, `play`) or about an errand. */
export type Activity =
  | "fire"
  | "bench"
  | "play"
  | "treasury"
  | "quests"
  | "market"
  | "stall"
  | "works"
  | "table"
  | "pond"
  | "tree"
  | "pole"
  | "garden";

export type Tone = "gold" | "leaf" | "coral" | "rose";
export type Moment = "level" | "raidOut" | "raidBack" | "land" | "call";

/** Something that has just happened out in the guild. */
export type Happening =
  | { kind: "raidOut"; who: readonly string[]; raid: string }
  | { kind: "raidBack"; who: readonly string[]; raid: string; leaf: number }
  | { kind: "land"; name: string }
  | { kind: "level"; who: string; level: number }
  /** A quest has been finished and waits on the board. */
  | { kind: "quest"; id: string; text: string; tone: Tone }
  /** A guild-mate has looked in at the member's camp, with a note or a small present, or neither. */
  | { kind: "call"; id: string; who: string; note: string; gift: string };

/** One line of the letter that meets a returning member. */
export interface AwayLine {
  art: "leaf" | "coin" | "mates" | "crab" | "banner";
  text: string;
  /** What the line pays into the purse, if anything. */
  pay?: { kind: "leaf" | "coins"; amount: number };
  /** Guild-mates the line is about. */
  who?: readonly string[];
}

export interface Away {
  /** Whether this is the member's first time in town. */
  first: boolean;
  hours: number;
  lines: readonly AwayLine[];
}

export interface Guild {
  me(): Me;
  /** Who keeps the Treasury. */
  keeper(): Member;
  /** The guild-mates who are in town. */
  roster(): readonly Member[];
  /** What a guild-mate has gone off to do next. */
  doing(name: string): Activity;
  /** What is pinned on the board, with how far along each is. */
  quests(): readonly Quest[];
  wares(): readonly Ware[];
  /** The Treasury's fine pieces for a camp, for Leaf. */
  pieces(): readonly Stock[];
  stalls(): readonly Stall[];
  /** The small things a member may leave at somebody else's camp. */
  presents(): readonly string[];
  /** A guild-mate's camp, by their name; nothing for somebody the guild does not know. */
  camp(name: string): MateCamp | null;
  /** The letters guild-mates left in the member's mailbox between two moments (as for `away`). */
  mail(from: number, to: number): Letter[];
  /** Which crab is missing from roll call. */
  lostCrab(): number;
  /** What the guild did between two moments (milliseconds since 1970; `from` 0 means never here). */
  away(from: number, to: number): Away;
  /** Hears each thing as it happens. Returns how to stop. */
  hear(fn: (h: Happening) => void): () => void;
  /** Time passing in town, in seconds. */
  step(dt: number): void;
}

const GUILD_KEY = "town.guild.v1";

const madeUp = makeGuild({
  memory: kept(GUILD_KEY),
  keep: (text) => {
    keepText(GUILD_KEY, text);
  },
});

export const guild: Guild = madeUp;

/** Sets off one of the guild's moments now. Only the made-up guild can; it is for looking at the town. */
export const stir = (kind: Moment): void => {
  madeUp.stir(kind);
};
