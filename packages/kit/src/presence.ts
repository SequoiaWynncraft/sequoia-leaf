/**
 * Who is here: when the game is live, each page tells the server where in the game the member is
 * (the town, their camp, the Works, the table) and whether their character may stay in town after
 * they go, every half minute and at once when either changes; and hears back everybody seen in the
 * last little while, and those gone in the last day whose characters stay. With the made-up guild
 * it does nothing.
 */

import { keptText } from "./keep.ts";
import { member } from "./live.ts";
import { isRecord, put } from "./net.ts";

export type Place = "town" | "camp" | "works" | "table";

/** Somebody the server has seen in the game lately, and where. */
export interface Present {
  id: string;
  name: string;
  place: Place;
  /** Their rank, if the server says. */
  rank: string | null;
  /** Whether they play as a guest, not in the guild. */
  guest: boolean;
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

const PLACES: readonly Place[] = ["town", "camp", "works", "table"];
const isPlace = (v: unknown): v is Place => PLACES.some((p) => p === v);

/** The list from the server's answer, leaving out anything that makes no sense. */
export function readPresent(v: unknown): Present[] {
  if (!isRecord(v) || !Array.isArray(v.present)) return [];
  const out: Present[] = [];
  for (const p of v.present) {
    if (!isRecord(p) || typeof p.id !== "string" || typeof p.username !== "string" || !isPlace(p.place)) continue;
    out.push({
      id: p.id,
      name: p.username,
      place: p.place,
      rank: typeof p.rank === "string" ? p.rank : null,
      guest: p.guest === true,
    });
  }
  return out;
}

/** Those resting, from the server's answer, leaving out anything that makes no sense. */
export function readResting(v: unknown): Resting[] {
  if (!isRecord(v) || !Array.isArray(v.resting)) return [];
  const out: Resting[] = [];
  for (const r of v.resting) {
    if (!isRecord(r) || typeof r.id !== "string" || typeof r.username !== "string" || !isPlace(r.place)) continue;
    const seen = typeof r.seen_at === "string" ? Date.parse(r.seen_at) : NaN;
    if (!Number.isFinite(seen)) continue;
    out.push({ id: r.id, name: r.username, place: r.place, seen, guest: r.guest === true });
  }
  return out;
}

/** The town's record, where the member's choice to stay or not is kept (its `stay`, true unless false). */
const TOWN_RECORD = "town.save.v1";

/**
 * Whether the member would stay, as the town last wrote it down. Every page of the game reads it,
 * so that a game opened in the town's frame, or on its own, does not say "stay" for a member who
 * switched it off in their cabin.
 */
export function keptStay(): boolean {
  try {
    const raw: unknown = JSON.parse(keptText(TOWN_RECORD) ?? "null");
    return !(isRecord(raw) && raw.stay === false);
  } catch {
    return true;
  }
}

let at: Place | null = null;
/** What this page last said about staying; until it says, what the town kept. */
let staying: boolean | null = null;
const stayingNow = (): boolean => staying ?? keptStay();
let timer: ReturnType<typeof setInterval> | null = null;
const ears = new Set<(present: readonly Present[], resting: readonly Resting[]) => void>();

async function send(): Promise<void> {
  if (at === null || !member()) return;
  const a = await put("/v1/game/presence", { place: at, stay: stayingNow() });
  if (a.status !== 200) return;
  const present = readPresent(a.body);
  const resting = readResting(a.body);
  for (const fn of ears) fn(present, resting);
}

/** Says where the member is now; `null` while this page is not where they are (a game is open over it). */
export function here(place: Place | null): void {
  if (!member()) return;
  const moved = place !== at;
  at = place;
  timer ??= setInterval(() => void send(), EVERY);
  if (moved && place !== null) void send();
}

/** Says whether the member's character stays in town, dozing, for a day after they go; tells the server at once. */
export function stay(on: boolean): void {
  if (on === stayingNow()) {
    staying = on;
    return;
  }
  staying = on;
  if (member() && at !== null) void send();
}

/** Hears who is here, and who is resting, each time the server says. Returns how to stop. */
export function hearPresent(fn: (present: readonly Present[], resting: readonly Resting[]) => void): () => void {
  ears.add(fn);
  return () => ears.delete(fn);
}
