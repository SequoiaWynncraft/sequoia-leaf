/**
 * The table's keys (`keyboard.ts` in the kit). Tab and Enter are the browser's own, and the arrows on
 * the room track the track's (`table.ts`): the table itself reads only Escape. So none of them can
 * be changed.
 */
import { fixedKeymap } from "@sequoia-leaf/kit/keyboard.ts";

export const RAID_KEYS = fixedKeymap({
  buttons: { shelf: "At the table", does: "Go from button to button, and press one", keys: ["Tab", "Enter"] },
  rooms: {
    shelf: "At the table",
    does: "On the track of rooms, go from room to room",
    keys: ["ArrowLeft", "ArrowRight"],
  },
  back: { shelf: "At the table", does: "Put down, put away, or this menu", keys: ["Escape"] },
});
