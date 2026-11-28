/**
 * Keeping a yard, and reading it back. The yard is written as a small JSON record of its numbers,
 * goals and orders, with its pieces packed into bytes (`cells`, base64, as `cells.ts` packs them) and
 * each of its blueprints the same (`prints.ts`; a plan of the whole yard as `{ "whole": ... }`), and
 * what Undo would put back (`history.ts`). Reading is by shape first: a record of the wrong shape or
 * version is refused whole, and nothing else is. Inside a good one, every piece is built again through
 * the rules (`vouch`), and anything that depends on today's tuning (how much a piece holds, how far a
 * tunnel goes, which goals, plots and grades open when) is clamped or carried, never a reason to
 * refuse the yard; nothing a player has is lost. Goals done, plots owned, redwoods felled (each by
 * its first tile, and only on a plot the yard owns), orders on the board, blueprints and line
 * colours are carried as kept. A piece that cannot stand at the grade it was kept
 * at stands at the highest grade the yard may build of its kind, and one that cannot stand at all
 * (land it is not on, ground it cannot work, a kind not opened) is paid back into the till at today's
 * price for the grade it was kept at; one of the pieces to hand goes back to hand. What a machine is
 * told to make, and the way a splitter puts first, are kept only where the yard may set them.
 *
 * Every tile a yard keeps (its pieces, the redwoods it felled, a plan of the whole yard) is a tile of
 * the land it says it was kept on (`land`, `keptland.ts`), and is read onto the tile as far from the
 * yard plot's corner on the land it is read on: more land round the yard moves nothing. One kept
 * before yards said (version 8 and before) was kept on the guild's first land, three plots by three.
 *
 * A yard kept by the Works' first design (version 3, its pieces a list) is brought over as far as is
 * cheap (`fromFirst`): it is a new yard at the tier its story had reached. One kept by version 8
 * reads as this version's (`UNPLACED`); one kept by version 7 too, with every redwood standing
 * (`UNFELLED`); one kept by version 6 too, but for the grades it did not keep (`UNGRADED`).
 */
import { build, isDir, plotState, refusal } from "./build.ts";
import { fromBase64, toBase64 } from "./bytes.ts";
import { keptOnto, type KeptPiece, keptPieces, packKept, unpackCells } from "./cells.ts";
import { clearRefusal } from "./clearing.ts";
import { here } from "./clock.ts";
import { NODES } from "./content/nodes.ts";
import { historyOf, stampOf } from "./history.ts";
import { FIRST_LAND, holdsFirst, type KeptLand, keptLandOf, keptOn, piecesOn, tileOn } from "./keptland.ts";
import { LAND, type Land, plotPrice } from "./land.ts";
import { type KeptNames, keptNames, knownAt10, knownHere, pastTen, WIDER } from "./named.ts";
import { counting, fillBoard, giveGoal, ORDER_WAITS, queue, study } from "./orders.ts";
import { keptOf, packPieces, type Piece, placed, unpackWays } from "./pieces.ts";
import { type KeptBlueprint, keptBlueprint, printText } from "./prints.ts";
import {
  ALL_GOALS,
  ALL_ITEMS,
  BLUEPRINTS_MOST,
  CLEARING,
  FIXED,
  type Goal,
  goalNamed,
  GOALS,
  highest,
  isGoal,
  isKind,
  isNode,
  itemName,
  itemNamed,
  kindNamed,
  LINED,
  MILLI,
  nextHand,
  NONE,
  plotName,
  plotNamed,
  price,
  ready,
  REGRADED,
  SPANS,
} from "./tables.ts";
import {
  type Away,
  type Counts,
  counts,
  emptyYard,
  hold,
  type Print,
  reopen,
  type Standing,
  type Yard,
} from "./yard.ts";

/**
 * 11: a yard naming anything the last Leaf of version 10 did not know, anywhere in it (`knownAt10`:
 * a goal, a thing, a kind past its 16, a plot, or a tunnel past its 5 tiles). A yard naming nothing
 * past it is kept as `PLACED`, byte for byte as before, so that Leaf reads it; and that Leaf leaves
 * one of this version as a newer Leaf's, rather than read it with what it does not know let go.
 */
