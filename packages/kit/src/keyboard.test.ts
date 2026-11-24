import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import {
  bindName,
  caught,
  fixedKeymap,
  keyboard,
  keymap,
  type Layout,
  layoutOfMap,
  LAYOUTS,
  nameOf,
  type Place,
  placeOf,
} from "./keyboard.ts";
import { noKeysHeld } from "./keys.ts";
import { scope } from "./scope.ts";
import { keysKey, SETTING_KEYS, settings } from "./settings.ts";
import { type Standin, standin } from "./standin.ts";

let world: Standin | null = null;
beforeEach(() => {
  world = standin({});
  settings.reread();
  keyboard.found(null);
  noKeysHeld();
});
afterEach(() => {
  world?.done();
  world = null;
  settings.reread();
  keyboard.found(null);
});

/** A key going down as a keyboard sends it: its place, what it types, and the keys held with it. */
const press = (code: string, key: string, held: "shift" | "ctrl" | "meta" | "alt" | null = null, repeat = false) => ({
  code,
  key,
  shiftKey: held === "shift",
  ctrlKey: held === "ctrl",
  metaKey: held === "meta",
  altKey: held === "alt",
  repeat,
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
      "Comma",
      ")",
      "=",
    ]);
    // Marks too small to tell apart are named in words.
    expect(named(["KeyY", "KeyZ", "Minus", "Equal"], "qwertz")).toEqual(["Z", "Y", "ß", "Accent"]);
    expect(named(["KeyR", "KeyQ", "KeyW", "KeyE", "Minus", "Equal"], "dvorak")).toEqual([
      "P",
      "Quote",
      "Comma",
      "Period",
      "[",
      "]",
    ]);
    expect(named(["KeyE", "KeyR", "KeyS"], "colemak")).toEqual(["F", "P", "R"]);
    expect(named(["KeyT", "KeyZ", "KeyC", "KeyB", "KeyM"], "colemak-dh")).toEqual(["B", "X", "D", "Z", "H"]);
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

  test("name every key of the main block as XKB has it printed", () => {
    const block: Place[] = [
      "Backquote",
      "BracketLeft",
      "BracketRight",
      "Semicolon",
      "Quote",
      "Backslash",
      "IntlBackslash",
      "Comma",
      "Period",
      "Slash",
    ];
    expect(named(block, "qwerty")).toEqual([
      "Backtick",
      "[",
      "]",
      "Semicolon",
      "Quote",
      "\\",
      "<",
      "Comma",
      "Period",
      "/",
    ]);
    expect(named(block, "qwertz")).toEqual(["^", "Ü", "+", "Ö", "Ä", "Hash", "<", "Comma", "Period", "-"]);
    // AZERTY's M, and its marks along the bottom row.
    expect(named(block, "azerty")).toEqual(["²", "^", "$", "M", "ù", "*", "<", "Semicolon", "Colon", "!"]);
    // Dvorak's S, W, V and Z.
    expect(named(block, "dvorak")).toEqual(["Backtick", "/", "=", "S", "-", "\\", "<", "W", "V", "Z"]);
    // Colemak's and Workman's O and I, where QWERTY has its semicolon.
    expect([nameOf("Semicolon", "colemak"), nameOf("KeyP", "colemak"), nameOf("Semicolon", "workman")]).toEqual([
      "O",
      "Semicolon",
      "I",
    ]);
  });

  test("each prints at every key of the main block, and no letter on two letter keys", () => {
    for (const { id, prints } of LAYOUTS) {
      expect(prints.map((row) => row.length)).toEqual([3, 12, 12, 11]);
      // The key beside the left Shift may print a letter another key does too (Colemak-DH's Z, for keyboards without that key).
      const onLetters = LETTERS.map((place) => nameOf(place, id)).filter((c) => /^[A-Z]$/.test(c));
      expect(new Set(onLetters).size).toBe(onLetters.length);
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
    // As Chromium says a French keyboard, with its number row and the letter beside L: only the letter keys count.
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

/** The browser's `storage` event, which another page's change raises on this one. */
class Kept extends Event {
  readonly key: string | null;
  constructor(key: string | null) {
    super("storage");
    this.key = key;
  }
}

/** A page that follows the settings other pages change, for the time of `fn`: it is given how another page keeps a text. */
function following(fn: (elsewhere: (key: string, text: string | null) => void) => void): void {
  const page = new EventTarget();
  Object.defineProperty(globalThis, "window", { value: page, configurable: true });
  Object.defineProperty(globalThis, "StorageEvent", { value: Kept, configurable: true });
  const s = scope();
  try {
    settings.follow(s);
    fn((key, text) => {
      if (text === null) world?.store.removeItem(key);
      else world?.store.setItem(key, text);
      page.dispatchEvent(new Kept(key));
    });
  } finally {
    s.close();
    Reflect.deleteProperty(globalThis, "window");
    Reflect.deleteProperty(globalThis, "StorageEvent");
  }
}

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
    following((elsewhere) => {
      const told: string[] = [];
      const stop = keyboard.listen(() => told.push(keyboard.layout));
      elsewhere(SETTING_KEYS.keyboard, "workman");
      elsewhere(SETTING_KEYS.keyboard, "workman");
      stop();
      expect(told).toEqual(["workman"]);
    });
  });

  test("is QWERTY, or the browser's word, where what is kept names no layout", () => {
    world?.store.setItem(SETTING_KEYS.keyboard, "bépo");
    settings.reread();
    expect(keyboard.layout).toBe("qwerty");
  });
});

