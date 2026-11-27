/**
 * Many pieces at once: standing a set all or none (a run of belt, a copy, a blueprint set down),
 * moving a set as one, taking a set away, and the yard's blueprints. Each is built on what a single
 * piece does in `build.ts`.
 */
import {
  at,
  costOf,
  type Dir,
  DX,
  DY,
  isDir,
  kindAt,
  type Lay,
  otherMouth,
  priceAt,
  type Refund,
  refusal,
  remove,
  right,
  setDown,
  type Spent,
  stops,
  turn,
} from "./build.ts";
import { RULES } from "./kinds/list.ts";
import { join } from "./lines.ts";
import { cornerOf, FACING, isBig, OWN, pieceOf, sizeOf } from "./sizes.ts";
import {
  BELT,
  FIXED,
  gradeOf,
  highest,
  isGraded,
  isKind,
  type Item,
  type Kind,
  LINED,
  locked,
  MOST,
  NONE,
  type Open,
  price,
  RECIPE,
  SHUTS,
  SPANS,
} from "./tables.ts";
import { packWays, unpackWays } from "./tiles.ts";
import { KIT } from "./wire.ts";
import { changed, cover, holderOf, PIECE_BYTES, tunnelOf, type Yard } from "./yard.ts";

export { packWays, unpackWays } from "./tiles.ts";

/** What a piece keeps when it is copied, moved or kept in a blueprint, besides what it is, where and which way: only what is not as new. */
export interface Kept {
  readonly recipe?: Item;
  readonly open?: false;
  readonly tint?: number;
  readonly shut?: number;
  /**
   * For a splitter, the way it puts first: 0 ahead, 1 left, 2 right. Never a way it has shut. For a
   * sorter, 2 where it sends the thing it is set to to its right; with none, it sends it left.
   */
  readonly first?: number;
  /** For a splitter, its ways out turned to take things in, a bit each as `shut` has them: never a shut way, nor the way put first. */
  readonly ins?: number;
  /** Its grade, when it is above 1. */
  readonly grade?: number;
}

/** A piece as it is asked for: what, on which tile, which way, and what it keeps. */
export interface Piece extends Kept {
  readonly kind: Kind;
  readonly x: number;
  readonly y: number;
  readonly dir: Dir;
  /** For a tunnel, how many tiles it passes under. */
  readonly span: number;
}

/** A splitter's ways on a tile as one byte (`packWays`), or a sorter's side; 0 for any other piece. */
export const waysOn = (y: Yard, i: number): number => packWays(y.shut[i] ?? 0, y.first[i] ?? 0, y.ins[i] ?? 0);

/** Sets the ways a piece keeps on the tile it stands on, as far as the yard may have them, as its kind says (`Hooks.waysTo`). */
export function waysTo(y: Yard, i: number, k: Kind, kept: Kept): void {
  RULES[k]?.waysTo(KIT, y, i, kept);
}

/** What a record has of what a piece keeps, if that kind of piece may keep it, as its kind says (`Hooks.keeps`). */
export const keptOf = (v: { readonly [K in keyof Kept]?: unknown }, k: Kind): Kept => RULES[k]?.keeps(KIT, k, v) ?? {};

/** What the piece standing on a tile keeps. */
export function keptAt(y: Yard, i: number): Kept {
  const k = y.kind[i] ?? NONE;
  if (!isKind(k)) return {};
  const r = holderOf(y, i);
  const h = y.holders;
  const recipe = y.set[i] ?? NONE;
  return keptOf(
    {
      ...(recipe === NONE ? {} : { recipe }),
      ...(SHUTS[k] === 1 && r >= 0 && h.open[r] === 0 ? { open: false } : {}),
      tint: y.tint[i],
      shut: y.shut[i],
      first: (y.first[i] ?? 0) - 1,
      ins: y.ins[i],
      grade: y.grade[i],
    },
    k,
  );
}

/**
 * Every tile a piece stands on, across and down, its own first: a tunnel's way-in mouth and the tile
 * it comes up on; every tile of a piece of more than one (`sizes.ts`).
 */
