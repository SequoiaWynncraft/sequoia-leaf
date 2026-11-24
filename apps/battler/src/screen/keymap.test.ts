import { describe, expect, test } from "bun:test";

import { RAID_KEYS } from "./keymap.ts";

describe("the table's keys", () => {
  test("no two actions share a key, and Escape is the one the table reads", () => {
    expect(RAID_KEYS.shared()).toEqual([]);
    const escape = { code: "Escape", key: "Escape", shiftKey: false, ctrlKey: false, metaKey: false, altKey: false };
    expect(RAID_KEYS.of(escape)?.id).toBe("back");
  });
});
