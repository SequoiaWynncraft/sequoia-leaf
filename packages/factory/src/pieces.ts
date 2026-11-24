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
import { join } from "./lines.ts";
import {
  BELT,
  CRATE,
  DEPOT,
  gradeOf,
  highest,
  isGraded,
  isItem,
  isKind,
  type Item,
  JOINER,
  type Kind,
  locked,
  NONE,
  type Open,
  price,
  RECIPE,
  SORTER,
  SPLITTER,
  STOP,
  TOP,
  TUNNEL,
} from "./tables.ts";
import { changed, holderOf, PIECE_BYTES, tunnelOf, type Yard } from "./yard.ts";

/** How many colours there are to give. */
export const TINTS = 6;

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

const tinted = (k: number): boolean => k === BELT || k === TUNNEL || k === SPLITTER || k === JOINER || k === SORTER;
const upTo = (v: unknown, most: number): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= most;
const isWay = (v: unknown): v is number => v === 0 || v === 1 || v === 2;
/** Whether a way is one of the shut ways `shut` holds, a bit each. */
const shutAt = (shut: unknown, way: number): boolean => typeof shut === "number" && ((shut >> way) & 1) === 1;

/**
 * A splitter's ways as one byte, as a blueprint and a kept yard hold them: its shut ways a bit each,
 * and 8 times what it puts first, 1 + the way or 0 for none. A sorter's side is kept the same way.
 */
export const packWays = (shut: number, first: number): number => shut | (first << 3);
/** A splitter's ways read back from their byte, as `keptOf` reads them: the shut ways, and the way put first or -1. */
export const unpackWays = (b: number): { shut: number; first: number } => ({ shut: b & 7, first: (b >> 3) - 1 });

/**
 * What a record has of the way a piece keeps first, if it may keep it: a splitter's way put first,
 * never a shut one; a sorter's side, only where it is the right (2), the left being how one stands
 * unless told.
 */
const firstKept = (v: { readonly first?: unknown; readonly shut?: unknown }, k: Kind): Pick<Kept, "first"> =>
  isWay(v.first) && (k === SPLITTER ? !shutAt(v.shut, v.first) : k === SORTER && v.first === 2)
    ? { first: v.first }
    : {};

/** What a record has of what a piece keeps, if that kind of piece may keep it. */
export const keptOf = (v: { readonly [K in keyof Kept]?: unknown }, k: Kind): Kept => ({
  ...(typeof v.recipe === "number" && isItem(v.recipe) && (k === SORTER || RECIPE[v.recipe]?.by === k)
    ? { recipe: v.recipe }
    : {}),
  ...(v.open === false && k === CRATE ? { open: v.open } : {}),
  ...(upTo(v.tint, TINTS) && tinted(k) ? { tint: v.tint } : {}),
  ...(upTo(v.shut, 7) && k === SPLITTER ? { shut: v.shut } : {}),
  ...firstKept(v, k),
  ...(upTo(v.grade, TOP) && v.grade > 1 && isGraded(k) ? { grade: v.grade } : {}),
});

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
      ...(k === CRATE && r >= 0 && h.open[r] === 0 ? { open: false } : {}),
      tint: y.tint[i],
      shut: y.shut[i],
      first: (y.first[i] ?? 0) - 1,
      grade: y.grade[i],
    },
    k,
  );
}

/** How far from a piece's own tile its second one is: for a tunnel, the tile it comes up on. */
const reach = (p: Piece): number => (p.kind === TUNNEL ? p.span + 1 : 0);

/** The tiles a set of pieces stands on: each one's own, then for a tunnel the one it comes up on. */
export const tilesOf = (y: Yard, pieces: readonly Piece[]): number[] =>
  pieces.flatMap((p) => {
    const far = reach(p);
    const mine = at(y, p.x, p.y);
    return far > 0 ? [mine, at(y, p.x + (DX[p.dir] ?? 0) * far, p.y + (DY[p.dir] ?? 0) * far)] : [mine];
  });

/** The box of tiles a set of pieces fills: its top-left corner, and how many tiles across and down. */
export function boxOf(pieces: readonly Piece[]): { x: number; y: number; w: number; h: number } {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of pieces) {
    const fx = p.x + (DX[p.dir] ?? 0) * reach(p);
    const fy = p.y + (DY[p.dir] ?? 0) * reach(p);
    x0 = Math.min(x0, p.x, fx);
    y0 = Math.min(y0, p.y, fy);
    x1 = Math.max(x1, p.x, fx);
    y1 = Math.max(y1, p.y, fy);
  }
  return pieces.length === 0 ? { x: 0, y: 0, w: 0, h: 0 } : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** A set of pieces turned as one, `turns` quarter turns to the right, with the corner of its box on (x, y). */
