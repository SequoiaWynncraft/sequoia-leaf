/**
 * The Works' writer cases: yards made to take every branch of the yard's writer (`codec.ts`'s
 * `record`, `cells.ts`'s parts), not whatever play happened to leave, so that the pins hold every
 * field the writer can write and every part of a piece's bytes. Each is kept as a stored row with the
 * material it was written from (`state.ts`), which it must read as for ever.
 *
 * - `yard-v9-full`, `yard-v11-full`: a yard of each version the writer writes now, with every
 *   optional field set: the away letter, Undo's entries, a queue, a node given things, orders, plain
 *   blueprints and a plan of the whole yard; and in version 11, redwoods felled, a plot cleared,
 *   another being cleared, part filled, and smog;
 * - `yard-v11-part-<part>`: a yard of one piece, on the guild's land, with one part of its bytes set
 *   to a value that is not its kind's new one (`PARTS`); its bytes from the piece's own on are pinned
 *   as `cells` (`bytesOf`), which is the layout itself: the part's bit, where its payload goes and how
 *   it is written;
 * - a standing, a postcard and each thing the Works logs, by the command that logs it.
 */
import { LOGGED, type Logged } from "@sequoia-leaf/core";
import { type Row, sawLogs, Seen, versionOf } from "@sequoia-leaf/core/review/pins.ts";

import { fromBase64 } from "../src/bytes.ts";
import { unpackCells } from "../src/cells.ts";
import * as F from "../src/index.ts";
import { keptOn } from "../src/keptland.ts";
import { bareLand } from "../test/land.ts";
import { near } from "../test/near.ts";
import { boardFilled } from "../test/player.ts";
import { bought, buying, fillHand, must, staged } from "../test/yards.ts";
import { material } from "./state.ts";

/** For each shape, the versions the Works' writers write now. The standing, the postcard and the logs keep none of their own: their 1 stands for one. */
export const VERSIONS: Readonly<Record<string, readonly number[]>> = {
  yard: [F.PLACED, F.VERSION],
  cells: [F.VERSION],
  standing: [1],
  postcard: [1],
  [LOGGED.worksPlot]: [1],
  [LOGGED.worksOrder]: [1],
  [LOGGED.worksStory]: [1],
};
/** Within a yard, the records keyed by names of things or goals rather than by fields. */
const MAPS = new Set([
  "depot",
  "seen.depot",
  "away.made",
  "got",
  "got.*",
  "board[].want",
  "board[].filled",
  "clearing.want",
  "clearing.filled",
  "smog",
]);
export const seenNow = (): Seen => new Seen({ yard: MAPS });

// ---------- what a pin sees of a yard ----------

