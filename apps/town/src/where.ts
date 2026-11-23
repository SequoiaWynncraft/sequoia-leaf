/**
 * Where everybody else is, as the town shows it everywhere: in "Who is about" and the number on its
 * button, as a figure in town (live, standing at one of the games, or dozing), and on their card. One
 * record for each person, by their id, worked out here and nowhere else, from two things: the town's
 * live room (who is in town, as it happens) and Leaf's list of who is about (where everybody else is,
 * and who has gone), by Leaf's clock, so that every page works out the same at the same moment.
 *
 * - **In the room**: in town, drawn live.
 * - **On Leaf's list as in the game**: where it says, unless Leaf last saw them `silentMs` ago or
 *   more (gone from then, as Leaf's visits have it), or it says the town while the page is in the
 *   room and they are not (they have just left it, and Leaf's next word says where to: gone, just
 *   now).
 * - **On Leaf's list as gone**: where they were last, when Leaf last saw them, and whether their
 *   character stays in town.
 *
 * Out of the room (the connection down a while), whoever Leaf has in town is in town, not drawn.
 */

import { silentSince, VISIT_RULES, type VisitRules } from "@sequoia-leaf/core";
import type { Place } from "@sequoia-leaf/kit/presence.ts";
import type { Stand } from "@sequoia-leaf/town/clock.ts";

/** Somebody in the town's live room with the member: their account, name, and rank as the town shows it. */
export interface InRoom {
  id: string;
  name: string;
  /** Their rank as the town shows it, `GUEST` for a guest, or null for none. */
  rank: string | null;
}

/** Somebody on Leaf's list, as the town reads them: their rank as the town shows it, if the list says. */
export interface Listed {
  id: string;
  name: string;
  rank: string | null;
  at: Place;
  /** When Leaf last saw them, in milliseconds since 1970; null when it does not say. */
  seen: number | null;
}

/** Where somebody else is, by the one account of it. */
export interface Where {
  id: string;
  name: string;
  /** Their rank as the town shows it, `GUEST` for a guest, or null when nobody has said. */
  rank: string | null;
  /** In the game now, where they are; gone from it, where they were last. */
  at: Place;
  /** In the game now. */
  here: boolean;
  /** In the town's live room with the member: drawn there as they move. */
  live: boolean;
  /** Gone: when Leaf last saw them, in milliseconds since 1970; null for just now. Null while here. */
  seen: number | null;
  /** Gone: whether their character stays in town, dozing. */
  stays: boolean;
}

/**
 * Everybody but the member (`me`), one record each by id, in order: the room's, then Leaf's list of
 * those here (name order, as Leaf sends it), then those gone, newest first. `room` is everybody in
 * the room but the member, or null while the page is in no room; `present`, `resting` (gone, and
 * staying) and `gone` (gone, and not) are Leaf's lists; `ranks` the ranks the page has learnt of
 * anybody, by id, for those the lists do not say; `now` Leaf's clock.
 */
export function whereabouts(o: {
  me: string;
  room: readonly InRoom[] | null;
  present: readonly Listed[];
  resting: readonly Listed[];
  gone: readonly Listed[];
  ranks?: ReadonlyMap<string, string>;
  now: number;
  rules?: VisitRules;
}): ReadonlyMap<string, Where> {
  const out = new Map<string, Where>();
  const rules = o.rules ?? VISIT_RULES;
  const put = (w: Where): void => {
    if (w.id === o.me || out.has(w.id)) return;
    out.set(w.id, { ...w, rank: w.rank ?? o.ranks?.get(w.id) ?? null });
  };
  const gone = (p: Listed, seen: number | null, stays: boolean): Where => ({
    id: p.id,
    name: p.name,
    rank: p.rank,
    at: p.at,
    here: false,
    live: false,
    seen,
    stays,
  });

  for (const m of o.room ?? [])
    put({ id: m.id, name: m.name, rank: m.rank, at: "town", here: true, live: true, seen: null, stays: true });
  const leftJustNow: Listed[] = [];
  for (const p of o.present) {
    if (p.seen !== null && silentSince(p.seen, o.now, rules)) leftJustNow.push(p);
    else if (o.room !== null && p.at === "town") leftJustNow.push({ ...p, seen: null });
    else put({ id: p.id, name: p.name, rank: p.rank, at: p.at, here: true, live: false, seen: null, stays: true });
  }
  // Gone, newest first, those who have only just left first of all; what Leaf says next of staying is
  // believed, until then they stay, as Leaf has anybody who never said.
  const byNewest = (a: Listed, b: Listed): number =>
    (b.seen ?? Number.POSITIVE_INFINITY) - (a.seen ?? Number.POSITIVE_INFINITY) || (a.id < b.id ? -1 : 1);
  const said = new Map<string, boolean>();
  for (const r of o.resting) said.set(r.id, true);
  for (const r of o.gone) if (!said.has(r.id)) said.set(r.id, false);
  const left = [
    ...leftJustNow.map((p) => ({ p, stays: said.get(p.id) ?? true })),
    ...o.resting.map((p) => ({ p, stays: true })),
    ...o.gone.map((p) => ({ p, stays: false })),
  ].toSorted((a, b) => byNewest(a.p, b.p));
  for (const { p, stays } of left) put(gone(p, p.seen, stays));
  return out;
}

/** Whether a place is one of the games with a place in town to stand at: the Works, the stump, the Grove. */
export const isStand = (at: Place): at is Stand => at === "works" || at === "table" || at === "grove";

/** Those in one of the games, standing at it in town: here, not live, at most `most`, in the record's order. */
export const standing = (all: ReadonlyMap<string, Where>, most: number): (Where & { at: Stand })[] =>
  [...all.values()]
    .flatMap((w) => {
      const { at } = w;
      return w.here && !w.live && isStand(at) ? [{ ...w, at }] : [];
    })
    .slice(0, most);

/**
 * Those gone whom the town may draw dozing or leaving: Leaf said when it last saw them, and not at
 * their own camp; newest first, at most `most`.
 */
export const resters = (
  all: ReadonlyMap<string, Where>,
  most: number,
): (Where & { at: "town" | Stand; seen: number })[] =>
  [...all.values()]
    .flatMap((w) => {
      const { at, seen } = w;
      return !w.here && seen !== null && (at === "town" || isStand(at)) ? [{ ...w, at, seen }] : [];
    })
    .slice(0, most);