/** A keymap as a game has one, its changes kept under `game`. */
const gameKeys = (game: string) =>
  keymap(game, {
    left: { shelf: "Walking", does: "Walk left", keys: ["KeyA", "ArrowLeft"], held: true },
    tool: { shelf: "Building", does: "Pick a tool", keys: ["Digit1", "Digit2", "Minus"] },
    rotate: { shelf: "Building", does: "Rotate", keys: ["KeyR"] },
    zoomOut: { shelf: "Looking", does: "Zoom out", keys: ["Shift+Minus"], repeats: true },
    undo: { shelf: "Building", does: "Undo", keys: ["Ctrl+z", "KeyZ"], repeats: true },
    back: { shelf: "Building", does: "Put away", keys: ["Escape"] },
  });

/** What a key is for, without whether it is held down said again. */
const forKey = (keys: ReturnType<typeof gameKeys>, e: ReturnType<typeof press>) => {
  const at = keys.of(e);
  noKeysHeld();
  return at && { id: at.id, nth: at.nth };
};

/** The caps of a line of the Keys tab, named so; `fixed` says which cannot be changed. */
const caps = (names: readonly (string | null)[], fixed: readonly boolean[] = []) =>
  names.map((name, nth) => ({ nth, name, fixed: fixed[nth] ?? false }));

