/**
 * Keeping a yard, and reading it back. The yard is written as a small JSON record of its numbers and
 * orders, as today's yard is, with its pieces packed into bytes (`cells`, base64) and its blueprints
 * the same. Reading gives back a yard it can vouch for or nothing at all: a record of the wrong shape
 * or version is refused whole; inside a good one, a plot, plan or piece that could not have come
 * about by playing is left out, by building each piece again through the rules (`vouch`).
 *
 * A piece's bytes, in tile order: the tiles since the last piece less one (varint); a byte of its
 * kind (low four bits), its way (two bits), whether it carries something (64) and whether more
 * parts follow (128); if it carries, the thing (byte) and its progress in eighths with the side it
 * came in from (a byte, four bits each); if more follow, which (varint, a bit each), then those:
 *   2 what it holds: how many kinds (varint), then a thing (byte) and how many (varint) each
 *   4 out (byte)   8 work (num)   16 making (byte)   32 turn (byte)   64 recipe (byte)
 *   128 span (byte, +8), and for a way-in mouth a thing (byte) and its progress (byte) for each tile under
 *   256 a shut crate   512 fuel (byte)   1024 one of the pieces to hand   2048 tint (byte)   4096 shut ways (byte)
 */
import { build, isDir, planState, plotState, refusal } from "./build.ts";
import { fromBase64, Reader, toBase64, Writer } from "./bytes.ts";
import { here } from "./clock.ts";
import { BLUEPRINT, BLUEPRINTS, BUFFER, FUEL, SPAN, TICKS } from "./content/machines.ts";
import { STORY } from "./content/story.ts";
import { LAND, type Land } from "./land.ts";
import { countsOf, fillBoard, reask } from "./orders.ts";
import { blueprintRefusal, keptOf, packPieces, type Piece, placed, TINTS } from "./pieces.ts";
import {
  ALL_ITEMS,
  BOILER,
  CRATE,
  DEADFALL,
  DEPOT,
  GATHERER,
  isItem,
  isKind,
  isMaker,
  isRaw,
  ITEM_COUNT,
  itemName,
  JOINER,
  NONE,
  planName,
  planNamed,
  plotName,
  plotNamed,
  RECIPE,
  SPLITTER,
  TUNNEL,
  uses,
} from "./tables.ts";
import { carries } from "./wire.ts";
import {
  type Away,
  type Counts,
  counts,
  emptyYard,
  held,
  holds,
  PIECE_BYTES,
  put,
  reopen,
  type Standing,
  WARM,
  type Yard,
} from "./yard.ts";

export const VERSION = 4;

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
}

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);
const whole = (v: unknown, most: number): number | null =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= most ? v : null;
const amount = (v: unknown, most: number): number | null =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= most ? v : null;
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
    const got = amount(v[itemName(n)], most);
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
    if (holder && h.recipe[r] !== NONE) f |= 64;
    if (span !== 0) f |= 128;
    if (k === CRATE && holder && h.open[r] === 0) f |= 256;
    if (holder && h.fuel[r] !== 0) f |= 512;
    if (y.free[i] === 1) f |= 1024;
    if (y.tint[i] !== 0) f |= 2048;
    if (y.shut[i] !== 0) f |= 4096;
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
    if (f & 8) o.num(h.work[r] ?? 0);
    if (f & 16) o.byte(h.making[r] ?? NONE);
    if (f & 32) o.byte(y.turn[i] ?? 0);
    if (f & 64) o.byte(h.recipe[r] ?? NONE);
    if (f & 128) {
      o.byte(span + 8);
      const tr = span > 0 ? (y.row[i] ?? 0) * SPAN : -1;
      for (let s = 0; s < span; s++) {
        o.byte(t.under[tr + s] ?? NONE);
        o.byte(t.along[tr + s] ?? 0);
      }
    }
    if (f & 512) o.byte(h.fuel[r] ?? 0);
    if (f & 2048) o.byte(y.tint[i] ?? 0);
    if (f & 4096) o.byte(y.shut[i] ?? 0);
  }
  return o.bytes();
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
    at: y.at,
    till: y.till,
    bank: y.bank,
    told: y.told,
    ...(away === null ? {} : { away: { seconds: away.seconds, coins: away.coins, made: tally(away.made) } }),
    seen: { tick: y.seen.tick, till: y.seen.till, depot: tally(y.seen.depot) },
    plots: y.plots.map(plotName),
    plans: y.plans.map(planName),
    story: y.story,
    filled: tally(y.filled),
    board: y.board.map((o) => ({ ...o, want: tally(o.want), filled: tally(o.filled) })),
    serial: y.serial,
    done: y.done,
    swapAt: y.swapAt,
    depot: tally(y.depot),
    given: tally(y.given),
    sold: y.sold,
    paid: y.paid,
    pace: { ticks: y.pace.ticks, warm: y.pace.warm, made: tally(y.pace.made) },
    cells: toBase64(packCells(y)),
    ...(prints.some((b) => b !== null) ? { blueprints: prints.map((b) => b && toBase64(b)) } : {}),
  });
}

