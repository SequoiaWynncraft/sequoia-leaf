/**
 * Small helpers for the tests beside this file: ways to put a few figures on a board, make some of
 * them stand still as targets, and pick out what happened. Nothing in the game uses this.
 */
import { isPlanning, type RunCommand } from "./command.ts";
import { available, type Catalog, catalogAt } from "./content/catalog.ts";
import type { FigureId, Stars, UnitKind } from "./content/figures.ts";
import type { ItemId } from "./content/items.ts";
import { LEGACY_ERA } from "./content/releases.ts";
import { openFight, stepFight } from "./fight/engine.ts";
import type { Fight, FightEvent, Unit } from "./fight/types.ts";
import { newTable, type TableView, tableView } from "./game.ts";
import { cellSeat, COLS, type Side } from "./hex.ts";
import type { Party, Placed } from "./party.ts";
import { beginFight, newPiece, type Run, type RunView, takeTakings } from "./run.ts";
import { readWay } from "./way.ts";

/** The catalogue the tests play in: the era live when eras came in (`LEGACY_ERA`). */
export const CAT: Catalog = catalogAt(LEGACY_ERA);
/** Everyone's figures in it, in its order: the twenty-eight. */
export const EVERYONES: readonly FigureId[] = available(CAT, { for: "regular" });

/** Numbers in order, and words in order, for comparing lists whose order does not matter. */
export const inOrder = (numbers: readonly number[]): number[] => numbers.toSorted((a, b) => a - b);
export const abc = (words: readonly string[]): string[] => words.toSorted((a, b) => a.localeCompare(b));

/** A figure at a column and row of its own half (row 0 is its front line). */
export const at = (kind: UnitKind, col: number, row: number, stars: Stars = 1, items: ItemId[] = []): Placed => ({
  kind,
  stars,
  seat: row * COLS + col,
  items,
  fed: 0,
});
/** A figure on a hex of the fight board, for the side whose half that hex is on. */
export function onCell(kind: UnitKind, side: Side, cell: number, stars: Stars = 1, items: ItemId[] = []): Placed {
  const seat = cellSeat(side, cell);
  if (seat < 0) throw new Error(`hex ${cell} is not on side ${side}'s half`);
  return { kind, stars, seat, items, fed: 0 };
}
export const partyOfFigures = (figures: Placed[], more: Partial<Party> = {}): Party => ({
  who: "test",
  title: "",
  figures,
  boons: [],
  might: 100,
  ...more,
});
/** A fight between two lists of figures, opened and not yet stepped. */
export function fightOf(
  ours: Placed[],
  theirs: Placed[],
  more: { seed?: number; ours?: Partial<Party>; theirs?: Partial<Party> } = {},
): Fight {
  return openFight({
    seed: more.seed ?? 7,
    era: LEGACY_ERA,
    sides: [partyOfFigures(ours, more.ours), partyOfFigures(theirs, more.theirs)],
  });
}
/** The first figure of a kind on a side. */
export function unitOf(f: Fight, kind: UnitKind, side: Side = 0): Unit {
  const u = f.units.find((o) => o.kind === kind && o.side === side);
  if (!u) throw new Error(`no ${kind} on side ${side}`);
  return u;
}
export const unitsOf = (f: Fight, kind: UnitKind, side: Side): Unit[] =>
  f.units.filter((o) => o.kind === kind && o.side === side);
/** Makes a figure a plain target: it never attacks, casts or walks, and has no armour or ward, so damage on it is exact. */
export function still(u: Unit, health = 100_000): Unit {
  u.attack = 0;
  u.attack0 = 0;
  u.manaFull = 0;
  u.mana = 0;
  u.rooted = true;
  u.armour = 0;
  u.ward = 0;
  u.slip = 0;
  u.thorns = 0;
  u.maxHp = health;
  u.hp = health;
  u.shield = 0;
  u.digs = false;
  return u;
}
/** Everyone on a side made a plain target. */
export function stillSide(f: Fight, side: Side, health = 100_000): void {
  for (const u of f.units) if (u.side === side) still(u, health);
}
/** Fills a figure's mana, so that it uses its ability on its next turn. */
export function ready(u: Unit): Unit {
  u.mana = u.manaFull;
  return u;
}
/** Steps a fight a number of times and gives back everything that happened. */
export function steps(f: Fight, count: number): FightEvent[] {
  const out: FightEvent[] = [];
  for (let i = 0; i < count && !f.over; i++) out.push(...stepFight(f));
  return out;
}
/** Steps a fight until something happens that a check accepts (or a limit), and gives back everything up to and including that step. */
export function stepUntil(f: Fight, found: (ev: FightEvent) => boolean, most = 1200): FightEvent[] {
  const out: FightEvent[] = [];
  for (let i = 0; i < most && !f.over; i++) {
    const step = stepFight(f);
    out.push(...step);
    if (step.some(found)) break;
  }
  return out;
}
/** The events of one sort. */
export function only<T extends FightEvent["t"]>(events: readonly FightEvent[], t: T): Extract<FightEvent, { t: T }>[] {
  const out: Extract<FightEvent, { t: T }>[] = [];
  for (const ev of events) if (isSort(ev, t)) out.push(ev);
  return out;
}
function isSort<T extends FightEvent["t"]>(ev: FightEvent, t: T): ev is Extract<FightEvent, { t: T }> {
  return ev.t === t;
}

// ---------- every command of a run ----------

