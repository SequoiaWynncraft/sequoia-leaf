/**
 * Who is here: when the game is live, each page tells the server where in the game the member is
 * (the town, a camp and whose, the Works, the table, the Grove) and what the page is on, every half minute and at
 * once when where changes; and hears back everybody seen in the last little while, and those gone in
 * the last day whose characters stay. Whether the member's character may stay in town after they go
 * is the town's to say (`stay`, from Leaf's town): a page that has not been told says nothing of it,
 * and Leaf keeps what it had. While the page is in a live room of the place it is at, the room says
 * where the member is: the page asks who is about as the room welcomes it (`askAgain`), and after
 * that the room tells it whenever who is about changes, with the lists (`heardAbout`). Of two lists,
 * the one Leaf made later is kept, by the time Leaf put on it (`at`): one older than lists already
 * heard is dropped, however it came. Without Leaf it does nothing.
 */

import { device, member } from "./live.ts";
import { ask, isRecord, put } from "./net.ts";

export type Place = "town" | "camp" | "works" | "table" | "grove";

/** Whose camp somebody is at: its owner's player id (how the camp list and the camps' rooms name a camp) and name. */
export interface CampOwner {
  id: string;
  name: string;
}

/** Where the page says the member is: a place, and at a camp whose, if the page knows; null anywhere else. */
interface Spot {
  readonly place: Place;
  readonly camp: string | null;
}

/** Somebody the server has seen in the game lately, and where. */
export interface Present {
  id: string;
  name: string;
  place: Place;
  /** At a camp, whose, when the server says; null anywhere else. */
  camp: CampOwner | null;
  /** Their rank, if the server says. */
  rank: string | null;
  /** Whether they play as a guest, not in the guild. */
  guest: boolean;
  /** When the server last saw them there, in milliseconds since 1970; null from a server that does not say. */
  seen: number | null;
  /** When they last did something, as far as the server knows, in milliseconds since 1970; null for not yet, or a server that does not say. */
  acted: number | null;
}

/** Somebody gone from the game in the last day whose character stays in town, and when they were last seen. */
export interface Resting {
  id: string;
  name: string;
  place: Place;
  /** At a camp, whose, when the server says; null anywhere else. */
  camp: CampOwner | null;
  /** When the server last saw them, in milliseconds since 1970. */
  seen: number;
  /** Whether they played as a guest, not in the guild. */
  guest: boolean;
}

export const EVERY = 30_000;

const PLACES: readonly Place[] = ["town", "camp", "works", "table", "grove"];
export const isPlace = (v: unknown): v is Place => PLACES.some((p) => p === v);

/** Whose camp a row of the server's lists says somebody is at: only at a camp, with its owner's id and name; else null. */
function campOf(row: Record<string, unknown>): CampOwner | null {
  const { place, camp_owner: id, camp_owner_name: name } = row;
  return place === "camp" && typeof id === "string" && id !== "" && typeof name === "string" && name !== ""
    ? { id, name }
    : null;
}

/** The list from the server's answer, leaving out anything that makes no sense. */
export function readPresent(v: unknown): Present[] {
  if (!isRecord(v) || !Array.isArray(v.present)) return [];
  const out: Present[] = [];
  for (const p of v.present) {
    if (!isRecord(p) || typeof p.id !== "string" || typeof p.username !== "string" || !isPlace(p.place)) continue;
    const seen = typeof p.seen_at === "string" ? Date.parse(p.seen_at) : NaN;
    const acted = typeof p.acted_at === "string" ? Date.parse(p.acted_at) : NaN;
    out.push({
      id: p.id,
      name: p.username,
      place: p.place,
      camp: campOf(p),
      rank: typeof p.rank === "string" ? p.rank : null,
      guest: p.guest === true,
      seen: Number.isFinite(seen) ? seen : null,
      acted: Number.isFinite(acted) ? acted : null,
    });
  }
  return out;
}

/**
 * Those gone in the last day, from the server's answer, leaving out anything that makes no sense:
 * `resting`, whose characters stay in town, or `gone`, whose do not.
 */
export function readResting(v: unknown, list: "resting" | "gone" = "resting"): Resting[] {
  const rows = isRecord(v) ? v[list] : null;
  if (!Array.isArray(rows)) return [];
  const out: Resting[] = [];
  for (const r of rows) {
    if (!isRecord(r) || typeof r.id !== "string" || typeof r.username !== "string" || !isPlace(r.place)) continue;
    const seen = typeof r.seen_at === "string" ? Date.parse(r.seen_at) : NaN;
    if (!Number.isFinite(seen)) continue;
    out.push({ id: r.id, name: r.username, place: r.place, camp: campOf(r), seen, guest: r.guest === true });
  }
  return out;
}

