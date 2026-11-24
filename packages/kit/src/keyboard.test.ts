import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import {
  bindName,
  keyboard,
  keymap,
  type Layout,
  layoutOfMap,
  LAYOUTS,
  nameOf,
  type Place,
  placeOf,
} from "./keyboard.ts";
import { scope } from "./scope.ts";
import { SETTING_KEYS, settings } from "./settings.ts";
import { type Standin, standin } from "./standin.ts";

let world: Standin | null = null;
beforeEach(() => {
  world = standin({});
  settings.reread();
  keyboard.found(null);
});
afterEach(() => {
  world?.done();
  world = null;
  settings.reread();
  keyboard.found(null);
});

/** A key going down as a keyboard sends it: its place, what it types, and the keys held with it. */
const press = (code: string, key: string, held: "shift" | "ctrl" | "meta" | "alt" | null = null) => ({
  code,
  key,
  shiftKey: held === "shift",
  ctrlKey: held === "ctrl",
  metaKey: held === "meta",
  altKey: held === "alt",
});

const isLetterPlace = (p: string): p is Place => /^Key[A-Z]$/.test(p);
/** The places of the letters, as QWERTY has them. */
const LETTERS: readonly Place[] = "QWERTYUIOPASDFGHJKLZXCVBNM"
  .split("")
  .map((c) => `Key${c}`)
  .filter(isLetterPlace);

/** Chromium's layout map of a layout of the list, as it says it: what each letter's place prints, in small letters. */
const mapOf = (layout: Layout): Map<string, string> =>
  new Map(LETTERS.map((place) => [place, nameOf(place, layout).toLowerCase()]));

/** What some places are called on a layout. */
const named = (places: readonly Place[], layout: Layout): string[] => places.map((p) => nameOf(p, layout));

describe("the layouts", () => {
  test("name each key as that keyboard prints it", () => {
    expect(named(["KeyQ", "KeyW", "KeyA", "KeyZ", "KeyM", "Minus", "Equal"], "azerty")).toEqual([
      "A",
      "Z",
      "Q",
      "W",
      ",",
      ")",
      "=",
    ]);
    expect(named(["KeyY", "KeyZ", "Minus"], "qwertz")).toEqual(["Z", "Y", "ß"]);
    expect(named(["KeyR", "KeyQ", "KeyE", "Minus", "Equal"], "dvorak")).toEqual(["P", "'", ".", "[", "]"]);
    expect(named(["KeyE", "KeyR", "KeyS"], "colemak")).toEqual(["F", "P", "R"]);
    expect(named(["KeyT", "KeyV", "KeyM"], "colemak-dh")).toEqual(["B", "D", "H"]);
    expect(named(["KeyW", "KeyD", "KeyC"], "workman")).toEqual(["D", "H", "M"]);
    // The number row is named by its digits on every one, and keys of words by their words.
    expect(LAYOUTS.map((l) => nameOf("Digit1", l.id))).toEqual(LAYOUTS.map(() => "1"));
    expect(named(["Escape", "Delete", "ArrowUp", "NumpadAdd", "Space"], "dvorak")).toEqual([
      "Esc",
      "Del",
      "Up",
      "Num +",
      "Space",
    ]);
  });

  test("each prints at every place it names, and no letter twice", () => {
    for (const { prints } of LAYOUTS) {
      expect(prints.length).toBe(28);
      const letters = prints.split("").filter((c) => /^[A-Z]$/.test(c));
      expect(new Set(letters).size).toBe(letters.length);
    }
  });

  test("name a key with Shift or Ctrl as it is pressed", () => {
    expect([
      bindName("Shift+Equal", "qwerty"),
      bindName("Shift+Minus", "azerty"),
      bindName("Ctrl+z", "dvorak"),
    ]).toEqual(["Shift+=", "Shift+)", "Ctrl+Z"]);
  });
});

describe("the browser's word", () => {
  test("is matched to the layout of the list whose letters its keyboard prints", () => {
    for (const { id } of LAYOUTS) expect(layoutOfMap(mapOf(id))).toBe(id);
    // As Chromium says a French keyboard, with its number row and the letter beside L: only the letters count.
    const french = new Map([...mapOf("azerty"), ["Digit1", "&"], ["Semicolon", "m"], ["Minus", ")"]]);
    expect(layoutOfMap(french)).toBe("azerty");
    // A British keyboard prints its own signs, and QWERTY's letters.
    expect(layoutOfMap(new Map([...mapOf("qwerty"), ["Backquote", "`"], ["Quote", "#"]]))).toBe("qwerty");
  });

  test("of a keyboard not on the list, or of none, is no layout", () => {
    expect(layoutOfMap(new Map())).toBeNull();
    // A Turkish F keyboard: its letters are none of the list's.
    expect(layoutOfMap(new Map([...mapOf("qwerty"), ["KeyQ", "f"], ["KeyW", "g"]]))).toBeNull();
  });
});

