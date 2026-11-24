/**
 * Keeping a yard, and reading it back. The yard is written as a small JSON record of its numbers,
 * goals and orders, with its pieces packed into bytes (`cells`, base64) and each of its
 * blueprints the same (`packPrint`). Reading is by shape first: a record of the wrong shape or
 * version is refused whole, and nothing else is. Inside a good one, every piece is built again through
 * the rules (`vouch`), and anything that depends on today's tuning (how much a piece holds, how far a
 * tunnel goes, which goals, plots and grades open when) is clamped or carried, never a reason to
 * refuse the yard; nothing a player has is lost. Goals done, plots owned, orders on the board,
 * blueprints and line colours are carried as kept. A piece that cannot stand at the grade it was kept
 * at stands at the highest grade the yard may build of its kind, and one that cannot stand at all
 * (land it is not on, ground it cannot work, a kind not opened) is paid back into the till at today's
 * price for the grade it was kept at; one of the pieces to hand goes back to hand. What a machine is
 * told to make, and the way a splitter puts first, are kept only where the yard may set them.
 *
 * The pieces' bytes are how many pieces there are (varint), then each piece in tile order: the tiles
 * since the last piece less one (varint); a byte of its kind (low four bits), its way (two bits),
 * whether it carries something (64) and whether more parts follow (128); if it carries, the thing
 * (byte) and its progress in eighths with the side it came in from (a byte, four bits each); if more
 * follow, which (varint, a bit each), then those:
 *   2 what it holds: how many kinds (varint), then a thing (byte) and how many (varint) each
 *   4 out (byte)   8 work (varint)   16 making (byte)   32 turn (byte)   64 what it is set to (byte)
 *   128 span (byte, +8), and for a way-in mouth a thing (byte) and its progress (byte) for each tile under
 *   256 a shut crate   512 fuel (byte)   1024 one of the pieces to hand   2048 tint (byte)
 *   4096 a splitter's ways (byte: its shut ways, the way it puts first and its ways in, `packWays`), or a
 *        sorter's right side (the same byte, as the way it puts first)   8192 a grade above 1 (byte)
 *
 * Bytes that are not pieces are refused whole: bytes cut short or left over, a part this version
 * does not know, more pieces than the land has tiles, and counts no yard could have (more than 255
 * kinds of thing held, more than a million of one). What today's tables allow is no part of the
 * shape: a thing they do not have is let go, more of one than a piece holds is clamped as it is put
 * back, and a tunnel longer than tunnels go is a piece that cannot stand. *
 * A yard kept by the Works' first design (version 3, its pieces a list) is brought over as far as is
 * cheap (`fromFirst`): it is a new yard at the tier its story had reached. One kept by version 6
 * reads as this version's, but for the grades it did not keep (`UNGRADED`).
 */
import { build, isDir, keeps, plotState, refusal } from "./build.ts";
import { fromBase64, Reader, toBase64, Writer } from "./bytes.ts";
import { here } from "./clock.ts";
import { FUEL, STUDY_HOLDS, TICKS } from "./content/machines.ts";
import { NODES } from "./content/nodes.ts";
import { LAND, type Land } from "./land.ts";
import { counting, fillBoard, giveGoal, ORDER_WAITS, queue, study } from "./orders.ts";
import { keptOf, packPieces, packWays, type Piece, piecesOf, placed, unpackWays, waysOn, waysTo } from "./pieces.ts";
import {
  ALL_GOALS,
  ALL_ITEMS,
  BELT,
  BLUEPRINTS_MOST,
  BOILER,
  CRATE,
  DEADFALL,
  DEPOT,
  GATHERER,
  type Goal,
  goalNamed,
  GOALS,
  highest,
  holdsMost,
  isFolio,
  isGoal,
  isItem,
  isKind,
  isMaker,
  isNode,
  isRaw,
  type Item,
  itemName,
  itemNamed,
  JOINER,
  kindNamed,
  locked,
  MILLI,
  nextHand,
  NONE,
  PACE,
  plotName,
  plotNamed,
  price,
  ready,
  RECIPE,
  SORTER,
  SPAN_MOST,
  SPLITTER,
  STUDY,
  TINTS,
  TUNNEL,
  WORK,
} from "./tables.ts";
import { carries } from "./wire.ts";
import {
  type Away,
  type Counts,
  counts,
  emptyYard,
  enough,
  held,
  hold,
  holderOf,
  put,
  reopen,
  type Standing,
  tunnelOf,
  type Yard,
} from "./yard.ts";

/** 7: whole numbers, grades (a splitter's, a joiner's and a sorter's too), goals and research. */
export const VERSION = 7;
/**
 * The version before splitters, joiners and sorters had grades, which it kept with none. It still
 * reads: each it kept in the yard stands at the highest grade the yard may build of its kind, for
 * nothing, so that no line goes slower than it went; one kept in a blueprint, at the highest grade
 * of the belts and tunnels in that blueprint (`regraded`).
 */
