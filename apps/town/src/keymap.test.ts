import { describe, expect, test } from "bun:test";

import { keyboard } from "@sequoia-leaf/kit/keyboard.ts";

import { TOWN_KEYS } from "./keymap.ts";

/** A key going down as a keyboard sends it: where it is, and what it types there. */
const sent = (code: string, key: string) => ({
  code,
  key,
  shiftKey: false,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
});

describe("the town's keys", () => {
  test("no two actions share a key", () => {
    expect(TOWN_KEYS.shared()).toEqual([]);
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
