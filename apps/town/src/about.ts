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
 * The panel is one row for each player, kept by their id, so nobody can be listed twice: the room
 * is believed over the guild's lists, which can be half a minute old, and whoever is in the game
 * now is not "seen lately". That is the panel as it is opened; while it stays open its order holds
 * (`held`).
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

export type PartName = "In town" | "Elsewhere" | "Seen lately";

/** The parts, in the order the panel shows them. */
const PARTS: readonly PartName[] = ["In town", "Elsewhere", "Seen lately"];

/** One line of the panel: somebody, the part they are listed in, and the words under their name. */
export interface AboutRow {
  id: string;
  name: string;
  part: PartName;
  /** Their rank or "Guest", and for somebody elsewhere where they are, for somebody gone how long ago. */
  line: string;
  /** The member themself. */
  you: boolean;
  /** No longer in this part, but still listed in it, dimmed, while the panel stays open (`held`). */
  gone?: true;
}

export interface AboutPart {
  title: PartName;
  rows: AboutRow[];
}

export interface About {
  /** Everybody listed, one row each by their id; in each part, in the order the panel shows them. */
  rows: ReadonlyMap<string, AboutRow>;
  /** How many are in the game now, the member too. */
  count: number;
  /** Nobody anywhere but the member: the panel says only `ALONE`. */
  alone: boolean;
}

/** The parts with anybody in them, in order. */
export const partsOf = (a: About): AboutPart[] =>
  PARTS.flatMap((title) => {
    const rows = [...a.rows.values()].filter((r) => r.part === title);
    return rows.length > 0 ? [{ title, rows }] : [];
  });

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
  const rows = new Map<string, AboutRow>();
  /** Lists somebody in `part`, unless an earlier part has them. */
  const put = (part: PartName, m: { id: string; name: string }, words: string, you = false): void => {
    if (!rows.has(m.id)) rows.set(m.id, { id: m.id, name: m.name, part, line: words, you });
  };

  put("In town", o.me, line(rankOf(o.me)), true);
  const others =
    o.room === null
      ? o.present.filter((m) => m.at === "town").map((m) => ({ id: m.id, name: m.name, rank: m.rank }))
      : o.room;
  for (const m of others.toSorted(byName)) put("In town", m, line(rankOf(m)));
  for (const m of o.present.filter((p) => p.at !== "town").toSorted(byName))
    put("Elsewhere", m, line(rankOf(m), WHERE[m.at]));
  // In the room, the room says who is in town: anybody the guild still has in town has just left
  // it, and heads "Seen lately" until the guild's lists say so themselves.
  const justLeft = o.room === null ? [] : o.present.filter((m) => m.at === "town").toSorted(byName);
  for (const m of [...justLeft, ...o.resting.toSorted((a, b) => (b.seen ?? 0) - (a.seen ?? 0))])
    put("Seen lately", m, line(rankOf(m), m.seen === null ? JUST_NOW : agoLine(m.seen, o.now)));

  const count = [...rows.values()].filter((r) => r.part !== "Seen lately").length;
  return { rows, count, alone: count === 1 && rows.size === 1 };
}

/**
 * What the panel shows while it stays open: what it `showed`, in the order it showed it, brought up
 * to who is about `now`. Whoever is still in the part they were listed in stays where they were.
 * Whoever has left it stays there too, dimmed, the words under their name saying where they are
 * now; nobody is listed again in another part. Whoever is new to the panel goes to the end of their
 * part. Only a panel opened afresh is sorted again.
 */
export function held(showed: About, now: About): About {
  const rows = new Map<string, AboutRow>();
  for (const [id, was] of showed.rows) {
    const is = now.rows.get(id);
    if (is?.part === was.part) rows.set(id, is);
    else
      rows.set(id, {
        ...was,
        line: is === undefined ? was.line : is.part === "In town" ? line(is.line, WHERE.town) : is.line,
        gone: true,
      });
  }
  for (const [id, is] of now.rows) if (!rows.has(id)) rows.set(id, is);
  return { rows, count: now.count, alone: now.alone && showed.alone };
}