/** The parts a blueprint's piece says follow its way, a bit each (`prints.ts`), by name. */
const PRINT_PARTS: readonly [number, string][] = [
  [4, "span"],
  [8, "tint"],
  [16, "ways"],
  [32, "shut"],
  [64, "recipe"],
  [128, "grade"],
];
/** A blueprint as kept, by its parts: each piece's that follow its way. A bit no name is known for stops the read there. */
function printParts(text: unknown): unknown {
  const bytes = typeof text === "string" ? fromBase64(text) : null;
  if (!bytes) return text;
  const pieces: Record<string, 1>[] = [];
  for (let at = 0; at + 4 <= bytes.length;) {
    const flags = bytes[at + 3] ?? 0;
    const parts: Record<string, 1> = {};
    for (let bit = 4; bit < 256; bit *= 2)
      if ((flags & bit) !== 0) parts[PRINT_PARTS.find(([b]) => b === bit)?.[1] ?? `bit ${bit}`] = 1;
    pieces.push(parts);
    if (Object.keys(parts).some((p) => p.startsWith("bit "))) break;
    at += 4 + PRINT_PARTS.filter(([b]) => b !== 32 && (flags & b) !== 0).length;
  }
  return pieces;
}
/** A kept blueprint as its pin sees it: a plan of the whole yard with every key beside its packed pieces, which are read into parts. */
function blueprintParts(b: unknown): unknown {
  if (typeof b !== "object" || b === null || !("whole" in b)) return printParts(b);
  return { ...b, whole: printParts(b.whole) };
}
/** A kept yard as its pin sees it: its record, with its pieces and blueprints read into the parts each keeps. */
export function pinValue(text: string, land: F.Land = F.LAND): unknown {
  const raw: unknown = JSON.parse(text);
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return raw;
  const rec: Record<string, unknown> = { ...raw };
  const on = keptOn(rec, land);
  const bytes = typeof rec.cells === "string" ? fromBase64(rec.cells) : null;
  const cells = on && bytes ? unpackCells(bytes, on.w * on.h) : null;
  // A kind past 15 is a part of its own (`high`): it is told by the kind alone.
  if (Array.isArray(cells)) rec.cells = [...cells, ...(cells.some((p) => p.kind > 15) ? [{ high: 1 }] : [])];
  if (Array.isArray(rec.blueprints)) rec.blueprints = rec.blueprints.map(blueprintParts);
  return rec;
}
/** What Leaf stores of a yard, as its writers write it: the yard (a row kept as `kept`, if given), its standing and its postcard. */
export function watch(seen: Seen, y: F.Yard, kept?: string, read: unknown = material(y)): void {
  const text = F.FACTORY.encode(y);
  const as = (row: Row): ({ readonly as: string } & Row) | undefined =>
    kept === undefined ? undefined : { as: kept, ...row };
  seen.saw("yard", versionOf(text), pinValue(text, y.land), as({ text, read }));
  // A standing and a postcard are kept of the full yards alone: they have no branches of their own.
  const also = (row: Row): ({ readonly as: string } & Row) | undefined => (kept === "full" ? as(row) : undefined);
  const standing = F.FACTORY.standing?.(y);
  seen.saw("standing", 1, standing, also({ text: JSON.stringify(standing), read: standing }));
  const postcard = F.FACTORY.postcard?.(y);
  seen.saw("postcard", 1, postcard, also({ text: JSON.stringify(postcard), read: postcard }));
}
// ---------- every field of a yard of each version ----------

const PLANK = F.item("plank");

/** A command off the wire, with an id, done, or the case fails: what it logged. */
function sent(y: F.Yard, c: Record<string, unknown>): readonly Logged[] {
  const read = F.FACTORY.command({ tick: y.tick, id: `case-${y.rev}`, ...c });
  if (!read) throw new Error(`${JSON.stringify(c)} does not read`);
  const done = F.play(y, read);
  if ("refused" in done) throw new Error(`${JSON.stringify(c)} was refused: ${done.why}`);
  return done.log ?? [];
}
/**
 * The fields every yard may have set: the away letter, things delivered and seen, a node in hand
 * given things, a queue, an order part filled, a tunnel, Undo's entries, a plain blueprint and a plan
 * of the whole yard, and belts raised a grade.
 */