describe("a keymap", () => {
  test("finds what a key is for by its place, whatever it types", () => {
    const keys = gameKeys("finds");
    // AZERTY's Q, where QWERTY has A: it walks left. Its A, where QWERTY has Q, is for nothing here.
    expect(forKey(keys, press("KeyA", "q"))).toEqual({ id: "left", nth: 0 });
    expect(forKey(keys, press("KeyQ", "a"))).toBeUndefined();
    expect(forKey(keys, press("Digit2", "é"))).toEqual({ id: "tool", nth: 1 });
    // The number pad's digits are the number row's.
    expect([
      placeOf({ code: "Numpad2", key: "2" }),
      placeOf({ code: "NumpadEnter", key: "Enter" }),
      // With Num Lock off, the pad's digits are arrows, and say so.
      placeOf({ code: "Numpad4", key: "ArrowLeft" }),
      placeOf({ code: "KeyQ", key: "a" }),
    ]).toEqual(["Digit2", "Enter", "ArrowLeft", "KeyQ"]);
    expect(forKey(keys, press("Numpad1", "1"))).toEqual({ id: "tool", nth: 0 });
  });

  test("with Shift, takes the place's key with Shift where it has one, else the key without", () => {
    const keys = gameKeys("shift");
    expect(forKey(keys, press("Minus", "_", "shift"))).toEqual({ id: "zoomOut", nth: 0 });
    expect(forKey(keys, press("Minus", "-"))).toEqual({ id: "tool", nth: 2 });
    expect(forKey(keys, press("KeyA", "A", "shift"))).toEqual({ id: "left", nth: 0 });
  });

  test("with Ctrl or ⌘ goes by the letter typed; with Alt, it is for nothing", () => {
    const keys = gameKeys("ctrl");
    // AZERTY's Z is where QWERTY has W.
    expect(forKey(keys, press("KeyW", "z", "ctrl"))).toEqual({ id: "undo", nth: 0 });
    expect(forKey(keys, press("KeyZ", "z", "meta"))).toEqual({ id: "undo", nth: 0 });
    expect(forKey(keys, press("KeyA", "a", "ctrl"))).toBeUndefined();
    expect(forKey(keys, press("KeyA", "a", "alt"))).toBeUndefined();
  });

  test("says which held actions are down, from the places held", () => {
    const keys = gameKeys("held");
    expect([keys.isDown(new Set(["ArrowLeft"]), "left"), keys.isDown(new Set(["KeyQ"]), "left")]).toEqual([
      true,
      false,
    ]);
  });

  test("names its keys, and draws its Keys tab, for the keyboard the player has", () => {
    const keys = gameKeys("names");
    expect([keys.name("left"), keys.names("tool")]).toEqual(["A", ["1", "2", "-"]]);
    keyboard.choose("azerty");
    expect([keys.name("left"), keys.name("zoomOut"), keys.name("undo"), keys.titled("Rotate", "rotate")]).toEqual([
      "Q",
      "Shift+)",
      "Ctrl+Z",
      "Rotate (R)",
    ]);
    expect(keys.shelves()).toEqual([
      { name: "Walking", lines: [{ id: "left", does: "Walk left", caps: caps(["Q", "Left"]), changed: false }] },
      {
        name: "Building",
        lines: [
          { id: "tool", does: "Pick a tool", caps: caps(["1", "2", ")"]), changed: false },
          { id: "rotate", does: "Rotate", caps: caps(["R"]), changed: false },
          { id: "undo", does: "Undo", caps: caps(["Ctrl+Z", "W"], [true, false]), changed: false },
          { id: "back", does: "Put away", caps: caps(["Esc"], [true]), changed: false },
        ],
      },
      { name: "Looking", lines: [{ id: "zoomOut", does: "Zoom out", caps: caps(["Shift+)"]), changed: false }] },
    ]);
  });

  test("tells which keys two of its actions share", () => {
    expect(gameKeys("shared").shared()).toEqual([]);
    const twice = fixedKeymap({
      walk: { shelf: "", does: "", keys: ["KeyD"] },
      drop: { shelf: "", does: "", keys: ["Shift+KeyD", "KeyD"] },
    });
    expect(twice.shared()).toEqual(["KeyD"]);
  });

  test("held down, does again only what goes on while held: moving, and what repeats", () => {
    const keys = gameKeys("again");
    const again = (code: string, key: string, held: "shift" | "ctrl" | null = null): boolean[] => {
      noKeysHeld();
      // As the browser says it: once, then again with its word that it is a repeat; a browser that does not say so, again.
      const said = [press(code, key, held), press(code, key, held, true), press(code, key, held)];
      return said.map((e) => keys.of(e)?.again ?? false);
    };
    expect(again("KeyR", "r")).toEqual([false, true, true]);
    expect(again("Digit1", "1")).toEqual([false, true, true]);
    expect(again("KeyA", "a")).toEqual([false, false, false]);
    expect(again("Minus", "_", "shift")).toEqual([false, false, false]);
    expect(again("KeyZ", "z", "ctrl")).toEqual([false, false, false]);
  });
});

/** A page opened with `text` kept for its keys: what it reads of some of them, and the keys it has twice. */
function keptAs(text: string) {
  world?.store.setItem(keysKey("read"), text);
  settings.reread();
  const keys = gameKeys("read");
  return [keys.keysOf("left"), keys.keysOf("undo"), keys.keysOf("back"), keys.shared()];
}

