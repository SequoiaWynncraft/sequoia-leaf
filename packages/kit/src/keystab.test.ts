import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { keymap } from "./keyboard.ts";
import { noKeysHeld } from "./keys.ts";
import { Waiter } from "./keystab.ts";
import { settings } from "./settings.ts";
import { type Standin, standin } from "./standin.ts";

let world: Standin | null = null;
beforeEach(() => {
  world = standin({});
  settings.reread();
  noKeysHeld();
});
afterEach(() => {
  world?.done();
  world = null;
  settings.reread();
});

/** A key going down: its place, what it types, and the keys held with it. */
const press = (code: string, key: string, held: "shift" | "ctrl" | "alt" | null = null, repeat = false) => ({
  code,
  key,
  shiftKey: held === "shift",
  ctrlKey: held === "ctrl",
  metaKey: false,
  altKey: held === "alt",
  repeat,
});

const townKeys = (game: string) =>
  keymap(game, {
    up: { shelf: "Walking", does: "Walk up", keys: ["KeyW", "ArrowUp"], held: true },
    rotate: { shelf: "Decorating", does: "Rotate", keys: ["KeyR"] },
    back: { shelf: "Doing", does: "Put away, or this menu", keys: ["Escape"] },
  });

describe("a slot of the Keys tab waiting for a key", () => {
  test("says what it waits for; takes the next key, which walks from then on", () => {
    const keys = townKeys("wait");
    const waiter = new Waiter(keys);
    expect(waiter.key(press("KeyI", "i"))).toEqual({ taken: false, prevent: false });
    expect(waiter.wait({ id: "up", nth: 0, does: "Walk up", was: "W" })).toBe(
      "Press a key for Walk up. Escape keeps W.",
    );
    // Shift on its own: still waiting, nothing said.
    expect(waiter.key(press("ShiftLeft", "Shift", "shift"))).toEqual({ taken: true, prevent: false });
    expect(waiter.key(press("KeyI", "i"))).toEqual({ taken: true, prevent: true, say: { text: "", bad: false } });
    expect([waiter.slot, keys.keysOf("up"), keys.name("up")]).toEqual([null, ["KeyI", "ArrowUp"], "I"]);
    // Nothing waits now: the next key is the menu's own.
    expect(waiter.key(press("KeyQ", "q")).taken).toBe(false);
  });

  test("says which key it took from where; an empty slot says it is left empty", () => {
    const keys = townKeys("moved");
    const waiter = new Waiter(keys);
    waiter.wait({ id: "rotate", nth: 0, does: "Rotate", was: "R" });
    expect(waiter.key(press("KeyW", "w")).say).toEqual({ text: "W was on Walk up.", bad: false });
    expect([keys.keysOf("up"), keys.keysOf("rotate")]).toEqual([[null, "ArrowUp"], ["KeyW"]]);
    expect(waiter.wait({ id: "up", nth: 0, does: "Walk up", was: null })).toBe(
      "Press a key for Walk up. Escape leaves it empty.",
    );
  });

  test("Escape keeps the key it had, and is not the menu's; the next Escape is", () => {
    const keys = townKeys("keep");
    const waiter = new Waiter(keys);
    waiter.wait({ id: "rotate", nth: 0, does: "Rotate", was: "R" });
    expect(waiter.key(press("Escape", "Escape"))).toEqual({
      taken: true,
      prevent: true,
      say: { text: "", bad: false },
    });
    expect([waiter.slot, keys.keysOf("rotate")]).toEqual([null, ["KeyR"]]);
    noKeysHeld();
    expect(waiter.key(press("Escape", "Escape")).taken).toBe(false);
  });

  test("a key that cannot be used is said so, and the slot waits on; Ctrl with a key stays the system's", () => {
    const keys = townKeys("refused");
    const waiter = new Waiter(keys);
    const slot = { id: "rotate", nth: 0, does: "Rotate", was: "R" };
    waiter.wait(slot);
    expect(waiter.key(press("Tab", "Tab"))).toEqual({
      taken: true,
      prevent: true,
      say: { text: "Tab can't be used.", bad: true },
    });
    expect(waiter.key(press("KeyS", "s", "ctrl"))).toEqual({
      taken: true,
      prevent: false,
      say: { text: "Ctrl+S can't be used.", bad: true },
    });
    expect([waiter.slot, keys.keysOf("rotate")]).toEqual([slot, ["KeyR"]]);
  });

  test("the key that pressed the slot's button, held, is not taken for it", () => {
    const keys = townKeys("held");
    const waiter = new Waiter(keys);
    // Enter went down on the button and pressed it; the browser says it again while it is held.
    expect(waiter.key(press("Enter", "Enter")).taken).toBe(false);
    waiter.wait({ id: "rotate", nth: 0, does: "Rotate", was: "R" });
    expect(waiter.key(press("Enter", "Enter", null, true))).toEqual({ taken: true, prevent: true });
    expect(keys.keysOf("rotate")).toEqual(["KeyR"]);
    // Let go, and pressed again, it is the key.
    noKeysHeld();
    waiter.key(press("Enter", "Enter"));
    expect(keys.keysOf("rotate")).toEqual(["Enter"]);
  });
});