const UNGRADED = 6;
/** The kinds `UNGRADED` kept with no grade. */
const REGRADED: ReadonlySet<number> = new Set([SPLITTER, JOINER, SORTER]);
/**
 * The grade of a piece kept: as it says, or where it says none, the first; but a splitter, joiner or
 * sorter that `UNGRADED` kept (`ungraded`) goes at `top`.
 */
const regraded = (k: number, grade: number | undefined, ungraded: boolean, top: () => number): number =>
  grade ?? (ungraded && REGRADED.has(k) ? top() : 1);

/** The parts a piece's bytes may say follow, a bit each. */
const PARTS = 0x3ffe;
/** The most kinds of thing, and of one thing, a piece's bytes may say it holds: past these the bytes are no yard's. */
const KINDS_MOST = 255;
const MANY_MOST = 1_000_000;
/** A goal's id, as kept. */
const goalId = (g: Goal): string => GOALS[g]?.id ?? "";

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

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);
const whole = (v: unknown, most: number): number | null =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= most ? v : null;
const words = (v: unknown): string | null => (typeof v === "string" && v.length <= 200 ? v : null);

/** A count by name, as kept: only real things, only sensible counts, always in the same order. */
export function tally(c: Counts): Record<string, number> {
  const out: Record<string, number> = {};
  for (const n of ALL_ITEMS) {
    const v = c[n] ?? 0;
    if (Number.isFinite(v) && v > 0) out[itemName(n)] = v;
  }
  return out;
}
/** A count by name read back. */
export function untally(v: unknown, most: number): Counts {
  const out = counts();
  if (!isRec(v)) return out;
  for (const n of ALL_ITEMS) {
    const got = whole(v[itemName(n)], most);
    if (got !== null && got > 0) out[n] = got;
  }
  return out;
}

// ---------- writing ----------

/** The yard's pieces as bytes. */
function packCells(y: Yard): Uint8Array {
  const o = new Writer();
  const h = y.holders;
  const t = y.tunnels;
  let pieces = 0;
  for (const k of y.kind) if (k !== NONE && k !== DEPOT) pieces++;
  o.varint(pieces);
  let last = -1;
  for (let i = 0; i < y.kind.length; i++) {
    const k = y.kind[i] ?? NONE;
    if (k === NONE || k === DEPOT) continue;
    o.varint(i - last - 1);
    last = i;
    const r = holderOf(y, i);
    const holder = r >= 0;
    const span = y.span[i] ?? 0;
    let f = 0;
    if (holder && (h.count[r] ?? 0) > 0) f |= 2;
    if (holder && h.out[r] !== NONE) f |= 4;
    if (holder && h.work[r] !== 0) f |= 8;
    if (holder && h.making[r] !== NONE) f |= 16;
    if (y.turn[i] !== 0) f |= 32;
    if (y.set[i] !== NONE) f |= 64;
    if (span !== 0) f |= 128;
    if (k === CRATE && holder && h.open[r] === 0) f |= 256;
    if (holder && h.fuel[r] !== 0) f |= 512;
    if (y.free[i] === 1) f |= 1024;
    if (y.tint[i] !== 0) f |= 2048;
    if (waysOn(y, i) !== 0) f |= 4096;
    if ((y.grade[i] ?? 0) > 1) f |= 8192;
    const carrying = y.item[i] !== NONE;
    o.byte(k | ((y.dir[i] ?? 0) << 4) | (carrying ? 64 : 0) | (f === 0 ? 0 : 128));
    if (carrying) {
      o.byte(y.item[i] ?? NONE);
      o.byte((y.prog[i] ?? 0) | ((y.via[i] ?? 0) << 4));
    }
    if (f !== 0) o.varint(f);
    if (f & 2) {
      const kinds = ALL_ITEMS.filter((n) => held(h, r, n) > 0);
      o.varint(kinds.length);
      for (const n of kinds) {
        o.byte(n);
        o.varint(held(h, r, n));
      }
    }
    if (f & 4) o.byte(h.out[r] ?? NONE);
    if (f & 8) o.varint(h.work[r] ?? 0);
    if (f & 16) o.byte(h.making[r] ?? NONE);
    if (f & 32) o.byte(y.turn[i] ?? 0);
    if (f & 64) o.byte(y.set[i] ?? NONE);
    if (f & 128) {
      o.byte(span + 8);
      const tr = tunnelOf(y, i) * SPAN_MOST;
      for (let s = 0; s < span; s++) {
        o.byte(t.under[tr + s] ?? NONE);
        o.byte(t.along[tr + s] ?? 0);
      }
    }
    if (f & 512) o.byte(h.fuel[r] ?? 0);
    if (f & 2048) o.byte(y.tint[i] ?? 0);
    if (f & 4096) o.byte(waysOn(y, i));
    if (f & 8192) o.byte(y.grade[i] ?? 1);
  }
  return o.bytes();
}

