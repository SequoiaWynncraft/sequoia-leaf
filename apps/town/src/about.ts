/**
 * "Who is about": the rules with no page in them. Who goes in which part of the panel, in what
 * order, and the line under each name (`whoIsAbout`), all from where each person is (`where.ts`),
 * which is where the figures in town and every card have them too. `aboutui.ts` is the page that
 * shows them.
 *
 * - **In town**: the member first, marked as them; then everybody in town: in the town's live room
 *   with the member, or whoever else Leaf has in town; and for whoever is away, for how long
 *   (`awayFor`: always with a time, and from the first for somebody only their page says is there).
 * - **Elsewhere**: in the game, but not in town: at the Works, at the raid table, in the Grove, in
 *   their camp or visiting somebody's (`campWords`); and for whoever is away, for how long.
 * - **Seen lately**: gone in the last day by Leaf's word, newest first, with how long ago they
 *   left, and whose camp for whoever was last at one.
 *
 * The panel is one row for each player, kept by their id, so nobody can be listed twice. That is
 * the panel as it is opened; while it stays open its order holds (`held`).
 */

import type { CampOwner, Place } from "@sequoia-leaf/kit/presence.ts";

import { span } from "./letter.ts";
import { awayFor, inGame, type InRoom, type Where } from "./where.ts";

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

/** Where somebody in the game is, in words, but at a camp (`campWords`). */
export const WHERE: Readonly<Record<Exclude<Place, "camp">, string>> = {
  town: "in town",
  works: "at the Works",
  table: "at the raid table",
  grove: "in the Grove",
};

/**
 * Whose camp somebody (`id`) is at, in words, as the member (`me`) reads it: "in their camp",
 * "visiting you", "visiting Name"; "in a camp" where Leaf does not say whose.
 */
export function campWords(id: string, camp: CampOwner | null, me: string): string {
  if (camp === null) return "in a camp";
  if (camp.id === id) return "in their camp";
  return camp.id === me ? "visiting you" : `visiting ${camp.name}`;
}

/** Where somebody is, or was last, in words, as the member (`me`) reads it. */
export const placeWords = (w: Where, me: string): string =>
  w.at === "camp" ? campWords(w.id, w.camp, me) : WHERE[w.at];

/** How long somebody has been away (`ms`, in milliseconds), in words: "away for 20 minutes". */
export const awayWords = (ms: number): string => `away for ${span(ms / 60_000)}`;

/**
 * What somebody in the game is about, in words, for their row and their card, as the member (`me`)
 * reads them: where they are if not in town, and for how long they have been away if they are
 * (`awayFor`); nothing for somebody just about the town, or gone.
 */
export function doingWords(w: Where, now: number, me: string): string[] {
  if (w.state === "gone") return [];
  const gone = awayFor(w, now);
  return [...(w.at === "town" ? [] : [placeWords(w, me)]), ...(gone === null ? [] : [awayWords(gone)])];
}

/** A person's card's line under their rank: "At the Works", "Visiting you", "Away for 20 minutes"; null for nothing to say. */
export function cardLine(w: Where | undefined, now: number, me: string): string | null {
  const said = w ? doingWords(w, now, me).join(", ") : "";
  return said === "" ? null : said.charAt(0).toUpperCase() + said.slice(1);
}

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
  const here = all.filter(inGame).toSorted(byName);
  const doing = (w: Where): string => line(w.rank, ...doingWords(w, o.now, o.me.id));
  for (const w of here.filter((x) => x.at === "town")) put("In town", w, doing(w));
  for (const w of here.filter((x) => x.at !== "town")) put("Elsewhere", w, doing(w));
  // In the order the record has them: newest first.
  for (const w of all) {
    if (w.state !== "gone") continue;
    const camp = w.at === "camp" ? placeWords(w, o.me.id) : null;
    put("Seen lately", w, line(w.rank, camp, agoLine(w.seen, o.now)));
  }

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
