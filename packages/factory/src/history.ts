/**
 * Undo, done by the rules: the yard keeps, with it, what it takes to undo each of the last things
 * done to it (`Yard.history`, the newest last), so the page and Leaf undo the same thing as one
 * command (`{ do: "undo", entry }`), all of it or none, and an Undo is still there after a reload or
 * on another device.
 *
 * An entry is named by the command that made it: its id, the page's, unique among the player's
 * commands to the Works, which Leaf answers it by. Page and Leaf both hand it to the rules (`play`),
 * so a command Leaf turned down has no entry there, and an Undo naming it is refused. A stroke of the
 * brush is many commands and one entry, named by its first: each after it says that name (`onto`).
 *
 * Each command with an Undo (`REACH`) keeps one entry: the tiles it changed; what stood on them before,
 * as the player set it and nothing the yard was doing (`Setting`: the settings `stand`, copies and
 * blueprints keep, `keptAt`, with whether it was one of the pieces to hand); which of those settings
 * it changed on each piece that still stands; and the Coins it moved, but for the till paid in.
 *
 * The history holds by construction. Undo takes the newest entry first; ticks change no setting, only
 * what pieces hold, carry and are doing; and every other command that changes a piece or the Coins
 * (`FORGETS`) forgets the whole history. A check of what the command left on its tiles (`sum`) still
 * refuses an entry that no longer matches the yard, which should never happen.
 *
 * Undo puts back what the player set, never what the yard was doing:
 * - a piece the command changed where it stands (turned, raised, coloured, its ways or side set) has
 *   back the settings the command changed, and only those, each as the command's own setter sets it,
 *   so that what it holds, carries and is doing (a splitter's next way, beside its ways in) is its own;
 * - a piece the command set down, or set in the place of another, is taken away, as the spade takes it;
 * - a piece the command took away, or set another in the place of, is stood again as new: its
 *   settings, holding nothing, doing nothing; one of the pieces to hand as one. Putting back is not
 *   building: nothing asks whether it may be built now, and its Coins are the recorded opposite;
 * - pieces moved are moved back as one, with what they hold now.
 * The Coins go the other way: what the command cost is given back, and what it gave back is taken.
 * All or none: everything that can refuse (the entry's name, its check, the Coins; a move's own
 * refusal) is asked before anything changes, and nothing after that can refuse.
 *
 * An entry's bytes: its id (a count, then a byte each), what it is (a byte: 1 a move, 2 a stroke of
 * the brush, 4 too much to keep), the Coins it moved (a varint, zigzag), the check of its tiles after
 * it (four bytes), the tiles it changed that held nothing before (a count, then each as the tiles
 * since the last less one), for a move the turns and corner that move the pieces back (a byte each),
 * which settings the command changed on each piece that stood there (a count, then a varint each,
 * `SETTINGS`), and last what stood there (`packSettings`).
 *
 * The history never outlives the rules or the land it was made under: it is kept stamped with both
 * (`stampOf`: the rules' version, as the page and Leaf compare it, and the land's own bytes), and a
 * yard read under another stamp has none, alike on the page and on Leaf. What an entry would put back,
 * and what it would cost, were the rules' and the land's when it was made.
 *
 * At most `UNDO_MOST` entries and `UNDO_BYTES` bytes in all, the oldest let go first. A command
 * whose own entry is over that is still done, and kept, under its id, as one that cannot be undone;
 * a stroke over it goes on as one, so that no part of it is undone.
 */
import type { CoinChange } from "@sequoia-leaf/core";
import { rulesVersions } from "@sequoia-leaf/core/build/rules.ts" with { type: "macro" };

