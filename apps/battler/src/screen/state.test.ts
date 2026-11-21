import { afterEach, describe, expect, test } from "bun:test";

import { forgetStop, stop } from "@sequoia-leaf/kit/keep.ts";
import { type Standin, standin } from "@sequoia-leaf/kit/standin.ts";

import { KEYS } from "./keep.ts";
import { act, begin, prefsChanged, S, saveNow } from "./state.ts";

let world: Standin | null = null;
afterEach(() => {
  world?.done();
  world = null;
  forgetStop();
  S.run = null;
});

/** Ends the run in progress, as losing its last fight would. */
const end = (): void =>
  void act((run) => {
    run.phase = "over";
    return { ok: true, notes: [] };
  });

describe("what the table keeps", () => {
  test("the run and the prefs are kept as they change, and the almanac when a run ends", () => {
    world = standin({});
    begin(7, 0);
    expect(world.store.getItem(KEYS.run)).not.toBeNull();
    expect(world.store.getItem(KEYS.prefs)).not.toBeNull();
    end();
    expect(world.store.getItem(KEYS.almanac)).not.toBeNull();
    expect(world.store.getItem(KEYS.run)).toBeNull();
  });

  test("a page that has stopped keeps none of them, and lets no run go", () => {
    world = standin({});
    for (const name of Object.values(KEYS)) world.store.setItem(name, "theirs");
    stop();
    begin(7, 0);
    saveNow();
    prefsChanged();
    end();
    for (const name of Object.values(KEYS)) expect(world.store.getItem(name)).toBe("theirs");
  });
});
