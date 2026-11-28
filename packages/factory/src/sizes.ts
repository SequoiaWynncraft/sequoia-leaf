/**
 * Pieces of more than one tile (`KindDef.size`): the tiles a piece covers, how each knows its piece,
 * and where the piece takes things in and sends them out (`KindDef.ports`).
 *
 * A kind's size is tiles across and down as it faces east; facing south or north, across and down
 * swap. A piece stands on the tile it is set down on, its own tile: the middle of its box of tiles,
 * or for an even side the middle's top left, whichever way it faces, so that a press on a tile sets
 * a piece down round it as the player sees it.
 *
 * Every tile a piece covers holds its kind (`Yard.kind`), so whatever asks whether something stands
 * on a tile, what is solid, or what colour a tile is on the map, asks as it always has. Its own tile
 * holds everything else about it, once: its way, grade, row in a side table and settings. Every tile
 * of a piece of more than one holds where its own tile is from it (`Yard.part`); a piece of one tile
 * holds 0 there, as every tile did before, and is exactly as it was.
 *
 * The ports are the kind's, as it faces east, turned here once for each way it may face: for each
 * tile it covers, the sides of it that take things in, as the plumbing reads every tile's
 * (`Wire.taken`); and each output, the tile it leaves from and the way it leaves, ahead.
 */
import type { Opened } from "./kinds/kind.ts";
import { KIND_DEFS } from "./kinds/list.ts";
import { BIG, itemNamed, NONE, SIZE_H, SIZE_W } from "./tables.ts";
import type { Yard } from "./yard.ts";

/** The part a tile is of a piece of more than one tile: where the piece's own tile is from it, four bits each way, 8 for none. */
export const partOf = (dx: number, dy: number): number => ((dx + 8) & 15) | ((dy + 8) << 4);
/** What a piece's own tile holds in `part`, as a piece of more than one tile. */
export const OWN = partOf(0, 0);

/** The tile of the piece that covers a tile: the tile itself for a piece of one tile, or none. */
export function pieceOf(y: Pick<Yard, "part" | "land">, i: number): number {
  const p = y.part[i] ?? 0;
  return p === 0 ? i : i + (p & 15) - 8 + ((p >> 4) - 8) * y.land.w;
}

/** A kind's tiles across and down as it faces a way. */
export const sizeOf = (k: number, d: number): readonly [number, number] =>
  d & 1 ? [SIZE_H[k] ?? 1, SIZE_W[k] ?? 1] : [SIZE_W[k] ?? 1, SIZE_H[k] ?? 1];

/** How far its box's top-left corner is from a piece's own tile, facing a way: up and to the left, by half its size less one. */
export function cornerOf(k: number, d: number): readonly [number, number] {
  const [w, h] = sizeOf(k, d);
  return [-((w - 1) >> 1), -((h - 1) >> 1)];
}

/**
 * Where a tile of a piece's box, across and down from its corner as it stands facing `d`, is as the
 * kind faces east (`w` by `h` as it faces east).
 */
function asEast(w: number, h: number, d: number, bx: number, by: number): readonly [number, number] {
  if (d === 1) return [by, h - 1 - bx];
  if (d === 2) return [w - 1 - bx, h - 1 - by];
  if (d === 3) return [w - 1 - by, bx];
  return [bx, by];
}
/** The other way: where a tile as the kind faces east is in its box as it stands facing `d`. */
function asFacing(w: number, h: number, d: number, lx: number, ly: number): readonly [number, number] {
  if (d === 1) return [h - 1 - ly, lx];
  if (d === 2) return [w - 1 - lx, h - 1 - ly];
  if (d === 3) return [ly, w - 1 - lx];
  return [lx, ly];
}

/**
 * An output, as a piece facing a way has it: its tile from the piece's own tile, the way it leaves,
 * what leaves (0 the thing finished, 1 a by-product), and the one thing it sends, or `NONE` for any
 * (`Ports.out.only`).
 */
export interface Out {
  readonly dx: number;
  readonly dy: number;
  readonly way: number;
  readonly also: boolean;
  readonly only: number;
}