export function placed(pieces: readonly Piece[], turns: number, x: number, y: number): Piece[] {
  let out = pieces;
  for (let k = turns & 3; k > 0; k--)
    out = out.map((p): Piece => Object.assign({}, p, { x: -p.y, y: p.x, dir: right(p.dir) }));
  const box = boxOf(out);
  return out.map((p): Piece => Object.assign({}, p, { x: p.x - box.x + x, y: p.y - box.y + y }));
}

/** The pieces standing on some tiles, each once and never the depot; a tunnel on its way-in mouth, whichever was named. */
export function piecesAt(y: Yard, tiles: readonly number[]): Piece[] {
  const out = new Map<number, Piece>();
  const W = y.land.w;
  for (const t of tiles) {
    const k = y.kind[t] ?? NONE;
    const d = y.dir[t] ?? 0;
    if (!isKind(k) || k === DEPOT || !isDir(d)) continue;
    const span = y.span[t] ?? 0;
    const back = span < 0 ? 1 - span : 0;
    const x = (t % W) - (DX[d] ?? 0) * back;
    const z = Math.floor(t / W) - (DY[d] ?? 0) * back;
    out.set(at(y, x, z), { kind: k, x, y: z, dir: d, span: Math.abs(span), ...keptAt(y, t) });
  }
  return [...out.values()];
}

/** The tiles of the pieces within a rectangle: a tunnel only with both mouths in it, never the depot. */
export function within(y: Yard, x0: number, y0: number, x1: number, y1: number): number[] {
  const out: number[] = [];
  for (let z = Math.max(0, y0); z <= Math.min(y.land.h - 1, y1); z++)
    for (let x = Math.max(0, x0); x <= Math.min(y.land.w - 1, x1); x++) {
      const i = at(y, x, z);
      const k = y.kind[i] ?? NONE;
      if (k === NONE || k === DEPOT) continue;
      const span = y.span[i] ?? 0;
      const d = y.dir[i] ?? 0;
      const far = (Math.abs(span) + 1) * Math.sign(span);
      const fx = x + (DX[d] ?? 0) * far;
      const fy = z + (DY[d] ?? 0) * far;
      if (fx >= x0 && fx <= x1 && fy >= y0 && fy <= y1) out.push(i);
    }
  return out;
}

/**
 * What a set of pieces costs to stand, each priced in turn by `priceAt`, the pieces to hand used as
 * setting it down uses them. With `bare`, as if on clear ground: what a blueprint or a copy costs
 * before it is aimed anywhere.
 */
export function priceOf(y: Yard, pieces: readonly Pick<Piece, "kind" | "x" | "y" | "grade">[], bare = false): number {
  const spare = Uint8Array.from(y.spare);
  let cost = 0;
  for (const p of pieces) {
    const i = bare ? -1 : at(y, p.x, p.y);
    const there = i < 0 ? NONE : (y.kind[i] ?? NONE);
    cost += bare ? costOf(y, p.kind, p.grade, spare) : priceAt(y, p.kind, p.x, p.y, p.grade, spare);
    if (there === p.kind) continue;
    if (there !== NONE && y.free[i] === 1) spare[there] = (spare[there] ?? 0) + 1;
    if ((spare[p.kind] ?? 0) > 0) spare[p.kind] = (spare[p.kind] ?? 0) - 1;
  }
  return cost;
}

/**
 * Why a yard may not have a piece as it is asked for, wherever it stands: its kind at its grade, what
 * it is set to, its colour, a splitter's way put first (a sorter's side needs nothing unlocked).
 */
export const pieceRefusal = (open: Open, p: Piece): string | null =>
  locked(open, { build: p.kind, grade: p.grade }) ??
  (p.recipe !== undefined && p.kind !== SORTER ? locked(open, { make: p.recipe }) : null) ??
  ((p.tint ?? 0) > 0 ? locked(open, { use: "paint" }) : null) ??
  (p.first !== undefined && p.kind === SPLITTER ? locked(open, { first: true }) : null);