describe("a keymap the player changes", () => {
  test("puts a key where the player says, taking it from the slot it was in, which is left empty", () => {
    const keys = gameKeys("put");
    expect(keys.put("rotate", 0, "KeyA")).toEqual([{ bind: "KeyA", from: "Walk left" }]);
    expect([keys.keysOf("rotate"), keys.keysOf("left"), keys.name("left")]).toEqual([
      ["KeyA"],
      [null, "ArrowLeft"],
      "Left",
    ]);
    expect(forKey(keys, press("KeyA", "a"))).toEqual({ id: "rotate", nth: 0 });
    expect(forKey(keys, press("KeyR", "r"))).toBeUndefined();
    // From another slot of the same action, the same.
    expect(keys.put("left", 0, "ArrowLeft")).toEqual([{ bind: "ArrowLeft", from: "Walk left" }]);
    expect([keys.keysOf("left"), keys.name("left"), keys.shared()]).toEqual([["ArrowLeft", null], "Left", []]);
    // A slot keeps its place when another of the action's is empty: the third tool is still the third.
    expect(keys.put("left", 1, "Digit2")).toEqual([{ bind: "Digit2", from: "Pick a tool" }]);
    expect([keys.names("tool"), forKey(keys, press("Minus", "-"))]).toEqual([["1", null, "-"], { id: "tool", nth: 2 }]);
    // A key from nowhere takes nothing from anyone.
    expect(keys.put("tool", 1, "KeyY")).toEqual([]);
    // An action with no key at all says so in its line, and names none.
    keys.put("tool", 0, "KeyA");
    expect([keys.name("rotate"), keys.titled("Rotate", "rotate"), keys.names("rotate")]).toEqual([
      null,
      "Rotate",
      [null],
    ]);
  });

  test("never changes Escape, Ctrl with a letter, or a keymap of the browser's own; and keys walking without Shift", () => {
    const keys = gameKeys("fixed");
    expect([keys.put("back", 0, "KeyB"), keys.put("undo", 0, "KeyQ"), keys.put("rotate", 0, "Escape")]).toEqual([
      [],
      [],
      [],
    ]);
    expect([keys.put("rotate", 0, "Tab"), keys.put("rotate", 0, "Ctrl+a"), keys.put("nothing", 0, "KeyQ")]).toEqual([
      [],
      [],
      [],
    ]);
    expect([keys.keysOf("back"), keys.keysOf("undo"), keys.keysOf("rotate")]).toEqual([
      ["Escape"],
      ["Ctrl+z", "KeyZ"],
      ["KeyR"],
    ]);
    keys.put("left", 0, "Shift+KeyI");
    expect(keys.keysOf("left")).toEqual(["KeyI", "ArrowLeft"]);
    const table = fixedKeymap({ back: { shelf: "", does: "Back", keys: ["Tab", "ArrowLeft"] } });
    expect([table.changeable, table.put("back", 1, "KeyQ"), table.keysOf("back")]).toEqual([
      false,
      [],
      ["Tab", "ArrowLeft"],
    ]);
  });

  test("keeps only the actions changed, each whole, and nothing once all are reset", () => {
    const keys = gameKeys("keep");
    keys.put("rotate", 0, "KeyA");
    expect(JSON.parse(world?.store.getItem(keysKey("keep")) ?? "null")).toEqual({
      left: [null, "ArrowLeft"],
      rotate: ["KeyA"],
    });
    // A line reset takes its keys back from wherever they went.
    expect(keys.reset("left")).toEqual([{ bind: "KeyA", from: "Rotate" }]);
    expect([keys.keysOf("left"), keys.keysOf("rotate")]).toEqual([["KeyA", "ArrowLeft"], [null]]);
    keys.put("tool", 2, "KeyQ");
    keys.resetAll();
    expect([world?.store.getItem(keysKey("keep")), keys.keysOf("rotate"), keys.keysOf("tool")]).toEqual([
      null,
      ["KeyR"],
      ["Digit1", "Digit2", "Minus"],
    ]);
  });

  test("reads what is kept as its own, letting go of anything else, and never throws", () => {
    const plain: ReturnType<typeof keptAs> = [["KeyA", "ArrowLeft"], ["Ctrl+z", "KeyZ"], ["Escape"], []];
    for (const junk of ["not json", "[]", "7", "null", '{"nope":["KeyA"]}', '{"left":["KeyA"]}', '{"left":"KeyA"}'])
      expect(keptAs(junk)).toEqual(plain);
    // A slot holding what is not a key, or a key it may not have, keeps the game's; a slot that cannot change keeps its own.
    expect(keptAs('{"left":[5,"Ctrl+a"],"undo":["KeyQ","Shift+KeyZ"],"back":["KeyB"]}')).toEqual([
      ["KeyA", "ArrowLeft"],
      ["Ctrl+z", "Shift+KeyZ"],
      ["Escape"],
      [],
    ]);
    expect(keptAs('{"left":[null,"Shift+KeyL"]}')).toEqual([[null, "KeyL"], ["Ctrl+z", "KeyZ"], ["Escape"], []]);
  });

  test("on loading, gives the player's keys first: a game's key the player put elsewhere leaves its own slot empty", () => {
    // Kept before the game gave Rotate's key, R, to anything: the player had put R on the first tool.
    world?.store.setItem(keysKey("load"), JSON.stringify({ tool: ["KeyR", "Digit2", "Minus"] }));
    settings.reread();
    const keys = gameKeys("load");
    expect([keys.keysOf("tool"), keys.keysOf("rotate"), keys.shared()]).toEqual([
      ["KeyR", "Digit2", "Minus"],
      [null],
      [],
    ]);
    // Something broken kept a key twice: the first slot in the keymap's order has it.
    world?.store.setItem(keysKey("twice"), JSON.stringify({ rotate: ["KeyQ"], left: ["KeyQ", "ArrowLeft"] }));
    settings.reread();
    const twice = gameKeys("twice");
    expect([twice.keysOf("left"), twice.keysOf("rotate"), twice.shared()]).toEqual([["KeyQ", "ArrowLeft"], [null], []]);
  });

  test("never has a key in two slots, whatever the player does, and reads back as it was left", () => {
    const keys = gameKeys("loop");
    const ids = ["left", "tool", "rotate", "zoomOut", "undo", "back"] as const;
    const binds = [
      "KeyA",
      "KeyQ",
      "KeyR",
      "Digit1",
      "Digit2",
      "Minus",
      "Shift+Minus",
      "ArrowLeft",
      "KeyZ",
      "Enter",
    ] as const;
    // A small generator of its own, so that every run is the same run.
    let seed = 7;
    const next = (n: number): number => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed % n;
    };
    for (let step = 0; step < 600; step++) {
      const id = ids[next(ids.length)] ?? "left";
      const roll = next(20);
      if (roll === 0) keys.resetAll();
      else if (roll < 3) keys.reset(id);
      else keys.put(id, next(3), binds[next(binds.length)] ?? "KeyA");
      expect(keys.shared()).toEqual([]);
    }
    // A page opened now reads the same keys.
    const again = gameKeys("loop");
    expect(ids.map((id) => again.keysOf(id))).toEqual(ids.map((id) => keys.keysOf(id)));
  });

  test("follows the keys another page changes, and its keyboard, telling whoever listens", () => {
    const keys = gameKeys("follow");
    following((elsewhere) => {
      const told: (string | null)[] = [];
      const stop = keys.listen(() => told.push(keys.name("rotate")));
      elsewhere(keysKey("follow"), JSON.stringify({ rotate: ["KeyY"] }));
      expect([keys.name("rotate"), keys.titled("Rotate", "rotate")]).toEqual(["Y", "Rotate (Y)"]);
      elsewhere(SETTING_KEYS.keyboard, "qwertz");
      expect(keys.name("rotate")).toBe("Z");
      // Another game's keys are not this one's.
      elsewhere(keysKey("elsewhere"), JSON.stringify({ rotate: ["KeyU"] }));
      elsewhere(keysKey("follow"), null);
      stop();
      expect([told, keys.name("rotate")]).toEqual([["Y", "Z", "R"], "R"]);
    });
  });
});

