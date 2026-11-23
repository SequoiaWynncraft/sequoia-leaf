/**
 * "Who is about": the rules with no page in them. Who goes in which part of the panel, in what
 * order, and the line under each name (`whoIsAbout`), all from where each person is (`where.ts`),
 * which is where the figures in town and every card have them too. `aboutui.ts` is the page that
 * shows them.
 *
 * - **In town**: the member first, marked as them; then everybody in town: in the town's live room
 *   with the member, or out of the room, whoever Leaf has in town; and for whoever is away, for how
 *   long.
 * - **Elsewhere**: in the game, but not in town: at the Works, at the raid table, in the Grove, in
 *   their camp; and for whoever is away, for how long.
 * - **Seen lately**: gone in the last day, newest first, with how long ago; first of all whoever
 *   has only just walked out of the town's room.
 *
 * The panel is one row for each player, kept by their id, so nobody can be listed twice. That is
 * the panel as it is opened; while it stays open its order holds (`held`).
 */

import { away } from "@sequoia-leaf/core";
import type { Place } from "@sequoia-leaf/kit/presence.ts";

import { span } from "./letter.ts";
import type { InRoom, Where } from "./where.ts";

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
export const WHERE: Readonly<Record<Place, string>> = {
  town: "in town",
  works: "at the Works",
  table: "at the raid table",
  grove: "in the Grove",
  camp: "in their camp",
};

/** How long somebody has been away, in words: "away for 20 minutes"; only "away" when Leaf has never heard them do anything. */
export const awayWords = (acted: number | null, now: number): string =>
  acted === null ? "away" : `away for ${span(Math.max(0, (now - acted) / 60_000))}`;

/**
 * What somebody in the game is about, in words, for their row and their card: where they are if not
 * in town, and for how long they have been away if they are (Leaf's rule, `away`); nothing for
 * somebody just about the town, or gone.
 */
export function doingWords(w: Where, now: number): string[] {
  if (!w.here) return [];
  return [...(w.at === "town" ? [] : [WHERE[w.at]]), ...(away(w.acted, now) ? [awayWords(w.acted, now)] : [])];
}

/** A person's card's line under their rank: "At the Works", "Away for 20 minutes", both; null for nothing to say. */
export function cardLine(w: Where | undefined, now: number): string | null {
  const said = w ? doingWords(w, now).join(", ") : "";
  return said === "" ? null : said.charAt(0).toUpperCase() + said.slice(1);
}

/** The line for somebody who walked out of town within the last minute or so. */
export const JUST_NOW = "just now";

/** How long ago somebody was last seen, in the words the dozers' cards use: "3 hours ago". */
export const agoLine = (seen: number, now: number): string => `${span(Math.max(0, (now - seen) / 60_000))} ago`;

const line = (...parts: readonly (string | null)[]): string => parts.filter((p) => p !== null && p !== "").join(" · ");
const byName = (a: { name: string }, b: { name: string }): number =>
  a.name.localeCompare(b.name, "en", { sensitivity: "base" });

/**
 * Who is about, part by part. `me` is the member; `all` where everybody else is (`whereabouts`);
 * `now` Leaf's clock, in milliseconds since 1970.
 */
export function whoIsAbout(o: { me: InRoom; all: ReadonlyMap<string, Where>; now: number }): About {
  const rows = new Map<string, AboutRow>();
  /** Lists somebody in `part`, unless an earlier part has them. */
  const put = (part: PartName, m: { id: string; name: string }, words: string, you = false): void => {
    if (!rows.has(m.id)) rows.set(m.id, { id: m.id, name: m.name, part, line: words, you });
  };
  const all = [...o.all.values()];

  put("In town", o.me, line(o.me.rank), true);
  for (const w of all.filter((x) => x.here && x.at === "town").toSorted(byName))
    put("In town", w, line(w.rank, ...doingWords(w, o.now)));
  for (const w of all.filter((x) => x.here && x.at !== "town").toSorted(byName))
    put("Elsewhere", w, line(w.rank, ...doingWords(w, o.now)));
  // In the order the record has them: whoever has only just left first, then newest first.
  for (const w of all.filter((x) => !x.here))
    put("Seen lately", w, line(w.rank, w.seen === null ? JUST_NOW : agoLine(w.seen, o.now)));

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