describe("the layout keys are named by", () => {
  test("is QWERTY with no choice and no word from the browser; the browser's word, once said", () => {
    expect(keyboard.layout).toBe("qwerty");
    keyboard.found("dvorak");
    expect(keyboard.layout).toBe("dvorak");
  });

  test("is the player's choice, whatever the browser says before or after", () => {
    keyboard.found("dvorak");
    keyboard.choose("azerty");
    expect(keyboard.layout).toBe("azerty");
    keyboard.found("colemak");
    expect([keyboard.layout, world?.store.getItem(SETTING_KEYS.keyboard)]).toEqual(["azerty", "azerty"]);
  });

  test("follows a choice made on another page, told once to whoever listens", () => {
    // The browser's `storage` event, which another page's change raises on this one.
    class Kept extends Event {
      readonly key: string | null;
      constructor(key: string | null) {
        super("storage");
        this.key = key;
      }
    }
    const page = new EventTarget();
    Object.defineProperty(globalThis, "window", { value: page, configurable: true });
    Object.defineProperty(globalThis, "StorageEvent", { value: Kept, configurable: true });
    const s = scope();
    try {
      settings.follow(s);
      const told: string[] = [];
      const stop = keyboard.listen(() => told.push(keyboard.layout));
      world?.store.setItem(SETTING_KEYS.keyboard, "workman");
      page.dispatchEvent(new Kept(SETTING_KEYS.keyboard));
      page.dispatchEvent(new Kept(SETTING_KEYS.keyboard));
      stop();
      expect(told).toEqual(["workman"]);
    } finally {
      s.close();
      Reflect.deleteProperty(globalThis, "window");
      Reflect.deleteProperty(globalThis, "StorageEvent");
    }
  });

  test("is QWERTY, or the browser's word, where what is kept names no layout", () => {
    world?.store.setItem(SETTING_KEYS.keyboard, "bépo");
    settings.reread();
    expect(keyboard.layout).toBe("qwerty");
  });
});

describe("a keymap", () => {
  const keys = keymap({
    left: { shelf: "Walking", does: "Walk left", keys: ["KeyA", "ArrowLeft"], held: true },
    tool: { shelf: "Building", does: "Pick a tool", keys: ["Digit1", "Digit2", "Minus"] },
    zoomOut: { shelf: "Looking", does: "Zoom out", keys: ["Shift+Minus"] },
    undo: { shelf: "Building", does: "Undo", keys: ["Ctrl+z", "KeyZ"] },
  });

  test("finds what a key is for by its place, whatever it types", () => {
    // AZERTY's Q, where QWERTY has A: it walks left. Its A, where QWERTY has Q, is for nothing here.
    expect(keys.of(press("KeyA", "q"))).toEqual({ id: "left", nth: 0 });
    expect(keys.of(press("KeyQ", "a"))).toBeUndefined();
    expect(keys.of(press("Digit2", "é"))).toEqual({ id: "tool", nth: 1 });
    // The number pad's digits are the number row's.
    expect([placeOf("Numpad2"), placeOf("NumpadEnter")]).toEqual(["Digit2", "Enter"]);
    expect(keys.of(press("Numpad1", "1"))).toEqual({ id: "tool", nth: 0 });
  });

  test("with Shift, takes the place's key with Shift where it has one, else the key without", () => {
    expect(keys.of(press("Minus", "_", "shift"))).toEqual({ id: "zoomOut", nth: 0 });
    expect(keys.of(press("Minus", "-"))).toEqual({ id: "tool", nth: 2 });
    expect(keys.of(press("KeyA", "A", "shift"))).toEqual({ id: "left", nth: 0 });
  });

  test("with Ctrl or ⌘ goes by the letter typed; with Alt, it is for nothing", () => {
    // AZERTY's Z is where QWERTY has W.
    expect(keys.of(press("KeyW", "z", "ctrl"))).toEqual({ id: "undo", nth: 0 });
    expect(keys.of(press("KeyZ", "z", "meta"))).toEqual({ id: "undo", nth: 0 });
    expect(keys.of(press("KeyA", "a", "ctrl"))).toBeUndefined();
    expect(keys.of(press("KeyA", "a", "alt"))).toBeUndefined();
  });

  test("says which held actions are down, from the places held", () => {
    expect([keys.isDown(new Set(["ArrowLeft"]), "left"), keys.isDown(new Set(["KeyQ"]), "left")]).toEqual([
      true,
      false,
    ]);
  });

  test("names its keys, and draws its Keys tab, for the keyboard the player has", () => {
    expect([keys.name("left"), keys.names("tool")]).toEqual(["A", ["1", "2", "-"]]);
    keyboard.choose("azerty");
    expect([keys.name("left"), keys.name("zoomOut"), keys.name("undo")]).toEqual(["Q", "Shift+)", "Ctrl+Z"]);
    expect(keys.shelves()).toEqual([
      { name: "Walking", lines: [{ does: "Walk left", keys: ["Q", "Left"] }] },
      {
        name: "Building",
        lines: [
          { does: "Pick a tool", keys: ["1", "2", ")"] },
          { does: "Undo", keys: ["Ctrl+Z", "W"] },
        ],
      },
      { name: "Looking", lines: [{ does: "Zoom out", keys: ["Shift+)"] }] },
    ]);
  });

  test("tells which keys two of its actions share", () => {
    expect(keys.shared()).toEqual([]);
    const twice = keymap({
      walk: { shelf: "", does: "", keys: ["KeyD"] },
      drop: { shelf: "", does: "", keys: ["Shift+KeyD", "KeyD"] },
    });
    expect(twice.shared()).toEqual(["KeyD"]);
  });
});