/** Whether a way out sends a thing: any it holds, or only the one it is for. */
export const sendsThing = (o: Out, n: number): boolean => o.only === NONE || o.only === n;

/**
 * A kind as it faces one way: the tiles it covers from its own tile (its own first), the sides of each
 * that take things in, a bit a way (east 1), those that take things in once the yard has an unlock
 * (`opened`, by the unlock), and its outputs.
 */
export interface Facing {
  readonly dx: Int8Array;
  readonly dy: Int8Array;
  readonly takes: Uint8Array;
  readonly opened: readonly { readonly when: Opened; readonly takes: Uint8Array }[];
  readonly outs: readonly Out[];
}

function facing(k: number, d: number): Facing {
  const w = SIZE_W[k] ?? 1;
  const h = SIZE_H[k] ?? 1;
  const [bw, bh] = sizeOf(k, d);
  const [cx, cy] = cornerOf(k, d);
  const n = bw * bh;
  const dx = new Int8Array(n);
  const dy = new Int8Array(n);
  const takes = new Uint8Array(n);
  const opened = new Map<Opened, Uint8Array>();
  const ports = KIND_DEFS[k]?.ports;
  // Its own tile first, then the rest of its box, row by row.
  const tiles = Array.from({ length: n }, (_, t) => [t % bw, Math.floor(t / bw)] as const).toSorted(
    ([ax, ay], [bx, by]) => Number(ax + cx !== 0 || ay + cy !== 0) - Number(bx + cx !== 0 || by + cy !== 0),
  );
  tiles.forEach(([bx, by], t) => {
    dx[t] = bx + cx;
    dy[t] = by + cy;
    const [lx, ly] = asEast(w, h, d, bx, by);
    for (const [px, py, side, when] of ports?.in ?? []) {
      if (px !== lx || py !== ly) continue;
      const into = when === undefined ? takes : (opened.get(when) ?? opened.set(when, new Uint8Array(n)).get(when));
      if (into) into[t] = (into[t] ?? 0) | (1 << ((side + d) & 3));
    }
  });
  const outs = (ports?.out ?? []).map((o): Out => {
    const [bx, by] = asFacing(w, h, d, o.at[0], o.at[1]);
    const only = o.only === undefined ? NONE : (itemNamed(o.only) ?? NONE);
    return { dx: bx + cx, dy: by + cy, way: d, also: o.sends === "also", only };
  });
  return { dx, dy, takes, opened: [...opened].map(([when, bits]) => ({ when, takes: bits })), outs };
}

/** Each kind as it faces each way, by its number and then the way. */
export const FACING: readonly (readonly Facing[])[] = KIND_DEFS.map((_, k) => [0, 1, 2, 3].map((d) => facing(k, d)));

/** Whether a kind's pieces cover more than one tile. */
export const isBig = (k: number): boolean => BIG[k] === 1;

/** The tiles a piece of a kind covers standing on (x, z) facing `d`, its own first; -1 for any off a land `w` by `h`. */
export function tilesAt(k: number, x: number, z: number, d: number, w: number, h: number): number[] {
  const f = FACING[k]?.[d & 3];
  if (!f) return [];
  return Array.from(f.dx, (dx, t) => {
    const tx = x + dx;
    const tz = z + (f.dy[t] ?? 0);
    return tx < 0 || tz < 0 || tx >= w || tz >= h ? -1 : tz * w + tx;
  });
}

/**
 * The sides of a tile of a piece that take things in, a bit a way (east 1), as its kind's ports say
 * (`KindDef.ports`), those an unlock opens with it once the yard has it.
 */
export function takesAt(y: Pick<Yard, "part" | "land" | "kind" | "dir" | "open">, i: number): number {
  const own = pieceOf(y, i);
  const f = FACING[y.kind[own] ?? 0]?.[(y.dir[own] ?? 0) & 3];
  if (!f) return 0;
  const w = y.land.w;
  const dx = (i % w) - (own % w);
  const dy = Math.floor(i / w) - Math.floor(own / w);
  for (let t = 0; t < f.dx.length; t++) {
    if (f.dx[t] !== dx || f.dy[t] !== dy) continue;
    let bits = f.takes[t] ?? 0;
    for (const o of f.opened) if (y.open[o.when]) bits |= o.takes[t] ?? 0;
    return bits;
  }
  return 0;
}

