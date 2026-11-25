/**
 * Undo, done by the rules: the yard keeps, with it, what it takes to undo each of the last things
 * done to it (`Yard.history`, the newest last), so the page and Leaf undo the same thing as one
 * command (`{ do: "undo", entry }`, the newest entry by its id), all of it or none, and an Undo is
 * still there after a reload or on another device.
 *
 * Each command with an Undo (`REACH`) keeps one entry, its exact inverse as the rules did it: the
 * tiles it changed; what stood on them before, whole (as `cells.ts` packs pieces: kind, way, grade,
 * colour, what it was set to, its ways, span, whether it was one of the pieces to hand); and the
 * Coins it moved, but for the till paid in with it. A stroke of the brush is many commands and one
 * entry: each after the first says the entry it adds to (`onto`).
 *
 * The history holds by construction. Undo takes the newest entry first; ticks change no piece, only
 * what pieces hold and carry; and every other command that changes a piece or the Coins (`FORGETS`)
 * forgets the whole history. A check of what the command left on its tiles (`sum`) still refuses an
 * entry that no longer matches the yard, which should never happen.
 *
 * Undoing puts back what was there:
 * - a piece the command took away comes back as it stood, with what it held when it went, as that
 *   was nowhere since, and what it was doing as far as the yard lets it be now (`keptOnto`, as reading
 *   a yard back does): a Study's work on research no longer first in line is let go;
 * - a piece the command changed where it stands (turned, raised, coloured, its ways or side set, a
 *   belt a splitter or joiner was set down on, which kept what the belt carried) has back the settings
 *   the command changed, and only those, keeping what it holds, carries and is doing now;
 * - a piece the command set down is taken away, with whatever it holds now, as the spade takes it;
 * - pieces moved are moved back as one, with what they hold now.
 * Whether a piece was one of those to hand goes back with it, exactly. The Coins go the other way:
 * what the command cost is given back, and what it gave back is taken.
 *
 * An entry's bytes: its id (a varint), what it is (a byte: 1 a move, 2 a stroke of the brush, 4 too
 * much to keep), the Coins it moved (a varint, zigzag), the check of its tiles after it (four bytes),
 * the tiles it changed that held nothing before (a count, then each as the tiles since the last less
 * one), for a move the turns and corner that move the pieces back (a byte each), which settings the
 * command changed on each piece that stood there (a count, then a varint each, a bit for each part as
 * `PARTS_SET` has them), and last what stood there before (`packKept`). Its id names the action, not
 * what it did: the yard's count of entries kept (`Yard.entries`) as the rules kept it, the same on the
 * page and on Leaf, which run the same commands in the same order. A stroke keeps its id as it grows.
 *
 * At most `UNDO_MOST` entries and `UNDO_BYTES` bytes in all, the oldest let go first. A command
 * whose own entry is over that is still done, and kept, under its id, as one that cannot be undone;
 * a stroke over it goes on as one, so that no part of it is undone.
 */
import type { CoinChange } from "@sequoia-leaf/core";

import { at, otherMouth, replaces, tunnelExit } from "./build.ts";
import { Reader, Writer } from "./bytes.ts";
import { keptOnto, type KeptPiece, keptPiece, packKept, unpackCells } from "./cells.ts";
import type { Act, ActOf } from "./commands.ts";
import { lineOf } from "./lines.ts";
import { blueprintAt, boxOf, copyOf, move, piecesAt, tilesOf } from "./pieces.ts";
import { REASON } from "./reasons.ts";
import { legPiece } from "./route.ts";
import { CRATE, DEPOT, gradeOf, isKind, NONE, TUNNEL } from "./tables.ts";
import { changed, type Entry, holderOf, place, tunnelRow, vacate, type Yard } from "./yard.ts";

/** The most entries a yard keeps, and the most bytes they may come to in all. */
export const UNDO_MOST = 20;
export const UNDO_BYTES = 4096;

/** The commands that change a piece or the Coins with no Undo, which forget every entry. */
const FORGETS: ReadonlySet<string> = new Set(["recipe", "sort", "crate", "buyPlot"]);

/** What an entry is, a bit each. */
const MOVED = 1;
const STROKE = 2;
const TOO_BIG = 4;

