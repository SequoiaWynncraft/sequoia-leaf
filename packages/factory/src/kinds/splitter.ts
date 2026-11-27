/**
 * The splitter: takes things in from behind and splits them between up to three ways out, ahead, left
 * and right, an item each way in turn. A way can be shut, put first (what it carries goes that way
 * whenever the tile there takes it), or turned to take things in, as it does from behind, in turn.
 *
 * Its fields: `shut`, its shut ways, a bit each (1 ahead, 2 left, 4 right); `first`, 1 + the way it
 * puts first, or 0; `ins`, its ways turned in, a bit each as `shut` has them (never a shut way, nor
 * the way put first); `turn`, its next way out (`turn & 3`) and over it, with ways in, its next way
 * in (`turn >> 2`: 0 behind, then 1 + its way out turned in).
 */
import type { KeptPiece } from "../cells.ts";
import type { Kept, Piece } from "../pieces.ts";
import type { Open } from "../tables.ts";
import type { Wire, Yard } from "../yard.ts";
import { gradeKept, tintKept, upTo } from "./kept.ts";
import { kind, type Unchecked } from "./kind.ts";
import type { Kit } from "./kit.ts";
import { anything, carrierCondition, carrierWords, crossed, empty, lay } from "./line.ts";

/** The sides it takes things in by besides behind, a bit each as `sides` has them: its ways in. */
function sidesIn(k: Kit, y: Yard, i: number): number {
  const ins = y.ins[i] ?? 0;
  const d = y.dir[i] ?? 0;
  let sides = 0;
  for (let way = 0; way < 3; way++) if ((ins >> way) & 1) sides |= 1 << ((d + (k.WAY_TURN[way] ?? 0)) & 3);
  return sides;
}

const sides = (k: Kit, y: Yard, i: number): number => (1 << (((y.dir[i] ?? 0) + 2) & 3)) | sidesIn(k, y, i);

/** A way in on each side, by how far round from ahead it is in quarter turns right: 1 ahead, 3 right, 0 behind, 2 left. */
const SLOT_ON = [1, 3, 0, 2] as const;
const slot = (y: Yard, i: number, side: number): number => SLOT_ON[(side - (y.dir[i] ?? 0)) & 3] ?? 0;

/** The tile its way in `s` takes from: behind, or a way out turned in; -1 for a way that takes nothing in. */
function from(k: Kit, y: Yard, i: number, s: number): number {
  if (s === 0) return k.wayIn(y, i, 0);
  const way = s - 1;
  return ((y.ins[i] ?? 0) >> way) & 1 ? k.toward(y.land, i, (y.dir[i] ?? 0) + (k.WAY_TURN[way] ?? 0)) : -1;
}

/** Room for a thing from its side `side`: nothing on it, and with ways in, that way's turn; one that takes in from behind alone takes whatever comes. */
const room = (k: Kit, y: Yard, i: number, _n: number, side: number): boolean =>
  empty(k, y, i) && ((y.ins[i] ?? 0) === 0 || k.onTurn(k, y, i, slot(y, i, side), 4, (y.turn[i] ?? 0) >> 2, from));

/** Takes a thing in; with ways in, the turn goes to the next way in. */
function give(k: Kit, y: Yard, i: number, n: number, side: number, over: number): void {
  if ((y.ins[i] ?? 0) !== 0) y.turn[i] = (((slot(y, i, side) + 1) % 4) << 2) | ((y.turn[i] ?? 0) & 3);
  lay(k, y, i, n, side, over);
}

/**
 * Sends what it carries, once it has crossed the tile, to its ways out in turn: ahead, left, right,
 * from the way after the last. One with a way put first sends it that way whenever the tile there
 * takes it, and only otherwise to the others in turn. Refused every way, it waits, unless one of the
 * tiles it sends to takes turns.
 */
function hands(k: Kit, y: Yard, i: number, wire: Wire): void {
  if (!crossed(k, y, i)) return;
  const first = (y.first[i] ?? 0) - 1;
  if (first >= 0 && k.passWay(y, i, first, wire)) return;
  // Its next way out is under its next way in (`room`).
  const turn = (y.turn[i] ?? 0) & 3;
  for (let w = 0; w < 3; w++) {
    const way = (w + turn) % 3;
    if (way === first || !k.passWay(y, i, way, wire)) continue;
    y.turn[i] = ((y.turn[i] ?? 0) & ~3) | ((way + 1) % 3);
    return;
  }
  for (let way = 0; way < 3; way++) if (k.takesTurns(y, k.wayOut(y, i, way))) return;
  wire.waiting[i] = 1;
}

/** Whether it has something that has crossed it for `to`, one of its ways out. */
const ready = (k: Kit, y: Yard, i: number, to: number): boolean =>
  crossed(k, y, i) && (k.wayOut(y, i, 0) === to || k.wayOut(y, i, 1) === to || k.wayOut(y, i, 2) === to);

