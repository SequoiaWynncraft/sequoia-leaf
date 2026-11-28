/**
 * The Works' goldens: what today's rules do, written down, so that a change meant to change nothing
 * proves it, and one meant to change something shows what it changed:
 *
 *     bun review/golden.ts           # every golden against the rules now: what differs, set by set
 *     bun review/golden.ts --write   # the same, then the goldens written as the rules have them now
 *
 * `golden.test.ts` holds them in `bun run verify`. Regenerating one is a line in the PR's
 * description saying why. In `golden/`:
 *
 * - `yards.txt`: a staged yard at every stage of each tier, made by the tests' stagers (`test/yards.ts`
 *   and the tier 5 and 6 yards), each run on `TICKS` ticks; by a hash of where it started and one of
 *   every piece's holding and carrying, its Coins, power, research and orders where it ended;
 * - `scripts.txt`: commands read off the wire as Leaf takes them (`FACTORY.command`), each done or
 *   refused by `FACTORY.apply`: building, laying, recipes, removing, Undo, research, upgrading,
 *   blueprints pasted and set down, plots, orders and felling; by a hash of what each did (refused
 *   with what, or what it paid and logged) and one of the yard at the end;
 * - `long.txt`: a yard brought on 8 hours as Leaf brings one: in one go (`advance`), in `tend`'s
 *   slices, and in slices with the yard stored and read back between each, as Leaf may let go of its
 *   copy between them;
 * - `keys.txt` and `stored/`: the keys of each shape the Works has Leaf store (the yard, its pieces'
 *   parts, its standing, its postcard, what it logs), pinned beside its version, and a row of each at
 *   each version (`@sequoia-leaf/core/review/pins.ts`).
 *
 * What a golden hashes is what the rules did, never how a yard is stored: a piece by where it stands
 * from the yard plot's corner and its kind's name, a thing by its name, a goal by its id, so that more
 * land round the yard, or a new tier's content anywhere in the tables, moves no golden of a yard that
 * never uses it. A change of the stored shape alone changes no golden but `keys.txt`.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";

import { type Ctx, isRefused, type Logged } from "@sequoia-leaf/core";
import { type Golden, goldensIn, goldensText, Hash, hashOf, tell } from "@sequoia-leaf/core/review/golden.ts";
import { Pinned, Seen, writePins } from "@sequoia-leaf/core/review/pins.ts";

import { fromBase64 } from "../src/bytes.ts";
import { PARTS, unpackCells } from "../src/cells.ts";
import * as F from "../src/index.ts";
import { keptOn } from "../src/keptland.ts";
import { roadbedYard } from "../test/roadbed.ts";
import { townlightYard } from "../test/townlight.ts";
import { junctions, staged, STAGES } from "../test/yards.ts";
import { type Script, SCRIPTS, type Step } from "./scripts.ts";

export const GOLDEN = new URL("golden/", import.meta.url);
export const PINS = new Pinned(GOLDEN);
/** How long each staged yard is run on: ten minutes of the yard's time. */
export const TICKS = 6000;
const HOUR_MS = 3600 * 1000;

// ---------- what the rules did, as plain values ----------

const itemOf = (n: number): string | null => (F.isItem(n) ? F.itemName(n) : null);
const goalOf = (g: number): string => F.GOALS[g]?.id ?? `goal ${g}`;
/** A count of each thing, by name, in the names' order: none of what there is none of. */
const tallied = (c: F.Counts): [string, number][] =>
  F.ALL_ITEMS.flatMap((n): [string, number][] => ((c[n] ?? 0) > 0 ? [[F.itemName(n), c[n] ?? 0]] : [])).toSorted(
    ([a], [b]) => (a < b ? -1 : 1),
  );
/** Where a tile is from the yard plot's corner. */
const placeOf = (y: F.Yard, i: number): [number, number] => [
  (i % y.land.w) - y.land.origin[0],
  Math.floor(i / y.land.w) - y.land.origin[1],
];

