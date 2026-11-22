/**
 * Keeping a yard as text, and reading it back. The text carries a version; reading gives back a
 * yard it can vouch for or nothing at all. A record whose shape or version is wrong is refused
 * whole; inside a good one, a plot, plan or building that could not have come about by playing is
 * left out and the rest is kept. A yard without its seed (what the page is shown) is written and
 * read without one.
 */
import { build, planState, plotState, refusal } from "./build.ts";
import { isItem, type Item, ITEMS, type Tally } from "./content/items.ts";
import { BUFFER, FUEL, isKind, type Kind, TICKS } from "./content/machines.ts";
import { isPlanId, PLANS } from "./content/plans.ts";
import { isPlotId } from "./content/plots.ts";
import { MADE_BY, RECIPE } from "./content/recipes.ts";
import { STORY } from "./content/story.ts";
import { create } from "./create.ts";
import { isDir } from "./grid.ts";
import { LAND, type Land } from "./land.ts";
import { fillBoard, reask } from "./orders.ts";
import { repower } from "./power.ts";
import { type Away, type Building, put, reopen, type Standing, WARM, type World } from "./world.ts";

export const VERSION = 3;

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);
/** A whole number from 0 up to `most`, or nothing. */
const whole = (v: unknown, most: number): number | null =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= most ? v : null;
/** A number from 0 up to `most`, or nothing. */
const amount = (v: unknown, most: number): number | null =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= most ? v : null;
const words = (v: unknown): string | null => (typeof v === "string" && v.length <= 200 ? v : null);

/** A count of things, read back or written out: only real things, only sensible counts, always in the same order. */
function tally(v: unknown, most: number): Tally {
  const out: Tally = {};
  if (!isRec(v)) return out;
  for (const item of ITEMS) {
    const n = amount(v[item], most);
    if (n !== null && n > 0) out[item] = n;
  }
  return out;
}

/** A building as it is kept: where, what, which way, and only the parts that are not as new. */
function pack(b: Building, i: number): Rec {
  const o: Rec = { i, k: b.kind, d: b.dir };
  if (b.item !== null) Object.assign(o, { it: b.item, p: b.prog, v: b.via });
  if (b.count > 0) o.b = tally(b.buf, 1e6);
  if (b.out !== null) o.o = b.out;
  if (b.work !== 0) o.w = b.work;
  if (b.making !== null) o.m = b.making;
  if (b.turn !== 0) o.t = b.turn;
  if (b.recipe !== null) o.r = b.recipe;
  if (b.span !== 0) o.s = b.span;
  if (b.span > 0) Object.assign(o, { u: b.under, up: b.underProg });
  if (!b.open) o.c = 1;
  if (b.fuel !== 0) o.f = b.fuel;
  if (b.free) o.g = 1;
  return o;
}

/** A yard as text. */
export function save(w: World): string {
  const cells: Rec[] = [];
  w.cells.forEach((b, i) => {
    if (b && b.kind !== "depot") cells.push(pack(b, i));
  });
  return JSON.stringify({
    v: VERSION,
    ...(w.seed === null ? {} : { seed: w.seed }),
    tick: w.tick,
    at: w.at,
    till: w.till,
    bank: w.bank,
    told: w.told,
    ...(w.away === null ? {} : { away: w.away }),
    plots: w.plots,
    plans: w.plans,
    story: w.story,
    filled: tally(w.filled, Infinity),
    board: w.board.map((o) => ({ ...o, want: tally(o.want, Infinity), filled: tally(o.filled, Infinity) })),
    serial: w.serial,
    done: w.done,
    swapAt: w.swapAt,
    depot: tally(w.depot, Infinity),
    given: tally(w.given, Infinity),
    sold: w.sold,
    paid: w.paid,
    pace: { ...w.pace, made: tally(w.pace.made, Infinity) },
    cells,
  });
}

/** What a kept building may hold, by what it is. */
function holds(kind: Kind, item: Item): number {
  if (kind === "mill" || kind === "bench" || kind === "workshop")
    return MADE_BY[kind].some((r) => r.from.includes(item)) ? BUFFER : 0;
  if (kind === "boiler") return item === "deadfall" ? FUEL : 0;
  return kind === "crate" ? 1e6 : 0;
}

/** Puts a kept building's parts back onto a building new-made where it stood. */
function unpack(w: World, b: Building, i: number, o: Rec): void {
  const carries = b.kind === "belt" || b.kind === "splitter" || b.kind === "joiner" || b.kind === "tunnel";
  const makes = b.kind === "mill" || b.kind === "bench" || b.kind === "workshop";
  if (carries && isItem(o.it)) {
    b.item = o.it;
    b.prog = amount(o.p, 2) ?? 0;
    b.via = whole(o.v, w.cells.length - 1) ?? -1;
  }
  const held = tally(o.b, 1e6);
  const room = b.kind === "crate" ? w.rates.crate : 1e6;
  for (const item of ITEMS)
    for (let n = Math.min(Math.floor(held[item] ?? 0), holds(b.kind, item)); n > 0 && b.count < room; n--) put(b, item);
  b.idle = false;
  const out = isItem(o.o) ? o.o : null;
  if (out !== null) {
    if (b.kind === "crate" || (b.kind === "gatherer" && w.land.deposit[i] === out)) b.out = out;
    if (makes && RECIPE[out]?.by === b.kind) b.out = out;
  }
  if (makes || b.kind === "gatherer") b.work = amount(o.w, 200) ?? 0;
  if (makes && isItem(o.r) && RECIPE[o.r]?.by === b.kind) b.recipe = o.r;
  if (makes && isItem(o.m)) {
    const r = RECIPE[o.m];
    if (r?.by === b.kind && r.from.every((k) => (b.buf[k] ?? 0) > 0)) b.making = o.m;
  }
  if (b.kind === "splitter" || b.kind === "joiner") b.turn = whole(o.t, 2) ?? 0;
  if (b.kind === "crate") b.open = o.c !== 1;
  if (b.kind === "boiler") b.fuel = whole(o.f, TICKS.burn) ?? 0;
  if (b.span > 0 && Array.isArray(o.u) && Array.isArray(o.up))
    for (let k = 0; k < b.span; k++) {
      const item: unknown = o.u[k];
      b.under[k] = isItem(item) ? item : null;
      b.underProg[k] = amount(o.up[k], 2) ?? 0;
    }
}