/** Why an Undo is refused. */
const UNDO_SAYS = {
  nothing: "Nothing to undo",
  notLast: "Cannot undo: that is no longer the last thing done",
  tooBig: "Cannot undo: that changed too much at once",
  changed: "Cannot undo: it has changed since",
} as const;

type Name = Act["do"];

/** The highest an entry's id goes. */
export const ID_MOST = 1e12;

/** An entry read back from its bytes. */
interface Undoing {
  readonly id: number;
  readonly flags: number;
  /** The Coins the command moved to the player: below nothing for what it cost. */
  readonly coins: number;
  readonly sum: number;
  /** Every tile it changed, in order. */
  readonly tiles: readonly number[];
  /** What stood on those of them that held something before, and the settings the command changed on each (`PARTS_SET`, a bit each). */
  readonly was: readonly KeptPiece[];
  readonly masks: readonly number[];
  /** For a move, the turns and the corner that move the pieces back. */
  readonly back: { readonly turns: number; readonly x: number; readonly y: number } | null;
}

/** A command about to be done: every tile it may change, in order, and what stood on them, with all it held. */
export interface Before {
  readonly tiles: readonly number[];
  readonly was: ReadonlyMap<number, KeptPiece>;
  /** For a move, the turns and the corner that move the pieces back. */
  readonly back: Undoing["back"];
}

// ---------- keeping ----------

const tileOf = (y: Yard, p: { readonly x: number; readonly y: number }): number => at(y, p.x, p.y);
/** The tile a command names. */
const one = (y: Yard, a: { readonly x: number; readonly y: number }): number[] => [tileOf(y, a)];
/** The tiles of the pieces on some tiles: a tunnel's both mouths. */
const inArea = (y: Yard, a: { readonly tiles: readonly number[] }): number[] => tilesOf(y, piecesAt(y, a.tiles));
/** A new tunnel's far mouth, where it would come up. */
function tunnelEnd(y: Yard, a: ActOf<"build">): number[] {
  const exit = a.kind === TUNNEL ? tunnelExit(y, a.x, a.y, a.dir) : null;
  return exit ? [tileOf(y, exit)] : [];
}

/**
 * The commands with an Undo, each with the tiles it may change, worked out before it is done: never
 * fewer than it changes, as random play undone back to its start shows (`undo.test.ts`). Beside
 * these, the mouths of a tunnel on any of them go too (`before`).
 */
const REACH: { readonly [D in Name]?: (y: Yard, a: ActOf<D>) => readonly number[] } = {
  build: (y, a) => [tileOf(y, a), ...tunnelEnd(y, a)],
  lay: (y, a) => [...tilesOf(y, a.legs.map(legPiece)), ...(a.turn ? [tileOf(y, a.turn)] : [])],
  stand: (y, a) => tilesOf(y, a.pieces),
  placeBlueprint: (y, a) => tilesOf(y, blueprintAt(y, a.slot, a.turns, a.x, a.y) ?? []),
  move: (y, a) => [...inArea(y, a), ...tilesOf(y, copyOf(y, a.tiles, a.turns, a.x, a.y) ?? [])],
  copy: (y, a) => tilesOf(y, copyOf(y, a.tiles, a.turns, a.x, a.y) ?? []),
  remove: one,
  clear: inArea,
  upgrade: inArea,
  turn: one,
  paint: (y, a) => lineOf(y, tileOf(y, a)),
  side: one,
  way: one,
  first: one,
  wayIn: one,
};

/** The tiles a command may change, or null for one with no Undo (`REACH`). */
function reach<D extends Name>(y: Yard, a: ActOf<D>): readonly number[] | null {
  const tiles: ((y: Yard, a: ActOf<D>) => readonly number[]) | undefined = REACH[a.do];
  return tiles ? tiles(y, a) : null;
}

