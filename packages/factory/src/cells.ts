/**
 * Pieces as bytes: the yard's own (`codec.ts`, its `cells`), and what an Undo puts back
 * (`history.ts`), in one format. A piece is read off its tile as a kept piece first (`keptPiece`),
 * and kept pieces are what is written (`packKept`) and read back (`unpackCells`). Reading a yard back
 * puts a kept piece back onto the piece stood where it was as the rules let it be now (`keptOnto`).
 *
 * The pieces' bytes are how many pieces there are (varint), then each piece in tile order: the tiles
 * since the last piece less one (varint); a byte of its kind (low four bits), its way (two bits),
 * whether it carries something (64) and whether more parts follow (128); if it carries, the thing
 * (byte) and its progress in eighths with the side it came in from (a byte, four bits each); if more
 * follow, which (varint, a bit each), then those:
 *   2 what it holds: how many kinds (varint), then a thing (byte) and how many (varint) each
 *   4 out (byte)   8 work (varint)   16 making (byte)   32 turn (byte)   64 what it is set to (byte)
 *   128 span (a byte, `spanByte`), and for a way-in mouth a thing (byte) and its progress (byte) for each tile under
 *   256 a shut crate   512 fuel (byte)   1024 one of the pieces to hand   2048 tint (byte)
 *   4096 a splitter's ways (byte: its shut ways, the way it puts first and its ways in, `packWays`), or a
 *        sorter's right side (the same byte, as the way it puts first)   8192 a grade above 1 (byte)
 *   16384 a kind past 15: its bits above the first byte's four (byte)   32768 a by-product held (byte)
 *   65536 more of its finished thing waiting behind the first (byte, `Holders.more`)
 *
 * A piece of more than one tile is kept once, on its own tile (`sizes.ts`), and stands over the rest
 * of its tiles again as it is read back. A yard with no kind past 15 and no by-product has exactly the
 * bytes it had before either could be kept; one with either is a newer Leaf's to a reader that knows
 * neither, as bytes with a part it does not know.
 *
 * A part this version does not know, a bit of the parts no reader here knows, is a newer Leaf's
 * (`NEWER`): the yard is not read, and is left as it is for the Leaf that reads it (`keptLater`); so
 * is a kind past 255. Bytes that are not pieces are refused whole: bytes cut short or left over, more
 * pieces than the land has tiles, and counts no yard could have (more than 255 kinds of thing held,
 * more than a million of one). What today's tables allow is no part of the shape: a thing they do not
 * have is let go, more of one than a piece holds is clamped as it is put back, and a tunnel longer
 * than tunnels go is a piece that cannot stand.
 */
import { NEWER, type Newer, Reader, spanByte, spanOfByte, Writer } from "./bytes.ts";
import { RULES } from "./kinds/list.ts";
import { waysOn } from "./pieces.ts";
import { OWN } from "./sizes.ts";
import { ALL_ITEMS, CARRIES, FIXED, type Goal, isItem, keptKind, NONE, SHUTS, SPAN_MOST, TINTS } from "./tables.ts";
import { KIT } from "./wire.ts";
import { held, holderOf, type Holders, tunnelOf, type Yard } from "./yard.ts";

/** The parts a piece's bytes may say follow, a bit each: any other is a newer Leaf's. */
export const PARTS = 0x3fffe;
/** The parts kept since a kind could pass 15 and a piece hold a by-product, after all the others. */
const HIGH = 0x4000;
const ALSO = 0x8000;
/** The part kept since a machine could hold more than one finished thing (an assembler). */
const MORE = 0x10000;
/** A piece that breaks one thing into several: its place in its mix (`kinds/mix.ts`), kept since tier 5. */
const MIX = 0x20000;
/** The most kinds of thing, and of one thing, a piece's bytes may say it holds: past these the bytes are no yard's. */
const KINDS_MOST = 255;
const MANY_MOST = 1_000_000;

/** A piece as kept, in the yard's own units, before it is vouched for. */
export interface KeptPiece {
  readonly tile: number;
  readonly kind: number;
  readonly dir: number;
  readonly item?: number;
  readonly prog?: number;
  readonly via?: number;
  readonly held?: readonly (readonly [number, number])[];
  readonly out?: number;
  readonly also?: number;
  readonly more?: number;
  readonly mix?: number;
  readonly work?: number;
  readonly making?: number;
  readonly turn?: number;
  readonly recipe?: number;
  readonly span?: number;
  readonly under?: readonly number[];
  readonly along?: readonly number[];
  readonly closed?: boolean;
  readonly fuel?: number;
  readonly free?: boolean;
  readonly tint?: number;
  readonly ways?: number;
  readonly grade?: number;
}
type Building = { -readonly [K in keyof KeptPiece]: KeptPiece[K] };

