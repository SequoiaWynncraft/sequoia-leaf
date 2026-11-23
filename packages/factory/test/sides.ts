/**
 * The two rules side by side: today's yard (`@sequoia-leaf/yard`) and the flat one. `differs` reads
 * both without changing either and says where they first differ: the land they stand on, the yard's
 * numbers, whether each has worked out power and the plumbing and what those come to, every part of
 * every tile, and that the flat yard's side tables agree with its tiles. A `Pair` gives both the same
 * commands and compares after every one, done or refused. Nothing here is part of the game.
 */
import type { Ctx } from "@sequoia-leaf/core";
import * as Y from "@sequoia-leaf/yard";

import * as F from "../src/index.ts";

export type Rec = Record<string, unknown>;
export const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);

/** A yard's kept text as a record, and its pieces as records. */
export function record(text: string): { rec: Rec; cells: Rec[] } {
  const raw: unknown = JSON.parse(text);
  if (!isRec(raw)) throw new Error("not a record");
  return { rec: raw, cells: Array.isArray(raw.cells) ? raw.cells.filter(isRec) : [] };
}
/** The strings in a list. */
export const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

// ---------- names ----------

/** The names of kinds and things by number, null where a byte holds none. */
const KIND_NAME: (string | null)[] = Array.from({ length: 256 }, (_, n) => (F.isKind(n) ? F.kindName(n) : null));
const ITEM_NAME: (string | null)[] = Array.from({ length: 256 }, (_, n) => (F.isItem(n) ? F.itemName(n) : null));
const nameF = (n: number | undefined): string | null => ITEM_NAME[n ?? F.NONE] ?? null;

/** A count by name, only what is there, in the tables' order. */
const tallyY = (t: Y.Tally): Rec => Object.fromEntries(Y.ITEMS.filter((k) => (t[k] ?? 0) !== 0).map((k) => [k, t[k]]));
const tallyF = (c: F.Counts): Rec =>
  Object.fromEntries(F.ALL_ITEMS.filter((n) => (c[n] ?? 0) !== 0).map((n) => [F.itemName(n), c[n]]));

/** A piece as both rules ask for one, every part named: what each side sends when it chooses pieces itself. */
export const pieceY = (p: Y.Piece): Rec => ({
  kind: p.kind,
  x: p.x,
  y: p.y,
  dir: p.dir,
  span: p.span,
  recipe: p.recipe ?? null,
  open: p.open ?? true,
  tint: p.tint ?? 0,
  shut: p.shut ?? 0,
});
export const pieceF = (p: F.Piece): Rec => ({
  kind: F.kindName(p.kind),
  x: p.x,
  y: p.y,
  dir: p.dir,
  span: p.span,
  recipe: p.recipe === undefined ? null : F.itemName(p.recipe),
  open: p.open ?? true,
  tint: p.tint ?? 0,
  shut: p.shut ?? 0,
});

// ---------- reading both ----------

