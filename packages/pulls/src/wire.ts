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

/** A player a banner names, as Leaf names players. */
export interface Named {
  readonly id: string;
  readonly name: string;
}
/**
 * A banner as `GET /v1/game/banners` gives it: its dates in Leaf's clock, its headliner if it has
 * one, and the players it calls, in order (Groot Night's grooters: `grooterN` is `called[N - 1]`).
 */
export interface BannerPerson {
  readonly id: string;
  readonly from: number;
  readonly until: number;
  readonly headliner: Named | null;
  readonly called: readonly Named[];
}
const isNamed = (v: unknown): v is Named => isRecord(v) && typeof v.id === "string" && typeof v.name === "string";

/** The banners route's answer: the banners these rules know, each with its headliner. Null for anything else. */
export function readBanners(v: unknown): BannerPerson[] | null {
  if (!isRecord(v) || !Array.isArray(v.banners)) return null;
  const out: BannerPerson[] = [];
  for (const b of v.banners) {
    if (!isRecord(b)) return null;
    const banner = BANNERS.find(({ id }) => id === b.id);
    if (!banner) continue;
    const h = b.headliner;
    const headliner = isNamed(h) ? { id: h.id, name: h.name } : null;
    // A Leaf from before banners called anyone says nothing of it: nobody.
    const said = b.called ?? [];
    if (!Array.isArray(said) || !said.every(isNamed)) return null;
    out.push({ ...banner, headliner, called: said.map(({ id, name }) => ({ id, name })) });
  }
  return out;
}
