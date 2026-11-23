/**
 * Keeping a yard, and reading it back. The yard is written as a small JSON record of its numbers,
 * goals and orders, with its pieces packed into bytes (`cells`, base64) and each of its
 * blueprints the same (`packPrint`). Reading gives back a yard it can vouch for or nothing at all: a
 * record of the wrong shape or version is refused whole; inside a good one, a goal, plot or piece
 * that could not have come about by playing is left out, by building each piece again through the
 * rules (`vouch`).
 *
 * The pieces' bytes are how many pieces there are (varint), then each piece in tile order: the tiles
 * since the last piece less one (varint); a byte of its kind (low four bits), its way (two bits),
 * whether it carries something (64) and whether more parts follow (128); if it carries, the thing
 * (byte) and its progress in eighths with the side it came in from (a byte, four bits each); if more
 * follow, which (varint, a bit each), then those:
 *   2 what it holds: how many kinds (varint), then a thing (byte) and how many (varint) each
 *   4 out (byte)   8 work (varint)   16 making (byte)   32 turn (byte)   64 what it is set to (byte)
 *   128 span (byte, +8), and for a way-in mouth a thing (byte) and its progress (byte) for each tile under
 *   256 a shut crate   512 fuel (byte)   1024 one of the pieces to hand   2048 tint (byte)   4096 shut ways (byte)
 *   8192 a grade above 1 (byte)
 *
 * Bytes that are not pieces are refused whole: bytes cut short or left over, a part this version
 * does not know, and any count past what the tables allow (more pieces than tiles, more kinds of
 * thing than there are, more of one thing than any piece holds, a tunnel longer than tunnels go).
 */
import { build, isDir, plotState, refusal } from "./build.ts";
import { fromBase64, Reader, toBase64, Writer } from "./bytes.ts";
import { here } from "./clock.ts";
import { BLUEPRINT, FUEL, STUDY_HOLDS, TICKS } from "./content/machines.ts";
import { LAND, type Land } from "./land.ts";
import { fillBoard, study } from "./orders.ts";
import { blueprintRefusal, keptOf, packPieces, type Piece, piecesOf, placed, TINTS } from "./pieces.ts";
import {
  ALL_ITEMS,
  ALL_KINDS,
  BLUEPRINTS_MOST,
  BOILER,
  CRATE,
  CRATE_MOST,
  DEADFALL,
  DEPOT,
  GATHERER,
  type Goal,
  goalNamed,
  GOALS,
  holdsMost,
  isFolio,
  isGoal,
  isItem,
  isKind,
  isMaker,
  isNode,
  isRaw,
  ITEM_COUNT,
  itemName,
  JOINER,
  nextHand,
  NONE,
  openOf,
  plotName,
  plotNamed,
  ready,
  RECIPE,
  RECIPES_N,
  SORTER,
  SPAN_MOST,
  SPLITTER,
  STUDY,
  TUNNEL,
} from "./tables.ts";
import { carries } from "./wire.ts";
import {
  type Away,
  type Counts,
  counts,
  emptyYard,
  held,
  hold,
  holds,
  put,
  reopen,
  type Standing,
  WARM,
  type Yard,
} from "./yard.ts";

/** 6: whole numbers, grades, goals and research. */
export const VERSION = 6;

/** The parts a piece's bytes may say follow, a bit each. */
const PARTS = 0x3ffe;
/** The most work a gatherer or machine carries toward its next piece, in half-ticks. */
const WORK_MOST = Math.max(TICKS.gather, TICKS.study, ...RECIPES_N.map((r) => r.ticks)) * 2;
/** The most of one thing any piece holds: a crate as large as it grows. */
const HOLDS_MOST = Math.max(
  FUEL,
  STUDY_HOLDS,
  CRATE_MOST,
  ...ALL_KINDS.flatMap((k) => ALL_ITEMS.map((n) => holdsMost(k, n))),
);
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
function tally(c: Counts): Rec {
  const out: Rec = {};
  for (const n of ALL_ITEMS) {
    const v = c[n] ?? 0;
    if (Number.isFinite(v) && v > 0) out[itemName(n)] = v;
  }
  return out;
}
/** A count by name read back. */
function untally(v: unknown, most: number): Counts {
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
    const r = y.row[i] ?? -1;
    const holder = holds(k) && r >= 0;
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
    if (y.shut[i] !== 0) f |= 4096;
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
      const tr = span > 0 ? (y.row[i] ?? 0) * SPAN_MOST : -1;
      for (let s = 0; s < span; s++) {
        o.byte(t.under[tr + s] ?? NONE);
        o.byte(t.along[tr + s] ?? 0);
      }
    }
    if (f & 512) o.byte(h.fuel[r] ?? 0);
    if (f & 2048) o.byte(y.tint[i] ?? 0);
    if (f & 4096) o.byte(y.shut[i] ?? 0);
    if (f & 8192) o.byte(y.grade[i] ?? 1);
  }
  return o.bytes();
}

