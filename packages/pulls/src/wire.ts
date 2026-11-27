/**
 * What Leaf sends a page of the pulls, read into the rules' own types: the player's view, the notes
 * a command gave, and the banners with whoever each one's headliner is. Anything these rules could
 * not have made reads as null, and the page loads again.
 */
import { isEra } from "@sequoia-leaf/raid/content/releases.ts";

import { BANNERS, decodePulls, type Fifty, PULLS_VERSION, type PullsNote, type PullsView, rarityOf } from "./game.ts";

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isFifty = (v: unknown): v is Fifty => v === "won" || v === "lost" || v === "owed";
const isNoteKind = (v: unknown): v is PullsNote["t"] => v === "pull" || v === "exchange" || v === "grant";

/** The view, read as the state is read from what Leaf stored (the stream it leaves out stands at 0). */
export function readView(v: unknown): PullsView | null {
  if (!isRecord(v) || !Array.isArray(v.open)) return null;
  const { open, era, ...state } = v;
  if (!isEra(era)) return null;
  const kept = decodePulls(JSON.stringify({ ...state, game: "pulls", v: PULLS_VERSION, rng: 0 }));
  if (!kept) return null;
  const banners: PullsView["open"] = [];
  for (const b of open) {
    if (!isRecord(b) || typeof b.id !== "string" || typeof b.until !== "number") return null;
    banners.push({ id: b.id, until: b.until });
  }
  return {
    have: kept.have,
    counters: kept.counters,
    seeds: kept.seeds,
    free: kept.free,
    history: kept.history,
    pulls: kept.pulls,
    open: banners,
    era,
  };
}

function readNote(v: unknown): PullsNote | null {
  if (!isRecord(v) || !isNoteKind(v.t)) return null;
  const { prize, have, top, fifty } = v;
  const rarity = typeof prize === "string" ? rarityOf(prize) : undefined;
  if (typeof prize !== "string" || rarity === undefined || rarity !== v.rarity || typeof have !== "number") return null;
  if ((top !== undefined && typeof top !== "number") || (fifty !== undefined && !isFifty(fifty))) return null;
  return {
    t: v.t,
    prize,
    rarity,
    have,
    ...(top === undefined ? {} : { top }),
    ...(fifty === undefined ? {} : { fifty }),
  };
}

export function readNotes(v: unknown): PullsNote[] | null {
  if (!Array.isArray(v)) return null;
  const notes: PullsNote[] = [];
  for (const each of v) {
    const note = readNote(each);
    if (!note) return null;
    notes.push(note);
  }
  return notes;
}

/** A player Leaf names: their Leaf id and the name they go by. */
export interface Named {
  readonly id: string;
  readonly name: string;
}
/** A player a banner calls, in their seat, counted from 1 (Groot Night's grooters: `grooterN` is seat N). */
export interface Called extends Named {
  readonly seat: number;
}
/**
 * A banner as `GET /v1/game/banners` gives it: its dates in Leaf's clock, its headliner if it has
 * one, and the players it calls, each in their seat, none until they are put in.
 */
export interface BannerPerson {
  readonly id: string;
  readonly from: number;
  readonly until: number;
  readonly headliner: Named | null;
  readonly called: readonly Called[];
}
const readNamed = (v: unknown): Named | null =>
  isRecord(v) && typeof v.id === "string" && typeof v.name === "string" ? { id: v.id, name: v.name } : null;
/** A seat: a whole number from 1. */
const isSeat = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 1;

/** The banners route's answer: the banners these rules know, each with its headliner. Null for anything else. */
export function readBanners(v: unknown): BannerPerson[] | null {
  if (!isRecord(v) || !Array.isArray(v.banners)) return null;
  const out: BannerPerson[] = [];
  for (const b of v.banners) {
    if (!isRecord(b)) return null;
    const banner = BANNERS.find(({ id }) => id === b.id);
    if (!banner) continue;
    // A Leaf from before banners called anyone says nothing of it: nobody is called yet.
    const said = b.called ?? [];
    if (!Array.isArray(said)) return null;
    const named = said.map((c: unknown) => [c, readNamed(c)] as const);
    if (named.some(([, c]) => c === null)) return null;
    // One with no seat, or with what is no seat, is left out: their seat stays empty, and nobody moves up into it.
    const called = named.flatMap(([c, person]) =>
      person && isRecord(c) && isSeat(c.seat) ? [{ seat: c.seat, ...person }] : [],
    );
    out.push({ ...banner, headliner: readNamed(b.headliner), called });
  }
  return out;
}