export function cellsOf(p: {
  readonly kind: number;
  readonly x: number;
  readonly y: number;
  readonly dir: number;
  readonly span: number;
}): (readonly [number, number])[] {
  const far = SPANS[p.kind] === 1 ? p.span + 1 : 0;
  if (far > 0)
    return [
      [p.x, p.y],
      [p.x + (DX[p.dir] ?? 0) * far, p.y + (DY[p.dir] ?? 0) * far],
    ];
  const f = FACING[p.kind]?.[p.dir & 3];
  return f ? Array.from(f.dx, (dx, t) => [p.x + dx, p.y + (f.dy[t] ?? 0)] as const) : [[p.x, p.y]];
}

/** The tiles a set of pieces stands on: each one's own, then for a tunnel the one it comes up on, or the rest of a piece of more than one. */
export const tilesOf = (y: Yard, pieces: readonly Piece[]): number[] =>
  pieces.flatMap((p) => cellsOf(p).map(([x, z]) => at(y, x, z)));

/** The box of tiles a set of pieces fills: its top-left corner, and how many tiles across and down. */
export function boxOf(pieces: readonly Piece[]): { x: number; y: number; w: number; h: number } {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of pieces)
    for (const [x, z] of cellsOf(p)) {
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, z);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, z);
    }
  return pieces.length === 0 ? { x: 0, y: 0, w: 0, h: 0 } : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/**
 * A piece turned a quarter turn right about the corner of the set it is in: its middle turned, so a
 * piece of more than one tile stands on the middle of its tiles turned, or the middle's top left.
 * Worked in twice the tiles, so that a middle between tiles stays whole.
 */
function turned(p: Piece): Piece {
  const [w, h] = sizeOf(p.kind, p.dir);
  const [cx, cy] = cornerOf(p.kind, p.dir);
  const mx = 2 * (p.x + cx) + w - 1;
  const my = 2 * (p.y + cy) + h - 1;
  const d = right(p.dir);
  const [w2, h2] = sizeOf(p.kind, d);
  const [cx2, cy2] = cornerOf(p.kind, d);
  return Object.assign({}, p, { x: (-my - (w2 - 1)) / 2 - cx2, y: (mx - (h2 - 1)) / 2 - cy2, dir: d });
}

/** A set of pieces turned as one, `turns` quarter turns to the right, with the corner of its box on (x, y). */
export function placed(pieces: readonly Piece[], turns: number, x: number, y: number): Piece[] {
  let out = pieces;
  for (let k = turns & 3; k > 0; k--) out = out.map(turned);
  const box = boxOf(out);
  return out.map((p): Piece => Object.assign({}, p, { x: p.x - box.x + x, y: p.y - box.y + y }));
}

/** The pieces standing on some tiles, each once and never the depot; a tunnel on its way-in mouth, a piece of more than one tile on its own, whichever was named. */
export function piecesAt(y: Yard, tiles: readonly number[]): Piece[] {
  const out = new Map<number, Piece>();
  const W = y.land.w;
  for (const named of tiles) {
    const t = named < 0 ? named : pieceOf(y, named);
    const k = y.kind[t] ?? NONE;
    const d = y.dir[t] ?? 0;
    if (!isKind(k) || FIXED[k] === 1 || !isDir(d)) continue;
    const span = y.span[t] ?? 0;
    const back = span < 0 ? 1 - span : 0;
    const x = (t % W) - (DX[d] ?? 0) * back;
    const z = Math.floor(t / W) - (DY[d] ?? 0) * back;
    out.set(at(y, x, z), { kind: k, x, y: z, dir: d, span: Math.abs(span), ...keptAt(y, t) });
  }
  return [...out.values()];
}