/** What a holder holds and is doing; not what it found last time it looked, which it works out again. */
function holding(y: F.Yard, i: number): unknown {
  const h = y.holders;
  const r = F.holderOf(y, i);
  if (r < 0) return null;
  const stock = F.ALL_ITEMS.flatMap((n): [string, number][] =>
    F.held(h, r, n) > 0 ? [[F.itemName(n), F.held(h, r, n)]] : [],
  ).toSorted(([a], [b]) => (a < b ? -1 : 1));
  const [out, also, making] = [h.out[r] ?? F.NONE, h.also[r] ?? F.NONE, h.making[r] ?? F.NONE];
  return [
    itemOf(out),
    itemOf(also),
    h.more[r],
    itemOf(making),
    h.work[r],
    h.mix[r],
    h.quarter[r],
    h.open[r],
    h.fuel[r],
    stock,
  ];
}
/** What a tunnel's way-in mouth carries under the ground. */
function under(y: F.Yard, i: number): unknown {
  const r = F.tunnelOf(y, i);
  const span = y.span[i] ?? 0;
  if (r < 0 || span <= 0) return null;
  const at = r * F.SPAN_MOST;
  return [[...y.tunnels.under.subarray(at, at + span)].map(itemOf), [...y.tunnels.along.subarray(at, at + span)]];
}
/** A piece on its own tile: where, what, how it is set, what it carries, holds and is doing. */
function piece(y: F.Yard, i: number): unknown {
  const k = y.kind[i] ?? F.NONE;
  if (!F.isKind(k)) return [];
  const set = [y.dir[i], y.grade[i], y.tint[i], y.turn[i], y.shut[i], y.first[i], y.ins[i], itemOf(y.set[i] ?? F.NONE)];
  return [
    [...placeOf(y, i), F.kindName(k), ...set, y.free[i], y.span[i]],
    [itemOf(y.item[i] ?? F.NONE), y.prog[i]],
    holding(y, i),
    under(y, i),
  ];
}
const order = (o: F.Standing): unknown => [
  o.id,
  o.title,
  o.from,
  o.line,
  o.pay,
  o.starts,
  tallied(o.want),
  tallied(o.filled),
];
const print = (b: F.Print | null): unknown =>
  b && [
    b.whole,
    F.piecesOf(b.pieces).map((p) => [
      [F.kindName(p.kind), p.x, p.y, p.dir, p.span, itemOf(p.recipe ?? F.NONE)],
      [p.open ?? true, p.tint ?? 0, p.shut ?? 0, p.first ?? 0, p.ins ?? 0, p.grade ?? 1],
    ]),
  ];

const plotOf = (p: F.Plot): string => F.plotName(p);
/** A yard as the rules left it: every piece, and its Coins, power, research, orders, plots and smog. */
export function yardState(y: F.Yard): Readonly<Record<string, unknown>> {
  const pieces: unknown[] = [];
  for (let i = 0; i < y.kind.length; i++) if (y.kind[i] !== F.NONE && y.part[i] === 0) pieces.push(piece(y, i));
  const smog = y.land.plots.flatMap((p, n) =>
    (y.smog.level[n] ?? 0) > 0 || (y.smog.made[n] ?? 0) > 0 ? [[plotOf(p.plot), y.smog.level[n], y.smog.made[n]]] : [],
  );
  const felled = y.land.trees.flatMap((tiles, t) => (y.felled[t] === 1 ? [placeOf(y, tiles[0] ?? 0)] : []));
  const spare = F.ALL_KINDS.flatMap((k) => ((y.spare[k] ?? 0) > 0 ? [[F.kindName(k), y.spare[k]]] : []));
  const c = y.clearing;
  return {
    clock: [y.tick, y.at, y.seen.tick, y.seen.till],
    coins: [y.till, y.bank, y.told, y.paid, y.sold, y.handed, y.serial, y.swapAt],
    power: [y.powered, y.supply, y.demand, y.charge],
    depot: tallied(y.depot),
    plots: [
      y.plots.map(plotOf),
      y.cleared.map(plotOf),
      y.begun,
      c && [plotOf(c.plot), c.start, tallied(c.want), tallied(c.filled)],
    ],
    land: [smog, felled, spare],
    goals: [
      y.open.tier,
      y.done.map(goalOf),
      y.hand === -1 ? null : goalOf(y.hand),
      y.queue.map(goalOf),
      y.line.map(goalOf),
    ],
    got: y.got.flatMap((got, g) => (got && tallied(got).length > 0 ? [[goalOf(g), tallied(got)]] : [])),
    board: y.board.map(order),
    blueprints: y.blueprints.map(print),
    history: y.history.map((e) => e.id),
    away: y.away && [y.away.seconds, y.away.coins, tallied(y.away.made)],
    pieces,
  };
}

/** A yard in words: its tier, its pieces, what it has earned and what it has done. */
function inWords(y: F.Yard): string {
  let pieces = 0;
  for (let i = 0; i < y.kind.length; i++) if (y.kind[i] !== F.NONE && y.part[i] === 0) pieces++;
  const delivered = tallied(y.depot).reduce((a, [, n]) => a + n, 0);
  const coins = Math.floor((y.paid + y.sold) / F.MILLI);
  return `tier ${y.open.tier}, ${pieces} pieces, ${y.done.length} goals done, ${Math.floor(delivered)} delivered, ${coins} Coins earned, ${Math.floor(y.till / F.MILLI)} in the till`;
}

