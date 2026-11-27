/**
 * Which pieces of the yard are in trouble, for the count on the top row's button, the marks on the
 * map and the far steps, and the list (`ui/views.ts`).
 *
 * Whether a piece is in trouble is the rules' to say (`condition`, which makes nothing): every tile
 * is asked at most once for each second of the yard's clock, and again when what stands has changed.
 * Trouble is listed once it has lasted a second and a half, as the mark over a machine's head is, so
 * that a line stuttering is not counted; and a piece listed stays listed until it has been out of
 * trouble for six seconds, so that a boiler that runs out of fuel every few seconds is one steady
 * line of the list and not one that comes and goes. A change to what stands drops at once whatever
 * it mended.
 *
 * What is wrong, in words, is the rules' too (`status`): it is asked of a piece when it is first
 * listed, and of the pieces in trouble when the list is read (`troubleGroups`), never of every piece.
 */

import {
  condition,
  isKind,
  type Item,
  type Kind,
  NONE,
  STATES,
  status,
  TROUBLE,
  type Yard,
} from "@sequoia-leaf/factory";

import { drawnFrom } from "./big.ts";

/** Ticks trouble must have lasted to be listed, and ticks a listed piece must have been out of it to be dropped. */
const LASTS = 15;
const HOLDS = 60;
/** A yard this many ticks from the one last looked at is another yard: what was known of its pieces is dropped. */
const ANOTHER = 600;

interface Found {
  yard: Yard | null;
  rev: number;
  /** The yard's tick, and the second of its clock, last looked at. */
  tick: number;
  second: number;
  /**
   * For each tile, how its piece stands with the list (0 not in trouble, 1 in trouble that has not
   * lasted yet, 2 listed), and the ticks it was first and last found in trouble.
   */
  listed: Uint8Array;
  first: Int32Array;
  last: Int32Array;
  /** What is wrong with each listed piece, by its tile: the head of its group. */
  said: Map<number, string>;
  /** The tiles of the pieces listed, `count` of them, in the order of the tiles. */
  tiles: Int32Array;
  count: number;
  /** Counts each look, so that what is worked out from one is kept until the next. */
  turn: number;
}
let found: Found | null = null;

const IDLE = STATES.indexOf("idle");

/**
 * What is wrong with the piece on a tile, as the head of a group: the rules' sentence for it
 * (`status`), as far as its first stop, colon or ", so": "Full of planks and waiting for pots",
 * "Nowhere to send its gears", "No power here", "Not connected to a pylon", "Out of fuel". A machine
 * holding what no recipe uses together has a sentence that counts what it holds, which is no group's.
 */
function titleOf(y: Yard, i: number): string {
  if (condition(y, i) % TROUBLE === IDLE) return "Holds things no recipe uses together";
  return (status(y, i)?.line ?? "").split(/[.:]|, so /)[0] ?? "";
}

/**
 * The pieces in trouble: their tiles (`count` of them at the head of `tiles`), as of the last look.
 * It looks again when the yard's clock has reached another second or what stands has changed
 * (`y.rev`, the rules' count of changes), and otherwise costs nothing.
 */
export function troubled(y: Yard): Found {
  const n = y.kind.length;
  if (found?.listed.length !== n)
    found = {
      yard: null,
      rev: -1,
      tick: 0,
      second: -1,
      listed: new Uint8Array(n),
      first: new Int32Array(n),
      last: new Int32Array(n),
      said: new Map(),
      tiles: new Int32Array(n),
      count: 0,
      turn: 0,
    };
  const f = found;
  const second = Math.floor(y.tick / 10);
  if (f.yard === y && f.rev === y.rev && f.second === second) return f;
  // The first look at a yard takes its trouble as it finds it: how long it has lasted is not known.
  const fresh = f.yard === null || y.tick < f.tick || y.tick - f.tick > ANOTHER;
  if (fresh) {
    f.listed.fill(0);
    f.said.clear();
  }
  // What stands has changed: whatever is out of trouble now was mended, and is dropped at once.
  const mended = f.yard !== y || f.rev !== y.rev;
  let count = 0;
  for (let i = 0; i < n; i++) {
    // A piece of more than one tile is listed once, by its own tile.
    const wrong = y.kind[i] !== NONE && drawnFrom(y, i) && condition(y, i) >= TROUBLE;
    const was = f.listed[i] ?? 0;
    if (wrong) {
      if (was === 0) {
        f.listed[i] = 1;
        f.first[i] = y.tick;
      }
      f.last[i] = y.tick;
      if (was !== 2 && (fresh || y.tick - (f.first[i] ?? 0) >= LASTS)) {
        f.listed[i] = 2;
        f.said.set(i, titleOf(y, i));
      }
    } else if (was !== 0 && (mended || was === 1 || y.tick - (f.last[i] ?? 0) > HOLDS)) {
      // Out of trouble: at once if it was not listed yet, else once it has stayed out.
      if (was === 2) f.said.delete(i);
      f.listed[i] = 0;
    }
    if (f.listed[i] === 2) f.tiles[count++] = i;
  }
  f.count = count;
  f.yard = y;
  f.rev = y.rev;
  f.tick = y.tick;
  f.second = second;
  f.turn++;
  return f;
}

/**
 * Pieces with the same thing wrong: what it is, in the rules' words, their tiles in the order of the
 * tiles, their kinds, and what they hold with nowhere to send it, if that is what is wrong (the
 * title names it), for a belt's picture to carry.
 */
export interface Group {
  readonly title: string;
  readonly tiles: readonly number[];
  readonly kinds: readonly Kind[];
  readonly stuck: Item | null;
}

let grouped: { turn: number; groups: readonly Group[] } | null = null;

/**
 * The pieces in trouble in groups by what is wrong, the largest first (of two as large, the one
 * whose first piece comes first). Worked out once for each look (`troubled`), and only when asked.
 */
export function troubleGroups(y: Yard): readonly Group[] {
  const f = troubled(y);
  if (grouped?.turn === f.turn) return grouped.groups;
  const by = new Map<string, { title: string; tiles: number[]; kinds: Kind[]; stuck: Item | null }>();
  for (let c = 0; c < f.count; c++) {
    const i = f.tiles[c] ?? 0;
    const k = y.kind[i] ?? NONE;
    // What is wrong may have changed while it stayed wrong (another thing with nowhere to go): said again while it is.
    if (condition(y, i) >= TROUBLE) f.said.set(i, titleOf(y, i));
    const title = f.said.get(i) ?? "";
    let group = by.get(title);
    if (!group) by.set(title, (group = { title, tiles: [], kinds: [], stuck: status(y, i)?.stuck ?? null }));
    group.tiles.push(i);
    if (isKind(k) && !group.kinds.includes(k)) group.kinds.push(k);
  }
  const groups = [...by.values()].toSorted(
    (a, b) => b.tiles.length - a.tiles.length || (a.tiles[0] ?? 0) - (b.tiles[0] ?? 0),
  );
  grouped = { turn: f.turn, groups };
  return groups;
}

/** Forgets what was found (for tests). */
export function forgetTrouble(): void {
  found = null;
  grouped = null;
}