/** The tiles of the pieces within a rectangle: a tunnel only with both mouths in it, a piece of more than one tile only whole, never the depot. */
export function within(y: Yard, x0: number, y0: number, x1: number, y1: number): number[] {
  const out: number[] = [];
  const inside = ([x, z]: readonly [number, number]): boolean => x >= x0 && x <= x1 && z >= y0 && z <= y1;
  for (let z = Math.max(0, y0); z <= Math.min(y.land.h - 1, y1); z++)
    for (let x = Math.max(0, x0); x <= Math.min(y.land.w - 1, x1); x++) {
      const i = at(y, x, z);
      const k = y.kind[i] ?? NONE;
      if (k !== NONE && FIXED[k] !== 1 && (y.part[i] === 0 || y.part[i] === OWN) && wholeIn(y, i, x, z, inside))
        out.push(i);
    }
  return out;
}

/** Whether every tile of the piece standing on (x, z), its tile `i`, is one `inside` says: a tunnel's other mouth too, whichever is named. */
function wholeIn(
  y: Yard,
  i: number,
  x: number,
  z: number,
  inside: (at: readonly [number, number]) => boolean,
): boolean {
  const k = y.kind[i] ?? NONE;
  const d = (y.dir[i] ?? 0) & 3;
  if (isBig(k)) return cellsOf({ kind: k, x, y: z, dir: d, span: 0 }).every(inside);
  const span = y.span[i] ?? 0;
  const far = (Math.abs(span) + 1) * Math.sign(span);
  return inside([x + (DX[d] ?? 0) * far, z + (DY[d] ?? 0) * far]);
}

/**
 * What a set of pieces costs to stand, each priced in turn by `priceAt`, the pieces to hand used as
 * setting it down uses them. With `bare`, as if on clear ground: what a blueprint or a copy costs
 * before it is aimed anywhere.
 */
export function priceOf(
  y: Yard,
  pieces: readonly Pick<Piece, "kind" | "x" | "y" | "grade" | "span">[],
  bare = false,
): number {
  const spare = Uint8Array.from(y.spare);
  let cost = 0;
  for (const p of pieces) {
    const t = bare ? -1 : at(y, p.x, p.y);
    const i = t < 0 ? t : pieceOf(y, t);
    const there = i < 0 ? NONE : (y.kind[i] ?? NONE);
    cost += bare ? costOf(y, p.kind, p.grade, spare, p.span) : priceAt(y, p.kind, p.x, p.y, p.grade, spare, p.span);
    if (there === p.kind) continue;
    if (there !== NONE && y.free[i] === 1) spare[there] = (spare[there] ?? 0) + 1;
    if ((spare[p.kind] ?? 0) > 0) spare[p.kind] = (spare[p.kind] ?? 0) - 1;
  }
  return cost;
}

/**
 * Why a yard may not have a piece as it is asked for, wherever it stands: its kind at its grade, the
 * recipe it is told to make (what a sorter is set to is no recipe), its colour, and what its kind
 * says more (`Hooks.locks`: a splitter's way put first and its ways in; a sorter's side needs nothing
 * unlocked).
 */
export const pieceRefusal = (open: Open, p: Piece): string | null =>
  locked(open, { build: p.kind, grade: p.grade }) ??
  (p.recipe !== undefined && RECIPE[p.recipe]?.by === p.kind ? locked(open, { make: p.recipe }) : null) ??
  ((p.tint ?? 0) > 0 ? locked(open, { use: "paint" }) : null) ??
  RULES[p.kind]?.locks(KIT, open, p) ??
  null;

/** The tiles setting a piece down changes: a piece of its kind standing there, both mouths of a tunnel, or else its own. */
function claims(y: Yard, p: Piece): number[] {
  const i = at(y, p.x, p.y);
  if (i < 0 || y.kind[i] !== p.kind || isBig(p.kind)) return tilesOf(y, [p]);
  const mouth = otherMouth(y, i);
  return mouth < 0 ? [i] : [i, mouth];
}

/**
 * For each of a set of pieces, why it cannot stand where it is asked, or nothing. With `moving`,
 * the tiles the set is being moved off count as empty, and a piece cannot go where anything else stands.
 */