/** No outputs: one list, made once, for every piece that has none (the tick asks this of pieces that hand on by their ways out). */
const NO_OUTS: readonly Out[] = Object.freeze([]);
/** The outputs of a kind of more than one tile facing a way, from its own tile: as one stands, or is about to be placed. */
export const outsAs = (k: number, dir: number): readonly Out[] => FACING[k]?.[dir & 3]?.outs ?? NO_OUTS;
/** The outputs of the piece of more than one tile standing on its own tile `i`, as it faces. */
export const outsOf = (y: Pick<Yard, "kind" | "dir">, i: number): readonly Out[] =>
  outsAs(y.kind[i] ?? 0, y.dir[i] ?? 0);

/** The tiles of the piece of more than one tile standing on its own tile `i`, as it faces, by `f`. */
const facingAt = (y: Pick<Yard, "kind" | "dir">, i: number): Facing | undefined =>
  FACING[y.kind[i] ?? 0]?.[(y.dir[i] ?? 0) & 3];

/** 1 if power reaches any tile of the piece of more than one tile on its own tile `i` (`lit`, a tile each), else 0. */
export function lit(y: Pick<Yard, "kind" | "dir" | "land">, tiles: Uint8Array, i: number): number {
  const f = facingAt(y, i);
  const w = y.land.w;
  for (let t = 0; t < (f?.dx.length ?? 0); t++) if (tiles[i + (f?.dx[t] ?? 0) + (f?.dy[t] ?? 0) * w] === 1) return 1;
  return 0;
}

/**
 * The piece of more than one tile on a tile may have room: every tile beside it stops waiting
 * (`roomBeside`). Its own tiles are woken too, which hand nothing on, so it is no matter.
 */
export function roomRound(y: Pick<Yard, "kind" | "dir" | "land" | "part">, t: number, waiting: Uint8Array): void {
  const i = pieceOf(y, t);
  const f = facingAt(y, i);
  const w = y.land.w;
  for (let n = 0; n < (f?.dx.length ?? 0); n++) {
    const c = i + (f?.dx[n] ?? 0) + (f?.dy[n] ?? 0) * w;
    waiting[c + 1] = 0;
    waiting[c - 1] = 0;
    waiting[c + w] = 0;
    waiting[c - w] = 0;
  }
}

/** Every tile of the piece standing on a tile, its own first: the tile alone for a piece of one tile. */
export function piecesTiles(y: Pick<Yard, "kind" | "dir" | "land" | "part">, t: number): number[] {
  if (y.part[t] === 0) return [t];
  const i = pieceOf(y, t);
  const f = facingAt(y, i);
  return Array.from(f?.dx ?? [], (dx, n) => i + dx + (f?.dy[n] ?? 0) * y.land.w);
}

/**
 * Lays a piece of a kind facing `d` on its own tile `i` over its tiles, on a land `w` tiles across:
 * each tile it covers takes its kind and where its own tile is (`part`), its own tile `OWN`. The one
 * way the tiles of a piece of more than one are laid (`yard.ts`'s `cover`, and the page's pieces in
 * hand), so that what is shown laid is what a command lays. Its tiles are on the land and clear.
 */
export function layOver(kind: Uint8Array, part: Uint8Array, w: number, i: number, k: number, d: number): void {
  const f = FACING[k]?.[d & 3];
  if (!f || f.dx.length < 2) return;
  part[i] = OWN;
  for (let t = 1; t < f.dx.length; t++) {
    const dx = f.dx[t] ?? 0;
    const dy = f.dy[t] ?? 0;
    kind[i + dx + dy * w] = k;
    part[i + dx + dy * w] = partOf(-dx, -dy);
  }
}
