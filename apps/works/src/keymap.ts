/** What each key does in the Works (`keyboard.ts` in the kit). */
import { type ActionOf, keymap } from "@sequoia-leaf/kit/keyboard.ts";

export const WORKS_KEYS = keymap("works", {
  up: { shelf: "Looking about", does: "Move the view up", keys: ["KeyW", "ArrowUp"], held: true },
  left: { shelf: "Looking about", does: "Move the view left", keys: ["KeyA", "ArrowLeft"], held: true },
  down: { shelf: "Looking about", does: "Move the view down", keys: ["KeyS", "ArrowDown"], held: true },
  right: { shelf: "Looking about", does: "Move the view right", keys: ["KeyD", "ArrowRight"], held: true },
  zoomIn: { shelf: "Looking about", does: "Zoom in", keys: ["Shift+Equal", "NumpadAdd"], repeats: true },
  zoomOut: { shelf: "Looking about", does: "Zoom out", keys: ["Shift+Minus", "NumpadSubtract"], repeats: true },
  // The nth slot picks the nth tool in the toolbar, whichever key the player has put in it.
  tool: {
    shelf: "Building",
    does: "Pick a tool, in toolbar order",
    keys: [
      "Digit1",
      "Digit2",
      "Digit3",
      "Digit4",
      "Digit5",
      "Digit6",
      "Digit7",
      "Digit8",
      "Digit9",
      "Digit0",
      "Minus",
      "Equal",
    ],
  },
  rotate: { shelf: "Building", does: "Rotate", keys: ["KeyR"] },
  flip: { shelf: "Building", does: "Flip a sorter", keys: ["KeyX"] },
  grade: { shelf: "Building", does: "Change the grade", keys: ["KeyG"] },
  another: { shelf: "Building", does: "Pick the piece pointed at", keys: ["KeyQ"] },
  remove: { shelf: "Building", does: "Remove", keys: ["KeyE"] },
  undo: { shelf: "Building", does: "Undo", keys: ["Ctrl+z", "KeyZ"], repeats: true },
  select: { shelf: "An area", does: "Select", keys: ["KeyF"] },
  move: { shelf: "An area", does: "Move what is marked; with nothing marked, the yard", keys: ["KeyM"] },
  paint: { shelf: "An area", does: "Copy what is marked; with nothing marked, paint a line", keys: ["KeyC"] },
  clear: { shelf: "An area", does: "Remove what is marked", keys: ["Delete"] },
  orders: { shelf: "Panels", does: "Orders", keys: ["KeyO"] },
  board: { shelf: "Panels", does: "Top yards", keys: ["KeyT"] },
  tier: { shelf: "Panels", does: "This tier", keys: ["KeyP"] },
  research: { shelf: "Panels", does: "Research", keys: ["KeyL"] },
  depot: { shelf: "Panels", does: "The depot", keys: ["KeyI"] },
  back: { shelf: "Panels", does: "Put away, or this menu", keys: ["Escape"] },
});

/** One of the Works' actions. */
export type WorksAction = ActionOf<typeof WORKS_KEYS>;

/** What the keys that turn a piece in hand do, after what a line says: " R rotates it, X flips it." (flips for a sorter); nothing for a key the player has left empty. */
export function turns(flips = false): string {
  const said = [
    [WORKS_KEYS.name("rotate"), "rotates it"],
    [flips ? WORKS_KEYS.name("flip") : null, "flips it"],
  ].flatMap(([key, does]) => (key ? [`${key} ${does}`] : []));
  return said.length === 0 ? "" : ` ${said.join(", ")}.`;
}