/** The tiles setting a piece down changes: a piece of its kind standing there, both mouths of a tunnel, or else its own. */
function claims(y: Yard, p: Piece): number[] {
  const i = at(y, p.x, p.y);
  if (i < 0 || y.kind[i] !== p.kind) return tilesOf(y, [p]);
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
    if (why === null && p.kind === STOP && y.kind[tiles[0] ?? -1] !== STOP) {
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
    const did = setDown(y, p.kind, p.x, p.y, p.dir, Infinity, p);
    if (!did.ok) continue;
    cost += did.cost;
    const kept = keptOf(p, p.kind);
    for (const i of did.laid) {
      // The colour it came with is of what stood there: a run is joined below, as a whole.
      y.tint[i] = kept.tint ?? 0;
      if (kept.shut !== undefined) y.shut[i] = kept.shut;
      if (kept.first !== undefined) y.first[i] = kept.first + 1;
      const r = holderOf(y, i);
      if (kept.recipe !== undefined) y.set[i] = kept.recipe;
      if (kept.open === false && r >= 0) y.holders.open[r] = 0;
      if (joins && (p.kind === BELT || p.kind === TUNNEL)) laid.push(i);
    }
  }
  join(y, laid);
  return { ok: true, cost };
}

/** The per-tile parts of a piece, lifted off its tile to be set down on another. */
const PARTS = [
  "kind",
  "dir",
  "item",
  "prog",
  "via",
  "tint",
  "turn",
  "shut",
  "first",
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
  const ways = to.flatMap((p): Dir[] => (reach(p) > 0 ? [p.dir, p.dir] : [p.dir]));
  tilesOf(y, to).forEach((i, k) => {
    const parts = lifted[k];
    if (!parts || i < 0) return;
    PARTS.forEach((part, n) => (y[part][i] = parts[n] ?? 0));
    y.dir[i] = ways[k] ?? y.dir[i] ?? 0;
    y.via[i] = 0;
    const r = holderOf(y, i);
    if (r >= 0) y.holders.tile[r] = i;
    const t = tunnelOf(y, i);
    if (t >= 0) y.tunnels.tile[t] = i;
  });
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
        packWays(p.shut ?? 0, (p.first ?? -1) + 1),
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
  if (why === null) y.blueprints[slot] = packPieces(pieces);
  return why;
}

/** The pieces of the blueprint in a place, turned `turns` quarter turns right with the corner of its box on (x, y); nothing if there is none. */
export function blueprintAt(y: Yard, slot: number, turns: number, x: number, z: number): Piece[] | null {
  const print = y.blueprints[slot];
  return print ? placed(piecesOf(print), turns, x, z) : null;
}

/** Throws away the blueprint in a place. Says whether there was one. */
export function deleteBlueprint(y: Yard, slot: number): boolean {
  if (!y.blueprints[slot]) return false;
  y.blueprints[slot] = null;
  return true;
}

// ---------- raising an area ----------

/** The pieces on some tiles that can be raised: of a kind with a grade, below the highest the yard may build of it. */
const raisable = (y: Yard, tiles: readonly number[]): Piece[] =>
  piecesAt(y, tiles).filter((p) => isGraded(p.kind) && (p.grade ?? 1) < highest(y.open, p.kind));

/** What raising every piece on some tiles to the highest grade the yard may build of its kind costs. */
export const upgradePrice = (y: Yard, tiles: readonly number[]): number =>
  raisable(y, tiles).reduce(
    (sum, p) => sum + price(p.kind, highest(y.open, p.kind)) - price(p.kind, gradeOf(p.kind, p.grade)),
    0,
  );

/** Why the pieces on some tiles cannot be raised with `coins` in the purse, or nothing if they can. */
export function upgradeRefusal(y: Yard, tiles: readonly number[], coins: number): string | null {
  if (raisable(y, tiles).length === 0) return "Nothing here can be raised";
  const short = upgradePrice(y, tiles) - coins;
  return short > 0 ? `Not enough Coins: ${short} short` : null;
}

/** Raises every piece on some tiles that can be raised to the highest grade the yard may build of its kind, all of them or none, and says what it cost. */
export function upgrade(y: Yard, tiles: readonly number[], coins: number): Spent {
  const why = upgradeRefusal(y, tiles, coins);
  if (why !== null) return { ok: false, why };
  const cost = upgradePrice(y, tiles);
  for (const p of raisable(y, tiles))
    setDown(y, p.kind, p.x, p.y, p.dir, Infinity, { grade: highest(y.open, p.kind), span: p.span });
  return { ok: true, cost };
}
