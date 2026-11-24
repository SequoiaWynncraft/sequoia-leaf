/**
 * Yards built with commands off the wire, as a player builds: for the tests, and for the play server
 * on a developer's machine, which stages them for the screenshot tours (`apps/api/test/stage-works.ts`).
 *
 * - `delivering`: every goal of the slice done, three lines on the guild's land into the depot;
 * - `generated`: the scale study's generator on a land of 3 by 3 plots, about 1,000 pieces whose
 *   lines end in crates;
 * - `junctions`: every kind of meeting of lines on the guild's land, with tier 4 done (see it);
 * - `cratesOpening`: a goal finished in a tick lets a crate hold more while a belt waits on it;
 * - `staged(name)`: a yard on the guild's land as play brings one there, made by the rules alone:
 *   built with commands, and every goal finished, paid and logged by the rules, by lines of its own
 *   or by what a node wants arriving at the depot (`fillHand`). `new`, as Leaf makes it; `small`, the
 *   first two lessons done by a line each of planks, ingots and bricks; `short`, a bench for tools
 *   too, and the last lesson in hand with the yard short of power; `mid`, the same lines with every
 *   node of tiers 0 and 1 done (tier 2 open), plots bought, a line painted and a splitter shutting
 *   a way to a crate; `hall`, the same yard with every node of tier 2 done too, so tier 3 has just
 *   opened: the Study may be built, none stands, nothing is studied; `study`, that yard with two
 *   boilers and a line of Timber folios into a Study, the first research known and four in the line,
 *   the first of them part studied; `gate`, that yard on until its Study has made known the research
 *   tier 3's commission needs, and the commission finished, so tier 4 has just opened, with a
 *   splitter on the ingots' line to the tools' bench sending half of them to the depot; `large`,
 *   every node of tiers 0 to 2 done (tier 3 open) and the generator's pieces on every plot the slice
 *   sells, as far as a yard with no research known may build them. Research is studied in a Study
 *   and does not arrive at the depot: only `study` and `gate` know any, and their Study studied it,
 *   a folio at a time, from the line that stands there.
 */
import { readFileSync } from "node:fs";

import * as F from "../src/index.ts";
import { type Gen, generate } from "./gen.ts";
import { bareLand, makeLand } from "./land.ts";

type Rec = Record<string, unknown>;

/** Gives a yard a command off the wire at its tick, and says what came of it; a command that does not read throws. */
export function give(y: F.Yard, c: Rec): ReturnType<typeof F.play> {
  const read = F.readCommand({ tick: y.tick, ...c });
  if (!read) throw new Error(`${JSON.stringify(c)} does not read`);
  return F.play(y, read);
}
/** Gives a yard a command that must be done. */
export function must(y: F.Yard, c: Rec): void {
  const did = give(y, c);
  if ("refused" in did) throw new Error(`${JSON.stringify(c)} was refused: ${did.why}`);
}
/**
 * How many planks a minute reach the depot from the crate on a tile, kept full: once its line has
 * filled (two minutes), over the next minute.
 */
export function flatOut(y: F.Yard, x: number, z: number): number {
  const plank = F.item("plank");
  const crate = F.holderOf(y, F.at(y, x, z));
  const run = (ticks: number): void => {
    for (let k = 0; k < ticks; k++) {
      while (F.held(y.holders, crate, plank) < 8) F.put(y.holders, crate, plank);
      F.step(y);
    }
  };
  run(2 * F.MINUTE);
  const before = y.depot[plank] ?? 0;
  run(F.MINUTE);
  return (y.depot[plank] ?? 0) - before;
}

/** Lays the run of belt the router finds from a tile to a piece. */
export function lay(y: F.Yard, from: readonly [number, number], to: readonly [number, number]): void {
  const legs = F.route(y, from, to);
  if (!legs) throw new Error(`no way from ${from.join(",")} to ${to.join(",")}`);
  must(y, F.writeAct({ do: "lay", legs }));
}

/**
 * Every goal of the tiers below 4 done, on the guild's land: deadfall gathered into a mill and sawn,
 * deadfall straight in, and ore gathered beyond a pylon, each line laid by the router into the depot,
 * and a crate on the way. Run on a little so that things are arriving.
 */
