/**
 * Yards run on for hours, and a digest of each at every step on the way: the record the tick's
 * results are held to, to the bit (`replays.test.ts`). A replay is a yard the tests make (every
 * staged yard, every save, the delivering and generated yards, random play from several starts, and
 * the largest staged yard tended in slices as Leaf tends it) run on for hours. After every tick of
 * the first minute of a run, every minute after, or after every command, what it is is digested: the
 * yard as kept (`encode`), the news since the last digest, and its power. The digests are gathered
 * into a line an hour, or fifty commands.
 *
 * `bun test/replays.ts --write` writes the record again from the tick as it stands. A change to the
 * rules changes the record, and says so; a change only to how fast the tick runs leaves it as it is.
 */
import { createHash, type Hash } from "node:crypto";

import type { Ctx } from "@sequoia-leaf/core";

import * as F from "../src/index.ts";
import { boardFilled, Player } from "./player.ts";
import { rng } from "./random.ts";
import { delivering, generated, JUNCTION_HOURS, junctions, must, saved, SAVES, staged, STAGES } from "./yards.ts";

const MINUTE = 600;
const HOUR = 60 * MINUTE;
/** How long each yard runs on for: as long as a yard runs unwatched at first. */
const HOURS = 8;
export const RECORD = `${import.meta.dir}/replays.json`;

/** The digests of one replay, a line at a time. */
class Digest {
  readonly lines: string[] = [];
  hash: Hash = createHash("sha1");
  /** Takes in what the yard is now: as kept, its news since the last, and its power. */
  add(y: F.Yard): void {
    this.hash.update(`${F.encode(y)}\n${JSON.stringify(F.drain(y))}\n${y.supply}\n`);
  }
  /** Ends a line. */
  line(): void {
    this.lines.push(this.hash.digest("hex").slice(0, 16));
    this.hash = createHash("sha1");
  }
}

/**
 * Runs a yard on `hours` hours of ticks, digested after every tick of the first minute, where a
 * difference that heals within a tick or two would not last until the minute's digest, and after
 * every minute; a line an hour.
 */
function hours(y: F.Yard, d: Digest, n = HOURS): void {
  for (let h = 0; h < n; h++) {
    for (let t = 1; t <= HOUR; t++) {
      F.step(y);
      if ((h === 0 && t <= MINUTE) || t % MINUTE === 0) d.add(y);
    }
    d.line();
  }
}

/** Random play from a yard: `n` commands, each digested, a line every fifty; then two hours. */
function played(start: () => F.Yard, seed: number, n = 300): (d: Digest) => void {
  return (d) => {
    const y = start();
    let k = 0;
    new Player(y, seed, new Map()).play(n, (after) => {
      d.add(after);
      if (++k % 50 === 0) d.line();
    });
    if (k % 50 !== 0) d.line();
    hours(y, d, 2);
  };
}

/** The junctions yard run on for eight hours, its owner's commands at the start of each, digested every minute. */
function junctionsRun(d: Digest): void {
  const y = junctions();
  for (const commands of JUNCTION_HOURS) {
    for (const c of commands) must(y, c);
    hours(y, d, 1);
  }
}

/** A copy of the generated yard, which the tests share. */
const generatedCopy = (): F.Yard => F.decode(F.encode(generated().y), generated().y.land) ?? F.create();

const ctx = (now: number): Ctx => ({ now, player: { id: "p", guest: false }, seed: 9, room: 0, awards: [] });

/**
 * The largest staged yard tended as Leaf tends a yard nobody has open: every two minutes of Leaf's
 * clock, run on in slices of any size until it has no further to go, for eight hours and a little
 * past, where it stands still.
 */
function tended(d: Digest): void {
  const y = staged("large");
  const r = rng(7);
  const start = 1_800_000_000_000;
  y.at = start;
  for (let now = start; now <= start + (HOURS + 1) * HOUR * F.TICK_MS; now += 2 * MINUTE * F.TICK_MS) {
    for (let further = true; further;) {
      let budget = 1 + Math.floor(r() * 5000);
      further = F.FACTORY.tend?.(y, ctx(now), () => budget-- > 0) ?? false;
    }
    F.FACTORY.advance(y, ctx(now));
    d.add(y);
    if ((now - start) % (HOUR * F.TICK_MS) === 0) d.line();
  }
  d.line();
}

/** Every replay, by name. */
export const REPLAYS: readonly (readonly [string, (d: Digest) => void])[] = [
  ...STAGES.map((name) => [`staged ${name}`, (d: Digest) => hours(staged(name), d)] as const),
  ...SAVES.map((name) => [`save ${name}`, (d: Digest) => hours(saved(name), d)] as const),
  ["delivering", (d) => hours(delivering(), d)],
  ["generated", (d) => hours(generatedCopy(), d)],
  ["junctions", junctionsRun],
  ["random play, a new yard", played(() => F.create({ seed: 11 }), 101)],
  ["random play, tier 3", played(() => F.create({ seed: 13, tier: 3 }), 103)],
  ["random play, tier 4 done", played(() => F.create({ seed: 14, tier: 5 }), 105)],
  ["random play, the delivering yard with its board filled", played(boardFilled, 107)],
  ["random play, the generated yard", played(generatedCopy, 109)],
  ["the largest staged yard, tended in slices", tended],
];

/** The lines of digests one replay gives now. */
export function replay(run: (d: Digest) => void): string[] {
  const d = new Digest();
  run(d);
  return d.lines;
}

if (import.meta.main && process.argv.includes("--write")) {
  const record: Record<string, string[]> = {};
  for (const [name, run] of REPLAYS) {
    const t = performance.now();
    record[name] = replay(run);
    console.log(`${name}: ${record[name].length} lines in ${((performance.now() - t) / 1000).toFixed(2)} s`);
  }
  await Bun.write(RECORD, `${JSON.stringify(record, null, 2)}\n`);
}
