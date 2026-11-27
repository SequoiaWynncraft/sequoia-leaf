/**
 * What is aimed and what is sent, on the page against a stand-in Leaf. An aim (the piece in hand, a
 * tunnel's far mouth, a run, the pieces held with Select) is kept while the pointer stays on its
 * tile, and worked out again when the yard or the purse changes under it, as each frame asks
 * (`keepAim`). And whatever costs Coins is judged by the rules with the purse at the moment it is
 * sent: one aimed while the purse covered it is refused once it no longer does, and nothing is sent.
 */
import { describe, expect, test } from "bun:test";

import {
  at,
  BELT,
  build,
  CRATE,
  create,
  encode,
  holderOf,
  MILLI,
  plot,
  priceAt,
  TUNNEL,
  type Yard,
} from "@sequoia-leaf/factory";
import { col, near, xy } from "@sequoia-leaf/factory/test/near.ts";

import { act, coinsAre, ctx, type FakeLeaf, opened, until, useFakeLeaf } from "../test/fake-leaf.ts";
import { buyLand } from "./plots.ts";
import { S, toolHooks } from "./state.ts";
import {
  aimAt,
  confirm,
  hold,
  keepAim,
  markEnd,
  markOver,
  markStart,
  place,
  setGrade,
  setTool,
  takeAway,
  tapBelt,
  undo,
} from "./tools.ts";
import { differences, doNow } from "./yard.ts";

useFakeLeaf();

/** A yard Leaf has, with every goal of the tiers below `tier` done, standing for Leaf's clock now; nothing in hand, and a mouse. */
function yardAt(tier: number): Yard {
  const y = create({ seed: 5, tier });
  y.at = ctx().now;
  S.finger = false;
  setTool(null);
  return y;
}

/** Does a command as a script or a card's button would, and says it was done. */
const done = (c: Record<string, unknown>): void => {
  expect(doNow(act(c))).not.toHaveProperty("refused");
};

/** Marks the pieces between two corners with Select and takes a copy of them in hand. */
function copyOf(x0: number, y0: number, x1: number, y1: number): void {
  setTool("select");
  markStart(x0, y0);
  markOver(x1, y1);
  markEnd();
  hold("copy");
}

