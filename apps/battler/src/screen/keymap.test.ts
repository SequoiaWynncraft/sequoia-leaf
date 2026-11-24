import { afterEach, describe, expect, test } from "bun:test";

import { noKeysHeld } from "@sequoia-leaf/kit/keys.ts";

import { RAID_KEYS } from "./keymap.ts";

// Asking what a key is for notes it down (`heldAgain`); no page here lets it go.
afterEach(noKeysHeld);
describe("the table's keys", () => {
  test("no two actions share a key, and Escape is the one the table reads", () => {
    expect(RAID_KEYS.shared()).toEqual([]);
    const escape = {
      code: "Escape",
      key: "Escape",
      shiftKey: false,
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      repeat: false,
    };
    expect(RAID_KEYS.of(escape)?.id).toBe("back");
  });

  test("are the browser's and the track's own, so none can be changed", () => {
    expect([RAID_KEYS.changeable, RAID_KEYS.put("rooms", 0, "KeyQ"), RAID_KEYS.keysOf("rooms")]).toEqual([
      false,
      [],
      ["ArrowLeft", "ArrowRight"],
    ]);
  });
});