/**
 * A blueprint as kept: each piece in its order, as its kind, x and y (a byte each), then its way
 * with a bit for each part that follows (4 span, 8 tint, 16 shut ways, 32 a shut crate, 64 recipe,
 * 128 a grade above 1), then those, a byte each.
 */
function packPrint(b: Uint8Array): Uint8Array {
  const o = new Writer();
  for (const p of piecesOf(b)) {
    o.byte(p.kind);
    o.byte(p.x);
    o.byte(p.y);
    const { span, tint = 0, shut = 0, recipe, grade = 1 } = p;
    o.byte(
      p.dir |
        (span > 0 ? 4 : 0) |
        (tint > 0 ? 8 : 0) |
        (shut > 0 ? 16 : 0) |
        (p.open === false ? 32 : 0) |
        (recipe === undefined ? 0 : 64) |
        (grade > 1 ? 128 : 0),
    );
    if (span > 0) o.byte(span);
    if (tint > 0) o.byte(tint);
    if (shut > 0) o.byte(shut);
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
  readonly shut: number;
  readonly grade: number;
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
    const shut = f & 16 ? r.byte() : 0;
    const recipe = f & 64 ? r.byte() : NONE;
    const grade = f & 128 ? r.byte() : 1;
    if (r.over) return null;
    out.push({ kind, x, y, dir: f & 3, span, recipe, open: (f & 32) === 0, tint, shut, grade });
  }
  return out;
}

export interface Keep {
  /** Whether to keep the seed: never in what the page is shown. */
  readonly seed?: boolean;
  /** What the yard did while its owner was away, for the page's letter. */
  readonly away?: Away | null;
  /** Whether to keep the blueprints: not in what a visitor is shown. */
  readonly blueprints?: boolean;
}