/** The yard's numbers as a record, the same for both rules; `kept` leaves out what neither keeps (news). */
function numbersY(w: Y.World, kept: boolean): Rec {
  return {
    seed: w.seed,
    tick: w.tick,
    at: w.at,
    till: w.till,
    bank: w.bank,
    told: w.told,
    away: w.away && { ...w.away, made: tallyY(w.away.made) },
    seen: { tick: w.seen.tick, till: w.seen.till, depot: tallyY(w.seen.depot) },
    plots: w.plots,
    plans: w.plans,
    spare: Object.fromEntries(Y.KINDS.filter((k) => (w.spare[k] ?? 0) > 0).map((k) => [k, w.spare[k]])),
    blueprints: w.blueprints.map((b) => b && b.map(pieceY)),
    story: w.story,
    filled: tallyY(w.filled),
    board: w.board.map((o) => ({ ...o, want: tallyY(o.want), filled: tallyY(o.filled) })),
    serial: w.serial,
    done: w.done,
    swapAt: w.swapAt,
    depot: tallyY(w.depot),
    given: tallyY(w.given),
    sold: w.sold,
    paid: w.paid,
    pace: { ticks: w.pace.ticks, warm: w.pace.warm, made: tallyY(w.pace.made) },
    rates: w.rates,
    open: {
      kinds: Y.KINDS.filter((k) => w.open.kinds.has(k)),
      plots: Y.PLOT_IDS.filter((k) => w.open.plots.has(k)),
      plans: Y.PLAN_IDS.filter((k) => w.open.plans.has(k)),
      board: w.open.board,
    },
    ...(kept ? {} : { news: w.news }),
  };
}
function numbersF(y: F.Yard, kept: boolean): Rec {
  return {
    seed: y.seed,
    tick: y.tick,
    at: y.at,
    till: y.till,
    bank: y.bank,
    told: y.told,
    away: y.away && { ...y.away, made: tallyF(y.away.made) },
    seen: { tick: y.seen.tick, till: y.seen.till, depot: tallyF(y.seen.depot) },
    plots: y.plots.map(F.plotName),
    plans: y.plans.map(F.planName),
    spare: Object.fromEntries(F.ALL_KINDS.filter((k) => (y.spare[k] ?? 0) > 0).map((k) => [F.kindName(k), y.spare[k]])),
    blueprints: y.blueprints.map((b) => b && F.piecesOf(b).map(pieceF)),
    story: y.story,
    filled: tallyF(y.filled),
    board: y.board.map((o) => ({ ...o, want: tallyF(o.want), filled: tallyF(o.filled) })),
    serial: y.serial,
    done: y.done,
    swapAt: y.swapAt,
    depot: tallyF(y.depot),
    given: tallyF(y.given),
    sold: y.sold,
    paid: y.paid,
    pace: { ticks: y.pace.ticks, warm: y.pace.warm, made: tallyF(y.pace.made) },
    rates: y.rates,
    open: {
      kinds: F.ALL_KINDS.filter((k) => (y.open.kinds >> k) & 1).map(F.kindName),
      plots: Y.PLOT_IDS.filter((name) => (y.open.plots >> (F.plotNamed(name) ?? 31)) & 1),
      plans: F.ALL_PLANS.filter((n) => (y.open.plans >> n) & 1).map(F.planName),
      board: y.open.board,
    },
    ...(kept ? {} : { news: y.news }),
  };
}

/** Where a tile is and what stands there, for a sentence. */
const tileAt = (w: Y.World, i: number): string =>
  `tile ${i} (${w.cells[i]?.kind ?? "nothing"} at ${i % w.land.w},${Math.floor(i / w.land.w)})`;
const say = (w: Y.World, i: number, part: string, a: unknown, b: unknown): string =>
  `${tileAt(w, i)}: ${part}: ${JSON.stringify(a)} against ${JSON.stringify(b)}`;

/**
 * The first part of a tile where the two differ, or null: what stands, its way, what it carries and
 * how far, where that came from, its colour, turn, shut ways, whether it was to hand, its span and
 * what is under it, and for what holds things how many kinds and in all, each thing held, what is
 * out, the work, what is being made, the recipe, open, fuel and (unless `kept`) the idle note.
 *
 * And where the flat yard's tiles and side tables disagree: every piece that keeps parts in a side
 * table has a row there whose tile is itself, the tables have no row besides, nothing else has a row,
 * a row's counts are what its stock adds up to, and a tunnel row holds nothing past its tiles under.
 *
 * One loop with nothing made in it, so it is quick enough to run after every command of a large yard.
 */
