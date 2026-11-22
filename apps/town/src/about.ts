/**
 * "Who is about": the rules with no page in them. Who goes in which part of the panel, in what
 * order, and the line under each name (`whoIsAbout`). `aboutui.ts` is the page that shows them.
 *
 * - **In town**: everybody in the town's live room with the member, the member first, marked as
 *   them. Out of the room (the made-up guild, or a connection let go of), whoever the guild says is
 *   in town.
 * - **Elsewhere**: in the game, but not in town: at the Works, at the raid table, in their camp.
 * - **Seen lately**: gone in the last day, newest first, with how long ago; first of all whoever
 *   has only just walked out of the town's room.
 *
 * Nobody is in two parts: the room is believed over the guild's lists, which can be half a minute
 * old, and whoever is in the game now is not "seen lately".
 */

import type { Mate } from "./guild.ts";
import { span } from "./letter.ts";

/** Somebody in the town's live room, as the panel needs them. */
export interface InRoom {
  id: string;
  name: string;
  /** Their rank as the town shows it, `GUEST` for a guest, or null for none. */
  rank: string | null;
}

/** One line of the panel: somebody, and the words under their name. */
export interface AboutRow {
  id: string;
  name: string;
  /** Their rank or "Guest", and for somebody elsewhere where they are, for somebody gone how long ago. */
  line: string;
  /** The member themself. */
  you: boolean;
}

export type PartName = "In town" | "Elsewhere" | "Seen lately";

export interface AboutPart {
  title: PartName;
  rows: AboutRow[];
}

export interface About {
  /** The parts with anybody in them, in order. */
  parts: AboutPart[];
  /** How many are in the game now, the member too. */
  count: number;
  /** Nobody anywhere but the member: the panel says only `ALONE`. */
  alone: boolean;
}

/** What the panel says when there is nobody else anywhere. */
export const ALONE = "Only you, for now.";

/** Where somebody in the game but not in town is, in words. */
export const WHERE: Readonly<Record<Mate["at"], string>> = {
  town: "in town",
  works: "at the Works",
  table: "at the raid table",
  camp: "in their camp",
};

/** The line for somebody who walked out of town within the last minute or so. */
export const JUST_NOW = "just now";

/** How long ago somebody was last seen, in the words the dozers' cards use: "3 hours ago". */
export const agoLine = (seen: number, now: number): string => `${span(Math.max(0, (now - seen) / 60_000))} ago`;

const line = (...parts: readonly (string | null)[]): string => parts.filter((p) => p !== null && p !== "").join(" · ");
const byName = (a: { name: string }, b: { name: string }): number =>
  a.name.localeCompare(b.name, "en", { sensitivity: "base" });

/**
 * Who is about, part by part. `me` is the member; `room` everybody in the town's room with them,
 * the member too, or null while the page is in no room; `present` and `resting` the guild's lists
 * (`Guild.about`); `ranks` the ranks the page has learnt of anybody, by id, for those the lists do
 * not say; `now` the time, in milliseconds since 1970.
 */
export function whoIsAbout(o: {
  me: InRoom;
  room: readonly InRoom[] | null;
  present: readonly Mate[];
  resting: readonly Mate[];
  ranks?: ReadonlyMap<string, string>;
  now: number;
}): About {
  const rankOf = (m: { id: string; rank: string | null }): string | null => m.rank ?? o.ranks?.get(m.id) ?? null;
  const seen = new Set<string>([o.me.id]);
  const take = (m: { id: string }): boolean => {
    if (seen.has(m.id)) return false;
    seen.add(m.id);
    return true;
  };

  const others =
    o.room === null
      ? o.present.filter((m) => m.at === "town").map((m) => ({ id: m.id, name: m.name, rank: m.rank }))
      : o.room;
  const town: AboutRow[] = [
    { id: o.me.id, name: o.me.name, line: line(rankOf(o.me)), you: true },
    ...others
      .filter(take)
      .toSorted(byName)
      .map((m) => ({ id: m.id, name: m.name, line: line(rankOf(m)), you: false })),
  ];
  // In the room, the room says who is in town: anybody the guild still has in town has just left
  // it, and heads "Seen lately" until the guild's lists say so themselves.
  const elsewhere = o.present
    .filter((m) => m.at !== "town" && take(m))
    .toSorted(byName)
    .map((m) => ({ id: m.id, name: m.name, line: line(rankOf(m), WHERE[m.at]), you: false }));
  const justLeft = o.room === null ? [] : o.present.filter((m) => m.at === "town" && take(m)).toSorted(byName);
  for (const m of o.present) seen.add(m.id);
  const lately = [...justLeft, ...o.resting.filter(take).toSorted((a, b) => (b.seen ?? 0) - (a.seen ?? 0))].map(
    (m) => ({
      id: m.id,
      name: m.name,
      line: line(rankOf(m), m.seen === null ? JUST_NOW : agoLine(m.seen, o.now)),
      you: false,
    }),
  );

  const parts: AboutPart[] = [
    { title: "In town" as const, rows: town },
    { title: "Elsewhere" as const, rows: elsewhere },
    { title: "Seen lately" as const, rows: lately },
  ].filter((p) => p.rows.length > 0);
  const count = town.length + elsewhere.length;
  return { parts, count, alone: count === 1 && lately.length === 0 };
}