let at: Spot | null = null;
/** Whether the member's character stays, as the town said; null on a page that has not been told. */
let staying: boolean | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
const ears = new Set<(present: readonly Present[], resting: readonly Resting[], gone: readonly Resting[]) => void>();
/** The place of the live room this page is in now (`realtime.ts` says), if it is one. */
let roomed: Place | null = null;
/** When Leaf made the newest lists heard, by its clock, in milliseconds since 1970; or none yet. */
let newest = -Infinity;

/**
 * Leaf's lists of who is about, from an answer or a room's word, told to everybody listening unless
 * Leaf made lists later than these already heard. Lists that do not say when (an older Leaf's) are
 * taken as they come.
 */
function heard(body: unknown): void {
  const made = isRecord(body) && typeof body.at === "string" ? Date.parse(body.at) : NaN;
  if (made < newest) return;
  if (Number.isFinite(made)) newest = made;
  const present = readPresent(body);
  const resting = readResting(body);
  const gone = readResting(body, "gone");
  for (const fn of ears) fn(present, resting, gone);
}

/**
 * Tells the server where the member is and hears who is about; only asks who is about while the
 * page is in a live room of that place (`asking`), unless what the member said about staying is to
 * be told.
 */
async function send(telling = false, asking = false): Promise<void> {
  if (at === null || !member()) return;
  const roomKeeps = at.place === roomed && !telling;
  // In a room of the place, the room keeps the member there, and tells the page of every change.
  if (roomKeeps && !asking) return;
  const on = device();
  const a = roomKeeps
    ? await ask("/v1/game/presence")
    : await put("/v1/game/presence", {
        place: at.place,
        ...(at.camp === null ? {} : { camp_owner: at.camp }),
        ...(staying === null ? {} : { stay: staying }),
        ...(on === null ? {} : { device: on }),
      });
  if (a.status === 200) heard(a.body);
}

/**
 * Says where the member is now, and at a camp whose (`camp`, its owner's player id); `null` while
 * this page is not where they are (a game is open over it). Another camp is somewhere else.
 */
export function here(place: Place | null, camp: string | null = null): void {
  if (!member()) return;
  const to = place === null ? null : { place, camp: place === "camp" ? camp : null };
  const moved = to?.place !== at?.place || to?.camp !== at?.camp;
  at = to;
  timer ??= setInterval(() => void send(), EVERY);
  if (moved && to !== null) void send(false, true);
}

/**
 * Says whether the member's character stays in town, dozing, for a day after they go (the town's
 * page, from Leaf's town); tells the server at once when it is news.
 */
export function stay(on: boolean): void {
  if (on === staying) return;
  staying = on;
  if (member() && at !== null) void send(true);
}

/**
 * The page is in a live room of a kind now (`realtime.ts` says so at each welcome), or in none
 * (`null`): while it is in one of the place it is at, the room keeps where the member is.
 */
export function inRoom(kind: string | null): void {
  roomed = isPlace(kind) ? kind : null;
}

/**
 * The page has just been welcomed into a live room, or the room said who is about changed without
 * saying who (an older Leaf): asks at once, from a page in a live room of the place it is at; any
 * other asks at its turn.
 */
export function askAgain(): void {
  if (roomed !== null && roomed === at?.place) void send(false, true);
}

/**
 * Asks Leaf who is about now, for a page about to count from it out of a room that tells it every
 * change (the signpost at a camp, which otherwise hears it every half minute): done once the answer
 * is heard, or none comes. Nothing without Leaf, or while the page is not where the member is.
 */
export function askNow(): Promise<void> {
  return send(false, true);
}

/**
 * The room says who is about has changed (`about`), with Leaf's lists (`who`), or without them from
 * an older Leaf, when the page asks.
 */
export function heardAbout(who: unknown): void {
  if (who === undefined) askAgain();
  else if (roomed !== null && roomed === at?.place) heard(who);
}

/** Forgets where the member is and what the town said of staying (for tests). */
export function forgetPresence(): void {
  at = null;
  staying = null;
  roomed = null;
  newest = -Infinity;
  if (timer !== null) clearInterval(timer);
  timer = null;
}

/** Hears who is here, who is resting, and who is gone and does not stay, each time the server says. Returns how to stop. */
export function hearPresent(
  fn: (present: readonly Present[], resting: readonly Resting[], gone: readonly Resting[]) => void,
): () => void {
  ears.add(fn);
  return () => ears.delete(fn);
}