export function refusals(
  y: Yard,
  pieces: readonly Piece[],
  moving: readonly number[] | null = null,
): (string | null)[] {
  const lifted = (moving ?? []).map((i) => y.kind[i] ?? NONE);
  for (const i of moving ?? []) y.kind[i] = NONE;
  const taken = new Set<number>();
  // Cart stops are counted as they are set down, with those already standing.
  let stopping = stops(y);
  const out = pieces.map((p) => {
    const tiles = claims(y, p);
    const shared = tiles.some((i) => taken.has(i));
    for (const i of tiles) taken.add(i);
    if (moving && tiles.some((i) => i >= 0 && y.kind[i] !== NONE)) return "Something is here already";
    const why = refusal(y, p.kind, p.x, p.y, Infinity, p.dir, p) ?? pieceRefusal(y.open, p);
    if (why === null && MOST[p.kind] === "stops" && y.kind[tiles[0] ?? -1] !== p.kind) {
      const most = locked(y.open, { stops: ++stopping });
      if (most !== null) return most;
    }
    return why ?? (shared ? "Two pieces cannot stand on one tile" : null);
  });
  (moving ?? []).forEach((i, k) => (y.kind[i] = lifted[k] ?? NONE));
  return out;
}

/** Why a set of pieces cannot be stood with `coins` in the purse, or nothing if it can. */
export function standRefusal(
  y: Yard,
  pieces: readonly Piece[],
  coins: number,
  why = refusals(y, pieces),
): string | null {
  const first = why.find((r) => r !== null);
  if (first !== undefined) return first;
  const short = priceOf(y, pieces) - coins;
  return short > 0 ? `Not enough Coins: ${short} short` : null;
}

/**
 * How `stand` sets a piece down: as it is asked for, and a sorter to the side it keeps (its left
 * unless it keeps the right), over a sorter as well as new: a sorter's side, like its way, is how it
 * stands, so a piece stood again where one of its kind stands puts both back.
 */
const laidAs = (p: Piece): Lay => RULES[p.kind]?.asLaid(KIT, p) ?? p;

/**
 * Stands a set of pieces, all of them or none, and says what it cost. One that is new keeps what it
 * was asked to and nothing else. With `joins`, as a run is laid, a new belt or tunnel asked for no
 * colour takes the colour of the line it joins. `bend` is a belt already standing where a run starts, turned to meet it.
 */
export function stand(
  y: Yard,
  pieces: readonly Piece[],
  coins: number,
  joins = false,
  bend?: Pick<Piece, "x" | "y" | "dir">,
): Spent {
  const why =
    bend && kindAt(y, bend.x, bend.y) !== BELT ? "There is no belt there to turn" : standRefusal(y, pieces, coins);
  if (why !== null) return { ok: false, why };
  if (bend) turn(y, bend.x, bend.y, bend.dir);
  let cost = 0;
  const laid: number[] = [];
  for (const p of pieces) {
    const did = setDown(y, p.kind, p.x, p.y, p.dir, Infinity, laidAs(p));
    if (!did.ok) continue;
    cost += did.cost;
    const kept = keptOf(p, p.kind);
    for (const i of did.laid) {
      // The colour it came with is of what stood there: a run is joined below, as a whole.
      y.tint[i] = kept.tint ?? 0;
      waysTo(y, i, p.kind, kept);
      const r = holderOf(y, i);
      if (kept.recipe !== undefined) y.set[i] = kept.recipe;
      if (kept.open === false && r >= 0) y.holders.open[r] = 0;
      if (joins && LINED[p.kind] === 1) laid.push(i);
    }
  }
  join(y, laid);
  return { ok: true, cost };
}

/** The per-tile parts of a piece, lifted off its tile to be set down on another. */
const PARTS = [
  "kind",
  "part",
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
  "row",
] as const;

/**
 * Moves the pieces on some tiles as one: turned `turns` quarter turns right, the corner of their box
 * on (x, y). All of them or none; each stays the piece it was, with what it holds. Costs nothing.
 */
