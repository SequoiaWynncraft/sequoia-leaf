/** What each key does in town, the same on every place of it (`keyboard.ts` in the kit). */
import { type ActionOf, keymap, WALKING } from "@sequoia-leaf/kit/keyboard.ts";

export const TOWN_KEYS = keymap("town", {
  ...WALKING,
  use: { shelf: "Doing", does: "Use, talk or sit", keys: ["KeyE", "Enter", "Space"] },
  back: { shelf: "Doing", does: "Put away, or this menu", keys: ["Escape"] },
  rotate: { shelf: "Decorating a camp", does: "Rotate", keys: ["KeyR"] },
  stow: { shelf: "Decorating a camp", does: "Put away in Storage", keys: ["Delete", "Backspace"] },
});

/** One of the town's actions. */
export type TownAction = ActionOf<typeof TOWN_KEYS>;
