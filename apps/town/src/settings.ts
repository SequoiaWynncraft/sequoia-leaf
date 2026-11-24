/** The town's settings menu (`menu.ts` in the kit): the camps' own kinds of sound, and the town's keys (`keymap.ts`). */
import { type Menu, settingsMenu } from "@sequoia-leaf/kit/menu.ts";
import type { Scope } from "@sequoia-leaf/kit/scope.ts";

import { CAMP_SOUNDS } from "./campsfx.ts";
import { TOWN_KEYS } from "./keymap.ts";

/** Makes the town's menu, for as long as `scope` stands; as it opens, the town lets go of what is held (`letGo`). */
export const startSettings = (scope: Scope, letGo: () => void): Menu =>
  settingsMenu(
    {
      sounds: [{ name: "The camps", sounds: CAMP_SOUNDS }],
      keys: TOWN_KEYS,
      opened: (open) => {
        if (open) letGo();
      },
    },
    scope,
  );
