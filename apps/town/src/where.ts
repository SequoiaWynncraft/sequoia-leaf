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
 * Whoever is in the game says too when they last did something (`acted`): what Leaf's list says, or
 * later, what the page itself saw them do in the room (a move somewhere, an emote, a touch), which is
 * what Leaf counts too. Away is Leaf's rule on it (`away`).
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
  /** In the game: when they last did something, as far as Leaf knows; null for not yet. */
  acted?: number | null;
}

/** Who somebody else is: their account, name, and rank as the town shows it (`GUEST` for a guest; null when nobody has said). */
interface Someone {
  id: string;
  name: string;
  rank: string | null;
}

/**
 * Where somebody else is, by the one account of it, in one of three states:
 *
 * - `live`: in the town's live room with the member, drawn there as they move;
 * - `listed`: in the game, where Leaf's list says, out of the room;
 * - `gone`: gone from the game, where they were last.
 *
 * In the game (`live` or `listed`), `acted` is when they last did something, as far as anybody
 * knows, in milliseconds since 1970, or null for not yet. Gone, `seen` is when Leaf last saw them
 * (null for just now) and `stays` whether their character stays in town, dozing.
 */
export type Where =
  | (Someone & { state: "live"; at: "town"; acted: number | null })
  | (Someone & { state: "listed"; at: Place; acted: number | null })
  | (Someone & { state: "gone"; at: Place; seen: number | null; stays: boolean });

/** Whether somebody is in the game now: in the room, or on Leaf's list as here. */
export const inGame = (w: Where): w is Extract<Where, { state: "live" | "listed" }> => w.state !== "gone";

/**
 * Everybody but the member (`me`), one record each by id, in order: the room's, then Leaf's list of
 * those here (name order, as Leaf sends it), then those gone, newest first. `room` is everybody in
 * the room but the member, or null while the page is in no room; `present`, `resting` (gone, and
 * staying) and `gone` (gone, and not) are Leaf's lists; `ranks` the ranks the page has learnt of
 * anybody, by id, for those the lists do not say; `stirred` when the page saw anybody in the room do
 * something, by id; `now` Leaf's clock.
 */
export function whereabouts(o: {
  me: string;
  room: readonly InRoom[] | null;
  present: readonly Listed[];
  resting: readonly Listed[];
  gone: readonly Listed[];
  ranks?: ReadonlyMap<string, string>;
  stirred?: ReadonlyMap<string, number>;
  now: number;
  rules?: VisitRules;
}): ReadonlyMap<string, Where> {
  const out = new Map<string, Where>();
  const rules = o.rules ?? VISIT_RULES;
  const leafActed = new Map(o.present.map((p) => [p.id, p.acted ?? null]));
  /** When somebody here last did something: Leaf's word, or what the page saw since, whichever is later. */
  const actedOf = (id: string): number | null => {
    const leaf = leafActed.get(id) ?? null;
    const seen = o.stirred?.get(id) ?? null;
    return leaf === null ? seen : seen === null ? leaf : Math.max(leaf, seen);
  };
  const put = (w: Where): void => {
    if (w.id === o.me || out.has(w.id)) return;
    const rank = w.rank ?? o.ranks?.get(w.id) ?? null;
    out.set(w.id, w.state === "gone" ? { ...w, rank } : { ...w, rank, acted: actedOf(w.id) });
  };
  const gone = (p: Listed, seen: number | null, stays: boolean): Where => ({
    state: "gone",
    id: p.id,
    name: p.name,
    rank: p.rank,
    at: p.at,
    seen,
    stays,
  });

  for (const m of o.room ?? []) put({ state: "live", id: m.id, name: m.name, rank: m.rank, at: "town", acted: null });
  const leftJustNow: Listed[] = [];
  for (const p of o.present) {
    if (p.seen !== null && silentSince(p.seen, o.now, rules)) leftJustNow.push(p);
    else if (o.room !== null && p.at === "town") leftJustNow.push({ ...p, seen: null });
    else put({ state: "listed", id: p.id, name: p.name, rank: p.rank, at: p.at, acted: null });
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

/**
 * Those gone whom the town may draw dozing or leaving: Leaf said when it last saw them, and not at
 * their own camp; newest first, at most `most`.
 */
export const resters = (
  all: ReadonlyMap<string, Where>,
  most: number,
): (Extract<Where, { state: "gone" }> & { at: "town" | Stand; seen: number })[] =>
  [...all.values()]
    .flatMap((w) => {
      if (w.state !== "gone") return [];
      const { at, seen } = w;
      return seen !== null && (at === "town" || isStand(at)) ? [{ ...w, at, seen }] : [];
    })
    .slice(0, most);
