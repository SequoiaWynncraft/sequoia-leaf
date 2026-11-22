import { expect, test } from "bun:test";

import { heldAgain, noKeysHeld } from "./keys.ts";

test("a key held down is one press, whether or not the browser marks its repeats", () => {
  noKeysHeld();
  expect(heldAgain({ code: "Space", repeat: false })).toBe(false);
  // The browser's own repeat, and one it did not mark: the key never came up.
  expect(heldAgain({ code: "Space", repeat: true })).toBe(true);
  expect(heldAgain({ code: "Space", repeat: false })).toBe(true);
  // Another key meanwhile is a press of its own.
  expect(heldAgain({ code: "KeyE", repeat: false })).toBe(false);
  noKeysHeld();
  expect(heldAgain({ code: "Space", repeat: false })).toBe(false);
  noKeysHeld();
});
