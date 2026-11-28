/**
 * Tier 7 on the page across a day: a ring of belts with growers on it, on the guild's land, tended by
 * Leaf now and then across 24 hours while the page runs its copy on by its own loop (`runYard`), which
 * goes a tick at a time where there are growers, to count what each took in and gave out
 * (`grown.ts`). Leaf's yard and the page's copy stand at one tick with one check all the way, and the
 * page never takes Leaf's yard again to be put right.
 */
import { expect, test } from "bun:test";

import {
  check,
  create,
  FACTORY,
  held,
  holderOf,
  item,
  litAt,
  play,
  put,
  readCommand,
  route,
  writeAct,
  type Yard,
} from "@sequoia-leaf/factory";

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
  if ("refused" in did) throw new Error(`${JSON.stringify(c)}: ${did.refused}`);
}

/** Where the ring stands: its north-west corner's tile, on the guild's land south of the yard plot. */
const [OX, OZ] = [42, 48];

/**
 * Tier 7's shared ring (SPEC-2 0.2), as the rules' tests and bench have it (`growers.ts`), on the
 * guild's land, the yard owning the Long Meadow and the Old Quarry south of the yard plot: a ring of
 * 40 belts (x 2 to 20 of it, rows 6 to 8) with 4 growers along its top, each facing south, fed star
 * crystals off the ring by a splitter that sends them up into its east side first and dropping onto the
 * ring from its middle way out, and fed crystal feed from two full crates on its back. A splitter on the
 * ring's east side sends every other thing on to the depot. 8 star crystals ride the ring. The growers
 * and the belts up into them are on the ring too: 60 tiles things go round.
 */
function ringYard(): Yard {
  const y = create({ seed: 5, tier: 8 });
  y.at = ctx().now;
  for (const name of ["Long Meadow", "The Old Quarry"]) {
    const plot = y.land.plots.find((p) => p.name === name)?.plot ?? null;
    if (plot === null) throw new Error(`no plot named ${name}`);
    y.plots.push(plot);
  }
  const build = (kind: string, x: number, z: number, dir: number): void =>
    must(y, { do: "build", kind, x: OX + x, y: OZ + z, dir });
  for (let x = 2; x < 20; x++) build("belt", x, 6, 0);
  for (let z = 6; z < 8; z++) build("belt", 20, z, 1);
  for (let x = 20; x > 2; x--) build("belt", x, 8, 2);
  for (let z = 8; z > 6; z--) build("belt", 2, z, 3);
  for (const gx of [4, 8, 12, 16]) {
    build("grower", gx, 3, 1);
    build("belt", gx, 5, 1);
    build("splitter", gx + 2, 6, 0);
    must(y, { do: "first", x: OX + gx + 2, y: OZ + 6, way: 1 });
    for (const [z, dir] of [
      [5, 3],
      [4, 3],
      [3, 2],
    ] as const)
      build("belt", gx + 2, z, dir);
    for (const z of [1, 0]) {
      build("crate", gx, z, 1);
      const r = holderOf(y, OX + gx + (OZ + z) * y.land.w);
      for (let k = 0; k < y.open.crate; k++) put(y.holders, r, FEED);
    }
  }
  build("splitter", 20, 7, 1);
  const legs = route(y, [OX + 21, OZ + 7], y.land.depot);
  if (!legs) throw new Error("no way to the depot");
  must(y, writeAct({ do: "lay", legs }));
  for (const [x, z] of [
    [14, -2],
    [18, 0],
    [14, 1],
    [10, 0],
    [6, 1],
    [2, 0],
  ] as const)
    build("pylon", x, z, 0);
  for (const x of [3, 5, 7, 9, 11, 13, 15, 17]) {
    y.item[OX + x + (OZ + 8) * y.land.w] = CRYSTAL;
    y.prog[OX + x + (OZ + 8) * y.land.w] = 4;
  }
  y.history = [];
  return y;
}

test("a ring with growers on it, Leaf tending its yard now and then across a day and the page running its copy by its own loop, stand at one tick with one check all the way", async () => {
  const fake = await opened(ringYard());
  const growers = [4, 8, 12, 16].map((x) => OX + x + (OZ + 3) * S.world.land.w);
  expect(growers.map((i) => litAt(S.world, i))).toEqual([true, true, true, true]);
  const marks = new Set([
    ...Array.from({ length: 12 }, (_, m) => m + 1),
    ...Array.from({ length: 24 }, (_, h) => (h + 1) * 60),
  ]);
  const seen: string[] = [];
  let grown = 0;
  await day(1, (minute) => {
    const ms = minute * MINUTE_MS;
    fake.leaf.ms = ms;
    performance.now = () => 1000 + ms;
    runYard(1000 + ms);
  });
  // At each mark, Leaf tends its yard on to its clock, as it does.
  async function day(minute: number, run: (minute: number) => void): Promise<void> {
    if (minute > 24 * 60) return;
    run(minute);
    // What the page sent reaches Leaf at once, as it would.
    await Bun.sleep(1);
    if (marks.has(minute)) {
      const leaf = fake.leaf.yard;
      const now = { ...ctx(), now: ctx().now + minute * MINUTE_MS };
      for (let further = true; further;) further = FACTORY.tend?.(leaf, now, () => true) ?? false;
      seen.push(`${minute}: ${leaf.tick === S.world.tick && check(leaf) === check(S.world)}`);
      grown = Math.max(grown, leaf.depot[CRYSTAL] ?? 0);
    }
    await day(minute + 1, run);
  }
  // And the page was never put right: it read Leaf's yard once, as it opened.
  expect([seen, fake.leaf.reads.length]).toEqual([[...marks].map((m) => `${m}: true`), 1]);
  // It grew, sent its net to the depot until its feed ran out, and the page counted its growers as it went.
  const counted = growers.map((i) => countedAt(S.world, i)?.seconds);
  expect([grown > 1000, counted, held(S.world.holders, holderOf(S.world, OX + 4 + OZ * S.world.land.w), FEED)]).toEqual(
    [true, [60, 60, 60, 60], 0],
  );
}, 120_000);