/** A run planning a room with nothing to pick: three figures, two components on the rack, acorns to spare, a free rustle. */
function planning(run: Run): void {
  Object.assign(run, { acorns: 30, level: 4, xp: 0, rustles: 1, held: false, items: ["bark", "thorn"] });
  run.stage = { phase: "plan", picks: [] };
  run.board = run.board.map(() => null);
  run.bench = run.bench.map(() => null);
  run.board[3] = newPiece(run, "crab7");
  run.board[4] = newPiece(run, "worm");
  run.bench[0] = newPiece(run, "moth");
  run.stall[0] = "crab7";
}
/** The same, with a Greg on the board who can still eat. */
function gregHungry(run: Run): void {
  planning(run);
  run.board[5] = newPiece(run, "greg");
}
/** The same, with three boons on offer to pick from. */
function boonsUp(run: Run): void {
  planning(run);
  run.stage = {
    phase: "plan",
    picks: [{ kind: "boon", options: ["secondwind", "headstart", "smallfry"], redraws: 1 }],
  };
}

/**
 * Each command of a run, and how to make a run ready for it to be done: what the tests of every
 * command at every kind of table send. A command of a run missing here does not compile.
 */
export const EVERY_COMMAND: {
  readonly [D in RunCommand["do"]]: { readonly c: Extract<RunCommand, { do: D }>; readonly ready: (run: Run) => void };
} = {
  choose: { c: { do: "choose", option: 0 }, ready: boonsUp },
  redraw: { c: { do: "redraw" }, ready: boonsUp },
  buy: { c: { do: "buy", offer: 0 }, ready: planning },
  sell: { c: { do: "sell", from: { on: "bench", at: 0 } }, ready: planning },
  feed: { c: { do: "feed", from: { on: "bench", at: 0 }, to: { on: "board", at: 5 } }, ready: gregHungry },
  move: { c: { do: "move", from: { on: "board", at: 3 }, to: { on: "board", at: 10 } }, ready: planning },
  bench: { c: { do: "bench", seat: 3 }, ready: planning },
  rustle: { c: { do: "rustle" }, ready: planning },
  hold: { c: { do: "hold", on: true }, ready: planning },
  xp: { c: { do: "xp" }, ready: planning },
  give: { c: { do: "give", item: 0, to: { on: "board", at: 3 } }, ready: planning },
  forge: { c: { do: "forge", item: 0, with: 1 }, ready: planning },
  fight: { c: { do: "fight" }, ready: planning },
  take: {
    c: { do: "take" },
    ready: (run) => {
      planning(run);
      beginFight(run);
    },
  },
  // Walking home is turned down at a table before the first room is fought.
  abandon: {
    c: { do: "abandon" },
    ready: (run) => {
      planning(run);
      beginFight(run);
      takeTakings(run);
    },
  },
};
/** Those a member plans a room with (`isPlanning`), each with its readying. */
export const EVERY_PLANNING = Object.values(EVERY_COMMAND).flatMap((each) =>
  isPlanning(each.c) ? [{ c: each.c, ready: each.ready }] : [],
);

/** A room as a run's record kept it before rooms were stored as rows (`roomRow`): an object. */
function roomWhole(row: unknown): unknown {
  if (!Array.isArray(row)) return row;
  const [room, kind, result, ours, theirs, boss, met] = row;
  return { room, kind, result, standing: [ours, theirs], boss, ...(met === undefined ? {} : { met }) };
}
/**
 * A run as a table before version 9 (or a sitting before version 5) kept it: every room of its record
 * as an object, and none folded (a run of a test has fought too few rooms to fold any).
 */
export function runKeptWhole(run: unknown): unknown {
  if (typeof run !== "object" || run === null || !("record" in run) || !Array.isArray(run.record)) return run;
  const rest = Object.entries(run).filter(([key]) => key !== "before" && key !== "record");
  return { ...Object.fromEntries(rest), record: run.record.map(roomWhole) };
}
/** A run as a table before version 8 (or a sitting before version 4) kept it: its way as its trail, its roster (`own`) and its endless way. */
export function runKeptBefore(kept: unknown): unknown {
  const run = runKeptWhole(kept);
  if (typeof run !== "object" || run === null || !("way" in run)) return run;
  const { way, ...rest } = run;
  const read = readWay(way);
  if (!read) return run;
  const { course, figures } = read;
  return {
    ...rest,
    trail: course.id === "trail" ? course.trail : 0,
    own: figures.pool === "own" ? figures.roster : null,
    endless: course.id === "trail" ? null : course.id,
  };
}
/**
 * A table kept now (its text), as a table of an older version (`v`, before 8) kept it: its runs in
 * `run` and `endless` with their counts in `runs` and `ventures`, each run's way in its three fields,
 * and nothing kept apart. Whatever else an older version kept differently is the test's to change.
 */
export function tableKeptAs(text: string, v: number): Record<string, unknown> & { run: Kept; endless: Kept } {
  const { held, begun, apart: _, ...rest } = JSON.parse(text);
  return {
    ...rest,
    v,
    runs: begun.main,
    run: runKeptBefore(held.main),
    ventures: begun.endless,
    endless: runKeptBefore(held.endless),
  };
}
/** A run as a stored table keeps it, to be changed by hand. */
type Kept = Record<string, unknown>;

/** The page's view of a new table (of `LEGACY_ERA`) with a run in hand, the first begun there. */
export function viewWith(run: RunView): TableView {
  const blank = tableView(newTable({ seed: 1, now: 0 }), { awards: [], now: 0 });
  return { ...blank, era: LEGACY_ERA, begun: { main: 1, endless: 0 }, held: { main: run, endless: null } };
}
