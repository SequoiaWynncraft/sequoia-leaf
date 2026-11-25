/**
 * The town's keyboard, the same on every place of it (`keymap.ts`): the keys that walk; use, on
 * what the member stands at; back, which puts away the newest thing up, or with nothing up opens the
 * settings menu; any other is the place's own (`Scene.key`). A key held down is one press: only
 * walking goes on while its key is held. A key something on the page has taken already (a row of
 * tabs its arrow, a card its Escape, a layer its use key: `dialog.ts`) is not the town's.
 */
import { placeOf } from "@sequoia-leaf/kit/keyboard.ts";
import { forControl, heldAgain, onControl, pressesButtons, typing } from "@sequoia-leaf/kit/keys.ts";
import type { Scope } from "@sequoia-leaf/kit/scope.ts";
import { unlock } from "@sequoia-leaf/kit/sound.ts";

import { TOWN_KEYS } from "./keymap.ts";
import type { Scene } from "./stage.ts";

/** What the keyboard asks of the town. */
export interface KeysOf {
  /** Whether the town takes no keys now: a game has the page, or the settings menu is up. */
  readonly away: () => boolean;
  /** Whether the member may do anything just now (not between one place and the next). */
  readonly mayAct: () => boolean;
  /** The place the member is on, as far as its keys go. */
  readonly scene: () => Pick<Scene, "act" | "back" | "key">;
  /** Escape with nothing for the place to put away: the settings menu. */
  readonly settings: () => void;
}

/** Use: what the member stands at is used, unless a button that has the keyboard answers the key (Enter, Space). */
function use(e: KeyboardEvent, repeated: boolean, scene: Pick<Scene, "act">): void {
  const onButton = onControl(e);
  const presses = pressesButtons(placeOf(e));
  // A button that has the keyboard answers Enter and Space itself.
  if (!repeated && (!presses || !onButton)) scene.act();
  // Or Enter, and Enter held, would go on to press the first button of the card it has just opened.
  if (presses && (!onButton || repeated)) e.preventDefault();
}

/**
 * A layer's own use key (`dialog.ts`, asked only while it is the newest layer): the use key pressed
 * afresh does `done`, and nothing else hears it. Enter or Space on a button is the button's own press.
 */
export const usesKey =
  (done: () => void) =>
  (e: KeyboardEvent): boolean => {
    const key = TOWN_KEYS.of(e);
    if (key?.id !== "use" || key.again || forControl(e)) return false;
    e.preventDefault();
    done();
    return true;
  };

/** Listens to the keyboard for as long as `scope` stands. Gives back the places of the keys held to walk (`TOWN_KEYS.isDown`). */
export function listenKeys(scope: Scope, of: KeysOf): Set<string> {
  const down = new Set<string>();
  scope.on(window, "keydown", (e) => {
    unlock();
    // Typed into a field (a tome's reason), a key is a letter, not a step or a press; and one taken
    // already (a tip opened by its key, a tab chosen by its arrow) is not a press in the world as well.
    if (of.away() || typing(e) || e.defaultPrevented) return;
    const act = TOWN_KEYS.of(e)?.id;
    // Said again while held: walking walks on, and nothing else is done again (not a Grove prize passed by a held Right).
    const repeated = heldAgain(e);
    if (act === "use") return use(e, repeated, of.scene());
    // Enter or Space on a button is the button's, whatever else the player has put on them.
    if (act === undefined || !of.mayAct() || forControl(e)) return;
    if (act === "back") {
      if (!repeated && !of.scene().back()) of.settings();
      return;
    }
    if (!repeated && of.scene().key(act)) {
      e.preventDefault();
      return;
    }
    // Still held when the town woke, a key that walks walks on.
    if (!TOWN_KEYS.held(act)) return;
    e.preventDefault();
    down.add(placeOf(e));
  });
  scope.on(window, "keyup", (e) => {
    down.delete(placeOf(e));
  });
  return down;
}
