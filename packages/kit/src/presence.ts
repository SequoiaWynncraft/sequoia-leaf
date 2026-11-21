/**
 * Who is here: when the game is live, each page tells the server where in the game the member is
 * (the town, their camp, the Works, the table), every half minute and at once when it changes, and
 * hears back everybody seen in the last little while. With the made-up guild it does nothing.
 */

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
    out.push({ id: p.id, name: p.username, place: p.place, rank: typeof p.rank === "string" ? p.rank : null });
  }
  return out;
}

let at: Place | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
const ears = new Set<(present: readonly Present[]) => void>();

async function send(): Promise<void> {
  if (at === null || !member()) return;
  const a = await put("/v1/game/presence", { place: at });
  if (a.status !== 200) return;
  const present = readPresent(a.body);
  for (const fn of ears) fn(present);
}

/** Says where the member is now; `null` while this page is not where they are (a game is open over it). */
export function here(place: Place | null): void {
  if (!member()) return;
  const moved = place !== at;
  at = place;
  timer ??= setInterval(() => void send(), EVERY);
  if (moved && place !== null) void send();
}

/** Hears who is here, each time the server says. Returns how to stop. */
export function hearPresent(fn: (present: readonly Present[]) => void): () => void {
  ears.add(fn);
  return () => ears.delete(fn);
}