// ---------- reading ----------

/** The pieces read back from their bytes, or null for bytes that are not pieces. */
function unpackCells(bytes: Uint8Array, tiles: number): KeptPiece[] | null {
  const r = new Reader(bytes);
  const out: KeptPiece[] = [];
  let tile = -1;
  while (!r.done) {
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
    if (f & 2) {
      const pairs: [number, number][] = [];
      for (let n = r.varint(); n > 0 && pairs.length < ITEM_COUNT; n--) pairs.push([r.byte(), r.varint()]);
      p.held = pairs;
    }
    if (f & 4) p.out = r.byte();
    if (f & 8) p.work = r.num();
    if (f & 16) p.making = r.byte();
    if (f & 32) p.turn = r.byte();
    if (f & 64) p.recipe = r.byte();
    if (f & 128) {
      p.span = r.byte() - 8;
      const under: number[] = [];
      const along: number[] = [];
      for (let s = 0; s < p.span && s < SPAN; s++) {
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
    if (r.over) return null;
    out.push(p);
  }
  return out;
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
    prints.map((b) => (typeof b === "string" ? fromBase64(b) : null)),
    land,
  );
}

/** A kept blueprint read back: real pieces within a blueprint's limits, or nothing. */
function blueprint(v: Uint8Array | null | undefined): Uint8Array | null {
  if (!v || v.length % PIECE_BYTES !== 0) return null;
  const pieces: Piece[] = [];
  for (let at = 0; at < v.length; at += PIECE_BYTES) {
    const [k = NONE, x = 99, z = 99, d = 9, span = 9, recipe = NONE, open = 1, tint = 0, shut = 0] = v.subarray(
      at,
      at + PIECE_BYTES,
    );
    if (!isKind(k) || k === DEPOT || !isDir(d) || x > BLUEPRINT.w - 1 || z > BLUEPRINT.h - 1 || span > SPAN)
      return null;
    pieces.push({
      kind: k,
      x,
      y: z,
      dir: d,
      span,
      ...keptOf({ recipe, open: open === 0 ? false : undefined, tint, shut }, k),
    });
  }
  return blueprintRefusal(pieces) === null ? packPieces(placed(pieces, 0, 0, 0)) : null;
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
  for (const n of ALL_ITEMS) if ((filled[n] ?? 0) > 0) filled[n] = Math.min(Math.floor(filled[n] ?? 0), want[n] ?? 0);
  return reask({ id, title, from, line, want, pay, filled });
}

function keptAway(v: unknown): Away | null {
  if (!isRec(v)) return null;
  const seconds = amount(v.seconds, 1e9);
  const coins = whole(v.coins, 1e12);
  return seconds === null || coins === null ? null : { seconds, coins, made: untally(v.made, 1e12) };
}

/** How many of a thing a kept piece may hold, by what it is. */
function mostHeld(k: number, n: number): number {
  if (isKind(k) && isMaker(k)) return isItem(n) && uses(k, n) ? BUFFER : 0;
  if (k === BOILER) return n === DEADFALL ? FUEL : 0;
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
    const room = k === CRATE ? y.rates.crate : 1e6;
    const has = counts();
    for (const [n, c] of o.held ?? []) if (isItem(n) && (amount(c, 1e6) ?? 0) > 0) has[n] = c;
    for (const n of ALL_ITEMS)
      for (let c = Math.min(Math.floor(has[n] ?? 0), mostHeld(k, n)); c > 0 && (h.count[r] ?? 0) < room; c--)
        put(h, r, n);
    h.idle[r] = 0;
    const out = o.out !== undefined && isItem(o.out) ? o.out : null;
    if (out !== null) {
      if (k === CRATE || (k === GATHERER && isRaw(out))) h.out[r] = out;
      if (makes && RECIPE[out]?.by === k) h.out[r] = out;
    }
    if (makes || k === GATHERER) h.work[r] = amount(o.work, 200) ?? 0;
    if (makes && o.recipe !== undefined && isItem(o.recipe) && RECIPE[o.recipe]?.by === k) h.recipe[r] = o.recipe;
    if (makes && o.making !== undefined && isItem(o.making)) {
      const rec = RECIPE[o.making];
      if (rec?.by === k && rec.from.every((n) => held(h, r, n) > 0)) h.making[r] = o.making;
    }
    if (k === CRATE) h.open[r] = o.closed === true ? 0 : 1;
    if (k === BOILER) h.fuel[r] = whole(o.fuel, TICKS.burn) ?? 0;
  }
  if (k === SPLITTER || k === JOINER) y.turn[i] = whole(o.turn, 2) ?? 0;
  if (k === SPLITTER) y.shut[i] = whole(o.ways, 7) ?? 0;
  const span = y.span[i] ?? 0;
  if (span > 0 && o.under && o.along) {
    const at = (y.row[i] ?? 0) * SPAN;
    for (let s = 0; s < span; s++) {
      const n = o.under[s] ?? NONE;
      y.tunnels.under[at + s] = isItem(n) ? n : NONE;
      y.tunnels.along[at + s] = whole(o.along[s], 16) ?? 0;
    }
  }
}