function tilesDiffer(w: Y.World, y: F.Yard, kept: boolean): string | null {
  const { cells } = w;
  const { kind, dir, item, prog, via, tint, turn, shut, free, span, row } = y;
  const { holders: h, tunnels: t } = y;
  const step = y.land.step;
  const n = F.ITEM_COUNT;
  if (cells.length !== kind.length) return `the map: ${cells.length} tiles against ${kind.length}`;
  // How many pieces keep parts in each side table, to set against the rows it has.
  let holders = 0;
  let mouths = 0;
  for (let i = 0; i < cells.length; i++) {
    const b = cells[i] ?? null;
    const k = kind[i] ?? F.NONE;
    const r = row[i] ?? -1;
    if (b === null) {
      if (k !== F.NONE) return say(w, i, "kind", null, KIND_NAME[k]);
      if (r !== -1) return `tile ${i}: nothing stands there, yet it has row ${r}`;
      continue;
    }
    if (b.kind !== KIND_NAME[k]) return say(w, i, "kind", b.kind, KIND_NAME[k]);
    if (b.dir !== dir[i]) return say(w, i, "dir", b.dir, dir[i]);
    if (b.item !== ITEM_NAME[item[i] ?? F.NONE]) return say(w, i, "item", b.item, ITEM_NAME[item[i] ?? F.NONE]);
    if (b.prog !== (prog[i] ?? 0) / 8) return say(w, i, "prog", b.prog, (prog[i] ?? 0) / 8);
    const v = via[i] ?? 0;
    const from = v === 0 ? -1 : i + (step[v - 1] ?? 0);
    if (b.via !== from) return say(w, i, "via", b.via, from);
    if (b.tint !== tint[i]) return say(w, i, "tint", b.tint, tint[i]);
    if (b.turn !== turn[i]) return say(w, i, "turn", b.turn, turn[i]);
    if (b.shut !== shut[i]) return say(w, i, "shut", b.shut, shut[i]);
    if (b.free !== (free[i] === 1)) return say(w, i, "free", b.free, free[i]);
    const s = span[i] ?? 0;
    if (b.span !== s) return say(w, i, "span", b.span, s);
    if (s > 0 && k === F.TUNNEL) {
      // A way-in mouth: its row in the tunnels' table, and what is under the ground, tile by tile.
      if (r < 0 || r >= t.size || t.tile[r] !== i) return `tile ${i}: its tunnel row ${r} is not its own`;
      mouths++;
      if (b.under.length !== s || b.underProg.length !== s) return say(w, i, "tiles under", b.under.length, s);
      for (let u = 0; u < F.SPAN; u++) {
        const thing = ITEM_NAME[t.under[r * F.SPAN + u] ?? F.NONE];
        const along = (t.along[r * F.SPAN + u] ?? 0) / 8;
        if (u >= s && (thing !== null || along !== 0)) return `tile ${i}: something kept past its ${s} tiles under`;
        if (u < s && (b.under[u] ?? null) !== thing) return say(w, i, `under ${u}`, b.under[u], thing);
        if (u < s && b.underProg[u] !== along) return say(w, i, `along ${u}`, b.underProg[u], along);
      }
    } else if (b.under.length !== 0 || b.underProg.length !== 0) return say(w, i, "tiles under", b.under.length, 0);
    if (HOLDS[k] === 1) {
      // A holder: its row in the holders' table, and everything in that row.
      if (r < 0 || r >= h.size || h.tile[r] !== i) return `tile ${i}: its row ${r} is not its own`;
      holders++;
      if (b.count !== h.count[r]) return say(w, i, "count", b.count, h.count[r]);
      if (b.kinds !== h.kinds[r]) return say(w, i, "kinds", b.kinds, h.kinds[r]);
      // Thing by thing, and that the row's counts are what its stock adds up to. Today's yard keeps
      // its count as the sum of what it holds (`put`, `take`): with none, it holds nothing.
      let kinds = 0;
      let count = 0;
      for (let m = 0; m < n; m++) {
        const c = h.stock[r * n + m] ?? 0;
        if (c > 0) kinds++;
        count += c;
        if (b.count > 0 && (b.buf[ITEM_KEY[m] ?? "plank"] ?? 0) !== c)
          return say(w, i, `held ${ITEM_NAME[m]}`, b.buf[ITEM_KEY[m] ?? "plank"], c);
      }
      if (kinds !== h.kinds[r] || count !== h.count[r])
        return `tile ${i}: ${h.kinds[r]} kinds and ${h.count[r]} in all, for a stock of ${kinds} and ${count}`;
      if (b.out !== ITEM_NAME[h.out[r] ?? F.NONE]) return say(w, i, "out", b.out, ITEM_NAME[h.out[r] ?? F.NONE]);
      if (b.work !== h.work[r]) return say(w, i, "work", b.work, h.work[r]);
      if (b.making !== ITEM_NAME[h.making[r] ?? F.NONE])
        return say(w, i, "making", b.making, ITEM_NAME[h.making[r] ?? F.NONE]);
      if (b.recipe !== ITEM_NAME[h.recipe[r] ?? F.NONE])
        return say(w, i, "recipe", b.recipe, ITEM_NAME[h.recipe[r] ?? F.NONE]);
      if (b.open !== (h.open[r] === 1)) return say(w, i, "open", b.open, h.open[r]);
      if (b.fuel !== h.fuel[r]) return say(w, i, "fuel", b.fuel, h.fuel[r]);
      if (!kept && b.idle !== (h.idle[r] === 1)) return say(w, i, "idle", b.idle, h.idle[r]);
      continue;
    }
    if (r !== -1 && !(s > 0 && k === F.TUNNEL)) return `tile ${i}: it keeps nothing in a side table, yet has row ${r}`;
    // Anything else holds nothing.
    if (b.count !== 0 || b.kinds !== 0 || b.out !== null || b.work !== 0 || b.making !== null || b.recipe !== null)
      return say(w, i, "what it holds", [b.count, b.kinds, b.out, b.work, b.making, b.recipe], null);
    if (!b.open || b.fuel !== 0 || (!kept && b.idle)) return say(w, i, "open, fuel or idle", b.open, true);
  }
  // Every row belongs to a piece that names it.
  if (holders !== h.size) return `${h.size} holder rows for ${holders} pieces that hold things`;
  if (mouths !== t.size) return `${t.size} tunnel rows for ${mouths} tunnels`;
  return null;
}