export const VERSION = 11;
/** 10: a kind past 15 kept anywhere. It still reads; nothing keeps a yard as it now. */
const WIDE = 10;
/** 9: the land a yard was kept on, so that its tiles stay where they are as the land grows. */
export const PLACED = 9;
/**
 * The version before a yard said the land it was kept on: whole numbers, grades (a splitter's, a
 * joiner's and a sorter's too), goals, research and redwoods felled, on the guild's first land. It
 * still reads. A Leaf that knows no later one refuses a yard this one keeps, rather than read its
 * tiles on a land they are not of.
 */
const UNPLACED = 8;
/**
 * The version before redwoods could be felled. It still reads, with every redwood standing. A Leaf
 * that knows no later one refuses a yard this one keeps, rather than read it with its felled
 * redwoods standing again and what was built where they stood taken away.
 */
const UNFELLED = 7;
/**
 * The version before splitters, joiners and sorters had grades, which it kept with none. It still
 * reads: each it kept in the yard stands at the highest grade the yard may build of its kind, for
 * nothing, so that no line goes slower than it went; one kept in a blueprint, at the highest grade
 * of the belts and tunnels in that blueprint (`regraded`).
 */
const UNGRADED = 6;
/**
 * The grade of a piece kept: as it says, or where it says none, the first; but a splitter, joiner or
 * sorter that `UNGRADED` kept (`ungraded`) goes at `top`.
 */
const regraded = (k: number, grade: number | undefined, ungraded: boolean, top: () => number): number =>
  grade ?? (ungraded && REGRADED[k] === 1 ? top() : 1);

/** A goal's id, as kept. */
const goalId = (g: Goal): string => GOALS[g]?.id ?? "";

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

export interface Keep {
  /** Whether to keep the seed: never in what the page is shown. */
  readonly seed?: boolean;
  /** What the yard did while its owner was away, for the page's letter. */
  readonly away?: Away | null;
}

/**
 * A yard as text: its numbers and orders as JSON, its pieces and blueprints packed; kept as version 9
 * while it names nothing the last Leaf of version 10 did not know (`knownAt10`), and as this version
 * once it does.
 */
export function encode(y: Yard, keep: Keep = {}): string {
  const pieces = keptPieces(y);
  const rec = record(y, keep, pieces);
  return JSON.stringify({ v: keptPastTen(y, rec, pieces) ? VERSION : PLACED, ...rec });
}

/**
 * Whether a yard, kept as `rec` with its `pieces`, keeps anything the last Leaf of version 10 did not
 * know: cheaply, of what these tables have past it (`pastTen`), or while they have a thing, kind or
 * plot past it, by the whole scan (`WIDER`).
 */
function keptPastTen(y: Yard, rec: Rec, pieces: readonly KeptPiece[]): boolean {
  // A yard that has begun a clearing keeps the count of them, which that Leaf would let go.
  if (y.begun > 0) return true;
  if (!WIDER) return pastTen(y);
  const prints: unknown[] = Array.isArray(rec.blueprints) ? rec.blueprints : [];
  return !knownAt10(keptNames(rec, pieces, prints.map(keptBlueprint), y.land.w * y.land.h));
}

/** A yard as kept, but for its version. */
function record(y: Yard, keep: Keep, pieces: readonly KeptPiece[]): Rec {
  const away = keep.away === undefined ? y.away : keep.away;
  return {
    land: keptLandOf(y.land),
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
    ...(y.felled.includes(1) ? { felled: felledTiles(y) } : {}),
    ...keptClearing(y),
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
    cells: toBase64(packKept(pieces)),
    ...(y.blueprints.some((b) => b !== null)
      ? { blueprints: y.blueprints.map((b) => b && (b.whole ? { whole: printText(b) } : printText(b))) }
      : {}),
    ...(y.history.length > 0 ? { history: y.history.map((e) => toBase64(e.bytes)), stamp: stampOf(y.land) } : {}),
  };
}

