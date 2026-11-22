import { afterEach, describe, expect, test } from "bun:test";

import {
  asGuest,
  balance,
  coinsOnLeaf,
  forgetLedger,
  fromLeaf,
  fromLedger,
  heardCoins,
  LEAF_GUEST,
  LEAF_SHUT,
  leafShown,
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
    expect([coinsOnLeaf(), leafShown(), leafShut()]).toEqual([true, true, LEAF_SHUT]);
  });

  test("is a guest's with no Leaf to show", () => {
    asGuest();
    expect([balance().leaf, leafShown(), leafShut()]).toEqual([0, false, LEAF_GUEST]);
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

  test("asks nothing before it holds Leaf's Coins", async () => {
    world = standin({});
    refreshCoins();
    heardCoins(5);
    await answered();
    expect([world.sent, balance().coins]).toEqual([[], 0]);
  });
});
