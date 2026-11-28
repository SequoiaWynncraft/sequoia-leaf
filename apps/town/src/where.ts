/**
 * Where everybody else is, as the town shows it everywhere: in "Who is about" and the number on its
 * button, as a figure in town (live, standing at one of the games, or dozing), and on their card. One
 * record for each person, by their id, made here and nowhere else from what Leaf says of them, and
 * from nothing else. Leaf says two things, each true on its own:
 *
 * - **Who is in the room with the member** (the town's live room): in town, drawn live.
 * - **Its list of who is about** (`kit/presence.ts`): of each person in the game, where they are,
 *   since when, whether a live room has them, and when they last did something; of each one gone,
 *   where they were last, when they left, and whether their character stays in town.
 *
 * Where somebody is, is what the list says of them, for every page alike: the room never says
 * otherwise. Somebody in the room whom the list has in town, or does not have yet, is in town,
 * drawn live; one whom the list has somewhere else is there, as everybody else reads them. Nothing
 * is worked out from somebody being in one and not in the other: listed in town and not in the room
 * with the member, they are in town all the same (in another of the town's rooms, or with a page
 * that only says so), and not drawn. Nobody is gone but by Leaf's word, with the time Leaf gives.
 *
 * Whoever is in the game says too when they last did something (`acted`): what Leaf's list says, or
 * later, what the page itself saw them do in the room (a move somewhere, an emote, a touch), which is
 * what Leaf counts too. Whether they are away, and for how long, is `awayFor`.
 */

import { away } from "@sequoia-leaf/core";
import type { CampOwner, Place } from "@sequoia-leaf/kit/presence.ts";
import type { Stand } from "@sequoia-leaf/town/map/rows.ts";

/** Somebody in the town's live room with the member: their account, name, and rank as the town shows it. */
export interface InRoom {
  id: string;
  name: string;
  /** Their rank as the town shows it, `GUEST` for a guest, or null for none. */
  rank: string | null;
}

/** Somebody on Leaf's list as in the game, as the town reads them: their rank as the town shows it, if the list says. Times are in milliseconds since 1970. */
export interface Here {
  id: string;
  name: string;
  rank: string | null;
  at: Place;
  /** At a camp, whose, when Leaf says; null anywhere else. */
  camp: CampOwner | null;
  /** Whether a live room of the place has them; null when Leaf did not say (one from before it did). */
  live: boolean | null;
  /** Since when they have been there; null when Leaf did not say. */
  since: number | null;
  /** When they last did something, as far as Leaf knows; null for not since they came. */
  acted: number | null;
}

/** Somebody on Leaf's list as gone: where they were last, and when they left. */
export interface Gone {
  id: string;
  name: string;
  rank: string | null;
  at: Place;
  camp: CampOwner | null;
  seen: number;
}

/** Who somebody else is: their account, name, and rank as the town shows it (`GUEST` for a guest; null when nobody has said). */
interface Someone {
  id: string;
  name: string;
  rank: string | null;
}

/**
 * Where somebody else is, in one of three states, each what Leaf says:
 *
 * - `live`: in the town's live room with the member, and in town by Leaf's list or not on it yet:
 *   drawn there as they move. `since` is since when the list has them in town; null until it does.
 * - `listed`: in the game where Leaf's list says; `live` when a live room has them there, and
 *   `since` since when (each null when Leaf did not say).
 * - `gone`: gone from the game, where they were last; `seen` is when they left, and `stays`
 *   whether their character stays in town, dozing.
 *
 * At a camp, `camp` is whose, when Leaf says; null anywhere else. In the game (`live` or `listed`),
 * `acted` is when they last did something, as far as anybody knows, or null for not since they
 * came. Times are in milliseconds since 1970.
 */
export type Where =
  | (Someone & { state: "live"; at: "town"; camp: null; since: number | null; acted: number | null })
  | (Someone & {
      state: "listed";
      at: Place;
      camp: CampOwner | null;
      live: boolean | null;
      since: number | null;
      acted: number | null;
    })
  | (Someone & { state: "gone"; at: Place; camp: CampOwner | null; seen: number; stays: boolean });

/** Whether somebody is in the game now: in the room, or on Leaf's list as here. */
export const inGame = (w: Where): w is Extract<Where, { state: "live" | "listed" }> => w.state !== "gone";

/**
 * Whether somebody who last did something at `last` (or, with nothing heard, came then) is away at
 * `now` by Leaf's rule (core's `away`); never when nothing says since when (null).
 */
export const awaySince = (last: number | null, now: number): boolean => last !== null && away(last, now);

/**
 * For how long somebody in the game has been away at `now` (Leaf's clock), in milliseconds; null
 * for not away. It is counted from the last thing anybody heard them do, or, with nothing heard,
 * from when they came, so that nobody is away without a time; null too for somebody of whom nothing
 * says since when (in the room and not on Leaf's list yet, or listed by a Leaf that did not say).
 *
 * Where Leaf hears what they do (in a live room, or at a game, whose page tells Leaf each thing
 * they do), they are away by Leaf's rule (core's `away`): nothing heard for five minutes. In town
 * or at a camp with no live room, only their page says they are there, and Leaf hears nothing of
 * their walking about: it is said from the first how long since it last heard them do anything.
 */
