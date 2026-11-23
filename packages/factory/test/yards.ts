/**
 * Yards for the tests, built with commands off the wire as a player builds: `delivering` is a small
 * yard on the guild's land whose lines end in the depot; `generated` is the scale study's generator
 * on a land of 3 by 3 plots, about 1,000 pieces whose lines end in crates.
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
