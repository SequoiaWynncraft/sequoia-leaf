/**
 * A person's card: somebody in a list ("Who is about", "Top yards") as the card shows them, their
 * face, their name and the line the list has for them, and under that their numbers in each game,
 * as Leaf has them (`GET /v1/game/people/{id}`). A page registers the kind once (`people`), says
 * what a list knows of somebody (`known`) before it links a row to `person:<id>`.
 *
 * Leaf is asked when the card is first shown, and what it said is kept a minute. Until it answers,
 * or when it cannot be read, the card shows the head alone.
 */

import type { Placed } from "@sequoia-leaf/core";

import { type Action, type Description, refresh, register, type Stat } from "./card.ts";
import { where } from "./live.ts";
import { ask, isRecord, outside } from "./net.ts";
import { faceFor } from "./skin.ts";

/** What a game says of somebody's standing in it: its name, and their numbers. */
export interface GameStats {
  readonly name: string;
  readonly numbers: (placed: Placed) => readonly Stat[];
}

/** Where somebody stands in each game, by game. */
export type Games = Readonly<Record<string, Placed>>;

/** Somebody, as a list knows them, and where they stand once Leaf has said (null until then, or if it could not be read). */
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

/** What Leaf says of somebody: their name, and where they stand. */
export interface Said {
  readonly name: string;
  readonly games: Games;
}

/** What Leaf said of somebody, read back; null for an answer that makes no sense. */
export function readPerson(v: unknown): Said | null {
  if (!isRecord(v) || typeof v.name !== "string" || !isRecord(v.games)) return null;
  const games = Object.entries(v.games).map(([game, placed]): [string, Placed | null] => [game, placedOf(placed)]);
  return games.every((g): g is [string, Placed] => g[1] !== null)
    ? { name: v.name, games: Object.fromEntries(games) }
    : null;
}

/** Asks Leaf what it says of somebody; null when that cannot be read. */
export async function askPerson(id: string): Promise<Said | null> {
  const a = await ask(`/v1/game/people/${encodeURIComponent(id)}`);
  return a.status === 200 ? readPerson(a.body) : null;
}

/**
 * The card's numbers: for each game in `stats` that somebody stands in, in that order, its name as
 * a label and then its numbers; for somebody who stands in none, one line.
 */
export function numbersOf(
  games: Games,
  stats: Readonly<Record<string, GameStats>>,
): Pick<Description, "stats" | "blocks"> {
  const shown: (Stat | string)[] = [];
  for (const [game, said] of Object.entries(stats)) {
    const placed = games[game];
    if (placed) shown.push(said.name, ...said.numbers(placed));
  }
  return shown.length > 0 ? { stats: shown } : { blocks: [{ body: "Has not played yet." }] };
}

const heads = new Map<string, { name: string; line: string }>();
const asked = new Map<string, { at: number; games: Games | null }>();

/** What a list already knows of somebody, so their card has a head before Leaf answers. */
export function known(p: { id: string; name: string; line: string }): void {
  heads.set(p.id, { name: p.name, line: p.line });
}

/** Asks Leaf where somebody stands, and draws their card again when it answers. */
async function askFor(id: string): Promise<void> {
  // What it said last is shown meanwhile.
  asked.set(id, { at: outside.now(), games: asked.get(id)?.games ?? null });
  const said = await askPerson(id);
  asked.set(id, { at: outside.now(), games: said?.games ?? null });
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
    if (!had || outside.now() - had.at >= KEPT_MS) void askFor(id);
    const games = had?.games ?? null;
    return {
      name: head.name,
      icon: faceFor(id, head.name, where().mode === "live"),
      ...(head.line === "" ? {} : { tag: head.line }),
      ...(games ? numbersOf(games, opts.stats) : {}),
      actions: opts.actions({ id, ...head, games }),
    };
  });
}
