/**
 * Tier 8 on the page across a day: a launch pad set to the test rocket, with two chargers against its
 * back fed cells from crates, crates of hull sections and rocket fuel for several launches, and its
 * plain cells let out into a crate; tended by Leaf now and then across 24 hours while the page runs its
 * copy on by its own loop (`runYard`), which goes a tick at a time where there are pads, to count what
 * came into each and the most it held (`pads.ts`). Charged cells cross beats in chargers, on their
 * way into the pad and in it, the pad launches again and again, and Leaf's yard and the page's copy
 * stand at one tick with one check all the way; the page never takes Leaf's yard again to be put right.
 */
import { expect, test } from "bun:test";

import {
  check,
  create,
  FACTORY,
  holderOf,
  item,
  litAt,
  play,
  put,
  readCommand,
  type Yard,
} from "@sequoia-leaf/factory";

import { ctx, opened, useFakeLeaf } from "../test/fake-leaf.ts";
import { padCounted } from "./pads.ts";
import { S } from "./state.ts";
import { runYard } from "./yard.ts";

useFakeLeaf();

const MINUTE_MS = 60_000;
const TESTROCKET = item("testrocket");

/** Gives a yard a command off the wire at its tick; one refused throws. */
function must(y: Yard, c: Record<string, unknown>): void {
  const read = readCommand({ tick: y.tick, ...c });
  const did = read ? play(y, read) : { refused: "does not read" };
  if ("refused" in did) throw new Error(`${JSON.stringify(c)}: ${did.refused}`);
}

/** Where the pad's yard stands: its north-west corner's tile, on the guild's land south of the yard plot. */
const [OX, OZ] = [42, 48];

/** Puts `count` of a thing into the holder of the piece on (x, z) of the pad's yard. */
function fill(y: Yard, x: number, z: number, name: Parameters<typeof item>[0], count: number): void {
  const r = holderOf(y, OX + x + (OZ + z) * y.land.w);
  for (let k = 0; k < count; k++) put(y.holders, r, item(name));
}

/** The pad's yard: tier 8 known, the yard owning the Long Meadow and the Old Quarry south of the yard plot. */
function padYard(): Yard {
  const y = create({ seed: 6, tier: 9 });
  y.at = ctx().now;
  for (const name of ["Long Meadow", "The Old Quarry"]) {
    const plot = y.land.plots.find((p) => p.name === name)?.plot ?? null;
    if (plot === null) throw new Error(`no plot named ${name}`);
    y.plots.push(plot);
  }
  const build = (kind: string, x: number, z: number, dir: number): void =>
    must(y, { do: "build", kind, x: OX + x, y: OZ + z, dir });
  // The pad, facing east, over x 6 to 10 and rows 2 to 6; its front's middle lets plain cells out into a shut crate.
  build("launchpad", 8, 4, 0);
  build("crate", 11, 4, 0);
  must(y, { do: "crate", x: OX + 11, y: OZ + 4, open: false });
  // Two chargers against its back, each fed from a crate of cells behind it.
  for (const z of [2, 4]) {
    build("charger", 4, z, 0);
    build("crate", 3, z, 0);
    fill(y, 3, z, "cell", 1200);
  }
  // The test rocket's parts, enough for eight launches: a crate of hull sections against its back, one of fuel on its north side.
  build("crate", 5, 6, 0);
  fill(y, 5, 6, "hull", 480);
  build("crate", 8, 1, 1);
  fill(y, 8, 1, "fuel", 1920);
  for (const [x, z] of [
    [14, -2],
    [14, 1],
    [10, 0],
    [6, 0],
    [2, 0],
    [2, 4],
  ] as const)
    build("pylon", x, z, 0);
  y.history = [];
  return y;
}

test("a launch pad with chargers, Leaf tending its yard now and then across a day and the page running its copy by its own loop, stand at one tick with one check all the way", async () => {
  const fake = await opened(padYard());
  const pad = OX + 8 + (OZ + 4) * S.world.land.w;
  expect([litAt(S.world, pad), litAt(S.world, OX + 4 + (OZ + 2) * S.world.land.w)]).toEqual([true, true]);
  const marks = new Set([
    ...Array.from({ length: 12 }, (_, m) => m + 1),
    ...Array.from({ length: 24 }, (_, h) => (h + 1) * 60),
  ]);
  const seen: string[] = [];
  await day(1);
  // At each mark, Leaf tends its yard on to its clock, as it does.
  async function day(minute: number): Promise<void> {
    if (minute > 24 * 60) return;
    const ms = minute * MINUTE_MS;
    fake.leaf.ms = ms;
    performance.now = () => 1000 + ms;
    runYard(1000 + ms);
    // What the page sent reaches Leaf at once, as it would.
    await Bun.sleep(1);
    if (marks.has(minute)) {
      const leaf = fake.leaf.yard;
      const now = { ...ctx(), now: ctx().now + minute * MINUTE_MS };
      for (let further = true; further;) further = FACTORY.tend?.(leaf, now, () => true) ?? false;
      seen.push(`${minute}: ${leaf.tick === S.world.tick && check(leaf) === check(S.world)}`);
    }
    await day(minute + 1);
  }
  // The page was never put right: it read Leaf's yard once, as it opened.
  expect([seen, fake.leaf.reads.length]).toEqual([[...marks].map((m) => `${m}: true`), 1]);
  // It launched again and again until its cells ran out, and the page counted its pad as it went.
  const counted = padCounted(S.world, pad);
  console.log(`test rockets launched in the day: ${S.world.depot[TESTROCKET] ?? 0}`);
  expect([(S.world.depot[TESTROCKET] ?? 0) >= 5, counted?.seconds]).toEqual([true, 60]);
}, 180_000);
