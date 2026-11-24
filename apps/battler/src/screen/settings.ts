import { heldAgain } from "@sequoia-leaf/kit/keys.ts";
/**
 * The table's settings menu (`menu.ts` in the kit): the table's own kinds of sound, and its keys.
 * The table is played with the pointer and a finger, so its keys are few.
 */
import { type KeyShelf, type Menu, settingsMenu } from "@sequoia-leaf/kit/menu.ts";
import type { Scope } from "@sequoia-leaf/kit/scope.ts";

import { handHooks, letGoHand } from "./hand.ts";
import { RAID_SOUNDS } from "./sounds.ts";
import { sheetUp } from "./ui/fightsheet.ts";
import { pageOver, showPage } from "./ui/pages.ts";

const KEYS: readonly KeyShelf[] = [
  {
    name: "At the table",
    lines: [
      { keys: ["Tab", "Enter"], does: "Go from button to button, and press one" },
      { keys: ["Escape"], does: "Put down, put away, or this menu" },
    ],
  },
];

/**
 * Makes the table's menu, for as long as `scope` stands: while it is up the table takes no presses,
 * and what the hand held is put down as it opens. And what Escape does at the table, one thing a
 * press unless a card took it first: a page over the table goes, else the last fight's sheet looked
 * back at (`lookBack` puts it away), else what the hand holds; with none of those, the menu opens.
 */
export function startSettings(scope: Scope, lookBack: () => void): Menu {
  const menu = settingsMenu(
    {
      sounds: [{ name: "The Little Raid", sounds: RAID_SOUNDS }],
      keys: KEYS,
      opened: (open) => {
        if (open) letGoHand();
      },
    },
    scope,
  );
  handHooks.paused = () => menu.isOpen;
  scope.on(window, "keydown", (e) => {
    if (e.key !== "Escape" || e.defaultPrevented || menu.isOpen) return;
    if (pageOver()) showPage(null);
    else if (sheetUp() === "again") lookBack();
    else if (!letGoHand() && !heldAgain(e)) menu.open();
  });
  return menu;
}