export function delivering(seed = 1): F.Yard {
  const y = F.create({ seed, tier: 4 });
  const depot = y.land.depot;
  // Deadfall north-west of the depot, gathered straight in.
  must(y, { do: "build", kind: "gatherer", x: 19, y: 15, dir: 0 });
  lay(y, [20, 15], depot);
  // Deadfall south-east, sawn into planks on the way.
  must(y, { do: "build", kind: "gatherer", x: 29, y: 21, dir: 3 });
  must(y, { do: "build", kind: "mill", x: 29, y: 20, dir: 2 });
  lay(y, [28, 20], depot);
  // Ore north-east, beyond the depot's reach: a pylon, and a crate on the line.
  must(y, { do: "build", kind: "pylon", x: 27, y: 15, dir: 0 });
  must(y, { do: "build", kind: "gatherer", x: 30, y: 14, dir: 2 });
  must(y, { do: "build", kind: "crate", x: 29, y: 14, dir: 2 });
  lay(y, [28, 14], depot);
  for (let k = 0; k < 600; k++) F.step(y);
  return y;
}

let small: Gen | null = null;
/** A yard of about 1,000 pieces on 48 by 36 tiles, made once by the generator. */
export const generated = (): Gen => (small ??= generate(makeLand(3, 3, 7), 1000));

type Placed = readonly [F.KindName, number, number, F.Dir, number?];

/**
 * A yard of every kind of meeting of lines, on the guild's land with tier 4 done: planks (sawn from
 * deadfall that comes through a tunnel) and stone from two gatherers taking turns at a joiner, then
 * a sorter sending the planks to its right, into a crate and on to a cart stop, and the stone ahead
 * to the depot; ore from behind and by a way in into a splitter that puts its left way, into a
 * crate, first and sends the rest ahead into a joiner, which the crate's ore comes back round to; a
 * bench on the Clay Bank fed more planks than pots (a splitter sends half the pots to a cart stop),
 * which makes hampers and has room for more planks while it holds a pot; and a boiler fed deadfall.
 */
export function junctions(): F.Yard {
  const y = F.create({ seed: 31, tier: 5 });
  const pieces: Placed[] = [
    ["gatherer", 19, 15, 1],
    ["mill", 19, 20, 0],
    ["belt", 20, 20, 1, 3],
    ["gatherer", 18, 21, 0],
    ["belt", 19, 21, 0, 2],
    ["gatherer", 18, 22, 0],
    ["belt", 19, 22, 0],
    ["belt", 20, 22, 3],
    ["joiner", 20, 21, 0],
    ["sorter", 21, 21, 0],
    ["crate", 21, 22, 1],
    ["belt", 21, 23, 0],
    ["stop", 22, 23, 0],
    ["belt", 22, 21, 3, 3],
    ["belt", 22, 20, 3, 3],
    ["belt", 22, 19, 0, 3],
    ["gatherer", 30, 13, 2],
    ["belt", 29, 13, 2],
    ["gatherer", 29, 12, 2],
    ["belt", 28, 12, 1],
    ["splitter", 28, 13, 2],
    ["joiner", 27, 13, 2],
    ["belt", 26, 13, 2],
    ["belt", 25, 13, 1],
    ["belt", 25, 14, 1],
    ["belt", 25, 15, 1],
    ["belt", 25, 16, 1],
    ["belt", 28, 14, 1],
    ["crate", 28, 15, 2],
    ["belt", 27, 15, 3],
    ["belt", 27, 14, 3],
    ["pylon", 27, 12, 0],
    ["pylon", 17, 20, 0],
    ["gatherer", 19, 14, 0],
    ["boiler", 20, 14, 0],
    ["gatherer", 18, 16, 1, 3],
    ["mill", 18, 17, 2, 3],
    ["belt", 17, 17, 2, 3],
    ["belt", 16, 17, 2, 3],
    ["belt", 15, 17, 1, 3],
    ["belt", 15, 18, 1, 3],
    ["belt", 15, 19, 1, 3],
    ["gatherer", 12, 20, 0],
    ["mill", 13, 20, 0],
    ["splitter", 14, 20, 0],
    ["stop", 14, 19, 0],
    ["bench", 15, 20, 1],
    ["stop", 15, 21, 0],
    ["pylon", 13, 18, 0],
  ];
  must(y, { do: "buyPlot", plot: "bank" });
  for (const [kind, x, z, dir, grade] of pieces)
    must(y, { do: "build", kind, x, y: z, dir, ...(grade === undefined ? {} : { grade }) });
  must(y, { do: "stand", pieces: [{ kind: "tunnel", x: 19, y: 16, dir: 1, span: 2, grade: 2 }] });
  must(y, { do: "sort", x: 21, y: 21, item: "plank" });
  must(y, { do: "side", x: 21, y: 21, right: true });
  must(y, { do: "wayIn", x: 28, y: 13, way: 2, on: true });
  must(y, { do: "first", x: 28, y: 13, way: 1 });
  return y;
}

