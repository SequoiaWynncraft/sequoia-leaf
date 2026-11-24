/**
 * The Works' settings menu (`menu.ts` in the kit): the yard's own kinds of sound, and what each key
 * does here. Letters are the keys that type them; the keys that move the view are where W, A, S and D
 * sit, whatever the keyboard prints on them (`input.ts`).
 */
import { type KeyShelf, type Menu, settingsMenu } from "@sequoia-leaf/kit/menu.ts";
import type { Scope } from "@sequoia-leaf/kit/scope.ts";

import { inputHooks, letGoKeys } from "../input.ts";
import { WORKS_SOUNDS } from "../sound.ts";

const KEYS: readonly KeyShelf[] = [
  {
    name: "Looking about",
    lines: [
      { keys: ["KeyW", "KeyA", "KeyS", "KeyD"], does: "Move the view" },
      { keys: ["Arrows"], does: "Move the view" },
      { keys: ["+", "_"], does: "Zoom in, zoom out" },
    ],
  },
  {
    name: "Building",
    lines: [
      { keys: ["1 to 0"], does: "Pick a tool, in toolbar order" },
      { keys: ["R"], does: "Rotate" },
      { keys: ["X"], does: "Flip a sorter" },
      { keys: ["G"], does: "Change the grade" },
      { keys: ["Q"], does: "Pick the piece pointed at" },
      { keys: ["E"], does: "Remove" },
      { keys: ["C"], does: "Paint a line" },
      { keys: ["Z"], does: "Undo" },
    ],
  },
  {
    name: "An area",
    lines: [
      { keys: ["F"], does: "Select" },
      { keys: ["M"], does: "Move what is marked" },
      { keys: ["C"], does: "Copy what is marked" },
      { keys: ["Delete"], does: "Remove what is marked" },
    ],
  },
  {
    name: "Panels",
    lines: [
      { keys: ["O"], does: "Orders" },
      { keys: ["T"], does: "Top yards" },
      { keys: ["P"], does: "This tier" },
      { keys: ["L"], does: "Research" },
      { keys: ["I"], does: "The depot" },
      { keys: ["M"], does: "The yard" },
      { keys: ["Escape"], does: "Put away, or this menu" },
    ],
  },
];

/**
 * Makes the Works' menu, for as long as `scope` stands: Escape with nothing else to put away opens it
 * (`inputHooks`), and while it is up the yard takes no keys and lets go of those held.
 */
export function startSettings(scope: Scope): Menu {
  const menu = settingsMenu(
    {
      sounds: [{ name: "The Works", sounds: WORKS_SOUNDS }],
      keys: KEYS,
      opened: (open) => {
        if (open) letGoKeys();
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
