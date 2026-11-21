import { beforeEach, describe, expect, test } from "bun:test";

import { balance, earn, grant, has, reset, spend, watch } from "./purse.ts";

describe("the purse", () => {
  beforeEach(reset);

  test("Coins are earned and Leaf is granted, in whole amounts", () => {
    const before = { ...balance() };
    earn(12.9, "a test");
    grant(3.2, "a test");
    expect(balance()).toEqual({ leaf: before.leaf + 3, coins: before.coins + 12 });
  });

  test("nothing, or less than nothing, changes nothing", () => {
    const before = { ...balance() };
    earn(0, "a test");
    earn(-5, "a test");
    grant(-1, "a test");
    grant(Number.NaN, "a test");
    expect(balance()).toEqual(before);
  });

  test("spending takes the price only when the purse holds it", () => {
    const { leaf, coins } = balance();
    expect(spend("leaf", leaf + 1, "too dear")).toBe(false);
    expect(balance().leaf).toBe(leaf);
    expect(spend("leaf", leaf, "all of it")).toBe(true);
    expect(balance().leaf).toBe(0);
    expect(has("leaf", 1)).toBe(false);
    expect(spend("coins", -4, "a trick")).toBe(false);
    expect(balance().coins).toBe(coins);
  });

  test("whoever is watching hears each change, and why", () => {
    const heard: string[] = [];
    const stop = watch((_p, why) => heard.push(why));
    earn(5, "a crate");
    spend("coins", 2, "a bun");
    spend("coins", 1e9, "the moon");
    stop();
    earn(5, "unheard");
    expect(heard).toEqual(["a crate", "a bun"]);
  });
});