/**
 * A blueprint as kept: each piece in its order, as its kind, x and y (a byte each), then its way
 * with a bit for each part that follows (4 span, 8 tint, 16 a splitter's ways, 32 a shut crate,
 * 64 recipe, 128 a grade above 1), then those, a byte each.
 */
function packPrint(b: Uint8Array): Uint8Array {
  const o = new Writer();
  for (const p of piecesOf(b)) {
    o.byte(p.kind);
    o.byte(p.x);
    o.byte(p.y);
    const { span, tint = 0, recipe, grade = 1 } = p;
    const ways = packWays(p.shut ?? 0, (p.first ?? -1) + 1, p.ins ?? 0);
    o.byte(
      p.dir |
        (span > 0 ? 4 : 0) |
        (tint > 0 ? 8 : 0) |
        (ways > 0 ? 16 : 0) |
        (p.open === false ? 32 : 0) |
        (recipe === undefined ? 0 : 64) |
        (grade > 1 ? 128 : 0),
    );
    if (span > 0) o.byte(span);
    if (tint > 0) o.byte(tint);
    if (ways > 0) o.byte(ways);
    if (recipe !== undefined) o.byte(recipe);
    if (grade > 1) o.byte(grade);
  }
  return o.bytes();
}

/** A blueprint's pieces as kept, before they are vouched for: every part a plain number. */
export type KeptPrint = readonly {
  readonly kind: number;
  readonly x: number;
  readonly y: number;
  readonly dir: number;
  readonly span: number;
  readonly recipe: number;
  readonly open: boolean;
  readonly tint: number;
  readonly ways: number;
  /** Its grade, where it is kept: above the first. */
  readonly grade?: number;
}[];

/** A kept blueprint's pieces read back from their bytes, or null for bytes that are not pieces. */
function unpackPrint(bytes: Uint8Array | null): KeptPrint | null {
  if (!bytes) return null;
  const r = new Reader(bytes);
  const out: KeptPrint[number][] = [];
  while (!r.done) {
    const kind = r.byte();
    const x = r.byte();
    const y = r.byte();
    const f = r.byte();
    const span = f & 4 ? r.byte() : 0;
    const tint = f & 8 ? r.byte() : 0;
    const ways = f & 16 ? r.byte() : 0;
    const recipe = f & 64 ? r.byte() : NONE;
    const grade = f & 128 ? r.byte() : undefined;
    if (r.over) return null;
    out.push({
      kind,
      x,
      y,
      dir: f & 3,
      span,
      recipe,
      open: (f & 32) === 0,
      tint,
      ways,
      ...(grade === undefined ? {} : { grade }),
    });
  }
  return out;
}

export interface Keep {
  /** Whether to keep the seed: never in what the page is shown. */
  readonly seed?: boolean;
  /** What the yard did while its owner was away, for the page's letter. */
  readonly away?: Away | null;
}

/** A yard as text: its numbers and orders as JSON, its pieces and blueprints packed. */
export function encode(y: Yard, keep: Keep = {}): string {
  const away = keep.away === undefined ? y.away : keep.away;
  return JSON.stringify({
    v: VERSION,
    ...(y.seed === null || keep.seed === false ? {} : { seed: y.seed }),
    tick: y.tick,
    charge: y.charge,
    at: y.at,
    till: y.till,
    bank: y.bank,
    told: y.told,
    ...(away === null ? {} : { away: { seconds: away.seconds, coins: away.coins, made: tally(away.made) } }),
    seen: { tick: y.seen.tick, till: y.seen.till, depot: tally(y.seen.depot) },
    plots: y.plots.map(plotName),
    done: y.done.map(goalId),
    hand: y.hand === -1 ? null : goalId(y.hand),
    ...(y.queue.length > 0 ? { queue: y.queue.map(goalId) } : {}),
    line: y.line.map(goalId),
    got: Object.fromEntries(y.got.flatMap((got, g) => (got && isGoal(g) ? [[goalId(g), tally(got)]] : []))),
    board: y.board.map(keptOrder),
    serial: y.serial,
    handed: y.handed,
    swapAt: y.swapAt,
    depot: tally(y.depot),
    sold: y.sold,
    paid: y.paid,
    cells: toBase64(packCells(y)),
    ...(y.blueprints.some((b) => b !== null)
      ? { blueprints: y.blueprints.map((b) => b && toBase64(packPrint(b))) }
      : {}),
  });
}

// ---------- reading ----------

