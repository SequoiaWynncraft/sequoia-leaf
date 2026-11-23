/**
 * The two rules side by side: today's yard (`@sequoia-leaf/yard`) and the flat one, each giving the
 * same canonical picture of a yard, and a pair of yards that takes the same commands and is
 * compared after each. Nothing here is part of the game.
 */
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

// ---------- the picture ----------

/** A count by name, only what is there, in the tables' order. */
const tallyY = (t: Y.Tally): Rec => Object.fromEntries(Y.ITEMS.filter((k) => (t[k] ?? 0) !== 0).map((k) => [k, t[k]]));
const tallyF = (c: F.Counts): Rec =>
  Object.fromEntries(F.ALL_ITEMS.filter((n) => (c[n] ?? 0) !== 0).map((n) => [F.itemName(n), c[n]]));
const nameF = (n: number | undefined): string | null => (n !== undefined && F.isItem(n) ? F.itemName(n) : null);

const pieceY = (p: Y.Piece): Rec => ({
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
const pieceF = (p: F.Piece): Rec => ({
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

/** A yard as a plain record, the same for both rules: its numbers, and a record for each tile where something stands. */
export type Picture = Rec & { readonly tiles: readonly Rec[] };

export interface Shown {
  /**
   * Whether to show only what a yard keeps: not a machine's note that it found nothing to start on,
   * which is worked out again, nor news no screen has taken yet (neither rules keep either).
   */
  readonly kept?: boolean;
}

/** Today's yard as the canonical picture: every part of every piece, and every number of the yard, exactly. */
export function pictureY(w: Y.World, shown: Shown = {}): Picture {
  const lit = w.power ?? Y.repower(w);
  const p = Y.power(w);
  const tiles: Rec[] = [];
  w.cells.forEach((b, i) => {
    if (!b) return;
    tiles.push({
      i,
      kind: b.kind,
      dir: b.dir,
      item: b.item,
      prog: b.prog,
      via: b.via,
      tint: b.tint,
      turn: b.turn,
      shut: b.shut,
      free: b.free,
      span: b.span,
      under: b.under,
      along: b.underProg,
      held: tallyY(b.buf),
      out: b.out,
      work: b.work,
      making: b.making,
      recipe: b.recipe,
      open: b.open,
      fuel: b.fuel,
      ...(shown.kept ? {} : { idle: b.idle }),
    });
  });
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
    lit: Array.from(lit).join(""),
    supply: p.supply,
    demand: p.demand,
    ...(shown.kept ? {} : { news: w.news }),
    tiles,
  };
}

/** The flat yard as the same picture. */
export function pictureF(y: F.Yard, shown: Shown = {}): Picture {
  const lit = F.litOf(y);
  const p = F.power(y);
  const { holders: h, tunnels: t, land } = y;
  const tiles: Rec[] = [];
  for (let i = 0; i < y.kind.length; i++) {
    const k = y.kind[i] ?? F.NONE;
    if (!F.isKind(k)) continue;
    const r = y.row[i] ?? -1;
    const holder = F.holds(k) && r >= 0;
    const span = y.span[i] ?? 0;
    const via = y.via[i] ?? 0;
    const under: (string | null)[] = [];
    const along: number[] = [];
    for (let s = 0; s < span; s++) {
      under.push(nameF(t.under[r * F.SPAN + s]));
      along.push((t.along[r * F.SPAN + s] ?? 0) / 8);
    }
    const held: Rec = {};
    if (holder) for (const n of F.ALL_ITEMS) if (F.held(h, r, n) > 0) held[F.itemName(n)] = F.held(h, r, n);
    tiles.push({
      i,
      kind: F.kindName(k),
      dir: y.dir[i],
      item: nameF(y.item[i]),
      prog: (y.prog[i] ?? 0) / 8,
      via: via === 0 ? -1 : i + (land.step[via - 1] ?? 0),
      tint: y.tint[i],
      turn: y.turn[i],
      shut: y.shut[i],
      free: y.free[i] === 1,
      span,
      under,
      along,
      held,
      out: holder ? nameF(h.out[r]) : null,
      work: holder ? h.work[r] : 0,
      making: holder ? nameF(h.making[r]) : null,
      recipe: holder ? nameF(h.recipe[r]) : null,
      open: holder ? h.open[r] === 1 : true,
      fuel: holder ? h.fuel[r] : 0,
      ...(shown.kept ? {} : { idle: holder && h.idle[r] === 1 }),
    });
  }
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
    lit: Array.from(lit).join(""),
    supply: p.supply,
    demand: p.demand,
    ...(shown.kept ? {} : { news: y.news }),
    tiles,
  };
}

/** The first place two pictures differ, as a path and both values; or null when they are the same. */
export function differ(a: unknown, b: unknown, path = ""): string | null {
  if (Object.is(a, b) || (a === 0 && b === 0)) return null;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null)
    return `${path || "."}: ${JSON.stringify(a)} against ${JSON.stringify(b)}`;
  if (Array.isArray(a) !== Array.isArray(b)) return `${path}: an array against not`;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  for (const k of new Set([...ka, ...kb])) {
    const va: unknown = Reflect.get(a, k);
    const vb: unknown = Reflect.get(b, k);
    // A tile is named by its index, so a difference reads as where it is and what.
    const step =
      Array.isArray(a) && typeof va === "object" && va !== null && "i" in va
        ? `[tile ${String(Reflect.get(va, "i"))}]`
        : `.${k}`;
    const d = differ(va, vb, path + step);
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

/** A blueprint of today's text, as the flat yard keeps one: its pieces as bytes, or nothing. */
function keptPrint(v: unknown): Uint8Array | null {
  if (!Array.isArray(v)) return null;
  const bytes = new Uint8Array(v.length * F.PIECE_BYTES);
  v.forEach((p: unknown, n) => {
    const r = (k: string): unknown => (typeof p === "object" && p !== null ? Reflect.get(p, k) : undefined);
    bytes.set(
      [
        F.kindNamed(r("kind")) ?? F.NONE,
        num(r("x")) ?? 255,
        num(r("y")) ?? 255,
        num(r("dir")) ?? 255,
        num(r("span")) ?? 255,
        F.itemNamed(r("recipe")) ?? F.NONE,
        r("open") === false ? 0 : 1,
        num(r("tint")) ?? 0,
        num(r("shut")) ?? 0,
      ],
      n * F.PIECE_BYTES,
    );
  });
  return bytes;
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

// ---------- a pair ----------

/** What a command came to, as both rules answer it. */
const answer = (a: unknown): string => JSON.stringify(a, (key, v: unknown) => (key === "state" ? undefined : v));

/** Today's yard and the flat one, given the same commands and compared after each. */
export class Pair {
  readonly yard: Y.World;
  readonly flat: F.Yard;
  /** How many comparisons and commands so far. */
  compared = 0;
  commands = 0;
  ticks = 0;

  constructor(yard: Y.World, flat: F.Yard) {
    this.yard = yard;
    this.flat = flat;
  }

  /** Throws with the first difference, if the two are not the same yard. */
  same(where: string, shown: Shown = {}): void {
    this.compared++;
    const a = pictureY(this.yard, shown);
    const b = pictureF(this.flat, shown);
    if (JSON.stringify(a) === JSON.stringify(b)) return;
    throw new Error(`${where}: ${differ(a, b) ?? "the pictures differ"}`);
  }

  /** Gives both the same command off the wire, done at the yard's tick unless it says, and compares the answers and the yards. */
  do(c: Rec, where = ""): unknown {
    const wire = { tick: this.yard.tick, ...c };
    const cy = Y.readCommand(wire);
    const cf = F.readCommand(wire);
    if ((cy === null) !== (cf === null))
      throw new Error(
        `${where} ${JSON.stringify(wire)}: read ${cy === null ? "only by the flat yard" : "only by today's"}`,
      );
    this.commands++;
    if (!cy || !cf) return null;
    const ay = Y.play(this.yard, cy);
    const af = F.play(this.flat, cf);
    const sy = answer(ay);
    const sf = answer(af);
    if (sy !== sf)
      throw new Error(
        `${where} ${JSON.stringify(wire).slice(0, 300)}: answered ${sy.slice(0, 400)} against ${sf.slice(0, 400)}`,
      );
    return ay;
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
export function pairOf(text: string, land: Y.Land = Y.LAND): Pair {
  const yard = Y.load(text, land);
  const flat = fromText(text, landOf(land));
  if (!yard || !flat) throw new Error("the text is not a yard");
  return new Pair(yard, flat);
}
