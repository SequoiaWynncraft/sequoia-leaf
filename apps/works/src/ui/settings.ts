/** The Works' settings menu (`menu.ts` in the kit): the yard's own kinds of sound, and the Works' keys (`keymap.ts`). */
import { type Menu, settingsMenu } from "@sequoia-leaf/kit/menu.ts";
import type { Scope } from "@sequoia-leaf/kit/scope.ts";

import { inputHooks, letGo } from "../input.ts";
import { WORKS_KEYS } from "../keymap.ts";
import { WORKS_SOUNDS } from "../sound.ts";

/**
 * Makes the Works' menu, for as long as `scope` stands: Escape with nothing else to put away opens it
 * (`inputHooks`), and while it is up the yard takes no keys, and lets go of the keys and presses held.
 */
export function startSettings(scope: Scope): Menu {
  const menu = settingsMenu(
    {
      sounds: [{ name: "The Works", sounds: WORKS_SOUNDS }],
      keys: WORKS_KEYS,
      opened: (open) => {
        if (open) letGo();
      },
    },
    scope,
  );
  inputHooks.settings = () => {
    menu.open();
  };
  inputHooks.settingsUp = () => menu.isOpen;
  return menu;
}