/** The pieces read back from their bytes, or null for bytes that are not pieces. */
function unpackCells(bytes: Uint8Array, tiles: number): KeptPiece[] | null {
  const r = new Reader(bytes);
  const out: KeptPiece[] = [];
  const pieces = r.varint();
  if (r.over || pieces > tiles) return null;
  let tile = -1;
  for (let n = 0; n < pieces; n++) {
    tile += r.varint() + 1;
    const kd = r.byte();
    if (r.over || tile >= tiles) return null;
    const p: { -readonly [K in keyof KeptPiece]: KeptPiece[K] } = { tile, kind: kd & 15, dir: (kd >> 4) & 3 };
    if (kd & 64) {
      p.item = r.byte();
      const pv = r.byte();
      p.prog = pv & 15;
      p.via = pv >> 4;
    }
    const f = kd & 128 ? r.varint() : 0;
    if (f > PARTS || (f & ~PARTS) !== 0) return null;
    if (f & 2) {
      const kinds = r.varint();
      if (kinds > KINDS_MOST) return null;
      const pairs: [number, number][] = [];
      for (let k = 0; k < kinds; k++) {
        const thing = r.byte();
        const many = r.varint();
        if (many > MANY_MOST) return null;
        pairs.push([thing, many]);
      }
      p.held = pairs;
    }
    if (f & 4) p.out = r.byte();
    if (f & 8) p.work = r.varint();
    if (f & 16) p.making = r.byte();
    if (f & 32) p.turn = r.byte();
    if (f & 64) p.recipe = r.byte();
    if (f & 128) {
      p.span = r.byte() - 8;
      const under: number[] = [];
      const along: number[] = [];
      for (let s = 0; s < p.span; s++) {
        under.push(r.byte());
        along.push(r.byte());
      }
      p.under = under;
      p.along = along;
    }
    if (f & 256) p.closed = true;
    if (f & 512) p.fuel = r.byte();
    if (f & 1024) p.free = true;
    if (f & 2048) p.tint = r.byte();
    if (f & 4096) p.ways = r.byte();
    if (f & 8192) p.grade = r.byte();
    if (r.over) return null;
    out.push(p);
  }
  return r.done ? out : null;
}

/**
 * Stands each kept piece again through the rules, as play would build it, and gives it the parts it
 * was kept with: everything but the far mouths of tunnels, which come with their near mouths. A
 * splitter, joiner or sorter kept with no grade by a version that gave them none (`ungraded`) stands
 * at the highest grade the yard may build of its kind. One that cannot stand at the grade it was kept
 * at stands at the highest the yard may build, if it can there. Gives back what is owed for the rest,
 * in thousandths of a Coin: the difference for each piece stood at a lower grade, and for each that
 * could not stand at all, today's price at the grade it was kept at (but for one of the pieces to
 * hand, which goes back to hand).
 */
function stand(y: Yard, pieces: readonly KeptPiece[], studied: Goal | undefined, ungraded: boolean): number {
  const kept: [number, KeptPiece][] = [];
  const far: KeptPiece[] = [];
  let owed = 0;
  const { land } = y;
  const tiles = land.w * land.h;
  const paidFor = (o: KeptPiece): number =>
    o.free === true || !isKind(o.kind) ? 0 : price(o.kind, Math.max(1, o.grade ?? 1)) * MILLI;
  for (const o of pieces) {
    const i = whole(o.tile, tiles - 1);
    const k = o.kind;
    const d = o.dir;
    if (i === null || !isKind(k) || !isDir(d)) {
      owed += paidFor(o);
      continue;
    }
    const span = o.span ?? 0;
    if (k === TUNNEL && span < 0) {
      far.push(o);
      continue;
    }
    const x = i % land.w;
    const z = (i - x) / land.w;
    const kept1 = regraded(k, o.grade, ungraded, () => highest(y.open, k));
    const may = (grade: number): boolean =>
      y.kind[i] === NONE && refusal(y, k, x, z, Infinity, d, k === TUNNEL ? { span, grade } : { grade }) === null;
    const top = Math.min(kept1, Math.max(1, highest(y.open, k)));
    const grade = may(kept1) ? kept1 : top < kept1 && may(top) ? top : null;
    if (grade === null) {
      owed += paidFor(o);
      continue;
    }
    // Only a piece kept as one the yard had to hand takes the place of one: the rest were paid for.
    const spare = y.spare[k] ?? 0;
    if (o.free !== true) y.spare[k] = 0;
    const did = build(y, k, x, z, d, Infinity, k === TUNNEL ? { span, grade } : { grade });
    if (o.free !== true) y.spare[k] = spare;
    if (!did.ok) {
      owed += paidFor(o);
      continue;
    }
    kept.push([i, o]);
    // Stood lower than it was kept at: the difference, as today's prices have it.
    if (grade < kept1 && o.free !== true) owed += (price(k, kept1) - price(k, grade)) * MILLI;
  }
  for (const o of far) {
    const i = whole(o.tile, tiles - 1);
    if (i !== null && y.kind[i] === TUNNEL && (y.span[i] ?? 0) < 0 && y.span[i] === o.span && y.dir[i] === o.dir)
      kept.push([i, o]);
  }
  for (const [i, o] of kept) unpack(y, i, o, studied);
  return owed;
}

