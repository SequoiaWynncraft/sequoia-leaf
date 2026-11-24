/**
 * The town's settings menu (`menu.ts` in the kit): the camps' own kinds of sound, and what each key
 * does in town. The keys that walk are where W, A, S and D sit, whatever the keyboard prints on them
 * (`main.ts`); the rest are the letters they type.
 */
import { type KeyShelf, type Menu, settingsMenu } from "@sequoia-leaf/kit/menu.ts";
import type { Scope } from "@sequoia-leaf/kit/scope.ts";

import { CAMP_SOUNDS } from "./campsfx.ts";

const KEYS: readonly KeyShelf[] = [
  {
    name: "Walking",
    lines: [
      { keys: ["KeyW", "KeyA", "KeyS", "KeyD"], does: "Walk" },
      { keys: ["Arrows"], does: "Walk" },
    ],
  },
  {
    name: "Doing",
    lines: [
      { keys: ["E", "Enter", "Space"], does: "Use, talk or sit" },
      { keys: ["Escape"], does: "Put away, or this menu" },
    ],
  },
  {
    name: "Decorating a camp",
    lines: [
      { keys: ["R"], does: "Rotate" },
      { keys: ["Delete"], does: "Put away in Storage" },
    ],
  },
];

/** Makes the town's menu, for as long as `scope` stands; as it opens, the town lets go of what is held (`letGo`). */
export const startSettings = (scope: Scope, letGo: () => void): Menu =>
  settingsMenu(
    {
      sounds: [{ name: "The camps", sounds: CAMP_SOUNDS }],
      keys: KEYS,
      moves: ["KeyW", "KeyA", "KeyS", "KeyD"],
      opened: (open) => {
        if (open) letGo();
      },
    },
    scope,
  );
