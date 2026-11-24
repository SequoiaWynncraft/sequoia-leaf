/**
 * The table's settings menu (`menu.ts` in the kit): the table's own kinds of sound, and its keys.
 * The table is played with the pointer and a finger, so its keys are few.
 */
import { keymap } from "@sequoia-leaf/kit/keyboard.ts";
import { heldAgain } from "@sequoia-leaf/kit/keys.ts";
import { type Menu, settingsMenu } from "@sequoia-leaf/kit/menu.ts";
import type { Scope } from "@sequoia-leaf/kit/scope.ts";

import { handHooks, letGoHand } from "./hand.ts";
import { RAID_SOUNDS } from "./sounds.ts";
import { sheetUp } from "./ui/fightsheet.ts";
import { pageOver, showPage } from "./ui/pages.ts";

/** The table's keys (`keyboard.ts` in the kit). Tab and Enter are the browser's own: the table reads only Escape. */
export const RAID_KEYS = keymap({
  buttons: { shelf: "At the table", does: "Go from button to button, and press one", keys: ["Tab", "Enter"] },
  back: { shelf: "At the table", does: "Put down, put away, or this menu", keys: ["Escape"] },
});

/**
 * Makes the table's menu, for as long as `scope` stands: while it is up the table takes no presses,
 * and what the hand held is put down as it opens. And what Escape does at the table, one thing a
 * press (held down, it does nothing more) unless a card took it first: a page over the table goes,
 * else the last fight's sheet looked back at (`lookBack` puts it away), else what the hand holds;
 * with none of those, the menu opens.
 */
export function startSettings(scope: Scope, lookBack: () => void): Menu {
  const menu = settingsMenu(
    {
      sounds: [{ name: "The Little Raid", sounds: RAID_SOUNDS }],
      keys: RAID_KEYS,
      opened: (open) => {
        if (open) letGoHand();
      },
    },
    scope,
  );
  handHooks.paused = () => menu.isOpen;
  scope.on(window, "keydown", (e) => {
    if (RAID_KEYS.of(e)?.id !== "back" || e.defaultPrevented || menu.isOpen || heldAgain(e)) return;
    if (pageOver()) showPage(null);
    else if (sheetUp() === "again") lookBack();
    else if (!letGoHand()) menu.open();
  });
  return menu;
}