/** Whether each kind of piece holds things, by its number; and each thing's name as today's yard keys what it holds. */
const HOLDS = Uint8Array.from({ length: 256 }, (_, k) => (F.holds(k) ? 1 : 0));
const ITEM_KEY = F.ALL_ITEMS.map(F.itemName);

/** Lands found the same, so each pair of them is compared once: a land is never written. */
const sameLands = new WeakMap<Y.Land, WeakSet<F.Land>>();

/** Where two lands differ, or null: size, depot, and every tile's deposit, stream, redwood and plot. */
export function landDiffers(a: Y.Land, b: F.Land): string | null {
  if (sameLands.get(a)?.has(b)) return null;
  if (a.w !== b.w || a.h !== b.h) return `${a.w} by ${a.h} against ${b.w} by ${b.h}`;
  if (a.depot[0] !== b.depot[0] || a.depot[1] !== b.depot[1])
    return `the depot at ${a.depot.join(",")} against ${b.depot.join(",")}`;
  const plotsY = a.plots.map((p) => [p.id, p.name, p.why, p.price, p.x, p.y, p.w, p.h]);
  const plotsF = b.plots.map((p) => [F.plotName(p.plot), p.name, p.why, p.price, p.x, p.y, p.w, p.h]);
  if (JSON.stringify(plotsY) !== JSON.stringify(plotsF)) return differ(plotsY, plotsF, "plots") ?? "the plots";
  for (let i = 0; i < a.w * a.h; i++) {
    const deposit = nameF(b.deposit[i]);
    if ((a.deposit[i] ?? null) !== deposit) return `tile ${i}: deposit ${a.deposit[i]} against ${deposit}`;
    if (a.water[i] !== b.water[i] || a.trunk[i] !== b.trunk[i]) return `tile ${i}: stream or redwood`;
    const plot = b.plot[i] === F.NONE ? -1 : b.plot[i];
    if ((a.plot[i] ?? -1) !== plot) return `tile ${i}: plot ${a.plot[i]} against ${plot}`;
  }
  const known = sameLands.get(a) ?? new WeakSet<F.Land>();
  known.add(b);
  sameLands.set(a, known);
  return null;
}

/** Where power reaches, the power there is and the power drawn, as a yard works them out afresh. */
interface Flow {
  readonly lit: Uint8Array;
  readonly supply: number;
  readonly demand: number;
}
/** Worked out on a copy, so the yard itself is left as it was. */
function freshY(w: Y.World): Flow {
  const c: Y.World = { ...w };
  const lit = c.power ?? Y.repower(c);
  return { lit, ...Y.power(c) };
}
function freshF(y: F.Yard): Flow {
  const c: F.Yard = { ...y, lit: Uint8Array.from(y.lit) };
  const lit = F.litOf(c);
  return { lit, ...F.power(c) };
}

/**
 * Whether each has worked out power and the plumbing, and what those come to, without working
 * anything out in the yards: what a yard holds is read; what it does not hold is, with `copies`,
 * worked out on a copy. The flat yard never holds what today's does not; today's may hold what the
 * flat one does not only while `ahead` (see `Pair`). With `kept`, what each holds is not compared,
 * since neither keeps it.
 */
function workedOutDiffers(w: Y.World, y: F.Yard, copies: boolean, ahead: boolean, kept: boolean): string | null {
  const powered = w.power !== null;
  const wired = w.wire !== null;
  const wiredF = y.wire !== null;
  const flatAhead = (y.powered && !powered) || (wiredF && !wired);
  if (!kept && (flatAhead || (!ahead && (powered !== y.powered || wired !== wiredF))))
    return `worked out: power ${powered} against ${y.powered}, the plumbing ${wired} against ${wiredF}`;
  const fy = copies && !(powered && wired) ? freshY(w) : null;
  const ff = copies && !(y.powered && wiredF) ? freshF(y) : null;
  const litY = w.power ?? fy?.lit ?? null;
  const litF = y.powered ? y.lit : (ff?.lit ?? null);
  if (litY && litF)
    for (let i = 0; i < litF.length; i++) if (litY[i] !== litF[i]) return say(w, i, "power", litY[i], litF[i]);
  const flowY = wired ? w : fy;
  const flowF = wiredF ? y : ff;
  if (flowY && flowF && (flowY.supply !== flowF.supply || flowY.demand !== flowF.demand))
    return `power: ${flowY.supply} for ${flowY.demand} against ${flowF.supply} for ${flowF.demand}`;
  return null;
}

