import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { pretend } from "./net.ts";
import {
  balance,
  earn,
  forgetLedger,
  fromLedger,
  grant,
  has,
  KEY,
  leafOpen,
  reread,
  reset,
  spend,
  watch,
} from "./purse.ts";
import { MemoryStore } from "./standin.ts";

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

describe("the purse beside the guild's ledger", () => {
  let store = new MemoryStore();
  let done: (() => void) | null = null;
  beforeEach(() => {
    store = new MemoryStore();
    done = pretend({ store: () => store });
    reset();
    fromLedger(2450);
  });
  afterEach(() => {
    forgetLedger();
    done?.();
  });

  test("Leaf is what the ledger says, and only that", () => {
    expect(balance().leaf).toBe(2450);
    expect(leafOpen()).toBe(false);
    const heard: string[] = [];
    const stop = watch((p, why) => heard.push(`${p.leaf} ${why}`));
    fromLedger(2530);
    stop();
    expect(balance().leaf).toBe(2530);
    expect(heard).toEqual(["2530 the guild's ledger"]);
  });

  test("grant changes nothing", () => {
    const before = { ...balance() };
    grant(500, "a quest");
    expect(balance()).toEqual(before);
  });

  test("Leaf is never spent, even when the purse holds it", () => {
    expect(spend("leaf", 1, "a crown")).toBe(false);
    expect(spend("leaf", 0, "nothing at all")).toBe(false);
    expect(balance().leaf).toBe(2450);
  });

  test("Coins still come and go, and are kept without any Leaf beside them", () => {
    const coins = balance().coins;
    earn(40, "a crate");
    expect(spend("coins", 15, "a bun")).toBe(true);
    expect(balance()).toEqual({ leaf: 2450, coins: coins + 25 });
    expect(JSON.parse(store.getItem(KEY) ?? "null")).toEqual({ coins: coins + 25 });
  });

  test("a purse read back from the browser keeps the ledger's Leaf, whatever it says", () => {
    store.setItem(KEY, JSON.stringify({ leaf: 999_999, coins: 812 }));
    reread();
    expect(balance()).toEqual({ leaf: 2450, coins: 812 });
    reset();
    expect(balance().leaf).toBe(2450);
  });
});