/** What a command needs kept to be undone, taken before it is done: nothing for a command with no Undo. */
export function before(y: Yard, a: Act): Before | null {
  const near = reach(y, a);
  if (!near) return null;
  // A tunnel's mouths go together; the depot never changes.
  const mouths = near.flatMap((i) => (i < 0 ? [] : [i, otherMouth(y, i)]));
  const tiles = [...new Set(mouths)].filter((i) => i >= 0 && y.kind[i] !== DEPOT).toSorted((i, j) => i - j);
  const was = new Map(tiles.flatMap((i) => (y.kind[i] === NONE ? [] : [[i, keptPiece(y, i)] as const])));
  if (a.do !== "move") return { tiles, was, back: null };
  const box = boxOf(piecesAt(y, a.tiles));
  return { tiles, was, back: { turns: (4 - a.turns) & 3, x: box.x, y: box.y } };
}

/** A kept piece's parts in the order of the yard's arrays (`PARTS_SET`), as `vacate` leaves a tile with none. */
function setOf(p: KeptPiece | undefined): number[] {
  if (!p) return [NONE, 0, NONE, 0, 0, 0, 0, 0, 0, 0, NONE, 0, 0, 0];
  const w = p.ways ?? 0;
  const [item, prog, via] = [p.item ?? NONE, p.prog ?? 0, p.via ?? 0];
  const [tint, turn, recipe, grade, span] = [
    p.tint ?? 0,
    p.turn ?? 0,
    p.recipe ?? NONE,
    p.grade ?? gradeOf(p.kind),
    p.span ?? 0,
  ];
  return [p.kind, p.dir, item, prog, via, tint, turn, w & 7, (w >> 3) & 3, w >> 5, recipe, grade, p.free ? 1 : 0, span];
}
/** The arrays of a tile a command may change, in the order `setOf` gives them. */
const PARTS_SET = [
  "kind",
  "dir",
  "item",
  "prog",
  "via",
  "tint",
  "turn",
  "shut",
  "first",
  "ins",
  "set",
  "grade",
  "free",
  "span",
] as const;

/** What a piece carries: never set back on one that stays, which carries what it carries now. */
const CARRIED: ReadonlySet<string> = new Set(["item", "prog", "via"]);
/** Every setting at once: for a piece stood again. */
const ALL_SET = (1 << PARTS_SET.length) - 1;

/** The settings of the piece on a tile that differ from a kept piece's, a bit each by its place in `PARTS_SET`. */
function changedParts(y: Yard, p: KeptPiece): number {
  const want = setOf(p);
  return PARTS_SET.reduce((m, part, n) => (CARRIED.has(part) || y[part][p.tile] === want[n] ? m : m | (1 << n)), 0);
}

/** Whether the piece on a tile stands and carries as a kept piece (or, with none, as bare ground). */
function standsAs(y: Yard, i: number, p: KeptPiece | undefined): boolean {
  const want = setOf(p);
  return PARTS_SET.every((part, n) => y[part][i] === want[n]);
}

/** 32 bits of how the pieces on some tiles stand: everything a command sets, nothing ticks change. */
function sumOf(y: Yard, tiles: readonly number[]): number {
  let h = 0x811c9dc5 | 0;
  const mix = (v: number): void => {
    h = Math.imul(h ^ v, 0x01000193);
  };
  for (const i of tiles) {
    mix(i);
    for (const part of ["kind", "dir", "grade", "tint", "shut", "first", "ins", "set", "free", "span"] as const)
      mix(y[part][i] ?? 0);
    mix(y.kind[i] === CRATE ? (y.holders.open[holderOf(y, i)] ?? 1) : -1);
  }
  return h >>> 0;
}

/** An entry, its id read from its first bytes. */
const entry = (bytes: Uint8Array): Entry => ({ id: new Reader(bytes).varint(), bytes });
/** An entry that cannot be undone, under its id: a command's own entry over the cap, or a stroke's. */
function overCap(id: number, flags: number): Entry {
  const o = new Writer();
  o.varint(id);
  o.byte(TOO_BIG | (flags & STROKE));
  return entry(o.bytes());
}

/** A kept piece without what its holder held and was doing: for one that stays, which keeps what it holds now. */
const bare = ({ held: _h, out: _o, work: _w, making: _m, fuel: _f, ...p }: KeptPiece): KeptPiece => p;