export interface Shown {
  /**
   * Whether to compare only what a yard keeps: not a machine's note that it found nothing to start
   * on, nor whether power and the plumbing are worked out, which are worked out again, nor news no
   * screen has taken yet (neither rules keep any of these).
   */
  readonly kept?: boolean;
  /** Whether to work out power and the plumbing on copies where the yards have not (the default). */
  readonly copies?: boolean;
  /** Whether today's yard may have worked out power or the plumbing that the flat one has not. */
  readonly ahead?: boolean;
}

/** The first place today's yard and the flat one differ, as a sentence; or null when they are the same yard. */
export function differs(w: Y.World, y: F.Yard, shown: Shown = {}): string | null {
  const land = landDiffers(w.land, y.land);
  if (land !== null) return `the land: ${land}`;
  const a = numbersY(w, shown.kept ?? false);
  const b = numbersF(y, shown.kept ?? false);
  if (JSON.stringify(a) !== JSON.stringify(b)) return differ(a, b) ?? "the yards' numbers differ";
  return (
    workedOutDiffers(w, y, shown.copies ?? true, shown.ahead ?? false, shown.kept ?? false) ??
    tilesDiffer(w, y, shown.kept ?? false)
  );
}

/** Throws with the first difference, if today's yard and the flat one are not the same yard. */
export function expectSame(w: Y.World, y: F.Yard, shown: Shown = {}): void {
  const d = differs(w, y, shown);
  if (d !== null) throw new Error(d);
}

/** The first place two records differ, as a path and both values; or null when they are the same. */
export function differ(a: unknown, b: unknown, path = ""): string | null {
  if (Object.is(a, b) || (a === 0 && b === 0)) return null;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null)
    return `${path || "."}: ${JSON.stringify(a)} against ${JSON.stringify(b)}`;
  if (Array.isArray(a) !== Array.isArray(b)) return `${path}: an array against not`;
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const d = differ(Reflect.get(a, k), Reflect.get(b, k), `${path}.${k}`);
    if (d !== null) return d;
  }
  return null;
}

// ---------- the land and today's text ----------

/** Today's land, as the flat yard's. */
export function landOf(land: Y.Land): F.Land {
  const n = land.w * land.h;
  const deposit = new Uint8Array(n).fill(F.NONE);
  const plot = new Uint8Array(n).fill(F.NONE);
  for (let i = 0; i < n; i++) {
    deposit[i] = F.itemNamed(land.deposit[i]) ?? F.NONE;
    const p = land.plot[i] ?? -1;
    if (p >= 0) plot[i] = p;
  }
  return F.landOf({
    w: land.w,
    h: land.h,
    deposit,
    water: Uint8Array.from(land.water),
    trunk: Uint8Array.from(land.trunk),
    plot,
    plots: land.plots.map((p) => ({ ...p, plot: F.plot(p.id) })),
    depot: land.depot,
  });
}

const num = (v: unknown): number | undefined => (typeof v === "number" ? v : undefined);
const eighths = (v: unknown): number | undefined => {
  const n = num(v);
  return n === undefined ? undefined : Number.isInteger(n * 8) ? n * 8 : 0;
};
const itemOf = (v: unknown): number | undefined =>
  v === undefined || v === null ? undefined : (F.itemNamed(v) ?? 254);

