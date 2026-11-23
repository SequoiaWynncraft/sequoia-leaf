import { afterEach, describe, expect, test } from "bun:test";

import {
  asGuest,
  balance,
  coinsOnLeaf,
  forgetLedger,
  fromLeaf,
  fromLedger,
  heardCoins,
  LEAF_MEMBERS,
  LEAF_SHUT,
  leafFor,
  leafShut,
  refreshCoins,
  watch,
} from "./purse.ts";
import { type Standin, standin } from "./standin.ts";

let world: Standin | null = null;
afterEach(() => {
  world?.done();
  world = null;
  forgetLedger();
});

/** Lets every answer the stand-in has queued come in. */
const answered = (): Promise<void> => Bun.sleep(5);

describe("the purse", () => {
  test("shows the ledger's Leaf and Leaf's Coins, and whoever watches hears each change", () => {
    const heard: string[] = [];
    watch((p, why) => heard.push(`${p.leaf}/${p.coins} ${why}`));
    fromLedger(1860);
    fromLeaf(300);
    heardCoins(275);
    expect(balance()).toEqual({ leaf: 1860, coins: 275 });
    expect(heard).toEqual(["1860/0 the guild's ledger", "1860/300 Leaf", "1860/275 the town"]);
    expect([coinsOnLeaf(), leafShut(), leafFor("everyone"), leafFor("members")]).toEqual([true, LEAF_SHUT, true, true]);
  });

  test("is a guest's with their Leaf, to spend on what is for everyone but not on what is for members", () => {
    asGuest();
    fromLedger(1500);
    expect([balance().leaf, leafShut(), leafFor("everyone"), leafFor("members")]).toEqual([
      1500,
      LEAF_SHUT,
      true,
      false,
    ]);
    expect(LEAF_MEMBERS).toBe("For guild members.");
  });

  test("asks Leaf for the Coins again, one question at a time, and once more if asked meanwhile", async () => {
    let coins = 300;
    world = standin({ "GET /v1/game/me": () => ({ status: 200, body: { coins } }) });
    fromLeaf(300);
    coins = 275;
    refreshCoins();
    coins = 250;
    refreshCoins();
    await answered();
    expect(world.sent.map((s) => s.path)).toEqual(["/v1/game/me", "/v1/game/me"]);
    expect(balance().coins).toBe(250);
  });

  test("lets go an answer asked for before Coins were spent, and takes the one asked for after", async () => {
    let coins = 300;
    // Leaf answers with the Coins it held when asked, once it is let go.
    const held = Promise.withResolvers<void>();
    world = standin({
      "GET /v1/game/me": () => {
        const then = coins;
        return held.promise.then(() => ({ status: 200, body: { coins: then } }));
      },
    });
    fromLeaf(300);
    refreshCoins();
    await answered();
    // A purchase is shown at once and taken on Leaf before the answer to the question comes back.
    coins = 250;
    heardCoins(250);
    held.resolve();
    await answered();
    expect(balance().coins).toBe(250);
    // The purchase's own answer asks again while a question is out: the answer after it is taken.
    coins = 240;
    heardCoins(240);
    refreshCoins();
    coins = 230;
    refreshCoins();
    await answered();
    expect(balance().coins).toBe(230);
  });

  test("asks nothing before it holds Leaf's Coins", async () => {
    world = standin({});
    refreshCoins();
    heardCoins(5);
    await answered();
    expect([world.sent, balance().coins]).toEqual([[], 0]);
  });
});