/** The version of the yards the Works' first design kept. */
const FIRST = 3;
/** How many of the first design's twenty story orders a yard had filled to begin a tier: tier 1 from 4, tier 2 from 10. */
const FIRST_TIERS = [4, 10] as const;

/**
 * A yard the first design kept, brought over: what is cheap to bring, and the rest let go. It is a
 * new yard with every goal below a tier done, the tier its story had reached (2 at most, so that
 * the Study and research are still to come). The plots it owned that the tier sells are its own
 * again; its pieces stand where they stood, as far as the tier lets them (not a kind it has not
 * opened, nor on a plot it does not own), and each project of its tier that opens a kind it had
 * standing is done. A plot or a piece that cannot be its own yet is paid back
 * into the till, at what it would cost again, beside what the till held. What it was paid, what the
 * depot sold for it and how many side orders it handed over stay its totals, so its place on the
 * board holds, and it counts its Coins entries on from where it was. What its pieces held, its
 * orders and its blueprints are let go; its Coins were never in it, and are its owner's as they were.
 */
function fromFirst(raw: Rec, land: Land): Yard | null {
  const story = whole(raw.story, 1000);
  const paid = typeof raw.paid === "number" && Number.isFinite(raw.paid) && raw.paid >= 0 ? raw.paid : null;
  const sold = typeof raw.sold === "number" && Number.isFinite(raw.sold) && raw.sold >= 0 ? raw.sold : null;
  if (story === null || paid === null || sold === null || !Array.isArray(raw.plots)) return null;
  const y = emptyYard(land, FIRST_TIERS.filter((from) => story >= from).length);
  y.seed = (whole(raw.seed, 2 ** 32 - 1) ?? 1) >>> 0;
  y.at = whole(raw.at, Number.MAX_SAFE_INTEGER) ?? 0;
  y.paid = Math.round(paid * MILLI);
  y.sold = Math.round(sold * MILLI);
  y.handed = whole(raw.done, 1e9) ?? 0;
  // Each Coins entry the yard makes is named by this count: begun again, it would name entries that are already in the ledger.
  const bank = whole(raw.bank, Number.MAX_SAFE_INTEGER);
  if (bank === null) return null;
  y.bank = bank;
  // What its till held, not yet paid in, is still its own.
  const till = typeof raw.till === "number" && Number.isFinite(raw.till) && raw.till >= 0 ? raw.till : 0;
  y.till = Math.floor(till * MILLI);
  for (const name of raw.plots) {
    const p = typeof name === "string" ? plotNamed(name) : null;
    if (p === null || y.plots.includes(p)) continue;
    if (plotState(y, p).state === "for sale") y.plots.push(p);
    // A plot the tier does not sell yet is paid back, in the till, at what it would cost again.
    else y.till += (land.plots.find((q) => q.plot === p)?.price ?? 0) * MILLI;
  }
  const cells: unknown[] = Array.isArray(raw.cells) ? raw.cells : [];
  const pieces = cells.map(firstPiece).filter((o) => o !== null);
  // A project of its tier that opens a kind it had standing is done, so that what it had still
  // stands (its boilers, its tunnels, its waterwheels); the commission and research are still to do.
  const had = new Set(pieces.map((o) => o.kind));
  for (let more = true; more;) {
    more = false;
    for (const g of ALL_GOALS) {
      const node = NODES[g];
      if (node?.kind !== "project" || node.tier !== y.open.tier || y.done.includes(g) || !ready(y.open, g)) continue;
      if (!(GOALS[g]?.unlocks.kinds ?? []).some((name) => had.has(kindNamed(name) ?? NONE))) continue;
      y.done.push(g);
      reopen(y);
      more = true;
    }
  }
  y.told = y.done.length;
  if (y.hand !== -1 && y.done.includes(y.hand)) hold(y, nextHand(y.open));
  // Its pieces where they stood, as far as the tier lets them stand; each that cannot is paid back.
  y.till += stand(y, pieces, undefined, true);
  // What the till holds was not earned while away.
  y.seen = here(y);
  fillBoard(y);
  return y;
}

/**
 * A piece as the first design kept it (`{ i, k, d }` and the parts not as new), as this design keeps
 * one: how it stands and what it is set to (its way, a tunnel's span, its recipe, a crate shut, its
 * line's colour, its shut ways, one of those to hand), not what it held or was doing.
 */