/** A piece of today's text, as the flat yard keeps one. */
function keptPiece(o: unknown, w: number): F.KeptPiece | null {
  if (typeof o !== "object" || o === null || Array.isArray(o)) return null;
  const v = (k: string): unknown => Reflect.get(o, k);
  const tile = num(v("i")) ?? -1;
  const via = num(v("v"));
  const step = via === undefined || via < 0 ? -1 : [1, w, -1, -w].indexOf(via - tile);
  const held = v("b");
  const u = v("u");
  const up = v("up");
  const p: { -readonly [K in keyof F.KeptPiece]: F.KeptPiece[K] } = {
    tile,
    kind: F.kindNamed(v("k")) ?? F.NONE,
    dir: num(v("d")) ?? -1,
  };
  const it = itemOf(v("it"));
  if (it !== undefined) Object.assign(p, { item: it, prog: eighths(v("p")) ?? 0, via: step < 0 ? 0 : step + 1 });
  if (typeof held === "object" && held !== null)
    p.held = Object.entries(held).flatMap(([name, c]): [number, number][] => {
      const n = F.itemNamed(name);
      return n === null || typeof c !== "number" ? [] : [[n, c]];
    });
  const out = itemOf(v("o"));
  if (out !== undefined) p.out = out;
  const work = num(v("w"));
  if (work !== undefined) p.work = work;
  const making = itemOf(v("m"));
  if (making !== undefined) p.making = making;
  const turn = num(v("t"));
  if (turn !== undefined) p.turn = turn;
  const recipe = itemOf(v("r"));
  if (recipe !== undefined) p.recipe = recipe;
  const span = num(v("s"));
  if (span !== undefined) p.span = span;
  if (Array.isArray(u) && Array.isArray(up)) {
    p.under = u.map((k) => itemOf(k) ?? F.NONE);
    p.along = up.map((a) => eighths(a) ?? 0);
  }
  if (v("c") === 1) p.closed = true;
  const fuel = num(v("f"));
  if (fuel !== undefined) p.fuel = fuel;
  if (v("g") === 1) p.free = true;
  const tint = num(v("h"));
  if (tint !== undefined) p.tint = tint;
  const shut = num(v("x"));
  if (shut !== undefined) p.ways = shut;
  return p;
}

/** A blueprint of today's text, as the flat yard keeps one before it is vouched for, or nothing. */
function keptPrint(v: unknown): F.KeptPrint | null {
  if (!Array.isArray(v)) return null;
  return v.map((p: unknown) => {
    const r = (k: string): unknown => (isRec(p) ? p[k] : undefined);
    return {
      kind: F.kindNamed(r("kind")) ?? F.NONE,
      x: num(r("x")) ?? -1,
      y: num(r("y")) ?? -1,
      dir: num(r("dir")) ?? -1,
      span: num(r("span")) ?? -1,
      recipe: F.itemNamed(r("recipe")) ?? F.NONE,
      open: r("open") !== false,
      tint: num(r("tint")) ?? 0,
      shut: num(r("shut")) ?? 0,
    };
  });
}

/** Today's text read into the flat yard: one way only, as the tests need. */
export function fromText(text: string, land: F.Land = F.LAND): F.Yard | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const rec: Rec = Object.fromEntries(Object.entries(raw));
  if (rec.v !== Y.VERSION || !Array.isArray(rec.cells)) return null;
  const pieces = rec.cells.map((o) => keptPiece(o, land.w)).filter((p) => p !== null);
  const prints: unknown[] = Array.isArray(rec.blueprints) ? rec.blueprints : [];
  return F.vouch(rec, pieces, prints.map(keptPrint), land);
}

// ---------- each side choosing for itself ----------

/**
 * What a page works out from its own copy of the yard before it sends a command: the pieces within
 * a rectangle, those pieces copied, turned and placed, a blueprint placed, a run of belt. Each rules
 * answer from their own yard; the pieces come back as both send them.
 */
export interface Side {
  within(x0: number, y0: number, x1: number, y1: number): number[];
  copy(tiles: readonly number[], turns: number, x: number, y: number): Rec[];
  print(slot: number, turns: number, x: number, y: number): Rec[] | null;
  route(from: readonly [number, number], to: readonly [number, number], tunnels: boolean): Rec[] | null;
}
const leg = (kind: string, l: { x: number; y: number; dir: number; span: number }): Rec => ({
  kind,
  x: l.x,
  y: l.y,
  dir: l.dir,
  span: l.span,
});
export const sideY = (w: Y.World): Side => ({
  within: (x0, y0, x1, y1) => Y.within(w, x0, y0, x1, y1),
  copy: (tiles, turns, x, y) => Y.placed(Y.piecesAt(w, tiles), turns, x, y).map(pieceY),
  print: (slot, turns, x, y) => {
    const b = w.blueprints[slot];
    return b ? Y.placed(b, turns, x, y).map(pieceY) : null;
  },
  route: (from, to, tunnels) => Y.route(w, from, to, { tunnels })?.map((l) => leg(l.kind, l)) ?? null,
});
export const sideF = (y: F.Yard): Side => ({
  within: (x0, y0, x1, y1) => F.within(y, x0, y0, x1, y1),
  copy: (tiles, turns, x, z) => F.placed(F.piecesAt(y, tiles), turns, x, z).map(pieceF),
  print: (slot, turns, x, z) => {
    const b = y.blueprints[slot];
    return b ? F.placed(F.piecesOf(b), turns, x, z).map(pieceF) : null;
  },
  route: (from, to, tunnels) => F.route(y, from, to, { tunnels })?.map((l) => leg(F.kindName(l.kind), l)) ?? null,
});