function standing(v: unknown): Standing | null {
  if (!isRec(v)) return null;
  const id = whole(v.id, 1e9);
  const title = words(v.title);
  const from = words(v.from);
  const line = words(v.line);
  const pay = whole(v.pay, 1e8);
  const want = tally(v.want, 1e6);
  const asked = ITEMS.filter((k) => (want[k] ?? 0) > 0).length;
  if (id === null || title === null || from === null || line === null || pay === null || asked < 1 || asked > 2)
    return null;
  const filled = tally(v.filled, 1e6);
  for (const item of ITEMS)
    if ((filled[item] ?? 0) > 0) filled[item] = Math.min(Math.floor(filled[item] ?? 0), want[item] ?? 0);
  return reask({ id, title, from, line, want, pay, filled });
}

/** A time away kept in a yard, or nothing. */
function awayOf(v: unknown): Away | null {
  if (!isRec(v)) return null;
  const seconds = amount(v.seconds, 1e9);
  const coins = whole(v.coins, 1e12);
  return seconds === null || coins === null ? null : { seconds, coins };
}

/** A yard read back from text, on the guild's land unless another is given; nothing if the text is not a yard. */
export function load(text: string | null | undefined, land: Land = LAND): World | null {
  if (!text) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRec(raw) || raw.v !== VERSION) return null;
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
    !Array.isArray(raw.cells) ||
    raw.cells.length > land.w * land.h
  )
    return null;

  const w = create({ land, story });
  Object.assign(w, {
    seed,
    tick,
    at,
    till,
    bank,
    told: Math.min(told, story),
    away: awayOf(raw.away),
    serial,
    done,
    swapAt,
    sold,
    paid,
    board: [],
  });
  w.depot = tally(raw.depot, 1e12);
  w.given = tally(raw.given, 1e12);
  const want = STORY[story]?.want ?? {};
  w.filled = tally(raw.filled, 1e6);
  for (const item of ITEMS)
    if ((w.filled[item] ?? 0) > 0) w.filled[item] = Math.min(w.filled[item] ?? 0, want[item] ?? 0);

  // Plots and plans in the order they were bought, each only if it could have been bought then.
  for (const id of raw.plots) if (isPlotId(id) && plotState(w, id).state === "for sale") w.plots.push(id);
  for (const id of raw.plans)
    if (isPlanId(id) && PLANS.some((p) => p.id === id) && planState(w, id).state === "for sale") w.plans.push(id);
  reopen(w);

  // Buildings: everything but the far mouths of tunnels, which come with their near mouths.
  const kept: [Building, number, Rec][] = [];
  const far: Rec[] = [];
  for (const o of raw.cells) {
    if (!isRec(o)) continue;
    const i = whole(o.i, land.w * land.h - 1);
    if (i === null || !isKind(o.k) || !isDir(o.d)) continue;
    const span = typeof o.s === "number" ? o.s : 0;
    if (o.k === "tunnel" && span < 0) {
      far.push(o);
      continue;
    }
    const x = i % land.w;
    const y = (i - x) / land.w;
    if (w.cells[i] || refusal(w, o.k, x, y, Infinity, o.d, o.k === "tunnel" ? span : undefined) !== null) continue;
    // Only a piece kept as one the yard had to hand takes the place of one: the rest were paid for.
    const spare = w.spare[o.k] ?? 0;
    if (o.g !== 1) w.spare[o.k] = 0;
    const did = build(w, o.k, x, y, o.d, Infinity, o.k === "tunnel" ? span : undefined);
    if (o.g !== 1) w.spare[o.k] = spare;
    if (!did.ok) continue;
    const b = w.cells[i];
    if (b) kept.push([b, i, o]);
  }
  for (const o of far) {
    const i = whole(o.i, land.w * land.h - 1);
    const b = i === null ? null : w.cells[i];
    if (i !== null && b?.kind === "tunnel" && b.span < 0 && b.span === o.s && b.dir === o.d) kept.push([b, i, o]);
  }
  for (const [b, i, o] of kept) unpack(w, b, i, o);

  for (const o of raw.board) {
    const order = standing(o);
    if (order && w.open.board && w.board.length < w.rates.slots) w.board.push(order);
  }
  repower(w);
  fillBoard(w);
  const pace = isRec(raw.pace) ? raw.pace : {};
  w.pace = { ticks: amount(pace.ticks, 1e9) ?? 0, warm: whole(pace.warm, WARM) ?? WARM, made: tally(pace.made, 1e12) };
  w.news = [];
  return w;
}
