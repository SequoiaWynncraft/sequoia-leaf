/**
 * Many pieces at once: standing a set of them all or none (a run of belt, a copy, a blueprint set
 * down), moving a set as one, taking a set away, and the yard's blueprints. Each is built on what a
 * single piece does in `build.ts`.
 */
import { build, join, type Refund, refusal, remove, type Spent, turn, turnable, worth } from "./build.ts";
import { isItem, type Item } from "./content/items.ts";
import { BLUEPRINT, KIND, type Kind } from "./content/machines.ts";
import { RECIPE } from "./content/recipes.ts";
import { type Dir, DX, DY, RIGHT } from "./grid.ts";
import { repower } from "./power.ts";
import { at, changed, TINTS, type World } from "./world.ts";

/**
 * What a piece keeps when it is copied or kept in a blueprint, besides what it is, where it stands
 * and which way it faces: a set recipe, a shut crate, a colour. One more is a field here and a line
 * in `keptOf`.
 */
export interface Kept {
  readonly recipe?: Item;
  readonly open?: false;
  readonly tint?: number;
}

/** The kinds of piece that can be coloured. */
const tinted = (kind: Kind): boolean =>
  kind === "belt" || kind === "tunnel" || kind === "splitter" || kind === "joiner";

/** What a building, or a record read back, has of these, if that kind of piece may keep it. */
export const keptOf = (v: { readonly [K in keyof Kept]?: unknown }, kind: Kind): Kept => ({
  ...(isItem(v.recipe) && RECIPE[v.recipe]?.by === kind ? { recipe: v.recipe } : {}),
  ...(v.open === false && kind === "crate" ? { open: v.open } : {}),
  ...(typeof v.tint === "number" && Number.isInteger(v.tint) && v.tint >= 1 && v.tint <= TINTS && tinted(kind)
    ? { tint: v.tint }
    : {}),
});

/** A piece as it is asked for: what, on which tile, which way, and what it keeps. */
export interface Piece extends Kept {
  readonly kind: Kind;
  readonly x: number;
  readonly y: number;
  readonly dir: Dir;
  /** For a tunnel, how many tiles it passes under. */
  readonly span: number;
}

/** How far from a piece's own tile its second one is: for a tunnel, the tile it comes up on. */
const reach = (p: Piece): number => (p.kind === "tunnel" ? p.span + 1 : 0);

/** The tiles a set of pieces stands on, piece by piece: each one's own, then for a tunnel the one it comes up on. */
export const tilesOf = (w: World, pieces: readonly Piece[]): number[] =>
  pieces.flatMap((p) => {
    const far = reach(p);
    return far > 0 ? [at(w, p.x, p.y), at(w, p.x + DX[p.dir] * far, p.y + DY[p.dir] * far)] : [at(w, p.x, p.y)];
  });

/** The box of tiles a set of pieces fills: its top-left corner, and how many tiles across and down. */
export function boxOf(pieces: readonly Piece[]): { x: number; y: number; w: number; h: number } {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of pieces) {
    const fx = p.x + DX[p.dir] * reach(p);
    const fy = p.y + DY[p.dir] * reach(p);
    x0 = Math.min(x0, p.x, fx);
    y0 = Math.min(y0, p.y, fy);
    x1 = Math.max(x1, p.x, fx);
    y1 = Math.max(y1, p.y, fy);
  }
  return pieces.length === 0 ? { x: 0, y: 0, w: 0, h: 0 } : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** A set of pieces turned as one, `turns` quarter turns to the right, with the corner of the box it then fills on (x, y). */
export function placed(pieces: readonly Piece[], turns: number, x: number, y: number): Piece[] {
  let out = pieces;
  for (let k = turns & 3; k > 0; k--)
    out = out.map((p): Piece => Object.assign({}, p, { x: -p.y, y: p.x, dir: RIGHT[p.dir] }));
  const box = boxOf(out);
  return out.map((p): Piece => Object.assign({}, p, { x: p.x - box.x + x, y: p.y - box.y + y }));
}

/**
 * The pieces standing on some tiles, each once and never the depot. A tunnel is one piece, on the
 * mouth things go in at, whichever of its mouths was named.
 */