/** The parts of one number each, by their bit, in the order the bytes have them: those before the span, and after it. */
const EARLY = [
  [4, "out"],
  [8, "work"],
  [16, "making"],
  [32, "turn"],
  [64, "recipe"],
] as const;
const LATE = [
  [512, "fuel"],
  [2048, "tint"],
  [4096, "ways"],
  [8192, "grade"],
] as const;

// ---------- off the yard ----------

/** What a holder's row holds and is doing, as kept: only what there is. */
function heldBy(h: Holders, r: number): Partial<Building> {
  const kinds = ALL_ITEMS.filter((n) => held(h, r, n) > 0);
  const [out, work, making, fuel] = [h.out[r] ?? NONE, h.work[r] ?? 0, h.making[r] ?? NONE, h.fuel[r] ?? 0];
  const also = h.also[r] ?? NONE;
  const more = h.more[r] ?? 0;
  const mix = h.mix[r] ?? 0;
  return {
    ...(kinds.length > 0 ? { held: kinds.map((n): [number, number] => [n, held(h, r, n)]) } : {}),
    ...(out === NONE ? {} : { out }),
    ...(also === NONE ? {} : { also }),
    ...(more === 0 ? {} : { more }),
    ...(mix === 0 ? {} : { mix }),
    ...(work === 0 ? {} : { work }),
    ...(making === NONE ? {} : { making }),
    ...(fuel === 0 ? {} : { fuel }),
  };
}

/** How the piece on a tile is set, as kept: only what is not as a new piece has it. */
function settingsAt(y: Yard, i: number): Partial<Building> {
  const [turn, recipe, tint, ways, grade] = [
    y.turn[i] ?? 0,
    y.set[i] ?? NONE,
    y.tint[i] ?? 0,
    waysOn(y, i),
    y.grade[i] ?? 0,
  ];
  return {
    ...(turn === 0 ? {} : { turn }),
    ...(recipe === NONE ? {} : { recipe }),
    ...(SHUTS[y.kind[i] ?? NONE] === 1 && y.holders.open[holderOf(y, i)] === 0 ? { closed: true } : {}),
    ...(y.free[i] === 1 ? { free: true } : {}),
    ...(tint === 0 ? {} : { tint }),
    ...(ways === 0 ? {} : { ways }),
    ...(grade > 1 ? { grade } : {}),
  };
}

/** A tunnel mouth's span, as kept, and for its way-in mouth what is under the ground. */
function spanAt(y: Yard, i: number): Partial<Building> {
  const span = y.span[i] ?? 0;
  if (span === 0) return {};
  const at = tunnelOf(y, i) * SPAN_MOST;
  const under = Array.from({ length: Math.max(0, span) }, (_, s) => y.tunnels.under[at + s] ?? NONE);
  return { span, under, along: under.map((_, s) => y.tunnels.along[at + s] ?? 0) };
}

/** The piece on a tile, as kept. */
export function keptPiece(y: Yard, i: number): KeptPiece {
  const r = holderOf(y, i);
  const item = y.item[i] ?? NONE;
  return {
    tile: i,
    kind: y.kind[i] ?? NONE,
    dir: y.dir[i] ?? 0,
    ...(item === NONE ? {} : { item, prog: y.prog[i] ?? 0, via: y.via[i] ?? 0 }),
    ...(r >= 0 ? heldBy(y.holders, r) : {}),
    ...settingsAt(y, i),
    ...spanAt(y, i),
  };
}

/** The yard's pieces as bytes, in tile order: a piece of more than one tile on its own tile alone. */
export const packCells = (y: Yard): Uint8Array => packKept(keptPieces(y));

/** Every piece of the yard as kept, in tile order, each once, by its own tile: all but the depot. */
export function keptPieces(y: Yard): KeptPiece[] {
  const own = (i: number): boolean => y.part[i] === 0 || y.part[i] === OWN;
  const at = Array.from(y.kind.keys()).filter((i) => y.kind[i] !== NONE && FIXED[y.kind[i] ?? NONE] !== 1 && own(i));
  return at.map((i) => keptPiece(y, i));
}

