import { afterEach, describe, expect, test } from "bun:test";

import { forgetStop, stop } from "@sequoia-leaf/kit/keep.ts";
import { KEY as PURSE } from "@sequoia-leaf/kit/purse.ts";
import { type Standin, standin } from "@sequoia-leaf/kit/standin.ts";

import { forgetYard, keep, openYard } from "./yard.ts";

let world: Standin | null = null;
afterEach(() => {
  world?.done();
  world = null;
  forgetStop();
});

const YARD = "works.save.v2";
/** What the yards before this one kept, Coins and all: opening the yard carries the Coins over, and forgets them. */
const OLDER: Readonly<Record<string, string>> = {
  "works.save.v1": JSON.stringify({ cells: [], order: 0, coins: 40 }),
  "works.coins.v2": "120",
};

describe("keeping the yard", () => {
  test("the yard is kept, and forgotten when it starts over", () => {
    world = standin({});
    for (const [name, text] of Object.entries(OLDER)) world.store.setItem(name, text);
    openYard();
    for (const name of Object.keys(OLDER)) expect(world.store.getItem(name)).toBeNull();
    expect(world.store.getItem(PURSE)).not.toBeNull();
    keep();
    expect(world.store.getItem(YARD)).not.toBeNull();
    forgetYard();
    expect(world.store.getItem(YARD)).toBeNull();
  });

  test("a page that has stopped keeps nothing, and forgets nothing", () => {
    world = standin({});
    world.store.setItem(YARD, "theirs");
    for (const [name, text] of Object.entries(OLDER)) world.store.setItem(name, text);
    stop();
    openYard();
    keep();
    forgetYard();
    expect(world.store.getItem(YARD)).toBe("theirs");
    for (const [name, text] of Object.entries(OLDER)) expect(world.store.getItem(name)).toBe(text);
    expect(world.store.getItem(PURSE)).toBeNull();
  });
});