// ---------- what the goldens see of what Leaf stores ----------

/** The shapes the Works has Leaf store, and each one's version now. The standing, the postcard and the logs keep none of their own: their number stands for one. */
export const VERSIONS: Readonly<Record<string, number>> = {
  yard: F.VERSION,
  cells: F.VERSION,
  standing: 1,
  postcard: 1,
  works_plot: 1,
  works_order: 1,
  works_story: 1,
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

/** The parts of a piece's bytes, by their bit (`cells.ts`), as the pins name them. */
const PART_NAMES: Readonly<Record<number, string>> = {
  2: "held",
  4: "out",
  8: "work",
  16: "making",
  32: "turn",
  64: "recipe",
  128: "span",
  256: "closed",
  512: "fuel",
  1024: "free",
  2048: "tint",
  4096: "ways",
  8192: "grade",
  16384: "high",
  32768: "also",
  65536: "more",
  131072: "mix",
  262144: "quarter",
};
/** The parts this Leaf's reader knows, as it says them (`PARTS`): what may be in a yard of this version. */
export function partsKnown(): Record<string, 1> {
  const out: Record<string, 1> = {};
  for (let bit = 1; bit <= PARTS; bit *= 2) if ((PARTS & bit) !== 0) out[PART_NAMES[bit] ?? `bit ${bit}`] = 1;
  return out;
}
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
  if (Array.isArray(rec.blueprints))
    rec.blueprints = rec.blueprints.map((b: unknown) =>
      typeof b === "object" && b !== null && "whole" in b ? { whole: printParts(b.whole) } : printParts(b),
    );
  return rec;
}
const versionOf = (text: string): number => {
  const raw: unknown = JSON.parse(text);
  return typeof raw === "object" && raw !== null && "v" in raw && typeof raw.v === "number" ? raw.v : -1;
};
/** What Leaf stores of a yard: the yard (a row kept as `kept`, if given), its standing and its postcard. */
export function watch(seen: Seen, y: F.Yard, kept?: string): void {
  const text = F.FACTORY.encode(y);
  seen.saw("yard", versionOf(text), pinValue(text, y.land), kept === undefined ? undefined : { as: kept, text });
  seen.saw("cells", F.VERSION, partsKnown());
  seen.saw("standing", VERSIONS.standing ?? 1, F.FACTORY.standing?.(y));
  seen.saw("postcard", VERSIONS.postcard ?? 1, F.FACTORY.postcard?.(y));
}
const watchLog = (seen: Seen, log: readonly Logged[]): void => {
  for (const l of log) seen.saw(l.kind, VERSIONS[l.kind] ?? 0, l.data);
};

// ---------- staged yards, run on ----------

/** The staged yards: every stage the tests' stagers make, and tier 5's and 6's. */
export const YARDS: readonly (readonly [string, () => F.Yard])[] = [
  ...STAGES.map((s): [string, () => F.Yard] => [s, () => staged(s)]),
  ["junctions", junctions],
  ["townlight", () => townlightYard()],
  ["townlight without slag", () => townlightYard(false)],
  ["roadbed", () => roadbedYard()],
  ["roadbed without cracking", () => roadbedYard(false)],
];
/** The cases whose yard is kept as a stored row, by what the row is called: those on the guild's land, which a row is read on. */
const KEPT: Readonly<Record<string, string>> = { small: "small", gate: "gate", junctions: "junctions" };

export function yardLine(name: string, make: () => F.Yard, seen: Seen): Golden {
  const y = make();
  const start = hashOf(yardState(y));
  watch(seen, y);
  for (let k = 0; k < TICKS; k++) F.step(y);
  watch(seen, y, KEPT[name]);
  return { id: `yard ${name}`, says: inWords(y), hashes: `start ${start} end ${hashOf(yardState(y))}` };
}
export const yardLines = (seen: Seen): Golden[] => YARDS.map(([name, make]) => yardLine(name, make, seen));

// ---------- commands off the wire ----------

const ctxAt = (now: number, seed: number): Ctx => ({
  now,
  player: { id: "00000000-0000-4000-8000-00000000601d", guest: false },
  seed,
  room: 1e9,
  awards: [],
  postcards: {},
});

