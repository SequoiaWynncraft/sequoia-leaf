/**
 * A plan of the whole yard (the research of that name, the tool `whole`, used with Select): a
 * blueprint of every piece in the yard, kept on the tiles each stood on, whatever their number and
 * however much of the land they cover. It adds no place to keep one in.
 *
 * Put back, it goes where it was taken and makes the yard its layout again, as one command, all of
 * it or none (`placeYard`). A piece that stands as the plan has it stays, with what it holds and is
 * doing. Every other piece is taken up, and every piece of the plan not standing is stood, each as
 * the rules price it: taking one up gives back what it cost (one of the pieces to hand goes back to
 * hand), and standing one costs its price (less one to hand while the yard has one). The whole is
 * refused, with nothing changed, for any piece that cannot stand (land the yard does not own, a kind
 * not unlocked) and for Coins short of the net price.
 */
import { whole as said } from "@sequoia-leaf/core";

import { at, costOf, remove, type Spent, worthAt } from "./build.ts";
import { packPieces, type Piece, pieceRefusal, piecesAt, piecesOf, refusals, stand, tilesOf } from "./pieces.ts";
import { locked } from "./tables.ts";
import type { Print, Yard } from "./yard.ts";

/** Every tile of a yard's land. */
const everyTile = (y: Yard): number[] => Array.from({ length: y.kind.length }, (_, i) => i);

/** The parts a piece is told apart by: where and how it stands, and everything a blueprint keeps of it. */
const PARTS = ["kind", "x", "y", "dir", "span", "recipe", "open", "tint", "shut", "first", "ins", "grade"] as const;
/** Whether two pieces are the same as a blueprint keeps them (each part as `keptOf` has it, so a default is none). */
const same = (a: Piece, b: Piece): boolean => PARTS.every((part) => a[part] === b[part]);

/** What putting a plan of the whole yard back would do to the yard as it stands. */
export interface YardPlan {
  /** The pieces taken up: every piece that does not stand as the plan has it. */
  readonly up: readonly Piece[];
  /** The tiles they stand on, both mouths of a tunnel. */
  readonly tiles: readonly number[];
  /** The plan's pieces that do not stand as it has them, to be stood; and why each cannot, or nothing. */
  readonly stood: readonly Piece[];
  readonly why: readonly (string | null)[];
  /** The Coins it takes: the price of what is stood less what comes back for what is taken up; below nothing, what it gives. */
  readonly price: number;
}

/** What putting a plan of the whole yard back would do: what is taken up, what is stood, why any of it cannot be, and the net price. */
export function yardPlan(y: Yard, print: Print): YardPlan {
  const plan = piecesOf(print.pieces);
  const now = piecesAt(y, everyTile(y));
  const standing = new Map(now.map((p) => [at(y, p.x, p.y), p]));
  const stays = new Set<number>();
  const stood: Piece[] = [];
  for (const p of plan) {
    const i = at(y, p.x, p.y);
    const there = standing.get(i);
    if (i >= 0 && there && same(there, p) && !stays.has(i)) stays.add(i);
    else stood.push(p);
  }
  const up = now.filter((p) => !stays.has(at(y, p.x, p.y)));
  const tiles = tilesOf(y, up);
  // As every piece would be priced in turn: what is taken up first, its pieces to hand back in hand.
  const spare = Uint8Array.from(y.spare);
  let price = 0;
  for (const p of up) {
    const i = at(y, p.x, p.y);
    price -= worthAt(y, i);
    if (y.free[i] === 1) spare[p.kind] = (spare[p.kind] ?? 0) + 1;
  }
  for (const p of stood) {
    price += costOf(y, p.kind, p.grade, spare, p.span);
    if ((spare[p.kind] ?? 0) > 0) spare[p.kind] = (spare[p.kind] ?? 0) - 1;
  }
  return { up, tiles, stood, why: refusals(y, stood, tiles), price };
}

/** Why a plan of the whole yard cannot be put back with `coins` to spend, or nothing if it can. */
export function yardRefusal(y: Yard, plan: YardPlan, coins: number): string | null {
  const lock = locked(y.open, { use: "whole" });
  if (lock !== null) return lock;
  const why = plan.why.find((r) => r !== null);
  if (why !== undefined) return why;
  if (plan.up.length === 0 && plan.stood.length === 0) return "The yard already stands as this plan has it";
  const short = plan.price - coins;
  return short > 0 ? `Not enough Coins: ${said(short)} short` : null;
}

/** Puts a plan of the whole yard back with `coins` to spend, all of it or none, and says what it cost: below nothing, what it gave back. */
export function placeYard(y: Yard, print: Print, coins: number): Spent {
  const plan = yardPlan(y, print);
  const why = yardRefusal(y, plan, coins);
  if (why !== null) return { ok: false, why };
  // Everything that can refuse has been asked: what is taken up leaves its tiles bare for what is stood.
  for (const p of plan.up) remove(y, p.x, p.y);
  stand(y, plan.stood, Infinity);
  return { ok: true, cost: plan.price };
}

/** Keeps every piece in the yard as a plan of the whole yard in a place. Says why it cannot be done, or nothing when it is. */
export function saveYard(y: Yard, slot: number): string | null {
  const pieces = piecesAt(y, everyTile(y));
  const why =
    locked(y.open, { use: "whole" }) ??
    locked(y.open, { blueprint: slot }) ??
    (pieces.length === 0 ? "There is nothing here to save" : null) ??
    pieces.map((p) => pieceRefusal(y.open, p)).find((r) => r !== null) ??
    null;
  if (why === null) y.blueprints[slot] = { pieces: packPieces(pieces), whole: true };
  return why;
}