function firstPiece(v: unknown): KeptPiece | null {
  if (!isRec(v) || typeof v.k !== "string") return null;
  const kind = kindNamed(v.k);
  const tile = whole(v.i, 1e6);
  const dir = whole(v.d, 3);
  if (kind === null || kind === DEPOT || tile === null || dir === null) return null;
  const span = typeof v.s === "number" && Number.isInteger(v.s) ? v.s : 0;
  const recipe = typeof v.r === "string" ? itemNamed(v.r) : null;
  const tint = whole(v.h, 255) ?? 0;
  const ways = whole(v.x, 255) ?? 0;
  return {
    tile,
    kind,
    dir,
    ...(span === 0 ? {} : { span }),
    ...(recipe === null ? {} : { recipe }),
    ...(v.c === 1 ? { closed: true } : {}),
    ...(v.g === 1 ? { free: true } : {}),
    ...(tint === 0 ? {} : { tint }),
    ...(ways === 0 ? {} : { ways }),
  };
}

/** A yard read back from text, on the guild's land unless another is given; nothing if the text is not a yard. */
export function decode(text: string | null | undefined, land: Land = LAND): Yard | null {
  if (!text) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (isRec(raw) && raw.v === FIRST && Array.isArray(raw.cells)) return fromFirst(raw, land);
  if (!isRec(raw) || (raw.v !== VERSION && raw.v !== UNGRADED) || typeof raw.cells !== "string") return null;
  const bytes = fromBase64(raw.cells);
  const pieces = bytes && unpackCells(bytes, land.w * land.h);
  if (!pieces) return null;
  const prints: unknown[] = Array.isArray(raw.blueprints) ? raw.blueprints : [];
  return vouch(
    raw,
    pieces,
    prints.map((b) => (typeof b === "string" ? unpackPrint(fromBase64(b)) : null)),
    land,
  );
}

/**
 * A kept blueprint read back as it was kept: its pieces, each of a real kind and way, or nothing.
 * Whether the yard may set it down now is the rules' to say when it does. A splitter, joiner or
 * sorter kept in it with no grade by a version that gave them none (`ungraded`) is at the highest
 * grade of the belts and tunnels it is kept with.
 */
function blueprint(v: KeptPrint | null | undefined, ungraded: boolean): Uint8Array | null {
  if (!v) return null;
  const line = (): number =>
    Math.max(1, ...v.flatMap((p) => (p.kind === BELT || p.kind === TUNNEL ? [p.grade ?? 1] : [])));
  const pieces: Piece[] = [];
  for (const { kind: k, x, y: z, dir: d, span, recipe, open: lets, tint, ways, grade: kept } of v) {
    const grade = regraded(k, kept, ungraded, line);
    if (!isKind(k) || k === DEPOT || !isDir(d)) return null;
    if (whole(x, 255) === null || whole(z, 255) === null || whole(span, 255) === null) return null;
    pieces.push({
      kind: k,
      x,
      y: z,
      dir: d,
      span,
      ...keptOf({ recipe, open: lets ? undefined : false, tint, ...unpackWays(ways), grade }, k),
    });
  }
  return pieces.length > 0 ? packPieces(placed(pieces, 0, 0, 0)) : null;
}

/** A standing order as it is kept, and as Leaf's answer to a batch carries it: what it wants and has had, by name. */
export interface KeptOrder extends Omit<Standing, "want" | "filled"> {
  readonly want: Readonly<Record<string, number>>;
  readonly filled: Readonly<Record<string, number>>;
}
export const keptOrder = (o: Standing): KeptOrder => ({ ...o, want: tally(o.want), filled: tally(o.filled) });

/** A standing order read back from what `keptOrder` gives, every field checked, holding no more than it wants; or nothing. */
export function orderOf(v: unknown): Standing | null {
  if (!isRec(v)) return null;
  const id = whole(v.id, 1e9);
  const title = words(v.title);
  const from = words(v.from);
  const line = words(v.line);
  const pay = whole(v.pay, 1e8);
  const want = untally(v.want, 1e6);
  const starts = whole(v.starts, 1e13);
  const asked = ALL_ITEMS.filter((n) => (want[n] ?? 0) > 0).length;
  if (id === null || title === null || from === null || line === null || pay === null || starts === null) return null;
  if (asked < 1) return null;
  const filled = untally(v.filled, 1e6);
  for (const n of ALL_ITEMS) filled[n] = Math.min(filled[n] ?? 0, want[n] ?? 0);
  return { id, title, from, line, want, pay, filled, starts };
}

/**
 * A kept standing order at a tick: hung no later than an order hung then would count, and holding
 * nothing before it counts. Orders are hung at the end of the board with the next id, so its id is
 * past `after`, the id of the order before it, and below `serial`, the count of orders ever hung.
 */
function standing(v: unknown, tick: number, after: number, serial: number): Standing | null {
  const order = orderOf(v);
  if (!order || order.id <= after || order.id >= serial || order.starts > tick + ORDER_WAITS) return null;
  if (!counting(order, tick)) order.filled.fill(0);
  return order;
}