/** A step of a script done: a command read off the wire and done or refused, or the yard run on. */
function stepDone(y: F.Yard, step: Step, n: number, seen: Seen): { y: F.Yard; did: unknown; ok: boolean } {
  if ("wait" in step) {
    const at = y.at + (step.wait + F.LEAD) * F.TICK_MS;
    return { y: F.FACTORY.advance(y, ctxAt(at, n)), did: ["wait", step.wait, y.tick], ok: true };
  }
  const raw = typeof step.send === "function" ? step.send(y) : step.send;
  const c = F.FACTORY.command(JSON.parse(JSON.stringify({ tick: y.tick, id: `c${n}`, ...raw })));
  if (!c) throw new Error(`the wire does not read ${JSON.stringify(raw)}`);
  const done = F.FACTORY.apply(y, c, ctxAt(y.at, n));
  if (isRefused(done)) return { y, did: [raw.do, "refused", done.refused], ok: false };
  watchLog(seen, done.log ?? []);
  const coins = (done.coins ?? []).map((m) => [m.amount, m.reason, m.key]);
  return { y: done.state, did: [raw.do, coins, done.log ?? [], done.notes], ok: true };
}

export function scriptLine(script: Script, seen: Seen): Golden {
  let y = script.yard();
  const draws = new Hash();
  const results: string[] = [];
  script.steps.forEach((step, n) => {
    const done = stepDone(y, step, n, seen);
    y = done.y;
    draws.add(done.did);
    if (!("wait" in step)) results.push(done.ok ? "d" : "r");
  });
  watch(seen, y, script.kept);
  return {
    id: `script ${script.name}`,
    says: `${results.join("")}: ${inWords(y)}`,
    hashes: `did ${draws.short()} end ${hashOf(yardState(y))}`,
  };
}
export const scriptLines = (seen: Seen): Golden[] => SCRIPTS.map((s) => scriptLine(s, seen));

// ---------- 8 hours, in one go and in slices ----------

/** The yard brought on: the gate's, tier 4 open, which runs 12 hours unwatched. */
const longYard = (): F.Yard => staged("gate");
/** How many ticks a slice runs. */
const SLICE = 5000;

/** Brings a yard on 8 hours: in one go, in `tend`'s slices, or in slices with the yard stored and read back between each. */
export function broughtOn(way: "one go" | "slices" | "stored slices"): F.Yard {
  let y = longYard();
  const ctx = ctxAt(y.at + 8 * HOUR_MS, 1);
  if (way === "one go") return F.FACTORY.advance(y, ctx);
  for (let further = true; further;) {
    let left = SLICE;
    further = F.FACTORY.tend?.(y, ctx, () => left-- > 0) ?? false;
    if (way === "stored slices") {
      const read = F.FACTORY.decode(F.FACTORY.encode(y));
      if (!read) throw new Error("a yard stored between slices does not read");
      y = read;
    }
  }
  return F.FACTORY.advance(y, ctx);
}
export const WAYS = ["one go", "slices", "stored slices"] as const;
/**
 * The three ways' lines: each by a hash of the yard but for its power, and one of its power (whether
 * the yard is powered, and its supply and demand at its last tick), so that a way that differs from
 * one go in its power alone says so.
 */
export function longLines(): Golden[] {
  const ends = WAYS.map((way) => {
    const y = broughtOn(way);
    const { power, ...rest } = yardState(y);
    return { way, end: hashOf(rest), power: hashOf(power), says: inWords(y) };
  });
  const [first] = ends;
  return ends.map(({ way, end, power, says: words }) => {
    const as =
      way === "one go"
        ? ""
        : end === first?.end && power === first.power
          ? "as in one go: "
          : end === first?.end
            ? "as in one go but its power: "
            : "not as in one go: ";
    return { id: `long ${way}`, says: `${as}${words}`, hashes: `end ${end} power ${power}` };
  });
}

// ---------- all of it ----------

export interface Goldens {
  readonly yards: Golden[];
  readonly scripts: Golden[];
  readonly long: Golden[];
  readonly seen: Seen;
}
const read = (name: string): string =>
  existsSync(new URL(name, GOLDEN)) ? readFileSync(new URL(name, GOLDEN), "utf8") : "";
export const written = (name: "yards" | "scripts" | "long"): Golden[] => goldensIn(read(`${name}.txt`));

export function goldensNow(): Goldens {
  const seen = seenNow();
  return { yards: yardLines(seen), scripts: scriptLines(seen), long: longLines(), seen };
}

if (import.meta.main) {
  const write = process.argv.includes("--write");
  const now = goldensNow();
  tell("yards", written("yards"), now.yards);
  tell("scripts", written("scripts"), now.scripts);
  tell("long", written("long"), now.long);
  if (!writePins(PINS, now.seen, VERSIONS, write)) process.exit(1);
  if (write) {
    writeFileSync(new URL("yards.txt", GOLDEN), goldensText(now.yards));
    writeFileSync(new URL("scripts.txt", GOLDEN), goldensText(now.scripts));
    writeFileSync(new URL("long.txt", GOLDEN), goldensText(now.long));
    console.log("Written. Say why in the PR's description.");
  }
}
