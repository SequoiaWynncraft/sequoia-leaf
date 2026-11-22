/**
 * A person's card: somebody in a list ("Who is about", "Top yards") as the card shows them, their
 * face, their name and the line the list has for them, and under that how long they have played,
 * and their numbers in each game, as Leaf has them (`GET /v1/game/people/{id}`). A page registers
 * the kind once (`people`), says what a list knows of somebody (`known`) before it links a row to
 * `person:<id>`. A game's board, the lists of where people stand, is read here too (`readBoard`).
 *
 * Leaf is asked when the card is first asked for, and the card shows once, whole, when Leaf has
 * answered (`coming`); if the answer cannot be read, the head alone. What Leaf said is kept a
 * minute, and shown while it is asked again.
 */

import type { Placed } from "@sequoia-leaf/core";

import { type Action, type Description, refresh, register, type Stat } from "./card.ts";
import { ask, isRecord, outside } from "./net.ts";

/** What a game says of somebody's standing in it: its name, and their numbers. */
export interface GameStats {
  readonly name: string;
  readonly numbers: (placed: Placed) => readonly Stat[];
}

/** Somebody in a game: where they stand, if they do, and how long they have played it, in seconds. */
export interface InGame {
  readonly placed: Placed | null;
  readonly played: number;
}

/** Each game somebody stands in or has played, by game. */
export type Games = Readonly<Record<string, InGame>>;

/** Somebody, as a list knows them, and their games once Leaf has said (null until then, or if it could not be read). */
export interface Person {
  readonly id: string;
  readonly name: string;
  readonly line: string;
  readonly games: Games | null;
}

/** How long what Leaf said of somebody is kept before it is asked again. */
const KEPT_MS = 60_000;

const whole = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;

function placedOf(v: unknown): Placed | null {
  if (!isRecord(v) || !whole(v.place) || !whole(v.score) || !isRecord(v.also)) return null;
  const also = Object.entries(v.also);
  if (!also.every((a): a is [string, number] => typeof a[1] === "number")) return null;
  return { place: v.place, score: v.score, also: Object.fromEntries(also) };
}

/** Somebody on a game's board (`GET /v1/game/play/{game}/standings`). */
export type Row = Placed & {
  readonly id: string;
  readonly name: string;
  readonly guest: boolean;
  readonly you: boolean;
};
export interface Board {
  readonly top: readonly Row[];
  /** The player's own place among everyone, or null before they have a standing. */
  readonly you: Placed | null;
}

function rowOf(v: unknown): Row | null {
  const placed = placedOf(v);
  if (!placed || !isRecord(v) || typeof v.id !== "string" || typeof v.name !== "string") return null;
  return { ...placed, id: v.id, name: v.name, guest: v.guest === true, you: v.you === true };
}

/** A game's board from Leaf's answer, or null for one that makes no sense. */
export function readBoard(v: unknown): Board | null {
  if (!isRecord(v) || !Array.isArray(v.top)) return null;
  const top = v.top.map(rowOf);
  const you = v.you === null ? null : placedOf(v.you);
  if (top.some((r) => r === null) || (v.you !== null && you === null)) return null;
  return { top: top.filter((r) => r !== null), you };
}

/** What Leaf says of somebody: their name, their games, and how long they have played all games, in seconds. */
export interface Said {
  readonly name: string;
  readonly games: Games;
  readonly played: number;
}

function inGameOf(v: unknown): InGame | null {
  if (!isRecord(v) || !whole(v.played)) return null;
  const placed = v.place === undefined ? null : placedOf(v);
  return v.place !== undefined && placed === null ? null : { placed, played: v.played };
}

/** What Leaf said of somebody, read back; null for an answer that makes no sense. */
export function readPerson(v: unknown): Said | null {
  if (!isRecord(v) || typeof v.name !== "string" || !isRecord(v.games) || !whole(v.played)) return null;
  const games = Object.entries(v.games).map(([game, g]): [string, InGame | null] => [game, inGameOf(g)]);
  return games.every((g): g is [string, InGame] => g[1] !== null)
    ? { name: v.name, games: Object.fromEntries(games), played: v.played }
    : null;
}

/** Asks Leaf what it says of somebody; null when that cannot be read. */
export async function askPerson(id: string): Promise<Said | null> {
  const a = await ask(`/v1/game/people/${encodeURIComponent(id)}`);
  return a.status === 200 ? readPerson(a.body) : null;
}

/** A time played, as the card writes it: "under 1 min", "42 min", "3 h 20 min" ("3 h" on the hour), and from 100 hours "132 h". */
export function duration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  if (minutes < 1) return "under 1 min";
  if (hours < 1) return `${minutes} min`;
  if (hours >= 100 || minutes % 60 === 0) return `${hours.toLocaleString("en-US")} h`;
  return `${hours} h ${minutes % 60} min`;
}

/** "Time played", for a time above none. */
const timeOf = (seconds: number): Stat[] => (seconds > 0 ? [{ label: "Time played", value: duration(seconds) }] : []);

/**
 * The card's numbers: how long somebody has played all games together; then for each game in
 * `stats` they stand in or have played, in that order, its name as a label, its numbers and how
 * long they have played it. For somebody with none of these, one line.
 */
export function numbersOf(
  said: Said,
  stats: Readonly<Record<string, GameStats>>,
): Pick<Description, "stats" | "blocks"> {
  const shown: (Stat | string)[] = timeOf(said.played);
  for (const [game, says] of Object.entries(stats)) {
    const g = said.games[game];
    if (g) shown.push(says.name, ...(g.placed ? says.numbers(g.placed) : []), ...timeOf(g.played));
  }
  return shown.length > 0 ? { stats: shown } : { blocks: [{ body: "Has not played yet." }] };
}

interface Head {
  readonly name: string;
  readonly line: string;
  /** Their face, as the list shows it. */
  readonly face: HTMLCanvasElement;
}
const heads = new Map<string, Head>();
const asked = new Map<string, { at: number; said: Said | null }>();
/** Whoever Leaf is being asked about for the first time: their card waits for the answer. */
const first = new Map<string, Promise<void>>();

/** What a list knows of somebody: the head of their card. */
export function known(p: Head & { readonly id: string }): void {
  heads.set(p.id, p);
}

/** Asks Leaf where somebody stands, and draws their card again when it answers. */
async function askFor(id: string): Promise<void> {
  // What it said last is shown meanwhile.
  asked.set(id, { at: outside.now(), said: asked.get(id)?.said ?? null });
  const said = await askPerson(id);
  asked.set(id, { at: outside.now(), said });
  first.delete(id);
  refresh();
}

/** Registers the person's card, as the kind `person`, for this page. */
export function people(opts: {
  /** What each game's standing says, as the card's numbers. */
  readonly stats: Readonly<Record<string, GameStats>>;
  /** Buttons at the foot of a pinned card, for this page: "Visit yard", "Find in town". */
  readonly actions: (person: Person) => readonly Action[];
}): void {
  register("person", (id) => {
    const head = heads.get(id);
    if (!head) return null;
    const had = asked.get(id);
    if (!had) first.set(id, askFor(id));
    else if (outside.now() - had.at >= KEPT_MS) void askFor(id);
    const said = asked.get(id)?.said ?? null;
    const coming = first.get(id);
    return {
      name: head.name,
      icon: head.face,
      ...(head.line === "" ? {} : { tag: head.line }),
      ...(said ? numbersOf(said, opts.stats) : {}),
      actions: opts.actions({ id, name: head.name, line: head.line, games: said?.games ?? null }),
      ...(coming ? { coming } : {}),
    };
  });
}
