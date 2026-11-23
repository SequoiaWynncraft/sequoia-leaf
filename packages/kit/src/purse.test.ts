import { beforeEach, describe, expect, test } from "bun:test";

import {
  asGuest,
  balance,
  forgetLedger,
  fromLeaf,
  LEAF_MEMBERS,
  LEAF_SHUT,
  leafFor,
  leafShut,
  onLeaf,
  owe,
  settle,
  watch,
} from "./purse.ts";

beforeEach(() => {
  forgetLedger();
});

describe("the purse", () => {
  test("shows Leaf's word, and whoever watches hears each change", () => {
    const heard: string[] = [];
    watch((p, why) => heard.push(`${p.leaf}/${p.coins} ${why}`));
    expect(onLeaf()).toBe(false);
    fromLeaf({ coins: 300, leaf: 1860, version: 4 });
    fromLeaf({ coins: 300, leaf: 1900, version: 5 });
    expect(balance()).toEqual({ leaf: 1900, coins: 300 });
    expect(heard).toEqual(["1860/300 Leaf", "1900/300 Leaf"]);
    expect([onLeaf(), leafShut(), leafFor("everyone"), leafFor("members")]).toEqual([true, LEAF_SHUT, true, true]);
  });

  test("is a guest's with their Leaf, to spend on what is for everyone but not on what is for members", () => {
    asGuest();
    fromLeaf({ coins: 300, leaf: 1500, version: 1 });
    expect([balance().leaf, leafShut(), leafFor("everyone"), leafFor("members")]).toEqual([
      1500,
      LEAF_SHUT,
      true,
      false,
    ]);
    expect(LEAF_MEMBERS).toBe("For guild members.");
  });

  test("keeps Leaf's newest word: one of an older moment, or the same, comes too late and is let go", () => {
    expect(fromLeaf({ coins: 300, leaf: 10, version: 5 })).toBe(true);
    expect(fromLeaf({ coins: 999, leaf: 99, version: 3 })).toBe(false);
    expect(fromLeaf({ coins: 999, leaf: 99, version: 5 })).toBe(false);
    expect(balance()).toEqual({ leaf: 10, coins: 300 });
    expect(fromLeaf({ coins: 250, leaf: 10, version: 6 })).toBe(true);
    expect(balance()).toEqual({ leaf: 10, coins: 250 });
  });

  test("a purchase on its way stays shown when Leaf answers the one before it, and goes as Leaf answers it", () => {
    fromLeaf({ coins: 300, leaf: 0, version: 1 });
    // Two builds, A and B, shown at once; A is answered first, with Leaf's word after A alone.
    owe("a", -50);
    owe("b", -20);
    expect(balance().coins).toBe(230);
    settle(["a"], { coins: 250, leaf: 0, version: 2 });
    expect(balance().coins).toBe(230);
    settle(["b"], { coins: 230, leaf: 0, version: 3 });
    expect(balance().coins).toBe(230);
    // A's answer again, late (sent again after a lost answer): nothing.
    settle(["a"], { coins: 250, leaf: 0, version: 2 });
    expect(balance().coins).toBe(230);
  });

  test("a command answered with no word of Leaf's (refused unread, or a stop) lets what it owed go, and the word stands", () => {
    fromLeaf({ coins: 300, leaf: 0, version: 1 });
    owe("a", -50);
    owe("b", 40);
    settle(["a", "b"], null);
    expect(balance().coins).toBe(300);
  });

  test("owes nothing before Leaf has said, and never shows below nothing", () => {
    owe("a", -50);
    fromLeaf({ coins: 30, leaf: 0, version: 1 });
    expect(balance().coins).toBe(30);
    owe("b", -50);
    expect(balance().coins).toBe(0);
  });
});