describe("an aim", () => {
  test("a copy aimed, the crate it copies shut from its card, shows and sets down a shut crate", async () => {
    const y = yardAt(3);
    build(y, CRATE, ...xy(-6, -5), 0, Infinity);
    const fake = await opened(y, 1000);
    copyOf(...xy(-6, -5), ...xy(-6, -5));
    aimAt(...xy(-4, -2));
    expect(S.group?.at[0]).not.toHaveProperty("open");
    // The crate's card: Shut it.
    done({ do: "crate", ...near(-6, -5), open: false });
    keepAim();
    expect(S.group?.at[0]).toMatchObject({ kind: CRATE, ...near(-4, -2), open: false });
    expect(place(...xy(-4, -2))).toBe(true);
    const r = holderOf(S.world, at(S.world, ...xy(-4, -2)));
    expect(S.world.holders.open[r]).toBe(0);
    await until(() => fake.leaf.posts >= 2);
    expect(differences()).toBe(0);
    expect(encode(S.world)).toBe(encode({ ...fake.leaf.yard, seed: null }));
  });

  test("a tunnel aimed east, its far tile then taken, shows its far mouth where it will now come up, or that it cannot", async () => {
    const y = yardAt(2);
    build(y, BELT, ...xy(-5, -5), 0, Infinity);
    await opened(y, 1000);
    S.dir = 0;
    setTool(TUNNEL);
    aimAt(...xy(-6, -5));
    expect([S.aim?.far, S.aim?.why]).toEqual([at(S.world, ...xy(-4, -5)), null]);
    done({ do: "build", kind: "belt", ...near(-4, -5), dir: 0 });
    keepAim();
    expect([S.aim?.far, S.aim?.why]).toEqual([at(S.world, ...xy(-3, -5)), null]);
    done({ do: "build", kind: "belt", ...near(-3, -5), dir: 0 });
    done({ do: "build", kind: "belt", ...near(-2, -5), dir: 0 });
    keepAim();
    expect([S.aim?.far, S.aim?.why]).toEqual([-1, "A tunnel needs a free tile to come up on, 1 to 3 tiles ahead"]);
  });

  test("reads of the purse only whether it covers the cost, and by how much it falls short", async () => {
    const y = yardAt(3);
    build(y, CRATE, ...xy(-6, -5), 0, Infinity);
    build(y, CRATE, ...xy(-5, -5), 0, Infinity);
    await opened(y, 1000);
    copyOf(...xy(-6, -5), ...xy(-5, -5));
    aimAt(...xy(-5, -2));
    const covered = S.aim;
    expect(covered?.why).toBeNull();
    // More Coins (the till earning) change nothing it says: it is kept as it was.
    coinsAre(1500);
    keepAim();
    expect(S.aim).toBe(covered);
    const cost = covered?.cost ?? 0;
    coinsAre(cost - 10);
    keepAim();
    expect(S.aim?.why).toBe("Not enough Coins: 10 short");
    coinsAre(cost - 5);
    keepAim();
    expect(S.aim?.why).toBe("Not enough Coins: 5 short");
    coinsAre(cost);
    keepAim();
    expect(S.aim?.why).toBeNull();
  });

  test("a finger's run, another grade then chosen, is laid at that grade", async () => {
    const y = yardAt(3);
    await opened(y, 1000);
    S.finger = true;
    setTool(BELT);
    tapBelt(...xy(-7, 3));
    tapBelt(...xy(-2, 3));
    expect(S.run?.legs.map((l) => l.grade)).toEqual([1, 1, 1, 1, 1, 1]);
    setGrade(2);
    expect(S.run?.legs.map((l) => l.grade)).toEqual([2, 2, 2, 2, 2, 2]);
    expect(confirm()).toBe(true);
    expect([-7, -6, -5, -4, -3, -2].map((dx) => S.world.grade[at(S.world, ...xy(dx, 3))])).toEqual([2, 2, 2, 2, 2, 2]);
  });

  test("a finger's run tapped out to beside the depot turns into it", async () => {
    const y = yardAt(1);
    await opened(y, 1000);
    // Along the row over the depot (three tiles square), to the tile over its middle.
    const [mx, my] = S.world.land.depot;
    S.finger = true;
    setTool(BELT);
    tapBelt(mx - 4, my - 2);
    tapBelt(mx, my - 2);
    expect(S.run?.why).toBeNull();
    expect(S.run?.legs.at(-1)).toMatchObject({ x: mx, y: my - 2, dir: 1 });
  });

  test("a finger's run, a tile on its way then built on, is found again round it", async () => {
    const y = yardAt(1);
    await opened(y, 1000);
    S.finger = true;
    setTool(BELT);
    tapBelt(...xy(-7, 3));
    tapBelt(...xy(-2, 3));
    expect(S.run?.legs.map((l) => l.x)).toEqual([-7, -6, -5, -4, -3, -2].map(col));
    done({ do: "build", kind: "belt", ...near(-5, 3), dir: 1 });
    keepAim();
    expect(S.run?.why).toBeNull();
    expect(S.run?.legs.some((l) => `${l.x},${l.y}` === xy(-5, 3).join())).toBe(false);
    expect(S.run?.legs.at(-1)).toMatchObject({ ...near(-2, 3) });
  });
});