// ---------- what was reached ----------

/** How often each kind of command, piece and plan took effect, and what else a run is meant to reach. */
export class Reach {
  readonly counts = new Map<string, number>();
  note(key: string, n = 1): void {
    this.counts.set(key, (this.counts.get(key) ?? 0) + n);
  }
  /** Of some keys, those never reached. */
  missing(keys: readonly string[]): string[] {
    return keys.filter((k) => (this.counts.get(k) ?? 0) === 0);
  }
  /** The counts, one line each, in the order of `keys`. */
  table(keys: readonly string[]): string {
    return keys.map((k) => `${k.padEnd(28)} ${this.counts.get(k) ?? 0}`).join("\n");
  }
}

/** The pieces a command would set down new (not over one of their own kind), by kind, as today's yard stands. */
function fresh(w: Y.World, c: Rec): string[] {
  const asked = c.do === "build" ? [c] : c.do === "stand" ? c.pieces : c.do === "lay" ? c.legs : [];
  const out: string[] = [];
  for (const p of Array.isArray(asked) ? asked : [])
    if (isRec(p) && typeof p.kind === "string" && typeof p.x === "number" && typeof p.y === "number")
      if (w.cells[Y.at(w, p.x, p.y)]?.kind !== p.kind) out.push(p.kind);
  return out;
}

// ---------- a pair ----------

/** What a command came to, as both rules answer it. */
const answer = (a: unknown): string => JSON.stringify(a, (key, v: unknown) => (key === "state" ? undefined : v));

/** What Leaf's play service is told about a player, at a moment of its clock. */
const ctxAt = (now: number): Ctx => ({ now, player: { id: "p", guest: false }, seed: 1, room: 0, awards: [] });

export interface PairOpts {
  /** Work out power and the plumbing on copies, where the yards have not, at every comparison (1) or every so many. */
  readonly copiesEvery?: number;
  /** Where to count what took effect. */
  readonly reach?: Reach;
}

/**
 * The commands with which today's yard may work out its plumbing (and so power) where the flat one
 * does not: today's colours a line by following its plumbing, and works it out to do so when a line
 * is painted or a piece is set down beside a colour (`lineOf` and `join` in its `build.ts`); the flat
 * yard follows the pieces themselves (`lines.ts`) and works nothing out. Neither changes any outcome.
 */
const COLOURS_BY_PLUMBING = new Set(["paint", "build", "lay", "stand"]);

/**
 * Today's yard and the flat one, given the same commands and compared after every one, done or
 * refused, and every so many ticks as they run.
 */
export class Pair {
  readonly yard: Y.World;
  readonly flat: F.Yard;
  /** How many comparisons, commands and ticks so far. */
  compared = 0;
  commands = 0;
  ticks = 0;
  readonly reach: Reach | null;
  private readonly copiesEvery: number;
  /** Set by a command in `COLOURS_BY_PLUMBING`, until both have worked out the same again. */
  private ahead = false;

  constructor(yard: Y.World, flat: F.Yard, opts: PairOpts = {}) {
    this.yard = yard;
    this.flat = flat;
    this.reach = opts.reach ?? null;
    this.copiesEvery = opts.copiesEvery ?? 1;
    const land = landDiffers(yard.land, flat.land);
    if (land !== null) throw new Error(`the two stand on different land: ${land}`);
  }

  /** Throws with the first difference, if the two are not the same yard. */
  same(where: string, shown: Shown = {}): void {
    this.compared++;
    const copies = this.compared % this.copiesEvery === 0;
    const d = differs(this.yard, this.flat, { copies, ahead: this.ahead, ...shown });
    if (d !== null) throw new Error(`${where}: ${d}`);
    if ((this.yard.power !== null) === this.flat.powered && (this.yard.wire !== null) === (this.flat.wire !== null))
      this.ahead = false;
  }

  private answered(ay: unknown, af: unknown, what: string): void {
    const sy = answer(ay);
    const sf = answer(af);
    if (sy !== sf) throw new Error(`${what}: answered ${sy.slice(0, 400)} against ${sf.slice(0, 400)}`);
  }