// ---------- writing ----------

/** Which parts follow a kept piece's first byte: those it has. */
function partsOf(p: KeptPiece): number {
  const has: readonly (readonly [number, unknown])[] = [
    [2, p.held],
    ...EARLY.map(([bit, key]) => [bit, p[key]] as const),
    [128, p.span],
    [256, p.closed],
    ...LATE.map(([bit, key]) => [bit, p[key]] as const),
    [1024, p.free],
    [HIGH, p.kind > 15 ? true : undefined],
    [ALSO, p.also],
    [MORE, p.more],
    [MIX, p.mix],
  ];
  return has.reduce((f, [bit, v]) => (v === undefined || v === false ? f : f | bit), 0);
}

/** Writes what a holder holds: how many kinds, then each thing and how many. */
function writeHeld(o: Writer, pairs: readonly (readonly [number, number])[]): void {
  o.varint(pairs.length);
  for (const [n, c] of pairs) {
    o.byte(n);
    o.varint(c);
  }
}

/** Writes a tunnel mouth's span, and for each tile under a way-in mouth what is there. */
function writeSpan(o: Writer, p: KeptPiece): void {
  const span = p.span ?? 0;
  o.byte(spanByte(span));
  for (let s = 0; s < span; s++) {
    o.byte(p.under?.[s] ?? NONE);
    o.byte(p.along?.[s] ?? 0);
  }
}

/** Writes those of a kept piece's parts of one number each that it has: a byte each, but work a varint. */
function writeNumbers(o: Writer, p: KeptPiece, parts: typeof EARLY | typeof LATE): void {
  for (const [, key] of parts) {
    const v = p[key];
    if (v === undefined) continue;
    if (key === "work") o.varint(v);
    else o.byte(v);
  }
}

/** Writes a kept piece, from its first byte. */
function writeKept(o: Writer, p: KeptPiece): void {
  const f = partsOf(p);
  o.byte((keptKind(p.kind) & 15) | (p.dir << 4) | (p.item === undefined ? 0 : 64) | (f === 0 ? 0 : 128));
  if (p.item !== undefined) {
    o.byte(p.item);
    o.byte((p.prog ?? 0) | ((p.via ?? 0) << 4));
  }
  if (f !== 0) o.varint(f);
  if (p.held) writeHeld(o, p.held);
  writeNumbers(o, p, EARLY);
  if (p.span !== undefined) writeSpan(o, p);
  writeNumbers(o, p, LATE);
  if (f & HIGH) o.byte(p.kind >> 4);
  if (p.also !== undefined) o.byte(p.also);
  if (p.more !== undefined) o.byte(p.more);
  if (p.mix !== undefined) o.byte(p.mix);
}

/** Pieces as kept (in tile order, none twice) as bytes: `unpackCells` reads back the same. */
export function packKept(pieces: readonly KeptPiece[]): Uint8Array {
  const o = new Writer();
  o.varint(pieces.length);
  let last = -1;
  for (const p of pieces) {
    o.varint(p.tile - last - 1);
    last = p.tile;
    writeKept(o, p);
  }
  return o.bytes();
}

// ---------- reading ----------

/** Reads what a holder holds: how many kinds, then each thing and how many; null past what a yard could hold. */
function heldOf(r: Reader): [number, number][] | null {
  const kinds = r.varint();
  if (kinds > KINDS_MOST) return null;
  const pairs: [number, number][] = [];
  for (let k = 0; k < kinds; k++) {
    const thing = r.byte();
    const many = r.varint();
    if (many > MANY_MOST) return null;
    pairs.push([thing, many]);
  }
  return pairs;
}

/** Reads a tunnel mouth's span onto a piece, and for a way-in mouth what is under the ground. */
function readSpan(r: Reader, p: Building): void {
  const span = spanOfByte(r.byte());
  const under: number[] = [];
  const along: number[] = [];
  for (let s = 0; s < span; s++) {
    under.push(r.byte());
    along.push(r.byte());
  }
  Object.assign(p, { span, under, along });
}

/** Reads the parts `f` says follow onto a piece; false for bytes that are no yard's. */
function readParts(r: Reader, p: Building, f: number): boolean {
  const pairs = f & 2 ? heldOf(r) : [];
  if (!pairs) return false;
  if (f & 2) p.held = pairs;
  for (const [bit, key] of EARLY) if (f & bit) p[key] = key === "work" ? r.varint() : r.byte();
  if (f & 128) readSpan(r, p);
  for (const [bit, key] of LATE) if (f & bit) p[key] = r.byte();
  Object.assign(p, f & 256 ? { closed: true } : {}, f & 1024 ? { free: true } : {});
  if (f & HIGH && !readHigh(r, p)) return false;
  readHeldOut(r, p, f);
  return true;
}