function keptAway(v: unknown): Away | null {
  if (!isRec(v)) return null;
  const seconds = whole(v.seconds, 1e9);
  const coins = whole(v.coins, 1e12);
  return seconds === null || coins === null ? null : { seconds, coins, made: untally(v.made, 1e12) };
}

/** How many of a thing the piece on a tile may hold: a machine, as many as it keeps for what it may make (`keeps`). */
function mostHeld(y: Yard, i: number, n: number): number {
  const k = y.kind[i] ?? NONE;
  if (isMaker(k)) return holdsMost(keeps(y, i), n);
  if (k === BOILER) return n === DEADFALL ? FUEL : 0;
  if (k === STUDY) return isFolio(n) ? STUDY_HOLDS : 0;
  return k === CRATE ? 1e6 : 0;
}

/**
 * What a piece's work toward what it is making stays below: what that takes; with nothing being made,
 * what a tick at the top pace can leave over once a thing is done.
 */
const workFor = (k: number, making: number): number =>
  k === GATHERER
    ? WORK.gather
    : making === NONE
      ? Math.max(...PACE)
      : k === STUDY
        ? WORK.study
        : (RECIPE[making]?.work ?? 0);

/**
 * Puts a kept piece's parts back onto the piece new-built where it stood, each only as the rules let
 * it be: a colour where the yard may paint; a machine told to make, holding, making and having made
 * only what it may make (`locked`), and no more than it keeps; a Study at work on a folio it holds for
 * `studied`, the research its work was for; work only toward what is being made (`workFor`).
 */
function unpack(y: Yard, i: number, o: KeptPiece, studied: Goal | undefined): void {
  const k = y.kind[i] ?? NONE;
  const makes = isMaker(k);
  if (carries(k) && o.item !== undefined && isItem(o.item)) {
    y.item[i] = o.item;
    y.prog[i] = whole(o.prog, 16) ?? 0;
    y.via[i] = whole(o.via, 4) ?? 0;
  }
  if (carries(k)) y.tint[i] = whole(o.tint, TINTS) ?? 0;
  const r = holderOf(y, i);
  if (r >= 0) {
    const h = y.holders;
    const may = (n: number | undefined): n is Item =>
      n !== undefined && isItem(n) && RECIPE[n]?.by === k && locked(y.open, { make: n }) === null;
    if (makes && may(o.recipe)) y.set[i] = o.recipe;
    const room = k === CRATE ? y.open.crate : 1e6;
    const has = counts();
    for (const [n, c] of o.held ?? []) if (isItem(n) && (whole(c, 1e6) ?? 0) > 0) has[n] = c;
    for (const n of ALL_ITEMS)
      for (let c = Math.min(Math.floor(has[n] ?? 0), mostHeld(y, i, n)); c > 0 && (h.count[r] ?? 0) < room; c--)
        put(h, r, n);
    h.idle[r] = 0;
    const out = o.out !== undefined && isItem(o.out) ? o.out : null;
    if (out !== null && (k === CRATE || (k === GATHERER && isRaw(out)) || (makes && may(out)))) h.out[r] = out;
    const m = o.making;
    if (makes && m !== undefined && keeps(y, i).some((rec) => rec.out === m && enough(h, r, rec))) h.making[r] = m;
    const wanted = studied !== undefined && m !== undefined && isFolio(m) && (GOALS[studied]?.want[m] ?? 0) > 0;
    if (k === STUDY && wanted && held(h, r, m) > 0) h.making[r] = m;
    if (makes || k === GATHERER || (k === STUDY && studied !== undefined))
      h.work[r] = whole(o.work, workFor(k, h.making[r] ?? NONE) - 1) ?? 0;
    if (k === CRATE) h.open[r] = o.closed === true ? 0 : 1;
    if (k === BOILER) h.fuel[r] = whole(o.fuel, TICKS.burn) ?? 0;
  }
  // A joiner's next way in; a splitter's next way out, and over it its next way in (`tick.ts`).
  if (k === SPLITTER || k === JOINER) y.turn[i] = whole(o.turn, k === SPLITTER ? 14 : 2) ?? 0;
  if (isKind(k)) {
    // What a sorter is set to and its side, kept in the byte a splitter keeps its ways in, and a
    // splitter's ways (`waysTo`). `keptOf` keeps only what the kind may keep.
    const kept = keptOf({ ...unpackWays(whole(o.ways, 255) ?? 0), recipe: o.recipe }, k);
    if (k === SORTER && kept.recipe !== undefined) y.set[i] = kept.recipe;
    waysTo(y, i, k, kept);
  }
  const span = y.span[i] ?? 0;
  const t = tunnelOf(y, i);
  if (t >= 0 && o.under && o.along) {
    const at = t * SPAN_MOST;
    for (let s = 0; s < span; s++) {
      const n = o.under[s] ?? NONE;
      y.tunnels.under[at + s] = isItem(n) ? n : NONE;
      y.tunnels.along[at + s] = whole(o.along[s], 16) ?? 0;
    }
  }
}

