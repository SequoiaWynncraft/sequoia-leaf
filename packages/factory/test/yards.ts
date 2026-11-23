/**
 * Yards built with commands off the wire, as a player builds: for the tests, and for the play server
 * on a developer's machine, which stages them for the screenshot tours (`apps/api/test/stage-works.ts`).
 *
 * - `delivering`: every goal of the slice done, three lines on the guild's land into the depot;
 * - `generated`: the scale study's generator on a land of 3 by 3 plots, about 1,000 pieces whose
 *   lines end in crates;
 * - `staged(name)`: a yard on the guild's land as play brings one there. `new`, as Leaf makes it;
 *   `small`, the first two lessons done by a line each of planks, ingots and bricks; `short`, a bench
 *   for tools too, and the last lesson in hand with the yard short of power; `mid`, the same lines in
 *   a yard at tier 2, with plots bought, a line painted and a splitter shutting a way to a crate;
 *   `large`, the generator's yard on every plot the slice sells, every goal of it done.
 */
import * as F from "../src/index.ts";
import { type Gen, generate } from "./gen.ts";
import { makeLand } from "./land.ts";

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
/** Lays the run of belt the router finds from a tile to a piece. */
export function lay(y: F.Yard, from: readonly [number, number], to: readonly [number, number]): void {
  const legs = F.route(y, from, to);
  if (!legs) throw new Error(`no way from ${from.join(",")} to ${to.join(",")}`);
  must(y, { do: "lay", legs: legs.map((l) => Object.assign({}, l, { kind: F.kindName(l.kind) })) });
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

/** The names of the yards the play server stages. */
export const STAGES = ["new", "small", "short", "mid", "large"] as const;
export type Stage = (typeof STAGES)[number];
export const isStage = (v: unknown): v is Stage => STAGES.some((s) => s === v);

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

/** A yard on the guild's land as play brings one there (see the head of this file), its owner there at its last tick. */
export function staged(name: Stage, seed = 20_261_122): F.Yard {
  const y = built(name, seed);
  y.seen = F.here(y);
  return y;
}

function built(name: Stage, seed: number): F.Yard {
  if (name === "large") {
    const plots = F.PLOT_IDS.filter((p) => p !== "yard");
    const g = generate(F.LAND, 600, seed, (gen) => {
      for (const plot of plots) gen.cmd({ do: "buyPlot", plot });
    });
    for (let k = 0; k < 3000; k++) F.step(g.y);
    return g.y;
  }
  const y = F.create({ seed, tier: name === "mid" ? 2 : 0 });
  if (name === "new") return y;
  firstLines(y);
  workOn(y, ["planks", "ingots"]);
  if (name === "small") return y;
  toolsLine(y);
  workOn(y, ["tools"]);
  if (name === "short") return y;
  for (const plot of ["meadow", "bank", "stream"]) must(y, { do: "buyPlot", plot });
  // The bricks' line splits at its second belt: its right way to a crate, its left way shut.
  must(y, { do: "build", kind: "splitter", x: 21, y: 21, dir: 0 });
  must(y, { do: "build", kind: "crate", x: 21, y: 22, dir: 1 });
  must(y, { do: "way", x: 21, y: 21, way: 1, open: false });
  must(y, { do: "paint", x: 22, y: 15, tint: 2 });
  for (let k = 0; k < 600; k++) F.step(y);
  return y;
}