  /**
   * Gives both a command off the wire, done at the yard's tick unless it says, and compares the
   * answers and the yards. `cf` is the flat yard's own wording of it, where it chose pieces itself.
   */
  do(c: Rec, where = "", cf: Rec = c): unknown {
    const wire = { tick: this.yard.tick, ...c };
    const what = `${where} ${JSON.stringify(wire).slice(0, 300)}`;
    const cy = Y.readCommand(wire);
    const cflat = F.readCommand({ tick: this.yard.tick, ...cf });
    if ((cy === null) !== (cflat === null))
      throw new Error(`${what}: read ${cy === null ? "only by the flat yard" : "only by today's"}`);
    this.commands++;
    if (!cy || !cflat) {
      this.same(`${where} after a command neither reads`);
      return null;
    }
    const made = this.reach ? fresh(this.yard, wire) : [];
    const ay = Y.play(this.yard, cy);
    this.answered(ay, F.play(this.flat, cflat), what);
    this.took(wire, ay, made);
    if (COLOURS_BY_PLUMBING.has(cy.do)) this.ahead = true;
    this.same(`${where} after ${cy.do}`);
    return ay;
  }

  /**
   * Gives both a command through Leaf's play service (`Game.command`, then `Game.apply`) at a moment
   * of Leaf's clock: done at its own tick, at the server's lead if it asks for a tick past that, and
   * at the yard's tick if it asks for one the yard has passed.
   */
  apply(c: Rec, now: number, where = ""): unknown {
    const wire = { tick: this.yard.tick, ...c };
    const what = `${where} applied at ${now} ${JSON.stringify(wire).slice(0, 300)}`;
    const cy = Y.WORKS.command(wire);
    const cf = F.FACTORY.command(wire);
    if ((cy === null) !== (cf === null))
      throw new Error(`${what}: read ${cy === null ? "only by the flat yard" : "only by today's"}`);
    this.commands++;
    if (!cy || !cf) {
      this.same(`${where} after a command neither reads`);
      return null;
    }
    const ahead = cy.tick > F.clockOf(this.flat, now) + F.LEAD;
    const past = cy.tick < this.yard.tick;
    const made = this.reach ? fresh(this.yard, wire) : [];
    const ay = Y.WORKS.apply(this.yard, cy, ctxAt(now));
    this.answered(ay, F.FACTORY.apply(this.flat, cf, ctxAt(now)), what);
    if (this.took(wire, ay, made)) {
      this.reach?.note("through Game.apply");
      if (ahead) this.reach?.note("ahead of the server's lead");
      if (past) this.reach?.note("in the yard's past");
    }
    if (COLOURS_BY_PLUMBING.has(cy.do)) this.ahead = true;
    this.same(`${where} after ${cy.do}, applied`);
    return ay;
  }

  /**
   * Has each rules choose a command's pieces from its own yard (`ask` is given each side in turn),
   * says where they chose differently, and gives each its own.
   */
  choose(ask: (s: Side) => Rec, where = ""): unknown {
    const cy = ask(sideY(this.yard));
    const cf = ask(sideF(this.flat));
    if (JSON.stringify(cy) !== JSON.stringify(cf))
      throw new Error(`${where}: chose differently: ${differ(cy, cf) ?? ""}`);
    return this.do(cy, where, cf);
  }

  /** Counts what a command that was done set in motion; says whether it was done. */
  private took(c: Rec, a: unknown, made: readonly string[]): boolean {
    if (!isRec(a) || "refused" in a) return false;
    const reach = this.reach;
    if (!reach) return true;
    reach.note(`command ${String(c.do)}`);
    for (const k of made) reach.note(`piece ${k}`);
    if (c.do === "buyPlan") reach.note(`plan ${String(c.plan)}`);
    if (c.do === "buyPlot") reach.note(`plot ${String(c.plot)}`);
    return true;
  }

  /** Runs both on, comparing every `every` ticks and at the end. */
  run(ticks: number, every = 100, where = ""): void {
    for (let k = 1; k <= ticks; k++) {
      Y.step(this.yard);
      F.step(this.flat);
      this.ticks++;
      if (k % every === 0 || k === ticks) this.same(`${where} tick ${this.yard.tick}`);
    }
  }
}

/** A pair from today's text: read by today's rules and, one way, into the flat yard. */
export function pairOf(text: string, land: Y.Land = Y.LAND, opts: PairOpts = {}): Pair {
  const yard = Y.load(text, land);
  const flat = fromText(text, landOf(land));
  if (!yard || !flat) throw new Error("the text is not a yard");
  return new Pair(yard, flat, opts);
}
