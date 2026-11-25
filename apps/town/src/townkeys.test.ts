/**
 * The town's keyboard, as the window hears it: a key that something on the page took first (a row
 * of tabs its arrow) is not the town's, so it neither walks nor does anything in the place.
 */
import { afterEach, beforeEach, expect, test } from "bun:test";

import { noKeysHeld } from "@sequoia-leaf/kit/keys.ts";
import { scope } from "@sequoia-leaf/kit/scope.ts";

import type { TownAction } from "./keymap.ts";
import { listenKeys } from "./townkeys.ts";

beforeEach(() => {
  noKeysHeld();
  Object.defineProperty(globalThis, "window", { value: new EventTarget(), configurable: true });
});
afterEach(() => {
  Reflect.deleteProperty(globalThis, "window");
});

/** A key going down on the window, as the browser sends it from the page. */
function keyDown(code: string, key: string): Event {
  const e = Object.assign(new Event("keydown", { cancelable: true }), {
    code,
    key,
    repeat: false,
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
  });
  window.dispatchEvent(e);
  return e;
}

/** The town listening to the keys, on a place that writes down what it was asked to do. */
function town(): { walking: Set<string>; done: string[] } {
  const done: string[] = [];
  const walking = listenKeys(scope(), {
    away: () => false,
    mayAct: () => true,
    scene: () => ({
      act: () => void done.push("act"),
      back: () => done.push("back") > 0,
      key: (act: TownAction) => done.push(act) < 0,
    }),
    settings: () => void done.push("settings"),
  });
  return { walking, done };
}

test("an arrow a row of tabs took is not a step: it is not held to walk, and the place hears nothing", () => {
  // The row of tabs hears the key first, and takes it.
  window.addEventListener("keydown", (e) => {
    if ("key" in e && e.key === "ArrowLeft") e.preventDefault();
  });
  const { walking, done } = town();
  keyDown("ArrowLeft", "ArrowLeft");
  expect([...walking]).toEqual([]);
  expect(done).toEqual([]);
  // An arrow nobody took walks.
  keyDown("ArrowRight", "ArrowRight");
  expect([...walking]).toEqual(["ArrowRight"]);
});