function everyField(y: F.Yard): void {
  const made = F.counts();
  made[PLANK] = 40;
  y.away = { seconds: 900, coins: 12, made };
  y.depot[PLANK] = (y.depot[PLANK] ?? 0) + 25;
  y.seen = F.here(y);
  const ready = (id: string): boolean => F.ready(y.open, F.goal(id)) && !y.done.includes(F.goal(id));
  const nodes = F.NODES.filter((n) => n.tier === y.open.tier && ready(n.id)).map((n) => n.id);
  if (y.hand === -1 && nodes[0]) sent(y, { do: "take", node: nodes[0] });
  const hand = y.hand;
  given(y);
  for (const node of nodes.filter((id) => F.goal(id) !== hand).slice(0, 2)) sent(y, { do: "queue", node });
  // An order part filled once it counts.
  while (y.board.some((b) => b.starts > y.tick)) F.step(y);
  const o = y.board[0];
  const n = o && F.ALL_ITEMS.find((k) => (o.want[k] ?? 0) > 1);
  if (o && n !== undefined) o.filled[n] = 1;
  // Three belts north-west of the depot, where none stand, raised a grade.
  for (const dx of [-3, -2, -1]) {
    const [x, z] = xyOf(y, dx, -3);
    if (y.kind[F.at(y, x, z)] === F.NONE) F.build(y, F.BELT, x, z, 0, Infinity);
  }
  const belts = F.within(y, ...xyOf(y, -3, -3), ...xyOf(y, -1, -3));
  sent(y, { do: "upgrade", tiles: belts });
  // South of the depot, a piece with each thing a blueprint keeps of one: a belt painted and raised,
  // a splitter with a way shut, a bench told to make, a crate shut, a tunnel under two tiles.
  stood(y, "belt", -2, 4, { grade: 2 });
  y.tint[F.at(y, ...xyOf(y, -2, 4))] = 3;
  stood(y, "splitter", -1, 4);
  y.shut[F.at(y, ...xyOf(y, -1, 4))] = 2;
  stood(y, "bench", 0, 4);
  y.set[F.at(y, ...xyOf(y, 0, 4))] = F.item("tool");
  stood(y, "crate", 1, 4);
  y.holders.open[F.holderOf(y, F.at(y, ...xyOf(y, 1, 4)))] = 0;
  stood(y, "tunnel", 2, 4, { span: 2, grade: 1 });
  sent(y, { do: "saveBlueprint", slot: 0, tiles: belts });
  sent(y, { do: "saveBlueprint", slot: 2, tiles: F.within(y, ...xyOf(y, -2, 4), ...xyOf(y, 5, 4)) });
  sent(y, { do: "saveYard", slot: 1 });
}
/** A piece stood from the depot, or the case fails. */
function stood(y: F.Yard, kind: F.KindName, dx: number, dy: number, lay: F.Lay = {}): void {
  const did = F.build(y, F.kind(kind), ...xyOf(y, dx, dy), 0, Infinity, lay);
  if (!did.ok) throw new Error(`the case's ${kind} is refused: ${did.why}`);
}
const xyOf = (y: F.Yard, dx: number, dy: number): [number, number] => [y.land.depot[0] + dx, y.land.depot[1] + dy];

/** The node in hand given one of something it wants. */
function given(y: F.Yard): void {
  const hand = y.hand;
  if (hand === -1) return;
  const got = F.counts();
  const wanted = F.ALL_ITEMS.find((k) => (F.GOALS[hand]?.want[k] ?? 0) > 1);
  if (wanted !== undefined) got[wanted] = 1;
  y.got[hand] = got;
}
/** Goals done as the case says, not by play: the node or research a field needs open. */
function opened(y: F.Yard, ids: readonly string[]): void {
  for (const id of ids) if (!y.done.includes(F.goal(id))) y.done.push(F.goal(id));
  F.reopen(y);
  if (y.hand === -1 || y.done.includes(y.hand)) F.hold(y, F.nextHand(y.open));
}
/** A yard kept as version 9: the gate's, tier 4 open, a plan of the whole yard studied, and a node finished that the next command logs. */
function fullV9(): F.Yard {
  const y = staged("gate");
  opened(y, ["shelves", "wholeyard"]);
  everyField(y);
  // The node in hand finished by what arrives at the depot, between commands: not logged yet (`told`).
  fillHand(y);
  F.step(y);
  given(y);
  return y;
}
/**
 * A yard kept as version 11: tier 5 open, the Meadow bought and its redwood felled, The Old
 * Workings cleared and bought, another plot being cleared, part filled, and smog on two plots.
 */
function fullV11(): F.Yard {
  const y = F.create({ seed: 5, tier: 5 });
  must(y, buying(y, "meadow"));
  opened(y, ["shelves", "wholeyard", "felling"]);
  sent(y, { do: "fell", ...near(-2, 15), price: F.fellPrice(y) });
  bought(y, "workings");
  const next = y.land.plots.find((p) => p.ring === 2 && F.clearRefusal(y, p.plot) === null);
  if (next) {
    sent(y, { do: "clearPlot", plot: F.plotName(next.plot) });
    const want = y.clearing?.want;
    const n = F.ALL_ITEMS.find((k) => (want?.[k] ?? 0) > 1);
    if (n !== undefined) y.clearing?.filled.set([...F.counts()].map((_, k) => (k === n ? 1 : 0)));
  }
  for (const [p, level] of [
    [0, 40],
    [1, 12],
  ] as const) {
    F.setLevel(y, p, level);
    y.smog.made[p] = 7;
  }
  everyField(y);
  return y;
}

