import { afterEach, describe, expect, test } from "bun:test";

import { keyboard } from "@sequoia-leaf/kit/keyboard.ts";
import { noKeysHeld } from "@sequoia-leaf/kit/keys.ts";

import { TOWN_KEYS } from "./keymap.ts";

/** A key going down as a keyboard sends it: where it is, and what it types there. */
const sent = (code: string, key: string) => ({
  code,
  key,
  shiftKey: false,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  repeat: false,
});

// Asking what a key is for notes it down (`heldAgain`); no page here lets it go.
afterEach(noKeysHeld);
describe("the town's keys", () => {
  test("no two actions share a key; Escape stays Back and the menu", () => {
    expect(TOWN_KEYS.shared()).toEqual([]);
    expect([TOWN_KEYS.fixed("back", 0), TOWN_KEYS.put("back", 0, "KeyB"), TOWN_KEYS.keysOf("back")]).toEqual([
      true,
      [],
      ["Escape"],
    ]);
  });

  test("walk up put on I: I walks up, and W walks no more", () => {
    try {
      expect(TOWN_KEYS.put("up", 0, "KeyI")).toEqual([]);
      expect([TOWN_KEYS.of(sent("KeyI", "i"))?.id, TOWN_KEYS.of(sent("KeyW", "w")), TOWN_KEYS.name("up")]).toEqual([
        "up",
        undefined,
        "I",
      ]);
      expect([TOWN_KEYS.isDown(new Set(["KeyI"]), "up"), TOWN_KEYS.isDown(new Set(["KeyW"]), "up")]).toEqual([
        true,
        false,
      ]);
    } finally {
      TOWN_KEYS.resetAll();
    }
  });

  test("go by their place: on AZERTY, its Q (where QWERTY has A) walks left, and its A does nothing", () => {
    keyboard.choose("azerty");
    try {
      expect([TOWN_KEYS.of(sent("KeyA", "q"))?.id, TOWN_KEYS.of(sent("KeyQ", "a"))]).toEqual(["left", undefined]);
      expect(TOWN_KEYS.held("left")).toBe(true);
      expect(TOWN_KEYS.names("left")).toEqual(["Q", "Left"]);
      expect(["Enter", "Space", "KeyE"].map((code) => TOWN_KEYS.of(sent(code, ""))?.id)).toEqual(["use", "use", "use"]);
      expect(["Delete", "Backspace", "KeyR"].map((code) => TOWN_KEYS.of(sent(code, ""))?.id)).toEqual([
        "stow",
        "stow",
        "rotate",
      ]);
    } finally {
      keyboard.choose("qwerty");
    }
  });
});