/**
 * A yard from a kept record: its numbers as JSON gives them, its pieces, and its blueprints' pieces.
 * Every field's shape is checked, and every piece built again through the rules; what depends on
 * today's tuning is clamped or carried, and what cannot stand is paid back.
 */
export function vouch(
  raw: Rec,
  pieces: readonly KeptPiece[],
  prints: readonly (KeptPrint | null)[],
  land: Land,
): Yard | null {
  const seed = "seed" in raw ? whole(raw.seed, 0xffffffff) : null;
  const charge = whole(raw.charge, 1e9);
  const tick = whole(raw.tick, 1e12);
  const at = whole(raw.at, 8.64e15);
  const till = whole(raw.till, 1e12);
  const bank = whole(raw.bank, 1e12);
  const told = whole(raw.told, 1e9);
  const serial = whole(raw.serial, 1e9);
  const handed = whole(raw.handed, 1e9);
  const swapAt = whole(raw.swapAt, 1e13);
  const sold = whole(raw.sold, 1e15);
  const paid = whole(raw.paid, 1e15);
  if (
    ("seed" in raw && seed === null) ||
    tick === null ||
    charge === null ||
    at === null ||
    till === null ||
    bank === null ||
    told === null ||
    serial === null ||
    handed === null ||
    swapAt === null ||
    sold === null ||
    paid === null ||
    !Array.isArray(raw.plots) ||
    !Array.isArray(raw.done) ||
    !Array.isArray(raw.board) ||
    pieces.length > land.w * land.h
  )
    return null;

  const y = emptyYard(land);
  Object.assign(y, { seed, tick, charge, at, till, bank, away: keptAway(raw.away) });
  Object.assign(y, { serial, handed, swapAt, sold, paid, board: [] });
  y.depot = untally(raw.depot, 1e12);

  // Goals in the order they were done, each that today's tables have.
  for (const id of raw.done) {
    const g = goalNamed(id);
    if (g !== null && !y.done.includes(g)) y.done.push(g);
  }
  reopen(y);
  y.told = Math.min(told, y.done.length);
  for (const o of raw.board) {
    const order = standing(o, tick, y.board.at(-1)?.id ?? -1, serial);
    if (order) y.board.push(order);
  }
  // The node in hand and the line of research, each only if it could be taken up now; then what each
  // goal that could have been given anything was given, given again as play gives it, so that a goal
  // given all it wants is finished.
  y.got = GOALS.map(() => null);
  const hand = goalNamed(raw.hand);
  hold(y, hand !== null && isNode(hand) && ready(y.open, hand) ? hand : nextHand(y.open));
  // The nodes in line after it, each only if it could be put there now; a yard kept before there was a line has none.
  const queued: unknown[] = Array.isArray(raw.queue) ? raw.queue : [];
  for (const id of queued) {
    const g = goalNamed(id);
    if (g !== null) queue(y, g);
  }
  const line: unknown[] = Array.isArray(raw.line) ? raw.line : [];
  for (const id of line) {
    const g = goalNamed(id);
    if (g !== null) study(y, g);
  }
  const got = isRec(raw.got) ? raw.got : {};
  for (const g of ALL_GOALS.filter((h) => !y.done.includes(h) && isRec(got[GOALS[h]?.id ?? ""]))) {
    const given = untally(got[GOALS[g]?.id ?? ""], 1e6);
    y.got[g] ??= counts();
    for (const n of ALL_ITEMS) giveGoal(y, g, n, given[n] ?? 0);
  }
  // The Studies' work was for the research first in the line as kept: it is kept only while that is
  // still first, as play drops it when another comes first (`begin`).
  const studied = y.line[0] !== undefined && y.line[0] === goalNamed(line[0]) ? y.line[0] : undefined;
  const ungraded = raw.v === UNGRADED;
  y.blueprints = Array.from({ length: BLUEPRINTS_MOST }, (_, k) => blueprint(prints[k], ungraded));

  // Plots in the order they were bought, each that the land has.
  for (const name of raw.plots) {
    const p = plotNamed(name);
    if (p !== null && !y.plots.includes(p) && land.plots.some((q) => q.plot === p)) y.plots.push(p);
  }

  y.till += stand(y, pieces, studied, ungraded);

  fillBoard(y);
  // A yard kept before it knew its owner's last command is taken as last seen at its last tick.
  const seen = isRec(raw.seen) ? raw.seen : {};
  const last = whole(seen.tick, tick);
  const had = whole(seen.till, 1e12);
  y.seen = last === null || had === null ? here(y) : { tick: last, till: had, depot: untally(seen.depot, 1e12) };
  y.news = [];
  return y;
}