/**
 * What the junctions yard's owner does at the start of each hour: shuts the ore's crate, so the
 * splitter's first way fills and backs up; shuts the planks' crate, so the sorter, the joiner and
 * everything behind them stand; empties it, so they run until it is full again; opens both, puts no
 * way first and turns the splitter's way in back out, so the ore from the north stands; turns the
 * sorter to its left, where nothing takes, and lays a belt there; tells the mill to make planks and
 * the sorter to send stone aside; and takes a belt of the joiner's away.
 */
export const JUNCTION_HOURS: readonly (readonly Rec[])[] = [
  [],
  [{ do: "crate", x: 28, y: 15, open: false }],
  [{ do: "crate", x: 21, y: 22, open: false }],
  [{ do: "tipOut", x: 21, y: 22, item: null }],
  [
    { do: "crate", x: 21, y: 22, open: true },
    { do: "crate", x: 28, y: 15, open: true },
    { do: "first", x: 28, y: 13, way: null },
    { do: "wayIn", x: 28, y: 13, way: 2, on: false },
  ],
  [
    { do: "side", x: 21, y: 21, right: false },
    { do: "build", kind: "belt", x: 21, y: 20, dir: 0 },
  ],
  [
    { do: "recipe", x: 19, y: 20, item: "plank" },
    { do: "sort", x: 21, y: 21, item: "stone" },
  ],
  [{ do: "remove", x: 19, y: 22 }],
];

/**
 * Bigger crates opened in the middle of a tick: a yard at tier 2, the shells' project in hand with 99
 * of its 100 shells in, and a belt into the depot carrying the last, which crosses its tile at the
 * second tick. A shut crate holds 32 planks, as many as a crate holds before the project, and the
 * belt behind it a plank it cannot take. The belt into the depot hands on before the crate's belt
 * does, each tick, so the crate may hold 128 by the time that belt is asked at the second.
 */
export function cratesOpening(): { y: F.Yard; crate: number; behind: number } {
  const y = F.create({ land: bareLand(15, 9, [], [12, 4]), tier: 2, seed: 1 });
  const shell = F.item("shell");
  const plank = F.item("plank");
  must(y, { do: "take", node: "shells" });
  F.deliver(y, shell, 99);
  must(y, { do: "build", kind: "belt", x: 10, y: 3, dir: 0 });
  must(y, { do: "build", kind: "belt", x: 4, y: 6, dir: 0 });
  must(y, { do: "build", kind: "crate", x: 5, y: 6, dir: 0 });
  must(y, { do: "crate", x: 5, y: 6, open: false });
  const [toDepot, behind, crate] = [F.at(y, 10, 3), F.at(y, 4, 6), F.holderOf(y, F.at(y, 5, 6))];
  for (let k = 0; k < y.open.crate; k++) F.put(y.holders, crate, plank);
  y.item[toDepot] = shell;
  y.prog[toDepot] = 4;
  y.item[behind] = plank;
  y.prog[behind] = 8;
  return { y, crate, behind };
}

/** The yards in `saves/`, as each version kept them (`saves.test.ts`). */
export const SAVES = ["v7-small", "v7-mid", "v7-study", "v7-gate", "v6-mid", "v3-tier2"] as const;

/** A save read, with its owner there at its last tick. */
export function saved(name: (typeof SAVES)[number]): F.Yard {
  const raw: unknown = JSON.parse(readFileSync(`${import.meta.dir}/saves/${name}.json`, "utf8"));
  const text = typeof raw === "object" && raw !== null && "text" in raw ? raw.text : null;
  const y = typeof text === "string" ? F.decode(text) : null;
  if (!y) throw new Error(`${name} does not read`);
  y.seen = F.here(y);
  return y;
}

/** The names of the yards the play server stages. */
export const STAGES = ["new", "small", "short", "mid", "hall", "study", "gate", "large"] as const;
export type Stage = (typeof STAGES)[number];
export const isStage = (v: unknown): v is Stage => STAGES.some((s) => s === v);