/**
 * Shuts or opens one of its ways out. Shutting the way it puts first puts none first. A way it took
 * things in by takes nothing in, opened or shut.
 */
function shutWay(k: Kit, y: Yard, i: number, w: number, open: boolean): void {
  const was = y.shut[i] ?? 0;
  const shut = open ? was & ~(1 << w) : was | (1 << w);
  k.insTo(y, i, (y.ins[i] ?? 0) & ~(1 << w));
  if (was === shut) return;
  y.shut[i] = shut;
  if (!open && y.first[i] === w + 1) y.first[i] = 0;
  k.changed(y);
}

/** Puts one of its open ways first, or with null none. Who hands to whom is the same, so the plumbing stands. */
function putFirst(_k: Kit, y: Yard, i: number, w: number | null): string | null {
  if (w !== null && ((y.shut[i] ?? 0) >> w) & 1) return "That way is shut";
  if (w !== null && ((y.ins[i] ?? 0) >> w) & 1) return "That way takes things in";
  y.first[i] = w === null ? 0 : w + 1;
  return null;
}

/** Turns one of its ways out to take things in, or back to sending them out: a way turned in is neither shut nor put first. */
function turnIn(k: Kit, y: Yard, i: number, w: number, on: boolean): void {
  const bit = 1 << w;
  if (on) {
    y.shut[i] = (y.shut[i] ?? 0) & ~bit;
    if (y.first[i] === w + 1) y.first[i] = 0;
  }
  k.insTo(y, i, on ? (y.ins[i] ?? 0) | bit : (y.ins[i] ?? 0) & ~bit);
}

const isWay = (v: unknown): v is number => v === 0 || v === 1 || v === 2;
/** Whether a way is one of the ways `shut` holds, a bit each. */
const shutAt = (shut: number, w: number): boolean => ((shut >> w) & 1) === 1;

/** What it keeps: its colour, its shut ways, its ways in (none shut) and the way it puts first (none shut or in), and its grade. */
function keeps(k: Kit, _kind: number, v: Unchecked): Kept {
  const shut = upTo(v.shut, 7) ? v.shut : 0;
  const ins = upTo(v.ins, 7) ? v.ins & ~shut : 0;
  return {
    ...tintKept(k, v),
    ...(shut > 0 ? { shut } : {}),
    ...(ins > 0 ? { ins } : {}),
    ...(isWay(v.first) && !shutAt(shut | ins, v.first) ? { first: v.first } : {}),
    ...gradeKept(k, v),
  };
}

/** Sets its ways as kept, as far as the yard may have them: the way put first and the ways in once each is unlocked. */
function waysTo(k: Kit, y: Yard, i: number, kept: Kept): void {
  y.shut[i] = kept.shut ?? 0;
  if (kept.first !== undefined && k.locked(y.open, { first: true }) === null) y.first[i] = kept.first + 1;
  if (kept.ins !== undefined && k.locked(y.open, { ins: true }) === null) y.ins[i] = kept.ins;
}

/** Why a yard may not have one kept so: a way put first and ways in, each its own unlock. */
const locks = (k: Kit, open: Open, p: Piece): string | null =>
  (p.first === undefined ? null : k.locked(open, { first: true })) ??
  (p.ins === undefined ? null : k.locked(open, { ins: true }));

/** A kept splitter's next ways, and its ways as the kind may keep them. */
function onto(k: Kit, y: Yard, i: number, _r: number, o: KeptPiece): void {
  y.turn[i] = k.whole(o.turn, 14) ?? 0;
  waysTo(k, y, i, keeps(k, y.kind[i] ?? k.NONE, { ...k.unpackWays(k.whole(o.ways, 255) ?? 0), recipe: o.recipe }));
}

export const splitter = kind({
  name: "splitter",
  info: {
    name: "Splitter",
    cost: 8,
    draw: 0,
    gives: 0,
    what: "Splits one line into up to three: ahead, left and right, an item each way in turn. A side with no belt, or a full one, is skipped. Each way can be shut on its card. Nothing is lost.",
  },
  graded: true,
  carries: true,
  tint: "alone",
  ways: 3,
  over: ["belt", "joiner"],
  regraded: true,
  rules: {
    sides,
    closed: (_k, y, i) => (y.shut[i] ?? 0) | (y.ins[i] ?? 0),
    wants: anything,
    room,
    give,
    turns: (_k, y, i) => (y.ins[i] ?? 0) !== 0,
    hands,
    ready,
    condition: carrierCondition,
    words: carrierWords,
    set: { way: shutWay, first: putFirst, in: turnIn },
    keeps,
    waysTo,
    locks,
    onto,
  },
});
