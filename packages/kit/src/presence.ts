/**
 * Who is here: when the game is live, each page tells the server where in the game the member is
 * (the town, their camp, the Works, the table, the Grove) and what the page is on, every half minute and at
 * once when where changes; and hears back everybody seen in the last little while, and those gone in
 * the last day whose characters stay. Whether the member's character may stay in town after they go
 * is the town's to say (`stay`, from Leaf's town): a page that has not been told says nothing of it,
 * and Leaf keeps what it had. While the page is in a live room of the place it is at, the room says
 * where the member is, and the page only asks who is about; and the room says whenever who is where
 * changes, when the page asks at once (`askAgain`). Answers are taken in the order they were asked
 * for: one that comes after a later one has come is dropped. Without Leaf it does nothing.
 */

import { device, member } from "./live.ts";
import { ask, isRecord, put } from "./net.ts";

export type Place = "town" | "camp" | "works" | "table" | "grove";

/** Somebody the server has seen in the game lately, and where. */
export interface Present {
  id: string;
  name: string;
  place: Place;
  /** Their rank, if the server says. */
  rank: string | null;
  /** Whether they play as a guest, not in the guild. */
  guest: boolean;
  /** When the server last saw them there, in milliseconds since 1970; null from a server that does not say. */
  seen: number | null;
}

/** Somebody gone from the game in the last day whose character stays in town, and when they were last seen. */
export interface Resting {
  id: string;
  name: string;
  place: Place;
  /** When the server last saw them, in milliseconds since 1970. */
  seen: number;
  /** Whether they played as a guest, not in the guild. */
  guest: boolean;
}

export const EVERY = 30_000;

const PLACES: readonly Place[] = ["town", "camp", "works", "table", "grove"];
export const isPlace = (v: unknown): v is Place => PLACES.some((p) => p === v);

/** The list from the server's answer, leaving out anything that makes no sense. */
export function readPresent(v: unknown): Present[] {
  if (!isRecord(v) || !Array.isArray(v.present)) return [];
  const out: Present[] = [];
  for (const p of v.present) {
    if (!isRecord(p) || typeof p.id !== "string" || typeof p.username !== "string" || !isPlace(p.place)) continue;
    const seen = typeof p.seen_at === "string" ? Date.parse(p.seen_at) : NaN;
    out.push({
      id: p.id,
      name: p.username,
      place: p.place,
      rank: typeof p.rank === "string" ? p.rank : null,
      guest: p.guest === true,
      seen: Number.isFinite(seen) ? seen : null,
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
    out.push({ id: r.id, name: r.username, place: r.place, seen, guest: r.guest === true });
  }
  return out;
}

let at: Place | null = null;
/** Whether the member's character stays, as the town said; null on a page that has not been told. */
let staying: boolean | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
const ears = new Set<(present: readonly Present[], resting: readonly Resting[], gone: readonly Resting[]) => void>();
/** The place of the live room this page is in now (`realtime.ts` says), if it is one. */
let roomed: Place | null = null;
/** How many times the server has been asked, and the number of the newest answer taken. */
let asked = 0;
let taken = 0;

/**
 * Tells the server where the member is and hears who is about; only asks who is about while the
 * page is in a live room of that place, unless what the member said about staying is to be told.
 * An answer older than one already taken is dropped.
 */
async function send(telling = false): Promise<void> {
  if (at === null || !member()) return;
  const on = device();
  const n = ++asked;
  const a =
    at === roomed && !telling
      ? await ask("/v1/game/presence")
      : await put("/v1/game/presence", {
          place: at,
          ...(staying === null ? {} : { stay: staying }),
          ...(on === null ? {} : { device: on }),
        });
  if (a.status !== 200 || n < taken) return;
  taken = n;
  const present = readPresent(a.body);
  const resting = readResting(a.body);
  const gone = readResting(a.body, "gone");
  for (const fn of ears) fn(present, resting, gone);
}

/** Says where the member is now; `null` while this page is not where they are (a game is open over it). */
export function here(place: Place | null): void {
  if (!member()) return;
  const moved = place !== at;
  at = place;
  timer ??= setInterval(() => void send(), EVERY);
  if (moved && place !== null) void send();
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
 * Who is where has changed, or may have (the room says so, or has just welcomed the page): asks
 * again at once, from a page in a live room of the place it is at; any other asks at its turn.
 */
export function askAgain(): void {
  if (roomed !== null && roomed === at) void send();
}

/** Forgets where the member is and what the town said of staying (for tests). */
export function forgetPresence(): void {
  at = null;
  staying = null;
  roomed = null;
  asked = 0;
  taken = 0;
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