/**
 * What the node in hand still wants, arriving at the depot through the rules' own function for a
 * thing arriving there (`deliver`): it is finished, paid and logged as in play.
 */
export function fillHand(y: F.Yard): void {
  const g = y.hand;
  const want = g === -1 ? undefined : F.GOALS[g]?.want;
  if (g === -1 || !want) return;
  for (const n of F.ALL_ITEMS) F.deliver(y, n, (want[n] ?? 0) - (y.got[g]?.[n] ?? 0));
}

/** Every node of the tiers below `tier` finished as a player finishes them: each taken in hand (`take`) unless it comes by itself, and filled. */
function finishBelow(y: F.Yard, tier: number): void {
  const below = (g: F.Goal): boolean => F.isNode(g) && (F.GOALS[g]?.tier ?? tier) < tier;
  for (let n = 0; n < F.NODE_COUNT; n++) {
    if (y.hand === -1 || !below(y.hand)) {
      const next = F.GOALS.findIndex((_, g) => F.isGoal(g) && below(g) && F.takeRefusal(y, g) === null);
      if (next < 0) return;
      must(y, { do: "take", node: F.GOALS[next]?.id });
    }
    fillHand(y);
  }
}

/** Runs a yard on, a tick at a time, while the node in hand is one of `ids`, for at most `most` ticks. */
function workOn(y: F.Yard, ids: readonly string[], most = 20_000): void {
  const goals = ids.map(F.goal);
  for (let k = 0; k < most && goals.some((g) => y.hand === g); k++) F.step(y);
}

/** The lessons' first lines, each into the depot: planks; ingots past a pylon; bricks past another. */
function firstLines(y: F.Yard): void {
  const depot = y.land.depot;
  must(y, { do: "build", kind: "gatherer", x: 19, y: 15, dir: 0 });
  must(y, { do: "build", kind: "mill", x: 20, y: 15, dir: 0 });
  lay(y, [21, 15], depot);
  must(y, { do: "build", kind: "pylon", x: 27, y: 15, dir: 0 });
  must(y, { do: "build", kind: "gatherer", x: 30, y: 14, dir: 2 });
  must(y, { do: "build", kind: "mill", x: 29, y: 14, dir: 2 });
  lay(y, [28, 14], depot);
  must(y, { do: "build", kind: "pylon", x: 19, y: 23, dir: 0 });
  must(y, { do: "build", kind: "gatherer", x: 18, y: 21, dir: 0 });
  must(y, { do: "build", kind: "mill", x: 19, y: 21, dir: 0 });
  lay(y, [20, 21], depot);
}

/** A bench for tools north of the depot, fed planks from the west and ingots from the east. */
function toolsLine(y: F.Yard): void {
  must(y, { do: "build", kind: "gatherer", x: 19, y: 14, dir: 0 });
  must(y, { do: "build", kind: "mill", x: 20, y: 14, dir: 3 });
  must(y, { do: "build", kind: "bench", x: 21, y: 13, dir: 1 });
  lay(y, [20, 13], [21, 13]);
  must(y, { do: "build", kind: "gatherer", x: 30, y: 12, dir: 2 });
  must(y, { do: "build", kind: "mill", x: 29, y: 12, dir: 2 });
  lay(y, [28, 12], [21, 13]);
  lay(y, [21, 14], y.land.depot);
}

/**
 * Power, and a line of Timber folios into a Study, west of the depot: two boilers, each fed by a
 * gatherer on the deadfall south-east of the depot; a pylon on the Clay Bank's edge; planks from the
 * north and bricks from the south into a bench for frames; pots from the Clay Bank; and a bench that
 * makes the folio of a frame and a pot and hands it to the Study beside it.
 */
function folioLine(y: F.Yard): void {
  const pieces: [F.KindName, number, number, F.Dir][] = [
    ["gatherer", 28, 21, 2],
    ["boiler", 27, 21, 0],
    ["gatherer", 29, 21, 3],
    ["boiler", 29, 20, 0],
    ["pylon", 15, 18, 0],
    ["gatherer", 18, 16, 1],
    ["mill", 18, 17, 2],
    ["belt", 17, 17, 1],
    ["belt", 17, 18, 1],
    ["gatherer", 17, 22, 3],
    ["mill", 17, 21, 3],
    ["belt", 17, 20, 3],
    ["bench", 17, 19, 2],
    ["belt", 16, 19, 2],
    ["belt", 15, 19, 2],
    ["gatherer", 12, 20, 0],
    ["mill", 13, 20, 0],
    ["belt", 14, 20, 3],
    ["bench", 14, 19, 3],
    ["study", 14, 18, 0],
  ];
  for (const [kind, x, z, dir] of pieces) must(y, { do: "build", kind, x, y: z, dir });
  must(y, { do: "recipe", x: 17, y: 19, item: "frame" });
  must(y, { do: "recipe", x: 14, y: 19, item: F.itemName(F.FOLIOS[0] ?? F.item("timber")) });
}