/** Reads what a piece holds ready beside its finished thing, as `f` says follows: a by-product, more of the thing, and its place in a mix. */
function readHeldOut(r: Reader, p: Building, f: number): void {
  if (f & ALSO) p.also = r.byte();
  if (f & MORE) p.more = r.byte();
  if (f & MIX) p.mix = r.byte();
}

/** Reads a kind's bits past four onto a piece, as only a kind past 15 has; false for none, which no Leaf keeps. Past 15 they make a kind past 255, which no Leaf here has. */
function readHigh(r: Reader, p: Building): boolean {
  const high = r.byte();
  if (high === 0) return false;
  p.kind |= high << 4;
  return true;
}

/** Reads a piece on a tile, from its first byte; a newer Leaf's for a part this one does not know, null for bytes that are no yard's. */
function readKept(r: Reader, tile: number): KeptPiece | Newer | null {
  const kd = r.byte();
  const p: Building = { tile, kind: kd & 15, dir: (kd >> 4) & 3 };
  if (kd & 64) {
    p.item = r.byte();
    const pv = r.byte();
    p.prog = pv & 15;
    p.via = pv >> 4;
  }
  const f = kd & 128 ? r.varint() : 0;
  // What follows a part this Leaf does not know is past reading: the yard is a newer Leaf's.
  if (!r.over && (f > PARTS || (f & ~PARTS) !== 0)) return NEWER;
  return !readParts(r, p, f) || r.over ? null : p;
}

/**
 * The pieces read back from their bytes, on a land of `tiles` tiles; a newer Leaf's (`NEWER`) for a
 * piece with a part this one does not know; null for bytes that are not pieces.
 */
export function unpackCells(bytes: Uint8Array, tiles: number): KeptPiece[] | Newer | null {
  const r = new Reader(bytes);
  const out: KeptPiece[] = [];
  const pieces = r.varint();
  if (r.over || pieces > tiles) return null;
  let tile = -1;
  for (let n = 0; n < pieces; n++) {
    tile += r.varint() + 1;
    const p = tile < tiles ? readKept(r, tile) : null;
    if (!p || p === NEWER) return p;
    out.push(p);
  }
  return r.done ? out : null;
}

// ---------- onto the yard ----------

const whole = (v: unknown, most: number): number | null =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= most ? v : null;

/** Puts back what a carrying piece carried, and its line's colour. */
function carriedOnto(y: Yard, i: number, o: KeptPiece): void {
  if (CARRIES[y.kind[i] ?? NONE] !== 1) return;
  if (o.item !== undefined && isItem(o.item)) {
    y.item[i] = o.item;
    y.prog[i] = whole(o.prog, 16) ?? 0;
    y.via[i] = whole(o.via, 4) ?? 0;
  }
  y.tint[i] = whole(o.tint, TINTS) ?? 0;
}

/** Puts back what is under the ground in a way-in mouth's tunnel, a real thing or none at each tile. */
function underOnto(y: Yard, i: number, o: KeptPiece): void {
  const t = tunnelOf(y, i);
  if (t < 0 || !o.under || !o.along) return;
  const at = t * SPAN_MOST;
  for (let s = 0; s < (y.span[i] ?? 0); s++) {
    const n = o.under[s] ?? NONE;
    y.tunnels.under[at + s] = isItem(n) ? n : NONE;
    y.tunnels.along[at + s] = whole(o.along[s], 16) ?? 0;
  }
}

/**
 * Puts a kept piece's parts back onto the piece stood where it was, each only as the rules let it be
 * now: a colour where the yard may paint; a machine told to make, holding, making and having made
 * only what it may make (`locked`), and no more than it keeps; a Study at work on a folio it holds for
 * `studied`, the research first in line; work only toward what is being made (`workFor`).
 */
export function keptOnto(y: Yard, i: number, o: KeptPiece, studied: Goal | undefined): void {
  carriedOnto(y, i, o);
  RULES[y.kind[i] ?? NONE]?.onto(KIT, y, i, holderOf(y, i), o, studied);
  underOnto(y, i, o);
}
