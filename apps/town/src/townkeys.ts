/**
 * The town's keyboard, the same on every place of it: walking by the keys where W, A, S and D sit,
 * whatever the keyboard prints on them, or by the arrows; E, Enter and Space use what the member
 * stands at; Escape puts away the newest thing up, or with nothing up opens the settings menu; any
 * other key is the place's own (`Scene.key`). A key held down is one press: only walking goes on
 * while its key is held.
 */
import { heldAgain, typing } from "@sequoia-leaf/kit/keys.ts";
import type { Scope } from "@sequoia-leaf/kit/scope.ts";
import { unlock } from "@sequoia-leaf/kit/sound.ts";

import type { Scene } from "./stage.ts";
import { dismissArrival } from "./ui.ts";

/** The keys that walk, by their place on the keyboard (`code`), whatever it prints on them: as W, A, S and D sit. */
const WALKS: ReadonlyMap<string, string> = new Map([
  ["KeyW", "w"],
  ["KeyA", "a"],
  ["KeyS", "s"],
  ["KeyD", "d"],
]);
/** A key as the town reads it: one that walks by its place, any other by what it types, in lower case. */
const keyOf = (e: KeyboardEvent): string => WALKS.get(e.code) ?? e.key.toLowerCase();

/** What the keyboard asks of the town. */
export interface KeysOf {
  /** Whether the town takes no keys now: a game has the page, or the settings menu is up. */
  readonly away: () => boolean;
  /** Whether the member may do anything just now (not between one place and the next). */
  readonly mayAct: () => boolean;
  /** The place the member is on. */
  readonly scene: () => Scene;
  /** Escape with nothing for the place to put away: the settings menu. */
  readonly settings: () => void;
}

/** E, Enter or Space: what the member stands at is used, unless a button that has the keyboard answers it. */
function use(e: KeyboardEvent, k: string, repeated: boolean, scene: Scene): void {
  // Taken already (a tip opened by its key): it is not a press in the world as well.
  if (e.defaultPrevented) return;
  if (!repeated && dismissArrival()) {
    e.preventDefault();
    return;
  }
  // A control has the keyboard: a button, or anything the kit made one (a tip's owner, a card link).
  const onButton = e.target instanceof HTMLElement && e.target.matches("button, [role='button'], a[href], summary");
  // A button that has the keyboard answers Enter and Space itself.
  if (!repeated && (k === "e" || !onButton)) scene.act();
  // Or Enter, and Enter held, would go on to press the first button of the card it has just opened.
  if (k !== "e" && (!onButton || repeated)) e.preventDefault();
}

/** Listens to the keyboard for as long as `scope` stands. Gives back the keys held to walk (`w`, `arrowup`, ...). */
export function listenKeys(scope: Scope, of: KeysOf): Set<string> {
  const keys = new Set<string>();
  scope.on(window, "keydown", (e) => {
    unlock();
    // Typed into a field (a tome's reason), a key is a letter, not a step or a press.
    if (of.away() || typing(e)) return;
    const k = keyOf(e);
    const repeated = heldAgain(e);
    if (k === "enter" || k === " " || k === "e") return use(e, k, repeated, of.scene());
    if (!of.mayAct()) return;
    if (repeated) {
      if (k.startsWith("arrow")) e.preventDefault();
      // Still held when the town woke: the member walks on.
      keys.add(k);
      return;
    }
    // A card that took this Escape (the kit's says so) was the one layer it puts away.
    if (k === "escape") {
      if (!e.defaultPrevented && !of.scene().back()) of.settings();
      return;
    }
    if (of.scene().key(k)) {
      e.preventDefault();
      return;
    }
    if (k.startsWith("arrow")) e.preventDefault();
    keys.add(k);
  });
  scope.on(window, "keyup", (e) => {
    keys.delete(keyOf(e));
  });
  return keys;
}