import { at, type Dir, insTo, isDir, otherMouth, tunnelExit } from "./build.ts";
import { fromBase64, Reader, Writer } from "./bytes.ts";
import type { Act, ActOf } from "./commands.ts";
import type { Land } from "./land.ts";
import { lineOf } from "./lines.ts";
import {
  blueprintAt,
  boxOf,
  copyOf,
  type Kept,
  keptAt,
  keptOf,
  move,
  packWays,
  piecesAt,
  tilesOf,
  unpackWays,
} from "./pieces.ts";
import { REASON } from "./reasons.ts";
import { legPiece } from "./route.ts";
import { CRATE, DEPOT, gradeOf, isKind, type Kind, NONE, TUNNEL } from "./tables.ts";
import { changed, type Entry, holderOf, place, tunnelRow, vacate, type Yard } from "./yard.ts";

/** The version of the Works' rules this was built with: the one the page and Leaf compare. */
const RULES = rulesVersions().works;

/** Each land's stamp, worked out once. */
const STAMPS = new WeakMap<Land, string>();

/**
 * What a yard's history is made under: the rules' version and 32 bits of the land (its size, its
 * ground, water, redwoods and plots, and the depot). A yard read under another has no history.
 */
export function stampOf(land: Land): string {
  const known = STAMPS.get(land);
  if (known !== undefined) return known;
  let h = 0x811c9dc5 | 0;
  const mix = (v: number): void => {
    h = Math.imul(h ^ v, 0x01000193);
  };
  for (const v of [land.w, land.h, ...land.depot]) mix(v);
  for (const a of [land.deposit, land.water, land.trunk, land.plot]) for (let i = 0; i < a.length; i++) mix(a[i] ?? 0);
  for (const p of land.plots) for (const v of [p.plot, p.price, p.x, p.y, p.w, p.h]) mix(v);
  const stamp = `${RULES}.${(h >>> 0).toString(36)}`;
  STAMPS.set(land, stamp);
  return stamp;
}

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

/** A command's id, as Leaf takes one: up to 64 letters, digits and `_ . : -`; none for a test's. */
export const isId = (v: unknown): v is string => typeof v === "string" && /^[\w.:-]{0,64}$/.test(v);

type Name = Act["do"];

/** How a piece stood on a tile: as the player set it (`keptAt`), and whether it was one of the pieces to hand. */
interface Setting {
  readonly tile: number;
  readonly kind: Kind;
  readonly dir: Dir;
  /** For a tunnel's mouth, the tiles it passes under: positive at its way in, negative at its way out. */
  readonly span: number;
  readonly free: boolean;
  readonly kept: Kept;
}

/** An entry read back from its bytes. */
interface Undoing {
  readonly id: string;
  readonly flags: number;
  /** The Coins the command moved to the player: below nothing for what it cost. */
  readonly coins: number;
  readonly sum: number;
  /** Every tile it changed, in order. */
  readonly tiles: readonly number[];
  /** How the pieces stood on those of them that held one before, and the settings the command changed on each (`SETTINGS`, a bit each). */
  readonly was: readonly Setting[];
  readonly masks: readonly number[];
  /** For a move, the turns and the corner that move the pieces back. */
  readonly back: { readonly turns: number; readonly x: number; readonly y: number } | null;
}

/** A command about to be done: every tile it may change, in order, and how the pieces stood on them. */
export interface Before {
  readonly tiles: readonly number[];
  readonly was: ReadonlyMap<number, Setting>;
  /** For a move, the turns and the corner that move the pieces back. */
  readonly back: Undoing["back"];
}

// ---------- settings ----------

/** How the piece on a tile stands, as the player set it; null for none, or the depot. */
function settingAt(y: Yard, i: number): Setting | null {
  const k = y.kind[i] ?? NONE;
  const d = y.dir[i] ?? 0;
  if (!isKind(k) || k === DEPOT || !isDir(d)) return null;
  return { tile: i, kind: k, dir: d, span: y.span[i] ?? 0, free: y.free[i] === 1, kept: keptAt(y, i) };
}

/**
 * The settings a command may change on a piece where it stands, each as the yard holds it on a tile
 * (`at`), as a kept piece has it (`of`), and set back as the command that changes it sets it (`to`):
 * a splitter's ways in by `insTo`, as turning a way in or out does, so that its next way is its own.
 */