// ---------- every part of a piece's bytes ----------

/** A part of a piece's bytes: its bit (`cells.ts`), the kind it is set on, and how it is set. */
interface Part {
  readonly bit: number;
  readonly name: string;
  readonly kind: F.KindName;
  readonly set?: (y: F.Yard, i: number, r: number) => void;
  /** For a tunnel, how many tiles it passes under. */
  readonly span?: number;
  readonly grade?: number;
  /**
   * The part can be written but no piece the rules have now puts it back (no recipe has a by-product
   * yet): what the row must read as is the piece before it was set, and the part is held by its bytes alone.
   */
  readonly wire?: true;
}
/** A machine told to make a thing and making it, holding what its recipe takes, `work` half-ticks on. */
function making(y: F.Yard, i: number, r: number, n: F.Item, work: number): void {
  const rec = F.RECIPE[n];
  if (!rec) throw new Error(`nothing makes ${F.itemName(n)}`);
  rec.from.forEach((from, p) => {
    for (let c = 0; c < (rec.need[p] ?? 1); c++) F.put(y.holders, r, from);
  });
  y.set[i] = n;
  y.holders.making[r] = n;
  y.holders.work[r] = work;
}
export const PART_CASES: readonly Part[] = [
  { bit: 0, name: "carried", kind: "belt", set: (y, i) => ((y.item[i] = PLANK), (y.prog[i] = 5)) },
  { bit: 2, name: "held", kind: "crate", set: (y, _, r) => [1, 2, 3].forEach(() => F.put(y.holders, r, PLANK)) },
  { bit: 4, name: "out", kind: "mill", set: (y, _, r) => (y.holders.out[r] = PLANK) },
  { bit: 8, name: "work", kind: "mill", set: (y, i, r) => making(y, i, r, PLANK, 3) },
  { bit: 16, name: "making", kind: "bench", set: (y, i, r) => making(y, i, r, F.item("tool"), 0) },
  { bit: 32, name: "turn", kind: "splitter", set: (y, i) => (y.turn[i] = 2) },
  { bit: 64, name: "recipe", kind: "bench", set: (y, i) => (y.set[i] = F.item("tool")) },
  { bit: 128, name: "span", kind: "tunnel", span: 3 },
  { bit: 256, name: "closed", kind: "crate", set: (y, _, r) => (y.holders.open[r] = 0) },
  { bit: 512, name: "fuel", kind: "boiler", set: (y, _, r) => (y.holders.fuel[r] = 9) },
  {
    bit: 1024,
    name: "free",
    kind: "belt",
    set: (y, i) => {
      y.free[i] = 1;
      y.spare[F.BELT] = (y.spare[F.BELT] ?? 0) - 1;
    },
  },
  { bit: 2048, name: "tint", kind: "belt", set: (y, i) => (y.tint[i] = 3) },
  { bit: 4096, name: "ways", kind: "splitter", set: (y, i) => (y.shut[i] = 2) },
  { bit: 8192, name: "grade", kind: "belt", grade: 3 },
  { bit: 16384, name: "high", kind: "assembler" },
  { bit: 32768, name: "also", kind: "still", set: (y, _, r) => (y.holders.also[r] = F.item("creosote")), wire: true },
  {
    bit: 65536,
    name: "more",
    kind: "assembler",
    set: (y, _, r) => {
      y.holders.out[r] = F.item("gear");
      y.holders.more[r] = 2;
    },
  },
  { bit: 131072, name: "mix", kind: "breaker", set: (y, _, r) => (y.holders.mix[r] = 2) },
  { bit: 131072, name: "mix-still", kind: "still", set: (y, _, r) => (y.holders.mix[r] = 2) },
  { bit: 262144, name: "quarter", kind: "mill", set: (y, _, r) => (y.holders.quarter[r] = 3) },
];