export function piecesAt(w: World, tiles: readonly number[]): Piece[] {
  const out = new Map<number, Piece>();
  for (const t of tiles) {
    const b = w.cells[t];
    if (!b || b.kind === "depot") continue;
    // The mouth things come out of has the span negated: the other is that many tiles and one more behind it.
    const back = b.span < 0 ? 1 - b.span : 0;
    const x = (t % w.land.w) - DX[b.dir] * back;
    const y = Math.floor(t / w.land.w) - DY[b.dir] * back;
    out.set(at(w, x, y), { kind: b.kind, x, y, dir: b.dir, span: Math.abs(b.span), ...keptOf(b, b.kind) });
  }
  return [...out.values()];
}

/** The tiles of the pieces within a rectangle of tiles: a tunnel only when both its mouths are in it, and never the depot. */
export function within(w: World, x0: number, y0: number, x1: number, y1: number): number[] {
  const out: number[] = [];
  for (let y = Math.max(0, y0); y <= Math.min(w.land.h - 1, y1); y++)
    for (let x = Math.max(0, x0); x <= Math.min(w.land.w - 1, x1); x++) {
      const b = w.cells[at(w, x, y)];
      if (!b || b.kind === "depot") continue;
      const far = (Math.abs(b.span) + 1) * Math.sign(b.span);
      const fx = x + DX[b.dir] * far;
      const fy = y + DY[b.dir] * far;
      if (fx >= x0 && fx <= x1 && fy >= y0 && fy <= y1) out.push(at(w, x, y));
    }
  return out;
}

/**
 * What a set of pieces costs to stand, each priced in turn as a single piece is (`priceAt`): the
 * pieces the yard has to hand go down first, for nothing. `bare` prices them as on empty ground.
 */
export function priceOf(w: World, pieces: readonly Pick<Piece, "kind" | "x" | "y">[], bare = false): number {
  const spare = { ...w.spare };
  let cost = 0;
  for (const p of pieces) {
    const there = bare ? null : w.cells[at(w, p.x, p.y)];
    if (there?.kind === p.kind) continue;
    if ((spare[p.kind] ?? 0) > 0) spare[p.kind] = (spare[p.kind] ?? 0) - 1;
    else cost += KIND[p.kind].cost;
    if (!there) continue;
    cost -= worth(there);
    if (there.free) spare[there.kind] = (spare[there.kind] ?? 0) + 1;
  }
  return cost;
}

/**
 * For each of a set of pieces, why it cannot stand where it is asked, or nothing: what `refusal`
 * says of it alone, and that two of the set want one tile. With `moving`, the tiles the set is
 * being moved off, those count as empty, and a piece cannot go where anything else stands.
 */
export function refusals(
  w: World,
  pieces: readonly Piece[],
  moving: readonly number[] | null = null,
): (string | null)[] {
  const lifted = (moving ?? []).map((i) => w.cells[i] ?? null);
  for (const i of moving ?? []) w.cells[i] = null;
  const taken = new Set<number>();
  const out = pieces.map((p) => {
    const tiles = tilesOf(w, [p]);
    const shared = tiles.some((i) => taken.has(i));
    for (const i of tiles) taken.add(i);
    if (moving && tiles.some((i) => w.cells[i])) return "Something is here already";
    const why = refusal(w, p.kind, p.x, p.y, Infinity, p.dir, p.kind === "tunnel" ? p.span : undefined);
    return why ?? (shared ? "Two pieces cannot stand on one tile" : null);
  });
  (moving ?? []).forEach((i, k) => (w.cells[i] = lifted[k] ?? null));
  return out;
}

/**
 * Why a set of pieces cannot be stood with `coins` in the purse, or nothing if it can: the first
 * piece's reason that has one (`why`, each piece's, if already worked out), or how many Coins short.
 */
export function standRefusal(
  w: World,
  pieces: readonly Piece[],
  coins: number,
  why = refusals(w, pieces),
): string | null {
  const first = why.find((r) => r !== null);
  if (first !== undefined) return first;
  const short = priceOf(w, pieces) - coins;
  return short > 0 ? `Not enough Coins: ${short} short` : null;
}

/**
 * Stands a set of pieces, all of them or none, and says what it cost. Each goes down as a single
 * piece does (`build`): over one of its kind it only turns it, and a splitter or a joiner takes a
 * belt's place. One that is new keeps what it was asked to (`Kept`) and nothing else: a copy of an
 * uncoloured belt stays uncoloured. With `joins`, as a run of belt is laid, a new belt or tunnel
 * asked for no colour takes the colour of the line it joins, whatever order the pieces come in. `bend` is a
 * belt already standing where a run starts, turned to meet it.
 */
