import { afterEach, describe, expect, test } from "bun:test";

import { forgetStop, stop } from "@sequoia-leaf/kit/keep.ts";
import { type Standin, standin } from "@sequoia-leaf/kit/standin.ts";

import { stir } from "./guild.ts";
import { camp, remember } from "./record.ts";

let world: Standin | null = null;
afterEach(() => {
  world?.done();
  world = null;
  forgetStop();
});

/** The town's own names: its record (with the camp in it) and the made-up guild's memory. */
const RECORD = "town.save.v1";
const MEMORY = "town.guild.v1";

describe("what the town keeps", () => {
  test("the record, camp and all, and the made-up guild's memory are written as they change", () => {
    world = standin({});
    camp.parcels = ["gnome"];
    remember();
    stir("land");
    expect(JSON.parse(world.store.getItem(RECORD) ?? "null")).toMatchObject({ camp: { parcels: ["gnome"] } });
    expect(world.store.getItem(MEMORY)).not.toBeNull();
  });

  test("a page that has stopped writes neither", () => {
    world = standin({});
    world.store.setItem(RECORD, "theirs");
    world.store.setItem(MEMORY, "theirs too");
    stop();
    camp.parcels = ["well"];
    remember();
    stir("land");
    stir("call");
    expect(world.store.getItem(RECORD)).toBe("theirs");
    expect(world.store.getItem(MEMORY)).toBe("theirs too");
  });
});