describe("a key pressed for a slot waiting for one", () => {
  test("is the key, with Shift as pressed; Escape keeps the slot's; Shift alone waits; Tab and Ctrl, Alt or ⌘ with a key cannot be used", () => {
    expect([caught(press("KeyI", "i")), caught(press("KeyI", "I", "shift")), caught(press("Numpad3", "3"))]).toEqual([
      { is: "key", bind: "KeyI" },
      { is: "key", bind: "Shift+KeyI" },
      { is: "key", bind: "Digit3" },
    ]);
    expect([caught(press("Escape", "Escape")), caught(press("Escape", "Escape", "shift"))]).toEqual([
      { is: "keep" },
      { is: "keep" },
    ]);
    expect([caught(press("ShiftLeft", "Shift", "shift")), caught(press("ControlRight", "Control", "ctrl"))]).toEqual([
      { is: "wait" },
      { is: "wait" },
    ]);
    expect([
      caught(press("Tab", "Tab")),
      caught(press("KeyS", "s", "ctrl")),
      caught(press("KeyS", "s", "alt")),
      caught(press("F5", "F5")),
    ]).toEqual([
      { is: "refused", name: "Tab" },
      { is: "refused", name: "Ctrl+S" },
      { is: "refused", name: "Alt+S" },
      { is: "refused", name: "F5" },
    ]);
  });
});