/** Fills the line of research with what may be studied now, in the table's order. */
function studyAll(y: F.Yard): void {
  for (const g of F.ALL_GOALS)
    if (!F.isNode(g) && F.studyRefusal(y, g) === null) must(y, { do: "study", research: F.GOALS[g]?.id });
}

/** Studies the research a goal needs, each alone in the line, until the Study has made it known, the needs of each first. */
function studyFor(y: F.Yard, goal: string): void {
  const needs = (g: F.Goal): F.Goal[] => [...(F.GOALS[g]?.needs ?? []).flatMap(needs), g];
  for (const g of needs(F.goal(goal))) {
    if (F.isNode(g) || y.open.done[g] === 1) continue;
    for (let other = y.line[0]; other !== undefined; other = y.line[0])
      must(y, { do: "unstudy", research: F.GOALS[other]?.id });
    must(y, { do: "study", research: F.GOALS[g]?.id });
    for (let k = 0; k < 200_000 && y.open.done[g] !== 1; k++) F.step(y);
  }
}

/** A yard on the guild's land as play brings one there (see the head of this file), its owner there at its last tick. */
export function staged(name: Stage, seed = 20_261_122): F.Yard {
  const y = built(name, seed);
  y.seen = F.here(y);
  return y;
}

function built(name: Stage, seed: number): F.Yard {
  if (name === "large") {
    const start = F.create({ seed });
    finishBelow(start, 3);
    const plots = F.PLOT_IDS.filter((p) => p !== "yard");
    const g = generate(
      F.LAND,
      600,
      seed,
      (gen) => {
        for (const plot of plots) gen.cmd({ do: "buyPlot", plot });
      },
      start,
    );
    for (let k = 0; k < 3000; k++) F.step(g.y);
    return g.y;
  }
  const y = F.create({ seed });
  if (name === "new") return y;
  firstLines(y);
  workOn(y, ["planks", "ingots"]);
  if (name === "small") return y;
  toolsLine(y);
  workOn(y, ["tools"]);
  if (name === "short") return y;
  finishBelow(y, 2);
  for (const plot of ["meadow", "bank", "stream"]) must(y, { do: "buyPlot", plot });
  // The bricks' line splits at its second belt: its right way to a crate, its left way shut.
  must(y, { do: "build", kind: "splitter", x: 21, y: 21, dir: 0 });
  must(y, { do: "build", kind: "crate", x: 21, y: 22, dir: 1 });
  must(y, { do: "way", x: 21, y: 21, way: 1, open: false });
  must(y, { do: "paint", x: 22, y: 15, tint: 2 });
  for (let k = 0; k < 600; k++) F.step(y);
  if (name === "mid") return y;
  finishBelow(y, 3);
  if (name === "hall") return y;
  folioLine(y);
  // The first of the line is studied until it is known, by the Study's own work; then the line is
  // filled again, and the yard runs on a little into the next.
  studyAll(y);
  const first = y.line[0];
  const known = (): boolean => first === undefined || y.open.done[first] === 1;
  for (let k = 0; k < 60_000 && !known(); k++) F.step(y);
  studyAll(y);
  for (let k = 0; k < 1500; k++) F.step(y);
  if (name === "study") return y;
  // The research tier 3's commission needs, made known by the Study; then the commission, which opens tier 4.
  studyFor(y, "lanterns");
  fillHand(y);
  // A splitter on the ingots' line to the tools' bench, its left way down to the depot's line of ore.
  must(y, { do: "build", kind: "splitter", x: 26, y: 13, dir: 2 });
  lay(y, [26, 14], [26, 17]);
  must(y, { do: "way", x: 26, y: 13, way: 2, open: false });
  for (let k = 0; k < 1200; k++) F.step(y);
  return y;
}
