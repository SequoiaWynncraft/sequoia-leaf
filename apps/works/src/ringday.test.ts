/**
 * Tier 7 on the page across a day: a ring of belts with growers on it, on the guild's land, tended by
 * Leaf now and then across 24 hours while the page runs its copy on by its own loop (`runYard`), which
 * goes a tick at a time where there are growers, to count what each took in and gave out
 * (`grown.ts`). Leaf's yard and the page's copy stand at one tick with one check all the way.
 */
import { expect, test } from "bun:test";

import { FACTORY, check, create, held, holderOf, item, play, put, readCommand, type Yard } from "@sequoia-leaf/factory";

import { ctx, opened, useFakeLeaf } from "../test/fake-leaf.ts";
import { countedAt } from "./grown.ts";
import { S } from "./state.ts";
import { runYard } from "./yard.ts";

useFakeLeaf();

const CRYSTAL = item("crystal");
const FEED = item("feed");
const MINUTE_MS = 60_000;

/** Gives a yard a command off the wire at its tick; one refused throws. */
function must(y: Yard, c: Record<string, unknown>): void {
  const read = readCommand({ tick: y.tick, ...c });
  const did = read ? play(y, read) : { refused: "does not read" };
  if ("refused" in did) throw new Error(`${JSON.stringify(c)}: ${String(did.refused)}`);
}

/**
 * The yard plot of the guild's land (x 48 to 63, rows 36 to 47, the depot at 55 to 57, rows 41 to 43)
 * with a ring of 32 belts above the depot (rows 39 and 40), and two growers on it facing south, each
 * dropping onto the ring's top row and fed star crystals off it by a splitter that sends them up into
 * its east side first, and crystal feed from a full crate on its west side. A plain splitter on the
 * ring's bottom row sends every other thing down into the depot. 8 star crystals ride the ring.
 */
function ringYard(): Yard {
  const y = create({ seed: 5, tier: 8 });
  y.at = ctx().now;
  const belt = (x: number, z: number, dir: number): void => must(y, { do: "build", kind: "belt", x, y: z, dir });
  for (let x = 48; x < 63; x++) belt(x, 39, 0);
  belt(63, 39, 1);
  for (let x = 63; x > 48; x--) belt(x, 40, 2);
  belt(48, 40, 3);
  for (const gx of [50, 56]) {
    must(y, { do: "build", kind: "grower", x: gx, y: 37, dir: 1 });
    must(y, { do: "build", kind: "splitter", x: gx + 2, y: 39, dir: 0 });
    must(y, { do: "first", x: gx + 2, y: 39, way: 1 });
    belt(gx + 2, 38, 3);
    belt(gx + 2, 37, 2);
    must(y, { do: "build", kind: "crate", x: gx - 2, y: 37, dir: 0 });
    const r = holderOf(y, (gx - 2) + 37 * y.land.w);
    for (let k = 0; k < y.open.crate; k++) put(y.holders, r, FEED);
  }
  must(y, { do: "build", kind: "splitter", x: 56, y: 40, dir: 2 });
  for (const x of [49, 51, 53, 55, 57, 59, 61, 62]) {
    y.item[x + 40 * y.land.w] = CRYSTAL;
    y.prog[x + 40 * y.land.w] = 4;
  }
  y.history = [];
  return y;
}

test("a ring with growers on it, Leaf tending its yard now and then across a day and the page running its copy by its own loop, stand at one tick with one check all the way", async () => {
  const fake = await opened(ringYard());
  const growers = [50, 56].map((x) => x + 37 * S.world.land.w);
  const marks = new Set([
    ...Array.from({ length: 12 }, (_, m) => m + 1),
    ...Array.from({ length: 24 }, (_, h) => (h + 1) * 60),
  ]);
  const seen: string[] = [];
  let grown = 0;
  for (let minute = 1; minute <= 24 * 60; minute++) {
    const ms = minute * MINUTE_MS;
    fake.leaf.ms = ms;
    performance.now = () => 1000 + ms;
    runYard(1000 + ms);
    if (!marks.has(minute)) continue;
    // What the page sent on the way reaches Leaf; then Leaf tends its yard on to its clock, as it does.
    await Bun.sleep(1);
    const leaf = fake.leaf.yard;
    FACTORY.tend?.(leaf, { ...ctx(), now: ctx().now + ms }, () => true);
    const same = leaf.tick === S.world.tick && check(leaf) === check(S.world);
    seen.push(`${minute}: ${same}`);
    grown = Math.max(grown, leaf.depot[CRYSTAL] ?? 0);
  }
  expect(seen).toEqual([...marks].map((m) => `${m}: true`));
  // It grew, sent its net to the depot until its feed ran out, and the page counted its growers as it went.
  const counted = growers.map((i) => countedAt(S.world, i)?.seconds);
  expect([grown > 1000, counted, held(S.world.holders, holderOf(S.world, 48 + 37 * S.world.land.w), FEED)]).toEqual([
    true,
    [60, 60],
    0,
  ]);
}, 120_000);