/** A yard as text: its numbers and orders as JSON, its pieces and blueprints packed. */
export function encode(y: Yard, keep: Keep = {}): string {
  const away = keep.away === undefined ? y.away : keep.away;
  const prints = keep.blueprints === false ? [] : y.blueprints;
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
    line: y.line.map(goalId),
    got: Object.fromEntries(y.got.flatMap((got, g) => (got && isGoal(g) ? [[goalId(g), tally(got)]] : []))),
    board: y.board.map((o) => ({ ...o, want: tally(o.want), filled: tally(o.filled) })),
    serial: y.serial,
    handed: y.handed,
    swapAt: y.swapAt,
    depot: tally(y.depot),
    sold: y.sold,
    paid: y.paid,
    pace: { ticks: y.pace.ticks, warm: y.pace.warm, made: tally(y.pace.made) },
    cells: toBase64(packCells(y)),
    ...(prints.some((b) => b !== null) ? { blueprints: prints.map((b) => b && toBase64(packPrint(b))) } : {}),
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
      if (kinds > ITEM_COUNT) return null;
      const pairs: [number, number][] = [];
      for (let k = 0; k < kinds; k++) {
        const thing = r.byte();
        const many = r.varint();
        if (many > HOLDS_MOST) return null;
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
      if (p.span < -SPAN_MOST || p.span > SPAN_MOST) return null;
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

/** A yard read back from text, on the guild's land unless another is given; nothing if the text is not a yard. */
export function decode(text: string | null | undefined, land: Land = LAND): Yard | null {
  if (!text) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRec(raw) || raw.v !== VERSION || typeof raw.cells !== "string") return null;
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

/** A kept blueprint read back: real pieces within the yard's limits for a blueprint, or nothing. */
function blueprint(y: Yard, v: KeptPrint | null | undefined): Uint8Array | null {
  if (!v) return null;
  const pieces: Piece[] = [];
  for (const { kind: k, x, y: z, dir: d, span, recipe, open, tint, shut, grade } of v) {
    if (!isKind(k) || k === DEPOT || !isDir(d)) return null;
    if (whole(x, BLUEPRINT.w - 1) === null || whole(z, BLUEPRINT.h - 1) === null || whole(span, SPAN_MOST) === null)
      return null;
    pieces.push({
      kind: k,
      x,
      y: z,
      dir: d,
      span,
      ...keptOf({ recipe, open: open ? undefined : false, tint, shut, grade }, k),
    });
  }
  return blueprintRefusal(y, pieces) === null ? packPieces(placed(pieces, 0, 0, 0)) : null;
}

function standing(v: unknown): Standing | null {
  if (!isRec(v)) return null;
  const id = whole(v.id, 1e9);
  const title = words(v.title);
  const from = words(v.from);
  const line = words(v.line);
  const pay = whole(v.pay, 1e8);
  const want = untally(v.want, 1e6);
  const asked = ALL_ITEMS.filter((n) => (want[n] ?? 0) > 0).length;
  if (id === null || title === null || from === null || line === null || pay === null || asked < 1 || asked > 2)
    return null;
  const filled = untally(v.filled, 1e6);
  for (const n of ALL_ITEMS) filled[n] = Math.min(filled[n] ?? 0, want[n] ?? 0);
  return { id, title, from, line, want, pay, filled, starts: whole(v.starts, 1e12) ?? 0 };
}

function keptAway(v: unknown): Away | null {
  if (!isRec(v)) return null;
  const seconds = whole(v.seconds, 1e9);
  const coins = whole(v.coins, 1e12);
  return seconds === null || coins === null ? null : { seconds, coins, made: untally(v.made, 1e12) };
}

/** How many of a thing a kept piece may hold, by what it is. */
function mostHeld(k: number, n: number): number {
  if (isKind(k) && isMaker(k)) return isItem(n) ? holdsMost(k, n) : 0;
  if (k === BOILER) return n === DEADFALL ? FUEL : 0;
  if (k === STUDY) return isFolio(n) ? STUDY_HOLDS : 0;
  return k === CRATE ? 1e6 : 0;
}

/** Puts a kept piece's parts back onto the piece new-built where it stood. */
function unpack(y: Yard, i: number, o: KeptPiece): void {
  const k = y.kind[i] ?? NONE;
  const makes = isMaker(k);
  if (carries(k) && o.item !== undefined && isItem(o.item)) {
    y.item[i] = o.item;
    y.prog[i] = whole(o.prog, 16) ?? 0;
    y.via[i] = whole(o.via, 4) ?? 0;
  }
  if (carries(k)) y.tint[i] = whole(o.tint, TINTS) ?? 0;
  const r = y.row[i] ?? -1;
  if (holds(k) && r >= 0) {
    const h = y.holders;
    const room = k === CRATE ? y.open.crate : 1e6;
    const has = counts();
    for (const [n, c] of o.held ?? []) if (isItem(n) && (whole(c, 1e6) ?? 0) > 0) has[n] = c;
    for (const n of ALL_ITEMS)
      for (let c = Math.min(Math.floor(has[n] ?? 0), mostHeld(k, n)); c > 0 && (h.count[r] ?? 0) < room; c--)
        put(h, r, n);
    h.idle[r] = 0;
    const out = o.out !== undefined && isItem(o.out) ? o.out : null;
    if (out !== null) {
      if (k === CRATE || (k === GATHERER && isRaw(out))) h.out[r] = out;
      if (makes && RECIPE[out]?.by === k) h.out[r] = out;
    }
    if (makes || k === GATHERER) h.work[r] = whole(o.work, WORK_MOST) ?? 0;
    if (makes && o.recipe !== undefined && isItem(o.recipe) && RECIPE[o.recipe]?.by === k) y.set[i] = o.recipe;
    if (makes && o.making !== undefined && isItem(o.making)) {
      const rec = RECIPE[o.making];
      if (rec?.by === k && rec.from.every((n, p) => held(h, r, n) >= (rec.need[p] ?? 1))) h.making[r] = o.making;
    }
    if (k === CRATE) h.open[r] = o.closed === true ? 0 : 1;
    if (k === BOILER) h.fuel[r] = whole(o.fuel, TICKS.burn) ?? 0;
  }
  if (k === SPLITTER || k === JOINER) y.turn[i] = whole(o.turn, 2) ?? 0;
  if (k === SORTER && o.recipe !== undefined && isItem(o.recipe)) y.set[i] = o.recipe;
  if (k === SPLITTER) y.shut[i] = whole(o.ways, 7) ?? 0;
  const span = y.span[i] ?? 0;
  if (span > 0 && o.under && o.along) {
    const at = (y.row[i] ?? 0) * SPAN_MOST;
    for (let s = 0; s < span; s++) {
      const n = o.under[s] ?? NONE;
      y.tunnels.under[at + s] = isItem(n) ? n : NONE;
      y.tunnels.along[at + s] = whole(o.along[s], 16) ?? 0;
    }
  }
}

/**
 * A yard from a kept record: its numbers as JSON gives them, its pieces, and its blueprints' pieces.
 * Everything is checked, and every piece built again through the rules, so what comes back is a
 * yard that could have come about by playing.
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
  const told = whole(raw.told, GOALS.length);
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

  // Goals in the order they were done, each only if it could have been done then; what the rest
  // have been given, each only if it could have been given anything, and never more than it wants.
  for (const id of raw.done) {
    const g = goalNamed(id);
    if (g === null || !ready(y.open, g)) continue;
    y.done.push(g);
    y.open = openOf(y.done);
  }
  reopen(y);
  y.told = Math.min(told, y.done.length);
  const got = isRec(raw.got) ? raw.got : {};
  y.got = GOALS.map((info, g) => {
    const kept = got[info.id];
    if (!isGoal(g) || !ready(y.open, g) || !isRec(kept)) return null;
    const c = untally(kept, 1e6);
    for (const n of ALL_ITEMS) c[n] = Math.min(c[n] ?? 0, info.want[n] ?? 0);
    return c;
  });
  const hand = goalNamed(raw.hand);
  hold(y, hand !== null && isNode(hand) && ready(y.open, hand) ? hand : nextHand(y.open));
  for (const id of Array.isArray(raw.line) ? raw.line : []) {
    const g = goalNamed(id);
    if (g !== null) study(y, g);
  }
  y.blueprints = Array.from({ length: BLUEPRINTS_MOST }, (_, k) =>
    k < y.open.blueprints ? blueprint(y, prints[k]) : null,
  );

  // Plots in the order they were bought, each only if it could have been bought then.
  for (const name of raw.plots) {
    const p = plotNamed(name);
    if (p !== null && plotState(y, p).state === "for sale") y.plots.push(p);
  }

  // Pieces: everything but the far mouths of tunnels, which come with their near mouths.
  const kept: [number, KeptPiece][] = [];
  const far: KeptPiece[] = [];
  const tiles = land.w * land.h;
  for (const o of pieces) {
    const i = whole(o.tile, tiles - 1);
    const k = o.kind;
    const d = o.dir;
    if (i === null || !isKind(k) || !isDir(d)) continue;
    const span = o.span ?? 0;
    if (k === TUNNEL && span < 0) {
      far.push(o);
      continue;
    }
    const x = i % land.w;
    const z = (i - x) / land.w;
    const lay = k === TUNNEL ? { span, grade: o.grade ?? 1 } : { grade: o.grade ?? 1 };
    if (y.kind[i] !== NONE || refusal(y, k, x, z, Infinity, d, lay) !== null) continue;
    // Only a piece kept as one the yard had to hand takes the place of one: the rest were paid for.
    const spare = y.spare[k] ?? 0;
    if (o.free !== true) y.spare[k] = 0;
    const did = build(y, k, x, z, d, Infinity, lay);
    if (o.free !== true) y.spare[k] = spare;
    if (did.ok) kept.push([i, o]);
  }
  for (const o of far) {
    const i = whole(o.tile, tiles - 1);
    if (i !== null && y.kind[i] === TUNNEL && (y.span[i] ?? 0) < 0 && y.span[i] === o.span && y.dir[i] === o.dir)
      kept.push([i, o]);
  }
  for (const [i, o] of kept) unpack(y, i, o);

  for (const o of raw.board) {
    const order = standing(o);
    if (order && y.open.board && y.board.length < y.open.hooks) y.board.push(order);
  }
  fillBoard(y);
  const pace = isRec(raw.pace) ? raw.pace : {};
  y.pace = {
    ticks: whole(pace.ticks, 1e9) ?? 0,
    warm: whole(pace.warm, WARM) ?? WARM,
    made: untally(pace.made, 1e12),
  };
  // A yard kept before it knew its owner's last command is taken as last seen at its last tick.
  const seen = isRec(raw.seen) ? raw.seen : {};
  const last = whole(seen.tick, tick);
  const had = whole(seen.till, 1e12);
  y.seen = last === null || had === null ? here(y) : { tick: last, till: had, depot: untally(seen.depot, 1e12) };
  y.news = [];
  return y;
}
