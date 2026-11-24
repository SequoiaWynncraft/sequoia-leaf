/** The table's keys (`keyboard.ts` in the kit). Tab and Enter are the browser's own: the table reads only Escape. */
import { keymap } from "@sequoia-leaf/kit/keyboard.ts";

export const RAID_KEYS = keymap({
  buttons: { shelf: "At the table", does: "Go from button to button, and press one", keys: ["Tab", "Enter"] },
  back: { shelf: "At the table", does: "Put down, put away, or this menu", keys: ["Escape"] },
});