/** An entry's bytes, of the yard after its command (`y`); `was` is what stood on its tiles before. */
function written(y: Yard, u: Omit<Undoing, "sum" | "masks">): Uint8Array {
  const o = new Writer();
  o.varint(u.id);
  o.byte(u.flags);
  o.varint(u.coins < 0 ? -u.coins * 2 - 1 : u.coins * 2);
  const sum = sumOf(y, u.tiles);
  for (let k = 0; k < 4; k++) o.byte((sum >>> (8 * k)) & 255);
  const had = new Set(u.was.map((p) => p.tile));
  const fresh = u.tiles.filter((i) => !had.has(i));
  o.varint(fresh.length);
  fresh.forEach((i, k) => o.varint(i - (fresh[k - 1] ?? -1) - 1));
  if (u.back) for (const v of [u.back.turns, u.back.x, u.back.y]) o.byte(v);
  o.varint(u.was.length);
  for (const p of u.was) o.varint(changedParts(y, p));
  // Only a piece taken away keeps what it held: one that still stands, or was moved, holds what it holds now.
  const stays = (p: KeptPiece): boolean =>
    u.back !== null || y.kind[p.tile] === p.kind || replaces(y.kind[p.tile] ?? NONE, p.kind);
  for (const b of packKept(u.was.map((p) => (stays(p) ? bare(p) : p)))) o.byte(b);
  return o.bytes();
}

/** The entries kept within `UNDO_MOST` and `UNDO_BYTES`, the oldest let go first. */
function capped(history: readonly Entry[]): Entry[] {
  const out = history.slice(-UNDO_MOST);
  let bytes = out.reduce((n, e) => n + e.bytes.length, 0);
  while (bytes > UNDO_BYTES) bytes -= out.shift()?.bytes.length ?? bytes;
  return out;
}

/** The stroke of the brush a command adds to: the newest entry, if it is a stroke's and the command says it (`onto`). */
function strokeOf(y: Yard, a: Act): Undoing | null {
  const top = y.history.at(-1);
  if (a.do !== "paint" || a.onto === undefined || top?.id !== a.onto) return null;
  const u = readEntry(top.bytes, y.kind.length);
  return u && (u.flags & STROKE) !== 0 ? u : null;
}

/** What a command done (`b` taken before it) changed, with the stroke it adds to: its entry, but for the check. */
function undoing(
  y: Yard,
  b: Before,
  stroke: Undoing | null,
  coins: number,
  paint: boolean,
): Omit<Undoing, "sum" | "masks"> {
  const done = b.back ? b.tiles : b.tiles.filter((i) => !standsAs(y, i, b.was.get(i)));
  // What the stroke's lines were before it, over what this command found on them.
  const was = new Map([...done.flatMap((i) => b.was.get(i) ?? []), ...(stroke?.was ?? [])].map((p) => [p.tile, p]));
  return {
    id: stroke?.id ?? y.entries + 1,
    flags: (b.back ? MOVED : 0) | (paint ? STROKE : 0),
    coins: (stroke?.coins ?? 0) + coins,
    tiles: [...new Set([...done, ...(stroke?.tiles ?? [])])].toSorted((i, j) => i - j),
    was: [...was.values()].toSorted((p, q) => p.tile - q.tile),
    back: b.back,
  };
}

/**
 * Keeps an entry for a command done (`a`, `b` taken before it), numbered by the yard's count, which
 * made `changes` to the Coins: the till paid in with them is not undone. A command with no Undo that
 * changes a piece or the Coins forgets them all. A stroke of the brush that says the newest entry
 * (`onto`) adds to it, under its id.
 */
export function after(y: Yard, a: Act, b: Before | null, changes: readonly CoinChange[]): void {
  if (!b) {
    if (FORGETS.has(a.do)) y.history = [];
    return;
  }
  const stroke = strokeOf(y, a);
  // A stroke over the cap goes on as one that cannot be undone: no part of it is undone.
  if (stroke && stroke.flags & TOO_BIG) return;
  const coins = changes.reduce((n, c) => n + (c.reason === REASON.till ? 0 : c.amount), 0);
  const u = undoing(y, b, stroke, coins, a.do === "paint");
  if (u.tiles.length === 0 && u.coins === 0) return;
  const bytes = written(y, u);
  const kept = stroke ? y.history.slice(0, -1) : y.history;
  y.entries = Math.max(y.entries, u.id);
  y.history = bytes.length > UNDO_BYTES ? [overCap(u.id, u.flags)] : capped([...kept, entry(bytes)]);
}