export function move(y: Yard, tiles: readonly number[], turns: number, x: number, z: number): string | null {
  const from = piecesAt(y, tiles);
  if (from.length === 0) return "There is nothing here to move";
  const to = placed(from, turns, x, z);
  const left = tilesOf(y, from);
  const why = refusals(y, to, left).find((r) => r !== null);
  if (why !== undefined) return why;
  const lifted = left.map((i) => PARTS.map((part) => y[part][i] ?? 0));
  for (const i of left) {
    for (const part of PARTS)
      y[part][i] = part === "kind" || part === "item" || part === "set" ? NONE : part === "row" ? -1 : 0;
  }
  const ways = to.flatMap((p): Dir[] => cellsOf(p).map(() => p.dir));
  const covered = PARTS.indexOf("part");
  tilesOf(y, to).forEach((i, k) => {
    const parts = lifted[k];
    // The rest of a piece of more than one tile is laid over its tiles, turned, below.
    if (!parts || i < 0 || (parts[covered] !== 0 && parts[covered] !== OWN)) return;
    PARTS.forEach((part, n) => (y[part][i] = parts[n] ?? 0));
    y.dir[i] = ways[k] ?? y.dir[i] ?? 0;
    y.via[i] = 0;
    const r = holderOf(y, i);
    if (r >= 0) y.holders.tile[r] = i;
    const t = tunnelOf(y, i);
    if (t >= 0) y.tunnels.tile[t] = i;
  });
  for (const p of to) if (isBig(p.kind)) cover(y, at(y, p.x, p.y), p.kind, p.dir);
  changed(y);
  y.powered = false;
  return null;
}

/**
 * The pieces a copy of what stands on some tiles stands: turned `turns` quarter turns right, the
 * corner of their box on (x, y), each keeping what a piece copied keeps; nothing if none stands there.
 * The copy is stood all or none (`stand`), as one command, however many pieces it is.
 */
export function copyOf(y: Yard, tiles: readonly number[], turns: number, x: number, z: number): Piece[] | null {
  const from = piecesAt(y, tiles);
  return from.length === 0 ? null : placed(from, turns, x, z);
}

/** Takes away every piece on some tiles, and says what comes back. */
export function clear(y: Yard, tiles: readonly number[]): Refund {
  const pieces = piecesAt(y, tiles);
  if (pieces.length === 0) return { ok: false, why: "There is nothing here to remove" };
  let refund = 0;
  for (const p of pieces) {
    const did = remove(y, p.x, p.y);
    if (did.ok) refund += did.refund;
  }
  return { ok: true, refund };
}

// ---------- blueprints ----------

/** Why a set of pieces cannot be kept as a yard's blueprint in a place, or nothing if it can: each one, how many, and its box. */
export function blueprintRefusal(open: Open, slot: number, pieces: readonly Piece[]): string | null {
  if (pieces.length === 0) return "There is nothing here to save";
  const { w, h } = boxOf(pieces);
  for (const p of pieces) {
    const why = pieceRefusal(open, p);
    if (why !== null) return why;
  }
  return locked(open, { blueprint: slot, pieces: pieces.length, w, h });
}

/** A blueprint's pieces as bytes, `PIECE_BYTES` a piece. */
export function packPieces(pieces: readonly Piece[]): Uint8Array {
  const out = new Uint8Array(pieces.length * PIECE_BYTES);
  pieces.forEach((p, n) =>
    out.set(
      [
        p.kind,
        p.x,
        p.y,
        p.dir,
        p.span,
        p.recipe ?? NONE,
        p.open === false ? 0 : 1,
        p.tint ?? 0,
        packWays(p.shut ?? 0, (p.first ?? -1) + 1, p.ins ?? 0),
        p.grade ?? 1,
      ],
      n * PIECE_BYTES,
    ),
  );
  return out;
}