export function stand(
  w: World,
  pieces: readonly Piece[],
  coins: number,
  joins = false,
  bend?: Pick<Piece, "x" | "y" | "dir">,
): Spent {
  const why = bend && !turnable(w, bend.x, bend.y) ? "There is nothing there to turn" : standRefusal(w, pieces, coins);
  if (why !== null) return { ok: false, why };
  if (bend) turn(w, bend.x, bend.y, bend.dir);
  let cost = 0;
  const laid: number[] = [];
  for (const p of pieces) {
    const fresh = w.cells[at(w, p.x, p.y)]?.kind !== p.kind;
    const did = build(w, p.kind, p.x, p.y, p.dir, Infinity, p.kind === "tunnel" ? p.span : undefined);
    if (did.ok) cost += did.cost;
    if (!fresh) continue;
    const line = p.kind === "belt" || p.kind === "tunnel";
    for (const i of tilesOf(w, [p])) {
      const made = w.cells[i];
      // The colour `build` gave it came of what stood there or beside it: a run is joined below, as a whole.
      if (made) Object.assign(made, { tint: 0 }, keptOf(p, p.kind));
      if (line && joins) laid.push(i);
    }
  }
  join(w, laid);
  return { ok: true, cost };
}

/**
 * Moves the pieces on some tiles as one: turned `turns` quarter turns to the right, with the corner
 * of the box they then fill on (x, y). All of them or none. Each stays the piece it was, with
 * whatever it holds, and may land on a tile the set itself stood on. Costs nothing. Says why it
 * cannot be done, or nothing when it is.
 */
export function move(w: World, tiles: readonly number[], turns: number, x: number, y: number): string | null {
  const from = piecesAt(w, tiles);
  if (from.length === 0) return "There is nothing here to move";
  const to = placed(from, turns, x, y);
  const left = tilesOf(w, from);
  const why = refusals(w, to, left).find((r) => r !== null);
  if (why !== undefined) return why;
  const lifted = left.map((i) => w.cells[i] ?? null);
  for (const i of left) w.cells[i] = null;
  const ways = to.flatMap((p): Dir[] => (reach(p) > 0 ? [p.dir, p.dir] : [p.dir]));
  tilesOf(w, to).forEach((i, k) => {
    const b = lifted[k];
    if (!b) return;
    b.dir = ways[k] ?? b.dir;
    b.via = -1;
    w.cells[i] = b;
  });
  changed(w);
  repower(w);
  return null;
}

/** Takes away every piece on some tiles, and says what comes back, as `remove` does for one. */
export function clear(w: World, tiles: readonly number[]): Refund {
  const pieces = piecesAt(w, tiles);
  if (pieces.length === 0) return { ok: false, why: "There is nothing here to remove" };
  let refund = 0;
  for (const p of pieces) {
    const did = remove(w, p.x, p.y);
    if (did.ok) refund += did.refund;
  }
  return { ok: true, refund };
}

/** Why a set of pieces cannot be kept as a blueprint, or nothing if it can. */
export function blueprintRefusal(pieces: readonly Piece[]): string | null {
  if (pieces.length === 0) return "There is nothing here to save";
  if (pieces.length > BLUEPRINT.pieces)
    return `A blueprint holds at most ${BLUEPRINT.pieces} pieces. This is ${pieces.length}`;
  const box = boxOf(pieces);
  if (box.w > BLUEPRINT.w || box.h > BLUEPRINT.h)
    return `A blueprint is at most ${BLUEPRINT.w} tiles by ${BLUEPRINT.h}. This is ${box.w} by ${box.h}`;
  return null;
}

/**
 * Keeps the pieces on some tiles as the blueprint in a place, instead of whatever was kept there:
 * what each is, where it stands among the others, which way it faces and what it keeps (`Kept`),
 * not what it holds. Says why it cannot be done, or nothing when it is.
 */
export function saveBlueprint(w: World, slot: number, tiles: readonly number[]): string | null {
  const pieces = placed(piecesAt(w, tiles), 0, 0, 0);
  const why = slot in w.blueprints ? blueprintRefusal(pieces) : "There is no such blueprint";
  if (why === null) w.blueprints[slot] = pieces;
  return why;
}

/** Throws away the blueprint in a place. Says whether there was one. */
export function deleteBlueprint(w: World, slot: number): boolean {
  if (!w.blueprints[slot]) return false;
  w.blueprints[slot] = null;
  return true;
}