const SETTINGS: readonly {
  readonly at: (y: Yard, i: number) => number;
  readonly of: (s: Setting) => number;
  readonly to: (y: Yard, i: number, v: number) => void;
}[] = [
  { at: (y, i) => y.dir[i] ?? 0, of: (s) => s.dir, to: (y, i, v) => (y.dir[i] = v) },
  { at: (y, i) => y.grade[i] ?? 0, of: (s) => s.kept.grade ?? gradeOf(s.kind), to: (y, i, v) => (y.grade[i] = v) },
  { at: (y, i) => y.tint[i] ?? 0, of: (s) => s.kept.tint ?? 0, to: (y, i, v) => (y.tint[i] = v) },
  { at: (y, i) => y.set[i] ?? NONE, of: (s) => s.kept.recipe ?? NONE, to: (y, i, v) => (y.set[i] = v) },
  { at: (y, i) => y.shut[i] ?? 0, of: (s) => s.kept.shut ?? 0, to: (y, i, v) => (y.shut[i] = v) },
  { at: (y, i) => y.first[i] ?? 0, of: (s) => (s.kept.first ?? -1) + 1, to: (y, i, v) => (y.first[i] = v) },
  { at: (y, i) => y.ins[i] ?? 0, of: (s) => s.kept.ins ?? 0, to: insTo },
  {
    at: (y, i) => (y.kind[i] === CRATE ? (y.holders.open[holderOf(y, i)] ?? 1) : 1),
    of: (s) => (s.kept.open === false ? 0 : 1),
    to: (y, i, v) => {
      if (y.kind[i] === CRATE) y.holders.open[holderOf(y, i)] = v;
    },
  },
];

/** The settings of the piece on a tile that differ from how one stood (`s`), a bit each by its place in `SETTINGS`. */
const changedOf = (y: Yard, s: Setting): number =>
  SETTINGS.reduce((m, part, n) => (part.at(y, s.tile) === part.of(s) ? m : m | (1 << n)), 0);

/** Whether the piece on a tile stands as one stood (or, with none, the tile is bare as it was). */
function standsAs(y: Yard, i: number, s: Setting | undefined): boolean {
  const now = settingAt(y, i);
  if (!now || !s) return now === null && s === undefined;
  return now.kind === s.kind && now.span === s.span && now.free === s.free && changedOf(y, s) === 0;
}

/** Writes how pieces stood (in tile order): each as the tiles since the last less one, then its kind, way and the settings it has. */
function packSettings(o: Writer, was: readonly Setting[]): void {
  o.varint(was.length);
  let last = -1;
  for (const s of was) {
    o.varint(s.tile - last - 1);
    last = s.tile;
    const k = s.kept;
    const ways = packWays(k.shut ?? 0, (k.first ?? -1) + 1, k.ins ?? 0);
    const parts: readonly [number, number | undefined][] = [
      [1, k.recipe],
      [2, k.open === false ? 0 : undefined],
      [4, k.tint],
      [8, ways === 0 ? undefined : ways],
      [16, k.grade],
      [32, s.span === 0 ? undefined : s.span + 8],
    ];
    const f = parts.reduce((m, [bit, v]) => (v === undefined ? m : m | bit), 0);
    o.byte(s.kind | (s.dir << 4) | (s.free ? 64 : 0) | (f === 0 ? 0 : 128));
    if (f !== 0) o.byte(f);
    for (const [, v] of parts) if (v !== undefined) o.byte(v);
  }
}

/** One piece's settings read back, after its tile; null for bytes that are not a piece's. */
function readSetting(r: Reader, tile: number): Setting | null {
  const kd = r.byte();
  const [kind, dir] = [kd & 15, (kd >> 4) & 3];
  const f = kd & 128 ? r.byte() : 0;
  const [recipe, closed, tint, ways, grade, span] = [1, 2, 4, 8, 16, 32].map((bit) => (f & bit ? r.byte() : undefined));
  if (r.over || f > 63 || !isKind(kind) || kind === DEPOT || !isDir(dir)) return null;
  const kept = keptOf(
    { ...unpackWays(ways ?? 0), recipe, tint, grade, open: closed === undefined ? undefined : false },
    kind,
  );
  return { tile, kind, dir, span: span === undefined ? 0 : span - 8, free: (kd & 64) !== 0, kept };
}