/** A blueprint's pieces read back from its bytes. */
export function piecesOf(bytes: Uint8Array): Piece[] {
  const out: Piece[] = [];
  for (let from = 0; from + PIECE_BYTES <= bytes.length; from += PIECE_BYTES) {
    const [k = NONE, x = 0, z = 0, d = 0, span = 0, recipe = NONE, open = 1, tint = 0, ways = 0, grade = 1] =
      bytes.subarray(from, from + PIECE_BYTES);
    if (!isKind(k) || !isDir(d)) continue;
    out.push({
      kind: k,
      x,
      y: z,
      dir: d,
      span,
      ...keptOf({ recipe, open: open === 0 ? false : undefined, tint, ...unpackWays(ways), grade }, k),
    });
  }
  return out;
}

/** Keeps the pieces on some tiles as the blueprint in a place. Says why it cannot be done, or nothing when it is. */
export function saveBlueprint(y: Yard, slot: number, tiles: readonly number[]): string | null {
  const pieces = placed(piecesAt(y, tiles), 0, 0, 0);
  const why = blueprintRefusal(y.open, slot, pieces);
  if (why === null) y.blueprints[slot] = { pieces: packPieces(pieces), whole: false };
  return why;
}

/**
 * The pieces of the blueprint in a place, turned `turns` quarter turns right with the corner of its
 * box on (x, y); a plan of the whole yard's on the tiles they were kept on, however it is aimed;
 * nothing if there is none.
 */
export function blueprintAt(y: Yard, slot: number, turns: number, x: number, z: number): Piece[] | null {
  const print = y.blueprints[slot];
  if (!print) return null;
  return print.whole ? piecesOf(print.pieces) : placed(piecesOf(print.pieces), turns, x, z);
}

/** Throws away the blueprint in a place. Says whether there was one. */
export function deleteBlueprint(y: Yard, slot: number): boolean {
  if (!y.blueprints[slot]) return false;
  y.blueprints[slot] = null;
  return true;
}

// ---------- raising an area ----------

/** The grade each piece is raised to: the highest the yard may build of its kind, or with `to`, that grade (a card's Upgrade, one grade up). */
const raisedTo = (y: Yard, p: Piece, to?: number): number => to ?? highest(y.open, p.kind);

/** The pieces on some tiles that can be raised: of a kind with a grade, below the grade they would be raised to, which the yard may build. */
const raisable = (y: Yard, tiles: readonly number[], to?: number): Piece[] =>
  piecesAt(y, tiles).filter((p) => {
    const g = raisedTo(y, p, to);
    return isGraded(p.kind) && (p.grade ?? 1) < g && g <= highest(y.open, p.kind);
  });

/** What raising every piece on some tiles to the highest grade the yard may build of its kind (or to `to`) costs. */
export const upgradePrice = (y: Yard, tiles: readonly number[], to?: number): number =>
  raisable(y, tiles, to).reduce(
    (sum, p) => sum + price(p.kind, raisedTo(y, p, to), p.span) - price(p.kind, gradeOf(p.kind, p.grade), p.span),
    0,
  );

/** Why the pieces on some tiles cannot be raised with `coins` in the purse, or nothing if they can. */
export function upgradeRefusal(y: Yard, tiles: readonly number[], coins: number, to?: number): string | null {
  if (raisable(y, tiles, to).length === 0) return "Nothing here can be raised";
  const short = upgradePrice(y, tiles, to) - coins;
  return short > 0 ? `Not enough Coins: ${short} short` : null;
}

/**
 * Raises every piece on some tiles that can be raised to the highest grade the yard may build of its
 * kind, or with `to` to that grade, all of them or none, and says what it cost: each is laid again
 * where it stands, as a build over it at that grade lays it, for the same Coins.
 */
export function upgrade(y: Yard, tiles: readonly number[], coins: number, to?: number): Spent {
  const why = upgradeRefusal(y, tiles, coins, to);
  if (why !== null) return { ok: false, why };
  const cost = upgradePrice(y, tiles, to);
  for (const p of raisable(y, tiles, to))
    setDown(y, p.kind, p.x, p.y, p.dir, Infinity, { grade: raisedTo(y, p, to), span: p.span });
  return { ok: true, cost };
}