/** A yard of tier 3 with two crates and a blueprint of them, opened with `coins` in the purse. */
async function priced(coins: number): Promise<FakeLeaf> {
  const y = yardAt(3);
  build(y, CRATE, ...xy(-6, -5), 0, Infinity);
  build(y, CRATE, ...xy(-5, -5), 0, Infinity);
  const fake = await opened(y, coins);
  done({ do: "saveBlueprint", slot: 0, tiles: [at(y, ...xy(-6, -5)), at(y, ...xy(-5, -5))] });
  await until(() => fake.leaf.posts >= 1);
  fake.leaf.commands = [];
  return fake;
}

describe("whatever costs Coins", () => {
  // Each way the page sends something that costs: aimed (or pressed) while the purse covers it, then
  // the purse falls to nothing (spent from another page), and then sent.
  const ways: [string, () => void, () => boolean, (cost: number) => string][] = [
    [
      "a piece built",
      () => {
        setTool(CRATE);
        aimAt(...xy(-4, -2));
      },
      () => place(...xy(-4, -2)),
      () => "Not enough Coins",
    ],
    [
      "a run of belt",
      () => {
        S.finger = true;
        setTool(BELT);
        tapBelt(...xy(-7, 3));
        tapBelt(...xy(6, 3));
      },
      confirm,
      (cost) => `Not enough Coins: ${cost} short`,
    ],
    [
      "a copy",
      () => {
        copyOf(...xy(-6, -5), ...xy(-5, -5));
        aimAt(...xy(-5, -2));
      },
      () => place(...xy(-5, -2)),
      (cost) => `Not enough Coins: ${cost} short`,
    ],
    [
      "a blueprint",
      () => {
        setTool("select");
        hold(0);
        aimAt(...xy(-5, -2));
      },
      () => place(...xy(-5, -2)),
      (cost) => `Not enough Coins: ${cost} short`,
    ],
    ["a plot", () => undefined, () => buyLand(plot("meadow")), () => "Not enough Coins"],
  ];
  for (const [name, aim, send, why] of ways)
    test(`${name}, aimed while the purse covered it, is refused with the rules' sentence once it does not, and nothing is sent`, async () => {
      const fake = await priced(1000);
      const said: string[] = [];
      toolHooks.said = (text) => void said.push(text);
      aim();
      const cost = S.run?.cost ?? S.aim?.cost ?? 0;
      expect(S.run?.why ?? S.aim?.why ?? null).toBeNull();
      const kept = encode(S.world);
      coinsAre(0);
      expect(send()).toBe(false);
      expect([...said, S.aim?.why].some((s) => s?.startsWith(why(cost)))).toBe(true);
      expect(encode(S.world)).toBe(kept);
      await Bun.sleep(5);
      expect(fake.leaf.commands).toEqual([]);
    });

  test("an Undo that takes back what a piece taken away gave is refused whole once the purse and the till's whole Coins do not cover it, by how many; the till is counted once", async () => {
    const fake = await priced(0);
    const said: string[] = [];
    toolHooks.said = (text) => void said.push(text);
    expect(takeAway(...xy(-6, -5))).toBe(true);
    await until(() => fake.leaf.posts >= 2);
    fake.leaf.commands = [];
    const price = priceAt(S.world, CRATE, ...xy(-6, -5));
    // All but two of what it gave back are in the till, whole, and a part; one in the purse: one short.
    for (const y of [S.world, fake.leaf.yard]) y.till = (price - 2) * MILLI + 500;
    coinsAre(1);
    expect(undo()).toBe(false);
    expect(said).toEqual(["Not enough Coins: 1 short."]);
    await Bun.sleep(5);
    expect(fake.leaf.commands).toEqual([]);
    // One more in the purse covers it exactly: it is done, and sent as one command.
    coinsAre(2);
    expect(undo()).toBe(true);
    expect([S.world.kind[at(S.world, ...xy(-6, -5))], S.world.till]).toEqual([CRATE, 500]);
    await until(() => fake.leaf.commands.length >= 1);
    expect(fake.leaf.commands).toMatchObject([{ do: "undo" }]);
  });
});
