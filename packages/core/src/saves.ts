/**
 * What a member's games keep on their account: one save per slot, each a JSON
 * object the game reads back as it wrote it. Saves are not the ledger: they
 * hold nothing Leaf pays or charges, and Leaf trusts nothing in them.
 */

/** The slots a member has: the purse's Coins, the town, the Works and the battler. */
export const SAVE_SLOTS = ["purse", "town", "works", "raid"] as const;

export type SaveSlot = (typeof SAVE_SLOTS)[number];

/** The most a save may hold, as the bytes of its JSON text. */
export const MAX_SAVE_BYTES = 256 * 1024;

/** The slot a name stands for, or undefined when it is not one. */
export function saveSlot(name: string): SaveSlot | undefined {
  return SAVE_SLOTS.find((slot) => slot === name);
}

export type SaveCheck =
  /** `text` is the save as JSON, which is what is stored. */
  | { readonly ok: true; readonly slot: SaveSlot; readonly text: string }
  | { readonly ok: false; readonly reason: "invalid_slot" | "invalid_save" | "save_too_large" };

/** Whether `data` may be saved in the slot named `slot`: a JSON object of at most `MAX_SAVE_BYTES`. */
export function checkSave(slot: string, data: unknown): SaveCheck {
  const known = saveSlot(slot);
  if (known === undefined) {
    return { ok: false, reason: "invalid_slot" };
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return { ok: false, reason: "invalid_save" };
  }
  const text = JSON.stringify(data);
  if (utf8Length(text) > MAX_SAVE_BYTES) {
    return { ok: false, reason: "save_too_large" };
  }
  return { ok: true, slot: known, text };
}

/** How many bytes `text` takes as UTF-8. */
function utf8Length(text: string): number {
  let bytes = 0;
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
  }
  return bytes;
}