/** How pieces stood, read back, for a yard of so many tiles; null for bytes that are not pieces'. */
function readSettings(r: Reader, tiles: number): Setting[] | null {
  const n = r.varint();
  const out: Setting[] = [];
  for (let k = 0, tile = -1; k < Math.min(n, tiles) && !r.over; k++) {
    tile += r.varint() + 1;
    const s = tile < tiles ? readSetting(r, tile) : null;
    if (!s) return null;
    out.push(s);
  }
  return n > tiles || r.over || !r.done ? null : out;
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
  const was = new Map(tiles.flatMap((i) => [settingAt(y, i) ?? []].flat().map((s) => [i, s] as const)));
  if (a.do !== "move") return { tiles, was, back: null };
  const box = boxOf(piecesAt(y, a.tiles));
  return { tiles, was, back: { turns: (4 - a.turns) & 3, x: box.x, y: box.y } };
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

/** Writes a command's id: its length, then a byte each. */
function writeId(o: Writer, id: string): void {
  o.varint(id.length);
  for (let c = 0; c < id.length; c++) o.byte(id.charCodeAt(c));
}
/** Reads a command's id; null for bytes that are not one. */
function readId(r: Reader): string | null {
  const n = r.varint();
  if (n > 64) return null;
  const id = String.fromCharCode(...Array.from({ length: n }, () => r.byte()));
  return !r.over && isId(id) ? id : null;
}

/** An entry, its id read from its first bytes. */
const entry = (bytes: Uint8Array): Entry => ({ id: readId(new Reader(bytes)) ?? "", bytes });
/** An entry that cannot be undone, under its id: a command's own entry over the cap, or a stroke's. */
function overCap(id: string, flags: number): Entry {
  const o = new Writer();
  writeId(o, id);
  o.byte(TOO_BIG | (flags & STROKE));
  return entry(o.bytes());
}

/** An entry's bytes, of the yard after its command (`y`); `was` is how the pieces on its tiles stood before. */
function written(y: Yard, u: Omit<Undoing, "sum" | "masks">): Uint8Array {
  const o = new Writer();
  writeId(o, u.id);
  o.byte(u.flags);
  o.varint(u.coins < 0 ? -u.coins * 2 - 1 : u.coins * 2);
  const sum = sumOf(y, u.tiles);
  for (let k = 0; k < 4; k++) o.byte((sum >>> (8 * k)) & 255);
  const had = new Set(u.was.map((s) => s.tile));
  const fresh = u.tiles.filter((i) => !had.has(i));
  o.varint(fresh.length);
  fresh.forEach((i, k) => o.varint(i - (fresh[k - 1] ?? -1) - 1));
  if (u.back) for (const v of [u.back.turns, u.back.x, u.back.y]) o.byte(v);
  o.varint(u.was.length);
  for (const s of u.was) o.varint(changedOf(y, s));
  packSettings(o, u.was);
  return o.bytes();
}

/** The entries kept within `UNDO_MOST` and `UNDO_BYTES`, the oldest let go first. */
function capped(history: readonly Entry[]): Entry[] {
  const out = history.slice(-UNDO_MOST);
  let bytes = out.reduce((n, e) => n + e.bytes.length, 0);
  while (bytes > UNDO_BYTES) bytes -= out.shift()?.bytes.length ?? bytes;
  return out;
}

/** The stroke of the brush a command adds to: the newest entry, if it is a stroke's and the command names it (`onto`). */
function strokeOf(y: Yard, a: Act): Undoing | null {
  const top = y.history.at(-1);
  if (a.do !== "paint" || a.onto === undefined || top?.id !== a.onto) return null;
  const u = readEntry(top.bytes, y.kind.length);
  return u && (u.flags & STROKE) !== 0 ? u : null;
}

/** What a command done (`b` taken before it, `id` its id) changed, with the stroke it adds to: its entry, but for the check. */
function undoing(
  y: Yard,
  b: Before,
  id: string,
  stroke: Undoing | null,
  coins: number,
  paint: boolean,
): Omit<Undoing, "sum" | "masks"> {
  const done = b.back ? b.tiles : b.tiles.filter((i) => !standsAs(y, i, b.was.get(i)));
  // How the stroke's lines stood before it, over how this command found them.
  const was = new Map([...done.flatMap((i) => b.was.get(i) ?? []), ...(stroke?.was ?? [])].map((s) => [s.tile, s]));
  return {
    id: stroke?.id ?? id,
    flags: (b.back ? MOVED : 0) | (paint ? STROKE : 0),
    coins: (stroke?.coins ?? 0) + coins,
    tiles: [...new Set([...done, ...(stroke?.tiles ?? [])])].toSorted((i, j) => i - j),
    was: [...was.values()].toSorted((p, q) => p.tile - q.tile),
    back: b.back,
  };
}

/**
 * Keeps an entry for a command done (`a`, its id `id`, `b` taken before it), which made `changes` to
 * the Coins: the till paid in with them is not undone. A command with no Undo that changes a piece or
 * the Coins forgets them all. A stroke of the brush that names the newest entry (`onto`) adds to it.
 */
export function after(y: Yard, a: Act, b: Before | null, changes: readonly CoinChange[], id: string): void {
  if (!b) {
    if (FORGETS.has(a.do)) y.history = [];
    return;
  }
  const stroke = strokeOf(y, a);
  // A stroke over the cap goes on as one that cannot be undone: no part of it is undone.
  if (stroke && stroke.flags & TOO_BIG) return;
  const coins = changes.reduce((n, c) => n + (c.reason === REASON.till ? 0 : c.amount), 0);
  const u = undoing(y, b, id, stroke, coins, a.do === "paint");
  if (u.tiles.length === 0 && u.coins === 0) return;
  const bytes = written(y, u);
  const kept = stroke ? y.history.slice(0, -1) : y.history;
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

/** Settings changed, one for each piece that stood on an entry's tiles, after their count; null past `most`. */
function readMasks(r: Reader, most: number): number[] | null {
  const n = r.varint();
  const out: number[] = [];
  for (let k = 0; k < Math.min(n, most) && !r.over; k++) out.push(r.varint());
  return n > most || out.some((m) => m >= 1 << SETTINGS.length) ? null : out;
}

/** The rest of an entry's bytes, after its Coins and check: its tiles, the way back, the settings changed and how the pieces stood. */
function readBody(r: Reader, flags: number, tiles: number): Pick<Undoing, "tiles" | "was" | "masks" | "back"> | null {
  const fresh = readTiles(r, tiles);
  const back = flags & MOVED ? { turns: r.byte(), x: r.byte(), y: r.byte() } : null;
  const masks = readMasks(r, tiles);
  const was = fresh && masks && !r.over && (back?.turns ?? 0) <= 3 ? readSettings(r, tiles) : null;
  if (!fresh || !masks || !was || masks.length !== was.length) return null;
  const all = [...new Set([...fresh, ...was.map((s) => s.tile)])].toSorted((i, j) => i - j);
  return all.length === fresh.length + was.length ? { tiles: all, was, masks, back } : null;
}

/** An entry read back from its bytes, for a yard of so many tiles; null for bytes that are not an entry. */
function readEntry(bytes: Uint8Array, tiles: number): Undoing | null {
  const r = new Reader(bytes);
  const id = readId(r);
  const flags = r.byte();
  if (id === null) return null;
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
 * A yard's history read back from what it kept (each entry as base64, the oldest first) and the
 * stamp it was kept under, on its land: each entry; or none at all for any that is not one, or for a
 * history kept under other rules or another land (`stampOf`), or none kept.
 */
export function historyOf(kept: unknown, stamp: unknown, land: Land): Entry[] {
  if (!Array.isArray(kept) || stamp !== stampOf(land)) return [];
  const tiles = land.w * land.h;
  const read = kept.flatMap((b) => {
    const bytes = typeof b === "string" ? fromBase64(b) : null;
    return bytes && readEntry(bytes, tiles) ? [entry(bytes)] : [];
  });
  return read.length === kept.length ? capped(read) : [];
}

// ---------- undoing ----------

/** Why the newest entry, named `id`, cannot be undone with `coins` to spend; null if it can. */
export function undoRefusal(y: Yard, id: string, coins: number): string | null {
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

/** Takes away the piece on a tile, as the spade takes it: what it held goes, and one of the pieces to hand goes back to hand. */
function takeAway(y: Yard, i: number): void {
  const k = y.kind[i] ?? NONE;
  if (y.free[i] === 1) y.spare[k] = (y.spare[k] ?? 0) + 1;
  vacate(y, i);
}

/**
 * Stands a piece taken away again on its bare tile, as new: its settings as the player set them,
 * holding nothing, doing nothing; one of the pieces to hand only if it was one. Putting back is not
 * building: what the yard had is put back without asking whether it may be built now (an unlock, a
 * price), so nothing here can refuse. Each of a tunnel's mouths is stood with its own settings, and
 * its way-in mouth has its row.
 */
function standBack(y: Yard, s: Setting): void {
  place(y, s.tile, s.kind, s.dir, s.kept.grade ?? 1);
  for (const part of SETTINGS) part.to(y, s.tile, part.of(s));
  y.span[s.tile] = s.span;
  if (s.span > 0) tunnelRow(y, s.tile);
  if (s.free) {
    y.free[s.tile] = 1;
    y.spare[s.kind] = Math.max(0, (y.spare[s.kind] ?? 0) - 1);
  }
}

/**
 * Puts back how the pieces on an entry's tiles stood: each that still stands has back the settings
 * the command changed; the rest are taken away, and what was taken away is stood again as new. Every
 * tile a piece is stood on is one of the entry's, bare once what stands there is taken away, and no
 * step can refuse: it is done whole once begun.
 */
function putBack(y: Yard, u: Undoing): void {
  const was = new Map(u.was.map((s, k) => [s.tile, { s, mask: u.masks[k] ?? 0 }]));
  const stays = new Set(u.tiles.filter((i) => was.get(i)?.s.kind === y.kind[i]));
  for (const i of u.tiles) if (!stays.has(i) && y.kind[i] !== NONE) takeAway(y, i);
  for (const { s, mask } of was.values()) {
    if (stays.has(s.tile)) SETTINGS.forEach((part, n) => mask & (1 << n) && part.to(y, s.tile, part.of(s)));
    else standBack(y, s);
  }
}

/**
 * Undoes the newest entry, named `id`, with `coins` to spend: all of it or, refused, none. Says the
 * Coins it moves to the player: what the command cost, or less than nothing for what it gave.
 */
export function undo(y: Yard, id: string, coins: number): { ok: true; coins: number } | { ok: false; why: string } {
  const why = undoRefusal(y, id, coins);
  const u = why === null ? readEntry(y.history.at(-1)?.bytes ?? new Uint8Array(), y.kind.length) : null;
  if (!u) return { ok: false, why: why ?? UNDO_SAYS.changed };
  if (u.back) {
    // The pieces moved, from where they stand now, as one: the move's own refusal leaves all as it was.
    const now = u.tiles.filter((i) => y.kind[i] !== NONE);
    if (move(y, now, u.back.turns, u.back.x, u.back.y) !== null) return { ok: false, why: UNDO_SAYS.changed };
  } else putBack(y, u);
  y.history.pop();
  changed(y);
  y.powered = false;
  return { ok: true, coins: -u.coins };
}