// ---------- reading ----------

/** Tiles in order after their count, as each tile since the last less one; null for any past `tiles`. */
function readTiles(r: Reader, tiles: number): number[] | null {
  const n = r.varint();
  const out: number[] = [];
  for (let k = 0, i = -1; k < Math.min(n, tiles) && !r.over; k++) {
    i += r.varint() + 1;
    out.push(i);
  }
  return n > tiles || out.some((i) => i >= tiles) ? null : out;
}

/** What stood on an entry's tiles, read back: only pieces a yard may have. */
function wasOf(bytes: Uint8Array, tiles: number): KeptPiece[] | null {
  const was = unpackCells(bytes, tiles);
  return was && was.every((p) => isKind(p.kind) && p.kind !== DEPOT) ? was : null;
}

/** Settings changed, one for each piece that stood on an entry's tiles, after their count; null past `most`. */
function readMasks(r: Reader, most: number): number[] | null {
  const n = r.varint();
  const out: number[] = [];
  for (let k = 0; k < Math.min(n, most) && !r.over; k++) out.push(r.varint());
  return n > most || out.some((m) => m > ALL_SET) ? null : out;
}

/** The rest of an entry's bytes, after its Coins and check: its tiles, the way back, the settings changed and what stood there. */
function readBody(r: Reader, flags: number, tiles: number): Pick<Undoing, "tiles" | "was" | "masks" | "back"> | null {
  const fresh = readTiles(r, tiles);
  const back = flags & MOVED ? { turns: r.byte(), x: r.byte(), y: r.byte() } : null;
  const masks = readMasks(r, tiles);
  const was = fresh && masks && !r.over && (back?.turns ?? 0) <= 3 ? wasOf(r.rest(), tiles) : null;
  if (!fresh || !masks || !was || masks.length !== was.length) return null;
  const all = [...new Set([...fresh, ...was.map((p) => p.tile)])].toSorted((i, j) => i - j);
  return all.length === fresh.length + was.length ? { tiles: all, was, masks, back } : null;
}

/** An entry read back from its bytes, for a yard of so many tiles; null for bytes that are not an entry. */
function readEntry(bytes: Uint8Array, tiles: number): Undoing | null {
  const r = new Reader(bytes);
  const id = r.varint();
  const flags = r.byte();
  if (flags & TOO_BIG) {
    const big = r.done && !r.over && (flags & ~(TOO_BIG | STROKE)) === 0;
    return big ? { id, flags, coins: 0, sum: 0, tiles: [], was: [], masks: [], back: null } : null;
  }
  if ((flags & ~(MOVED | STROKE)) !== 0) return null;
  const zig = r.varint();
  const sum = (r.byte() | (r.byte() << 8) | (r.byte() << 16) | (r.byte() << 24)) >>> 0;
  const body = readBody(r, flags, tiles);
  return body && { id, flags, coins: zig % 2 === 1 ? -(zig + 1) / 2 : zig / 2, sum, ...body };
}

/**
 * A yard's history read back from what it kept, for a yard of so many tiles: each entry, the oldest
 * first, numbered in the order they were kept; or none at all if any is not one.
 */
export function historyOf(kept: readonly Uint8Array[], tiles: number): Entry[] {
  const read = kept.map((b) => readEntry(b, tiles));
  const inOrder = read.every((u, k) => u !== null && u.id > 0 && u.id > (read[k - 1]?.id ?? 0));
  return inOrder ? capped(kept.map(entry)) : [];
}

// ---------- undoing ----------