/** What a kept yard, read as JSON, names, on `land` (`keptNames`); nothing for one whose pieces are not pieces, or kept on more land. */
export function namesOf(raw: unknown, land: Land = LAND): KeptNames | null {
  if (!isRec(raw) || typeof raw.cells !== "string") return null;
  const on = keptOn(raw, land);
  const bytes = fromBase64(raw.cells);
  const pieces = on && bytes ? unpackCells(bytes, on.w * on.h) : null;
  const prints: unknown[] = Array.isArray(raw.blueprints) ? raw.blueprints : [];
  return on && pieces ? keptNames(raw, pieces, prints.map(keptBlueprint), on.w * on.h) : null;
}

/**
 * Whether a kept yard, read as JSON, names anything this Leaf does not know, or a tunnel longer than
 * its longest, on `land` (`keptLater` asks): a newer Leaf's (`knownHere`).
 */
export function keptUnknown(raw: unknown, land: Land = LAND): boolean {
  const names = namesOf(raw, land);
  return names !== null && !knownHere(names);
}

/** The plot being cleared, the number it was begun as, what it asks for and what it has been given; the plots cleared, by name; and how many clearings were begun: nothing for a yard that has begun none. */
function keptClearing(y: Yard): {
  clearing?: { plot: string; begun: number; want: Record<string, number>; filled: Record<string, number> };
  cleared?: string[];
  begun?: number;
} {
  const c = y.clearing;
  return {
    ...(c
      ? { clearing: { plot: plotName(c.plot), begun: c.begun, want: tally(c.want), filled: tally(c.filled) } }
      : {}),
    ...(y.cleared.length > 0 ? { cleared: y.cleared.map(plotName) } : {}),
    ...(y.begun > 0 ? { begun: y.begun } : {}),
  };
}

/** The first tile of each redwood the yard has felled, in the land's order. */
const felledTiles = (y: Yard): number[] =>
  y.land.trees.flatMap((tiles, t) => (y.felled[t] === 1 && tiles[0] !== undefined ? [tiles[0]] : []));

// ---------- reading ----------

/** What a kept piece was paid for at the grade it was kept at, in thousandths of a Coin, at today's prices: one to hand was paid nothing. */
const paidFor = (o: KeptPiece): number =>
  o.free === true || !isKind(o.kind) ? 0 : price(o.kind, Math.max(1, o.grade ?? 1), o.span ?? 0) * MILLI;

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
  for (const o of pieces) {
    const i = whole(o.tile, tiles - 1);
    const k = o.kind;
    const d = o.dir;
    if (i === null || !isKind(k) || !isDir(d)) {
      owed += paidFor(o);
      continue;
    }
    const span = o.span ?? 0;
    // The far end of a piece that runs under tiles (a tunnel's far mouth) stands with its way in.
    if (SPANS[k] === 1 && span < 0) {
      far.push(o);
      continue;
    }
    const x = i % land.w;
    const z = (i - x) / land.w;
    const kept1 = regraded(k, o.grade, ungraded, () => highest(y.open, k));
    const may = (grade: number): boolean =>
      y.kind[i] === NONE && refusal(y, k, x, z, Infinity, d, SPANS[k] === 1 ? { span, grade } : { grade }) === null;
    const top = Math.min(kept1, Math.max(1, highest(y.open, k)));
    const grade = may(kept1) ? kept1 : top < kept1 && may(top) ? top : null;
    if (grade === null) {
      owed += paidFor(o);
      continue;
    }
    // Only a piece kept as one the yard had to hand takes the place of one: the rest were paid for.
    const spare = y.spare[k] ?? 0;
    if (o.free !== true) y.spare[k] = 0;
    const did = build(y, k, x, z, d, Infinity, SPANS[k] === 1 ? { span, grade } : { grade });
    if (o.free !== true) y.spare[k] = spare;
    if (!did.ok) {
      owed += paidFor(o);
      continue;
    }
    kept.push([i, o]);
    // Stood lower than it was kept at: the difference, as today's prices have it.
    if (grade < kept1 && o.free !== true) owed += (price(k, kept1, span) - price(k, grade, span)) * MILLI;
  }
  for (const o of far) {
    const i = whole(o.tile, tiles - 1);
    if (i !== null && y.kind[i] === o.kind && (y.span[i] ?? 0) < 0 && y.span[i] === o.span && y.dir[i] === o.dir)
      kept.push([i, o]);
  }
  for (const [i, o] of kept) keptOnto(y, i, o, studied);
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
    else y.till += plotPrice(y, p) * MILLI;
  }
  const cells: unknown[] = Array.isArray(raw.cells) ? raw.cells : [];
  // Its tiles were the guild's first land's.
  const kept = cells.map(firstPiece).filter((o) => o !== null);
  const pieces = piecesOn(FIRST_LAND, land, kept);
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
  if (kind === null || FIXED[kind] === 1 || tile === null || dir === null) return null;
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