/**
 * A yard from a kept record: its numbers as JSON gives them, its pieces, and its blueprints' bytes.
 * Everything is checked, and every piece built again through the rules, so what comes back is a
 * yard that could have come about by playing.
 */
export function vouch(raw: Rec, pieces: readonly KeptPiece[], prints: readonly unknown[], land: Land): Yard | null {
  const seed = "seed" in raw ? whole(raw.seed, 0xffffffff) : null;
  const tick = whole(raw.tick, 1e12);
  const at = amount(raw.at, 8.64e15);
  const till = amount(raw.till, 1e12);
  const bank = whole(raw.bank, 1e12);
  const told = whole(raw.told, STORY.length);
  const story = whole(raw.story, STORY.length);
  const serial = whole(raw.serial, 1e9);
  const done = whole(raw.done, 1e9);
  const swapAt = whole(raw.swapAt, 1e13);
  const sold = amount(raw.sold, 1e15);
  const paid = amount(raw.paid, 1e15);
  if (
    ("seed" in raw && seed === null) ||
    tick === null ||
    at === null ||
    till === null ||
    bank === null ||
    told === null ||
    story === null ||
    serial === null ||
    done === null ||
    swapAt === null ||
    sold === null ||
    paid === null ||
    !Array.isArray(raw.plots) ||
    !Array.isArray(raw.plans) ||
    !Array.isArray(raw.board) ||
    pieces.length > land.w * land.h
  )
    return null;

  const y = emptyYard(land, story);
  Object.assign(y, { seed, tick, at, till, bank, told: Math.min(told, story), away: keptAway(raw.away) });
  Object.assign(y, { serial, done, swapAt, sold, paid, board: [] });
  y.blueprints = Array.from({ length: BLUEPRINTS }, (_, k) => {
    const b = prints[k];
    return blueprint(b instanceof Uint8Array ? b : null);
  });
  y.depot = untally(raw.depot, 1e12);
  y.given = untally(raw.given, 1e12);
  const want = STORY[story] ? countsOf(STORY[story].want) : counts();
  y.filled = untally(raw.filled, 1e6);
  for (const n of ALL_ITEMS) if ((y.filled[n] ?? 0) > 0) y.filled[n] = Math.min(y.filled[n] ?? 0, want[n] ?? 0);

  // Plots and plans in the order they were bought, each only if it could have been bought then.
  for (const name of raw.plots) {
    const p = plotNamed(name);
    if (p !== null && plotState(y, p).state === "for sale") y.plots.push(p);
  }
  for (const name of raw.plans) {
    const p = planNamed(name);
    if (p !== null && planState(y, p).state === "for sale") y.plans.push(p);
  }
  reopen(y);

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
    const tunnel = k === TUNNEL ? span : undefined;
    if (y.kind[i] !== NONE || refusal(y, k, x, z, Infinity, d, tunnel) !== null) continue;
    // Only a piece kept as one the yard had to hand takes the place of one: the rest were paid for.
    const spare = y.spare[k] ?? 0;
    if (o.free !== true) y.spare[k] = 0;
    const did = build(y, k, x, z, d, Infinity, tunnel);
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
    if (order && y.open.board && y.board.length < y.rates.slots) y.board.push(order);
  }
  fillBoard(y);
  const pace = isRec(raw.pace) ? raw.pace : {};
  y.pace = {
    ticks: amount(pace.ticks, 1e9) ?? 0,
    warm: whole(pace.warm, WARM) ?? WARM,
    made: untally(pace.made, 1e12),
  };
  // A yard kept before it knew its owner's last command is taken as last seen at its last tick.
  const seen = isRec(raw.seen) ? raw.seen : {};
  const last = whole(seen.tick, tick);
  const had = amount(seen.till, 1e12);
  y.seen = last === null || had === null ? here(y) : { tick: last, till: had, depot: untally(seen.depot, 1e12) };
  y.news = [];
  return y;
}