export function awayFor(w: Extract<Where, { state: "live" | "listed" }>, now: number): number | null {
  const last = w.acted ?? w.since;
  if (last === null) return null;
  const unheard = w.state === "listed" && (w.at === "town" || w.at === "camp") && w.live === false;
  return unheard || awaySince(last, now) ? Math.max(0, now - last) : null;
}

/**
 * Everybody but the member (`me`), one record each by id, in order: the room's whom Leaf's list
 * does not have somewhere else, then Leaf's list of those here (name order, as Leaf sends it), then
 * those gone, newest first. `room` is everybody in
 * the room but the member, or null while the page is in no room; `present`, `resting` (gone, and
 * staying) and `gone` (gone, and not) are Leaf's lists; `ranks` the ranks the page has learnt of
 * anybody, by id, for those the lists do not say; `stirred` when the page saw anybody in the room do
 * something, by id.
 */
export function whereabouts(o: {
  me: string;
  room: readonly InRoom[] | null;
  present: readonly Here[];
  resting: readonly Gone[];
  gone: readonly Gone[];
  ranks?: ReadonlyMap<string, string>;
  stirred?: ReadonlyMap<string, number>;
}): ReadonlyMap<string, Where> {
  const out = new Map<string, Where>();
  const listed = new Map(o.present.map((p) => [p.id, p]));
  /** When somebody here last did something: Leaf's word, or what the page saw since, whichever is later. */
  const actedOf = (id: string): number | null => {
    const leaf = listed.get(id)?.acted ?? null;
    const seen = o.stirred?.get(id) ?? null;
    return leaf === null ? seen : seen === null ? leaf : Math.max(leaf, seen);
  };
  const put = (w: Where): void => {
    if (w.id === o.me || out.has(w.id)) return;
    const rank = w.rank ?? o.ranks?.get(w.id) ?? null;
    out.set(w.id, w.state === "gone" ? { ...w, rank } : { ...w, rank, acted: actedOf(w.id) });
  };

  // Gone, newest first: each list is Leaf's, and so is the time.
  const left = [
    ...o.resting.map((p) => ({ ...p, stays: true })),
    ...o.gone.map((p) => ({ ...p, stays: false })),
  ].toSorted((a, b) => b.seen - a.seen || (a.id < b.id ? -1 : 1));
  const gone = new Set(left.map((p) => p.id));
  for (const m of o.room ?? []) {
    const leaf = listed.get(m.id);
    // Where Leaf's list has them is where they are, for this page as for any other.
    if (leaf === undefined ? gone.has(m.id) : leaf.at !== "town") continue;
    const since = leaf?.since ?? null;
    put({ state: "live", id: m.id, name: m.name, rank: m.rank, at: "town", camp: null, since, acted: null });
  }
  for (const p of o.present) put({ state: "listed", ...p });
  for (const p of left) put({ state: "gone", ...p });
  return out;
}

/**
 * How many are at each camp now, by its owner's id: everybody else in the game whose record has them
 * there (`all`, which never has the member), and the member, once, at the camp the page has them at
 * (`mine`; null at none).
 */
export function atCamps(all: ReadonlyMap<string, Where>, mine: string | null): ReadonlyMap<string, number> {
  const out = new Map<string, number>();
  const add = (owner: string): void => void out.set(owner, (out.get(owner) ?? 0) + 1);
  for (const w of all.values()) if (inGame(w) && w.at === "camp" && w.camp !== null) add(w.camp.id);
  if (mine !== null) add(mine);
  return out;
}

/** Whether a place is one of the games with a place in town to stand at: the Works, the stump, the Grove. */
export const isStand = (at: Place): at is Stand => at === "works" || at === "table" || at === "grove";

/** Those in one of the games, standing at it in town: listed, at most `most`, in the record's order. */
export const standing = (
  all: ReadonlyMap<string, Where>,
  most: number,
): (Extract<Where, { state: "listed" }> & { at: Stand })[] =>
  [...all.values()]
    .flatMap((w) => {
      if (w.state !== "listed") return [];
      const { at } = w;
      return isStand(at) ? [{ ...w, at }] : [];
    })
    .slice(0, most);

/** Those gone whom the town may draw dozing or leaving: not from a camp; newest first, at most `most`. */
export const resters = (
  all: ReadonlyMap<string, Where>,
  most: number,
): (Extract<Where, { state: "gone" }> & { at: "town" | Stand })[] =>
  [...all.values()]
    .flatMap((w) => {
      if (w.state !== "gone") return [];
      const { at } = w;
      return at === "town" || isStand(at) ? [{ ...w, at }] : [];
    })
    .slice(0, most);