/** The versions this one reads as its own. */
const READS: ReadonlySet<unknown> = new Set([VERSION, WIDE, PLACED, UNPLACED, UNFELLED, UNGRADED]);

/** Text as JSON, or nothing for text that is none. */
function parsed(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** A yard read back from text, on the guild's land unless another is given; nothing if the text is not a yard. */
export function decode(text: string | null | undefined, land: Land = LAND): Yard | null {
  const raw = text ? parsed(text) : null;
  if (!isRec(raw)) return null;
  // A yard of the first design was kept on the first land, and is not read on less (`holdsFirst`).
  if (raw.v === FIRST && Array.isArray(raw.cells)) return holdsFirst(land) ? fromFirst(raw, land) : null;
  if (typeof raw.cells !== "string" || !READS.has(raw.v)) return null;
  // A yard kept on more land is not read on less (`keptOn`).
  const on = keptOn(raw, land);
  const bytes = fromBase64(raw.cells);
  // Pieces with a part this Leaf does not know are a newer Leaf's (`NEWER`): not read, as bytes that are not pieces.
  const pieces = on && bytes ? unpackCells(bytes, on.w * on.h) : null;
  if (!on || !Array.isArray(pieces)) return null;
  const prints: unknown[] = Array.isArray(raw.blueprints) ? raw.blueprints : [];
  const kept = prints.map(keptBlueprint);
  // Anything this Leaf does not know, anywhere: a newer Leaf's yard (`keptLater`), not read with it let go.
  if (!knownHere(keptNames(raw, pieces, kept, on.w * on.h))) return null;
  return vouch(raw, piecesOn(on, land, pieces), kept, land, on);
}

/**
 * A kept blueprint read back as it was kept: its pieces, each of a real kind and way, or nothing; a
 * plan of the whole yard's on the tiles as far from the yard plot's corner as they were kept on (`shift`
 * takes them there). Whether the yard may set it down now is
 * the rules' to say when it does. A splitter, joiner or sorter kept in it with no grade by a version
 * that gave them none (`ungraded`) is at the highest grade of the belts and tunnels it is kept with.
 */
function blueprint(
  print: KeptBlueprint | undefined,
  ungraded: boolean,
  shift: readonly [number, number],
): Print | null {
  const v = print?.pieces;
  if (!v) return null;
  // A plan of the whole yard's tiles are the land's it was kept on; a blueprint's, from the corner of its box.
  const [sx, sy] = print.whole ? shift : [0, 0];
  const line = (): number => Math.max(1, ...v.flatMap((p) => (LINED[p.kind] === 1 ? [p.grade ?? 1] : [])));
  const pieces: Piece[] = [];
  for (const { kind: k, x: kx, y: ky, dir: d, span, recipe, open: lets, tint, ways, grade: kept } of v) {
    const grade = regraded(k, kept, ungraded, line);
    const [x, z] = [kx + sx, ky + sy];
    if (!isKind(k) || FIXED[k] === 1 || !isDir(d)) return null;
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
  if (pieces.length === 0) return null;
  const all = print.whole;
  return { pieces: packPieces(all ? pieces : placed(pieces, 0, 0, 0)), whole: all };
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

/** Puts back what a yard did to its land, once its plots are back: the redwoods it felled, and its clearing. */
function landOnto(y: Yard, raw: Rec, on: KeptLand): void {
  felledOnto(y, raw.felled, on);
  clearedOnto(y, raw.cleared);
  clearingOnto(y, raw.clearing, raw.begun);
}

/** Puts back the plots cleared, each the land has with a clearing, once; anything else kept is let go. */
function clearedOnto(y: Yard, cleared: unknown): void {
  for (const name of Array.isArray(cleared) ? cleared.slice(0, y.land.plots.length) : []) {
    const p = plotNamed(name);
    const onLand = p !== null && y.land.plots.some((q) => q.plot === p);
    if (onLand && CLEARING[p] && !y.cleared.includes(p)) y.cleared.push(p);
  }
}

/**
 * Puts back how many clearings the yard has begun, and the plot being cleared, if it could be taken
 * on now: by the number it was begun as (one the count has reached), asking for what it asked for
 * when it began (something), and with what it was given, no more than it wants.
 */
function clearingOnto(y: Yard, kept: unknown, begun: unknown): void {
  y.begun = whole(begun, 1e9) ?? 0;
  y.clearing = isRec(kept) ? clearingOf(y, kept) : null;
}

/** A kept clearing as `clearingOnto` puts it back, once the count begun is back; nothing for one it does not. */
function clearingOf(y: Yard, kept: Record<string, unknown>): Yard["clearing"] {
  const p = plotNamed(kept.plot);
  const n = whole(kept.begun, y.begun);
  const want = untally(kept.want, 1e6);
  if (p === null || !n || clearRefusal(y, p) !== null || !want.some((k) => k > 0)) return null;
  const given = untally(kept.filled, 1e6);
  const filled = counts();
  for (const k of ALL_ITEMS) filled[k] = Math.min(given[k] ?? 0, want[k] ?? 0);
  return { plot: p, begun: n, want, filled };
}

/**
 * Fells each redwood kept as felled, by a tile of it on the land the yard was kept on (`on`), on a
 * plot the yard owns; anything else kept is let go. No more are read than the land has redwoods, as many as a yard ever keeps.
 */
function felledOnto(y: Yard, kept: unknown, on: KeptLand): void {
  const { land } = y;
  for (const v of Array.isArray(kept) ? kept.slice(0, land.trees.length) : []) {
    const i = tileOn(on, land, whole(v, on.w * on.h - 1) ?? -1);
    const t = land.tree[i] ?? -1;
    const plot = land.plots[land.plot[i] ?? NONE];
    if (t >= 0 && plot && y.plots.includes(plot.plot)) y.felled[t] = 1;
  }
}

/**
 * A yard from a kept record: its numbers as JSON gives them, its pieces (on tiles of `land`), and its
 * blueprints' pieces, which, with the redwoods it felled, are on tiles of the land it was kept on (`on`).
 * Every field's shape is checked, and every piece built again through the rules; what depends on
 * today's tuning is clamped or carried, and what cannot stand is paid back.
 */
export function vouch(
  raw: Rec,
  pieces: readonly KeptPiece[],
  prints: readonly KeptBlueprint[],
  land: Land,
  on: KeptLand,
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
  const shift = [land.origin[0] - on.x, land.origin[1] - on.y] as const;
  y.blueprints = Array.from({ length: BLUEPRINTS_MOST }, (_, k) => blueprint(prints[k], ungraded, shift));

  // Plots in the order they were bought, each that the land has.
  for (const name of raw.plots) {
    const p = plotNamed(name);
    if (p !== null && !y.plots.includes(p) && land.plots.some((q) => q.plot === p)) y.plots.push(p);
  }

  // The redwoods it felled and its clearing, before its pieces stand where they stood.
  landOnto(y, raw, on);
  y.till += stand(y, pieces, studied, ungraded);

  fillBoard(y);
  // A yard kept before it knew its owner's last command is taken as last seen at its last tick.
  const seen = isRec(raw.seen) ? raw.seen : {};
  const last = whole(seen.tick, tick);
  const had = whole(seen.till, 1e12);
  y.seen = last === null || had === null ? here(y) : { tick: last, till: had, depot: untally(seen.depot, 1e12) };
  // What Undo would undo, as kept: none for a yard kept before it had any, or under other rules or another land.
  y.history = historyOf(raw.history, raw.stamp, land);
  y.news = [];
  return y;
}