/** Why the newest entry, said to be `id`, cannot be undone with `coins` to spend; null if it can. */
export function undoRefusal(y: Yard, id: number, coins: number): string | null {
  const top = y.history.at(-1);
  if (!top) return UNDO_SAYS.nothing;
  if (top.id !== id) return UNDO_SAYS.notLast;
  const u = readEntry(top.bytes, y.kind.length);
  if (!u || u.flags & TOO_BIG) return UNDO_SAYS.tooBig;
  if (sumOf(y, u.tiles) !== u.sum) return UNDO_SAYS.changed;
  // What the command gave back is taken: the Coins it moved to the player, past what there is to spend.
  const short = u.coins - coins;
  return short > 0 ? `Not enough Coins: ${short} short` : null;
}

/** Counts the pieces to hand as the piece on a tile goes, and a kept one (`comes`) takes its place: as setting down and taking away count them. */
function handBack(y: Yard, i: number, comes: KeptPiece | null): void {
  const k = y.kind[i] ?? NONE;
  if (y.free[i] === 1) y.spare[k] = (y.spare[k] ?? 0) + 1;
  if (comes?.free === true) y.spare[comes.kind] = (y.spare[comes.kind] ?? 0) - 1;
}

/**
 * Gives the piece on a tile the settings of a kept piece that `mask` names (a bit each, by its place in
 * `PARTS_SET`), the pieces to hand counted as it comes and goes.
 */
function setBack(y: Yard, i: number, p: KeptPiece, mask: number): void {
  handBack(y, i, p);
  const want = setOf(p);
  PARTS_SET.forEach((part, n) => {
    if (mask & (1 << n)) y[part][i] = want[n] ?? 0;
  });
}

/**
 * Stands a piece taken away again on its bare tile: as it stood, with what it held when it went, and
 * what it was doing as far as the yard lets it be now, as reading a yard back does (`keptOnto`).
 */
function standBack(y: Yard, i: number, p: KeptPiece): void {
  if (!isKind(p.kind)) return;
  place(y, i, p.kind, p.dir, p.grade ?? 1);
  setBack(y, i, p, ALL_SET);
  if ((p.span ?? 0) > 0) tunnelRow(y, i);
  keptOnto(y, i, p, y.line[0]);
}

/**
 * Puts back what stood on an entry's tiles: each piece that still stands given back the settings the
 * command changed, the rest taken away, and what was taken away stood again.
 */
function putBack(y: Yard, u: Undoing): void {
  const was = new Map(u.was.map((p, k) => [p.tile, { p, mask: u.masks[k] ?? 0 }]));
  const stays = (i: number): boolean => {
    const p = was.get(i)?.p;
    const k = y.kind[i] ?? NONE;
    return p !== undefined && (k === p.kind || replaces(k, p.kind));
  };
  const gone = u.tiles.filter((i) => !stays(i));
  for (const i of gone) {
    handBack(y, i, null);
    vacate(y, i);
  }
  for (const { p, mask } of was.values()) if (stays(p.tile)) setBack(y, p.tile, p, mask);
  for (const i of gone) {
    const p = was.get(i)?.p;
    if (p) standBack(y, i, p);
  }
}

/**
 * Undoes the newest entry, said to be `id`, with `coins` to spend: all of it or, refused, none.
 * Says the Coins it moves to the player: what the command cost, or less than nothing for what it gave.
 */
export function undo(y: Yard, id: number, coins: number): { ok: true; coins: number } | { ok: false; why: string } {
  const why = undoRefusal(y, id, coins);
  const u = why === null ? readEntry(y.history.at(-1)?.bytes ?? new Uint8Array(), y.kind.length) : null;
  if (!u) return { ok: false, why: why ?? UNDO_SAYS.changed };
  if (u.back) {
    // The pieces moved, from where they stand now, as one: the move's own refusal leaves all as it was.
    const no = move(
      y,
      u.tiles.filter((i) => y.kind[i] !== NONE),
      u.back.turns,
      u.back.x,
      u.back.y,
    );
    if (no !== null) return { ok: false, why: UNDO_SAYS.changed };
    // Moving forgets the side a thing came in from; still on its tile, it came in from where it did.
    for (const p of u.was)
      if (y.item[p.tile] === (p.item ?? NONE) && y.prog[p.tile] === (p.prog ?? 0)) y.via[p.tile] = p.via ?? 0;
  } else putBack(y, u);
  y.history.pop();
  changed(y);
  y.powered = false;
  return { ok: true, coins: -u.coins };
}
