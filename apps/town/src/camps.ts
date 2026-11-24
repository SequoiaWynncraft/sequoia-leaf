/**
 * The camps there are, as Leaf lists them (`GET /v1/game/camps`), for the signpost and the strip at
 * somebody's camp: read, put in order, found by name, and the next one along; a like given or taken
 * back; and who likes the member's camp and who stayed in it this week. The page holds the list as
 * Leaf last gave it, and the order last chosen at the signpost, which "Next camp" follows too.
 */

import { ask, isRecord } from "@sequoia-leaf/kit/net.ts";

/** A camp: whose, the things set out in it, how many like it, and whether the member does. */
export interface Camp {
  readonly id: string;
  readonly name: string;
  readonly guest: boolean;
  readonly setOut: number;
  readonly likes: number;
  readonly liked: boolean;
}

/** Somebody who likes the member's camp, or stayed in it. */
export interface Visitor {
  readonly id: string;
  readonly name: string;
  readonly guest: boolean;
}

/** The orders the signpost lists camps in, by what each is called. */
export const ORDERS = { liked: "Most liked", set: "Most set out" } as const;
export type Order = keyof typeof ORDERS;

/**
 * What the page holds: the camps as Leaf last listed them, and the order last chosen. Each question
 * to Leaf (a list, a like) is numbered as it is sent (`asked`), and each camp is held as the answer
 * to the last one sent that told of it (`told`): a list asked for before a like, and answered after
 * it, does not undo it.
 */
const held: { camps: readonly Camp[]; order: Order; asked: number; told: Map<string, number> } = {
  camps: [],
  order: "liked",
  asked: 0,
  told: new Map(),
};

/** A camp as the answer to question `n` tells of it: as held, if a later question has told of it since. */
function take(c: Camp, n: number): Camp {
  if ((held.told.get(c.id) ?? 0) > n) return held.camps.find((h) => h.id === c.id) ?? c;
  held.told.set(c.id, n);
  return c;
}

/** The camps as Leaf last listed them. */
export const camps = (): readonly Camp[] => held.camps;
/** The order last chosen at the signpost. */
export const order = (): Order => held.order;
export function choose(o: Order): void {
  held.order = o;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);

function readCamp(v: unknown): Camp | null {
  if (!isRecord(v)) return null;
  const id = str(v.id);
  const name = str(v.name);
  const setOut = num(v.set_out);
  const likes = num(v.likes);
  if (id === null || name === null || setOut === null || likes === null) return null;
  return { id, name, guest: v.guest === true, setOut, likes, liked: v.liked === true };
}

/** The camps from `GET /v1/game/camps`, or null for anything that is not that. */
export function readCamps(v: unknown): Camp[] | null {
  if (!isRecord(v) || !Array.isArray(v.camps)) return null;
  return v.camps.flatMap((c) => readCamp(c) ?? []);
}

const byName = (a: Camp, b: Camp): number =>
  a.name.localeCompare(b.name, "en", { sensitivity: "base" }) || (a.id < b.id ? -1 : 1);

/** Camps in an order: the most liked first, a tie going to more set out; or the most set out first, a tie to more likes; then by name. */
export function inOrder(list: readonly Camp[], o: Order): Camp[] {
  return list.toSorted((a, b) =>
    o === "liked"
      ? b.likes - a.likes || b.setOut - a.setOut || byName(a, b)
      : b.setOut - a.setOut || b.likes - a.likes || byName(a, b),
  );
}

/** The camps whose owner's name has `words` in it, in any case; all of them for no words. */
export function named(list: readonly Camp[], words: string): Camp[] {
  const w = words.trim().toLowerCase();
  return w === "" ? [...list] : list.filter((c) => c.name.toLowerCase().includes(w));
}

/** The camp after `at` in an order, never the member's own (`me`) or `at` itself, from the first again after the last; null for none. */
export function nextAfter(list: readonly Camp[], o: Order, at: string, me: string): Camp | null {
  const ways = inOrder(list, o).filter((c) => c.id !== me);
  const here = ways.findIndex((c) => c.id === at);
  const next = ways[(here + 1) % Math.max(1, ways.length)];
  return next === undefined || next.id === at ? null : next;
}

/** Asks Leaf for the camps, and holds them; null when Leaf did not answer with them. */
export async function fetchCamps(): Promise<readonly Camp[] | null> {
  const n = ++held.asked;
  const a = await ask("/v1/game/camps");
  const read = a.status === 200 ? readCamps(a.body) : null;
  if (read) held.camps = read.map((c) => take(c, n));
  return read && held.camps;
}

/** Gives (`on`) or takes back the member's like of `id`'s camp: the camp as Leaf answers, or what Leaf said, or null for no answer. */
export async function like(id: string, on: boolean): Promise<Camp | string | null> {
  const n = ++held.asked;
  const a = await ask(`/v1/game/camps/${encodeURIComponent(id)}/like`, { method: on ? "PUT" : "DELETE" });
  const body = isRecord(a.body) ? a.body : {};
  const likes = num(body.likes);
  if (a.status !== 200 || likes === null) return typeof body.message === "string" ? body.message : null;
  const was = held.camps.find((c) => c.id === id);
  const now: Camp = {
    id,
    name: was?.name ?? "",
    guest: was?.guest ?? false,
    setOut: was?.setOut ?? 0,
    likes,
    liked: body.liked === true,
  };
  const kept = take(now, n);
  held.camps = was ? held.camps.map((c) => (c.id === id ? kept : c)) : [...held.camps, kept];
  return kept;
}

function readVisitors(v: unknown): Visitor[] {
  return (Array.isArray(v) ? v : []).flatMap((c) => {
    if (!isRecord(c)) return [];
    const id = str(c.id);
    const name = str(c.name);
    return id === null || name === null ? [] : [{ id, name, guest: c.guest === true }];
  });
}

/** Who likes the member's camp, newest first, and who stayed in it this week; null when Leaf did not answer. */
export async function visitors(): Promise<{ likes: Visitor[]; stays: Visitor[] } | null> {
  const a = await ask("/v1/game/camps/visitors");
  if (a.status !== 200 || !isRecord(a.body)) return null;
  return { likes: readVisitors(a.body.likes), stays: readVisitors(a.body.stays) };
}