/**
 * The small bare land the part yards' bytes are pinned on, so that the whole of them (how many pieces,
 * the tiles between them) is the same for ever, as no more land round the guild's moves it.
 */
export const PART_LAND = bareLand(24, 16, [], [5, 8]);

/**
 * A yard of the one piece a part is set on, three tiles south-east of the depot, facing east, with
 * tier 6 open: on the guild's land, or another (`PART_LAND`); and what it must read as.
 */
export function partYard(part: Part, land: F.Land = F.LAND): { y: F.Yard; read: unknown } {
  const y = F.create({ seed: 1, tier: 6, land });
  // Every research of tier 6 and below known, so that every kind may stand.
  opened(
    y,
    F.RESEARCH.filter((r) => r.tier <= 6).map((r) => r.id),
  );
  const [x, z] = xyOf(y, 3, 3);
  const k = F.kind(part.kind);
  const did = F.build(y, k, x, z, 0, Infinity, {
    grade: part.grade ?? 1,
    ...(part.span === undefined ? {} : { span: part.span }),
  });
  if (!did.ok) throw new Error(`a ${part.kind} for ${part.name} does not stand: ${did.why}`);
  const i = F.at(y, x, z);
  // One of the pieces to hand stood here goes back to hand: the part says whether it is one.
  if (y.free[i] === 1) {
    y.free[i] = 0;
    y.spare[k] = (y.spare[k] ?? 0) + 1;
  }
  y.history = [];
  const before = part.wire ? material(y) : null;
  part.set?.(y, i, F.holderOf(y, i));
  return { y, read: before ?? material(y) };
}

/** A varint at `at` in the bytes, and where the bytes go on after it. */
function varint(bytes: Uint8Array, at: number): [number, number] {
  let v = 0;
  let shift = 0;
  let to = at;
  for (let b = 128; (b & 128) !== 0; shift += 7) {
    b = bytes[to++] ?? 0;
    v += (b & 127) * 2 ** shift;
  }
  return [v, to];
}
/**
 * A part yard's pieces' bytes as the writer writes them, whole, as hex: how many pieces, then each
 * piece's tiles since the last, its kind and way, what it carries, the parts said to follow (a bit
 * each) and their payload; and the first piece's parts, by their bits.
 */
export function bytesOf(text: string): { hex: string; bits: number } {
  const raw: unknown = JSON.parse(text);
  const cells = typeof raw === "object" && raw !== null && "cells" in raw ? raw.cells : null;
  const bytes = typeof cells === "string" ? fromBase64(cells) : null;
  if (!bytes) throw new Error("no pieces' bytes");
  const [, afterCount] = varint(bytes, 0);
  const [, from] = varint(bytes, afterCount);
  const head = bytes[from] ?? 0;
  const carried = (head & 64) !== 0 ? 2 : 0;
  const [bits] = (head & 128) !== 0 ? varint(bytes, from + 1 + carried) : [0];
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join(" ");
  return { hex, bits: bits | ((head & 64) !== 0 ? 1 : 0) };
}

// ---------- all the cases ----------

/** Every writer case, seen by `seen`: the full yards and the part yards, each kept as a row, and each thing the Works logs. */
export function cases(seen: Seen): void {
  watch(seen, fullV9(), "full");
  watch(seen, fullV11(), "full");
  for (const part of PART_CASES) {
    const { y, read } = partYard(part);
    watch(seen, y, `part-${part.name}`, read);
    const { hex } = bytesOf(F.FACTORY.encode(partYard(part, PART_LAND).y));
    seen.saw("cells", F.VERSION, { [`${part.name}: ${hex}`]: 1 });
  }
  // What the Works logs: a plot bought, an order handed over, a story node finished.
  const plotted = F.create({ seed: 5, tier: 5 });
  sawLogs(seen, sent(plotted, buying(plotted, "meadow")), "meadow");
  const board = boardFilled();
  sawLogs(seen, sent(board, { do: "handOver", order: board.board[0]?.id ?? -1 }), "handed");
  const story = F.create({ seed: 1 });
  fillHand(story);
  F.step(story);
  sawLogs(seen, sent(story, { do: "collect" }), "first");
}
