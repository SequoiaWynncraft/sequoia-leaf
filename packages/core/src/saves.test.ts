import { describe, expect, it } from "bun:test";

import { checkSave, MAX_SAVE_BYTES, SAVE_SLOTS, saveSlot } from "./saves.ts";

/** A save whose JSON text is exactly `bytes` long. */
function saveOf(bytes: number, filler = "a") {
  const empty = JSON.stringify({ keys: "" }).length;
  return { keys: filler.repeat(bytes - empty) };
}

describe("save slots", () => {
  it("are the purse, the town, the Works and the battler", () => {
    expect(SAVE_SLOTS).toEqual(["purse", "town", "works", "raid"]);
  });

  it("knows each slot by name and nothing else", () => {
    expect(saveSlot("works")).toBe("works");
    expect(saveSlot("ledger")).toBeUndefined();
    expect(saveSlot("Works")).toBeUndefined();
  });
});

describe("checkSave", () => {
  it("accepts a JSON object in a known slot, as its JSON text", () => {
    expect(checkSave("town", { saved_at: 1, keys: { "town.save.v1": "{}" } })).toEqual({
      ok: true,
      slot: "town",
      text: '{"saved_at":1,"keys":{"town.save.v1":"{}"}}',
    });
  });

  it("refuses a slot that is not one", () => {
    expect(checkSave("leaf", {})).toEqual({ ok: false, reason: "invalid_slot" });
  });

  it("refuses anything but an object", () => {
    for (const data of [null, [], "save", 3, true, undefined]) {
      expect(checkSave("purse", data)).toEqual({ ok: false, reason: "invalid_save" });
    }
  });

  it("accepts a save of exactly the limit and refuses one a byte over", () => {
    expect(checkSave("raid", saveOf(MAX_SAVE_BYTES))).toMatchObject({ ok: true });
    expect(checkSave("raid", saveOf(MAX_SAVE_BYTES + 1))).toEqual({ ok: false, reason: "save_too_large" });
  });

  it("counts the bytes of the text, not its characters", () => {
    // "é" is two bytes in UTF-8 and "🌳" four, so these are over the limit in fewer characters.
    expect(checkSave("raid", saveOf(MAX_SAVE_BYTES / 2 + 20, "é"))).toEqual({ ok: false, reason: "save_too_large" });
    expect(checkSave("raid", saveOf(MAX_SAVE_BYTES / 4 + 20, "🌳"))).toEqual({ ok: false, reason: "save_too_large" });
  });
});
