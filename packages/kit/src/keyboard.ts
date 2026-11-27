/**
 * Keys, the same in the town and in every game. A key is a place on the keyboard
 * (`KeyboardEvent.code`), the same place whatever the keyboard prints on it, so what each key does
 * is the same on every layout and no two things share a key on any of them. The layout only says
 * what each key is called. Ctrl (⌘ on a Mac) with a letter goes by the letter typed, as the
 * operating system's own shortcuts do.
 *
 * The layout is the one the player chose in the settings menu, kept with the other settings
 * (`settings.ts`, so every open page follows it), else the one the browser reports where it can
 * (Chromium), else QWERTY.
 *
 * Each game says what its keys do once, in a keymap (`keymap`): its input asks the keymap what a
 * key is for, its Keys tab is drawn from it, and every hint asks it what a key is called. An action
 * has a number of slots, each a key or nothing; the player may put any key of the main block in any
 * slot but a few (`fixed`), and what they change is kept with the other settings, so every page of
 * the game follows it at once.
 */
import { heldAgain } from "./keys.ts";
import { settings } from "./settings.ts";

/** Each character of a string, as a union of them. */
type CharOf<S extends string> = S extends `${infer C}${infer Rest}` ? C | CharOf<Rest> : never;
type Letter = CharOf<"ABCDEFGHIJKLMNOPQRSTUVWXYZ">;
type Digit = CharOf<"0123456789">;

/** The places a game may give a key to that are named in words, and those words. */
const WORDS = {
  Escape: "Esc",
  Enter: "Enter",
  Space: "Space",
  Tab: "Tab",
  Delete: "Del",
  Backspace: "Backspace",
  ArrowUp: "Up",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  NumpadAdd: "Num +",
  NumpadSubtract: "Num -",
} as const;
type Worded = keyof typeof WORDS;
const isWorded = (code: string): code is Worded => Object.hasOwn(WORDS, code);

/**
 * The keys of the main block a layout prints something on, row by row as a keyboard has them (the
 * number row's digits apart, which every layout names by its digit). `IntlBackslash` is the key
 * beside the left Shift that only some keyboards have.
 */
const ROWS = [
  ["Backquote", "Minus", "Equal"],
  ["KeyQ", "KeyW", "KeyE", "KeyR", "KeyT", "KeyY", "KeyU", "KeyI", "KeyO", "KeyP", "BracketLeft", "BracketRight"],
  ["KeyA", "KeyS", "KeyD", "KeyF", "KeyG", "KeyH", "KeyJ", "KeyK", "KeyL", "Semicolon", "Quote", "Backslash"],
  ["IntlBackslash", "KeyZ", "KeyX", "KeyC", "KeyV", "KeyB", "KeyN", "KeyM", "Comma", "Period", "Slash"],
] as const;
type Printed = (typeof ROWS)[number][number];

/** A place on the keyboard a game may give a key to, as `KeyboardEvent.code` names it. */
export type Place = Printed | `Digit${Digit}` | Worded;

/** A key: a place, a place with Shift held (`Shift+Equal`), or a letter with Ctrl (`Ctrl+z`). */
export type Bind = Place | `Shift+${Place}` | `Ctrl+${Lowercase<Letter>}`;

const PRINTED: readonly Printed[] = ROWS.flat();
const PRINTED_SET: ReadonlySet<string> = new Set(PRINTED);
const isPrinted = (code: string): code is Printed => PRINTED_SET.has(code);
const isPlace = (code: string): code is Place => isPrinted(code) || isWorded(code) || /^Digit\d$/.test(code);

/** Whether something kept is a key, as a keymap has them. */
export const isBind = (v: unknown): v is Bind =>
  typeof v === "string" && (/^Ctrl\+[a-z]$/.test(v) || isPlace(v.replace(/^Shift\+/, "")));

/**
 * The layouts a player may choose, and what each prints, row by row at `ROWS`: what XKB's symbol
 * files have at the first level (`us`, `de`, `fr`, `us(dvorak)`, `us(colemak)`, `us(colemak_dh)`,
 * `us(workman)`), with the `pc` key beside the left Shift where a layout has none of its own. A key
 * that prints a letter is named by the letter as its cap shows it. Colemak-DH prints Z beside the
 * left Shift as well as where QWERTY has B, as XKB has it, for keyboards with and without that key.
 */
export const LAYOUTS = [
  { id: "qwerty", name: "QWERTY", prints: ["`-=", "QWERTYUIOP[]", "ASDFGHJKL;'\\", "<ZXCVBNM,./"] },
  { id: "qwertz", name: "QWERTZ", prints: ["^ß´", "QWERTZUIOPÜ+", "ASDFGHJKLÖÄ#", "<YXCVBNM,.-"] },
  { id: "azerty", name: "AZERTY", prints: ["²)=", "AZERTYUIOP^$", "QSDFGHJKLMù*", "<WXCVBN,;:!"] },
  { id: "dvorak", name: "Dvorak", prints: ["`[]", "',.PYFGCRL/=", "AOEUIDHTNS-\\", "<;QJKXBMWVZ"] },
  { id: "colemak", name: "Colemak", prints: ["`-=", "QWFPGJLUY;[]", "ARSTDHNEIO'\\", "-ZXCVBKM,./"] },
  { id: "colemak-dh", name: "Colemak-DH", prints: ["`-=", "QWFPBJLUY;[]", "ARSTGMNEIO'\\", "ZXCDVZKH,./"] },
  { id: "workman", name: "Workman", prints: ["`-=", "QDRWBJFUP;[]", "ASHTGYNEOI'\\", "<ZXMCVKL,./"] },
] as const;

export type Layout = (typeof LAYOUTS)[number]["id"];

/** The layout of an id, if it is one. */
export const layoutOf = (id: string | null): Layout | null => LAYOUTS.find((l) => l.id === id)?.id ?? null;

/** What each layout prints at each place of `ROWS`. */
const PRINTS: ReadonlyMap<Layout, ReadonlyMap<Printed, string>> = new Map(
  LAYOUTS.map((l) => {
    const chars = l.prints.flatMap((row) => row.split(""));
    return [l.id, new Map(PRINTED.map((place, i) => [place, chars[i] ?? ""]))];
  }),
);

/**
 * Marks the pixel font draws too small to tell apart (a comma from a full stop, a semicolon from a
 * colon), or not plainly as themselves (#), named in words instead.
 */
const MARKS: Readonly<Record<string, string>> = {
  ",": "Comma",
  ".": "Period",
  "'": "Quote",
  "´": "Accent",
  "`": "Backtick",
  ";": "Semicolon",
  ":": "Colon",
  "#": "Hash",
};

/** What a place is called on a layout: what it prints there (a small mark in words), its digit, or its name in words. */
export function nameOf(place: Place, layout: Layout = keyboard.layout): string {
  if (isWorded(place)) return WORDS[place];
  if (!isPrinted(place)) return place.slice("Digit".length);
  const c = PRINTS.get(layout)?.get(place) ?? "";
  return MARKS[c] ?? c;
}

/** The place of a key, with or without Shift; none for a letter with Ctrl. */
function placeOfBind(bind: Bind): Place | null {
  const place = bind.replace(/^Shift\+/, "");
  return isPlace(place) ? place : null;
}

/** A name with a key after it, as a tip has it: "Rotate (R)"; the name alone, for no key. */
export const keyed = (title: string, key: string | null): string => (key === null ? title : `${title} (${key})`);

/** What a key is called on a layout: "R", "Shift+=", "Ctrl+Z". */
export function bindName(bind: Bind, layout: Layout = keyboard.layout): string {
  const place = placeOfBind(bind);
  if (place === null) return `Ctrl+${bind.slice("Ctrl+".length).toUpperCase()}`;
  return `${bind.startsWith("Shift+") ? "Shift+" : ""}${nameOf(place, layout)}`;
}

/**
 * Where a key that went down or up is, as keys are given: the number pad's Enter is the main one,
 * and its digits are the number row's, or with Num Lock off, the arrows they say they are.
 */
export function placeOf(e: Pick<KeyboardEvent, "code" | "key">): string {
  if (e.code === "NumpadEnter") return "Enter";
  const pad = /^Numpad(\d)$/.exec(e.code)?.[1];
  if (pad === undefined) return e.code;
  if (/^\d$/.test(e.key)) return `Digit${pad}`;
  return e.key.startsWith("Arrow") ? e.key : e.code;
}

/** Keys that never stand for a game's action: Escape is always Back and the settings menu, Tab moves between buttons, and Ctrl (or ⌘) with a letter is the operating system's way. */
const isFixedBind = (bind: Bind): boolean => {
  const place = placeOfBind(bind);
  return place === null || place === "Escape" || place === "Tab";
};

/** What a key pressed for a slot waiting for one is: a key to put there, nothing yet (Shift or another such key on its own), a refusal, or Escape, which keeps the key the slot had. */
export type Caught =
  | { readonly is: "key"; readonly bind: Bind }
  | { readonly is: "wait" }
  | { readonly is: "keep" }
  | { readonly is: "refused"; readonly name: string };

/** Shift, Ctrl, Alt and ⌘ on their own, by their places. */
const MODIFIERS = /^(Shift|Control|Alt|Meta|OS)(Left|Right)$/;

type Held = Pick<KeyboardEvent, "code" | "key" | "shiftKey" | "ctrlKey" | "metaKey" | "altKey">;

/** What a key pressed is called, with what was held with it: "Ctrl+S", "Tab", "F5". */
function pressedName(e: Held, at: string): string {
  const plain = isPlace(at) ? nameOf(at) : e.key.length === 1 ? e.key.toUpperCase() : e.key;
  const held = [e.ctrlKey && "Ctrl", e.metaKey && "⌘", e.altKey && "Alt", e.shiftKey && "Shift"];
  return [...held.filter((m): m is string => typeof m === "string"), plain].join("+");
}

/** What a key pressed while a slot waits for one gives it (`Caught`). */
export function caught(e: Held): Caught {
  const at = placeOf(e);
  if (at === "Escape") return { is: "keep" };
  if (MODIFIERS.test(e.code) || e.key === "AltGraph") return { is: "wait" };
  if (!isPlace(at) || at === "Tab" || e.ctrlKey || e.metaKey || e.altKey)
    return { is: "refused", name: pressedName(e, at) };
  return { is: "key", bind: e.shiftKey ? `Shift+${at}` : at };
}

/**
 * The layout a map of what the keyboard prints at each place is (Chromium's layout map): the one
 * whose every letter key prints, in the map, the letter that layout prints there. None, if no
 * layout's do. Only the letter keys count: some keyboards lack a key of the others.
 */
export function layoutOfMap(map: ReadonlyMap<string, string>): Layout | null {
  const fits = (prints: ReadonlyMap<Printed, string>): boolean =>
    [...prints].every(
      ([place, c]) => !place.startsWith("Key") || !/^[A-Z]$/.test(c) || map.get(place)?.toUpperCase() === c,
    );
  return LAYOUTS.find((l) => fits(PRINTS.get(l.id) ?? new Map()))?.id ?? null;
}

const isIterable = (v: unknown): v is Iterable<unknown> =>
  typeof v === "object" && v !== null && typeof Reflect.get(v, Symbol.iterator) === "function";

/** What this keyboard prints at each place, where the browser can say (Chromium can, as a map-like; others cannot). */
async function browserMap(): Promise<Map<string, string>> {
  const none = new Map<string, string>();
  const board: unknown = typeof navigator === "undefined" ? null : Reflect.get(navigator, "keyboard");
  if (typeof board !== "object" || board === null) return none;
  const ask: unknown = Reflect.get(board, "getLayoutMap");
  if (typeof ask !== "function") return none;
  try {
    const map: unknown = await Reflect.apply(ask, board, []);
    if (!isIterable(map)) return none;
    const pairs = [...map].filter(
      (e): e is [string, string] => Array.isArray(e) && typeof e[0] === "string" && typeof e[1] === "string",
    );
    return new Map(pairs);
  } catch {
    return none;
  }
}

/** The layout keys are named by on this page: the player's choice, else the browser's word, else QWERTY. */
class Keyboard {
  /** The layout the browser reports, once it has. */
  #found: Layout | null = null;
  readonly #told = new Set<() => void>();

  get layout(): Layout {
    return this.chosen ?? this.#found ?? "qwerty";
  }

  /** The layout the player chose, on this page or another; none until they have. */
  get chosen(): Layout | null {
    return layoutOf(settings.now.keyboard);
  }

  choose(layout: Layout): void {
    settings.setKeyboard(layout);
  }

  /** The browser has said which layout it has (or that it cannot: null). */
  found(layout: Layout | null): void {
    this.#found = layout;
    for (const fn of this.#told) fn();
  }

  /** Hears each change of `layout`, whichever page chose it, or the browser's word. Gives back how to stop. */
  listen(fn: () => void): () => void {
    let was = this.layout;
    const check = (): void => {
      if (this.layout === was) return;
      was = this.layout;
      fn();
    };
    this.#told.add(check);
    const stop = settings.listen(check);
    return () => {
      this.#told.delete(check);
      stop();
    };
  }
}

/** This page's keyboard. */
export const keyboard = new Keyboard();
void browserMap().then((map) => keyboard.found(layoutOfMap(map)));

/** What a game's action is: the heading it is under in the Keys tab, what it does, and its keys. */
export interface KeyAction {
  readonly shelf: string;
  readonly does: string;
  /** Its keys as the game gives them, a slot each. The first key it has is the one a hint names. */
  readonly keys: readonly [Bind, ...Bind[]];
  /** It goes on while its key is down (moving), where any other is a press. Its keys never take Shift. */
  readonly held?: boolean;
  /** Its key held down does it again each time the browser repeats the key (zooming, undoing), where any other press is once. */
  readonly repeats?: boolean;
  /** What each slot is, where each is a thing of its own, numbered from 1 ("Tool": Tool 1, Tool 2…); else every slot is the action. */
  readonly each?: string;
}

/** What a key is for: an action, and which of its slots has the key (the first is 0). */
export interface Pressed<Id extends string> {
  readonly id: Id;
  readonly nth: number;
  /**
   * The key is held down and the browser says it again (`heldAgain`), and the action does nothing
   * more for that: only what is held (moving) and what `repeats` goes on while a key is held.
   */
  readonly again: boolean;
}

/** A slot of a line of the Keys tab: which it is, what it is for, what its key is called (none: it is empty), and whether it is one the player cannot change. */
export interface KeyCap {
  readonly nth: number;
  /** What the slot is for: the action's words, or its own (`KeyAction.each`): "Tool 3". */
  readonly does: string;
  readonly name: string | null;
  readonly fixed: boolean;
}

/** A line of the Keys tab: an action, what it does, its slots, and whether they differ from the game's. */
export interface KeyLine {
  readonly id: string;
  readonly does: string;
  readonly caps: readonly KeyCap[];
  readonly changed: boolean;
}

/** A heading of the Keys tab, and its lines. */
export interface KeyShelf {
  readonly name: string;
  readonly lines: readonly KeyLine[];
}

/** A key taken from the slot it was in, for one the player put it in: the key, and what that slot's action does. */
export interface Moved {
  readonly bind: Bind;
  readonly from: string;
}

/** What the settings menu draws its Keys tab from, and changes through it. */
export interface KeyList {
  shelves(): KeyShelf[];
  /** Hears each change of its keys, or of what they are called. Gives back how to stop. */
  listen(fn: () => void): () => void;
  /** Whether the player may change any of its keys. */
  readonly changeable: boolean;
  /**
   * Puts a key in a slot of an action (by their id and number), taking it from any other slot it
   * was in, which is left empty. Gives back where it was taken from, if anywhere; nothing is
   * changed for a slot that cannot be changed.
   */
  put(id: string, nth: number, bind: Bind): Moved[];
  /** Whether a slot of an action may hold a key (a held one never takes Shift). */
  fits(id: string, bind: Bind): boolean;
  /** Gives an action its keys as the game has them again, taking each from wherever it is now. Gives back where they were taken from. */
  reset(id: string): Moved[];
  /** Gives every action its keys as the game has them again. */
  resetAll(): void;
}

type Slots = readonly (Bind | null)[];
/** Slots as kept: a key, nothing, or the game's key if no choice of the player's has it (`undefined`). */
type Kept = readonly (Bind | null | undefined)[];

const sameSlots = (a: Slots | undefined, b: Slots | undefined): boolean =>
  a !== undefined && b !== undefined && a.length === b.length && a.every((bind, i) => bind === b[i]);

/**
 * A game's keys: each action once, by its id, and the slots each has now. With a game id, the
 * player may change them, and what they change is kept with the other settings under that id;
 * without, they are as the game gives them.
 */
export class Keymap<Id extends string> implements KeyList {
  readonly #game: string | null;
  readonly #actions: Readonly<Record<Id, KeyAction>>;
  readonly #ids: readonly Id[];
  /** The kept changes the slots were last worked out from. */
  #kept: string | null;
  /** Each action's keys now: the game's, with the player's changes on top (`#resolve`). */
  #slots: ReadonlyMap<Id, Slots> = new Map();
  /** What each key is for now, by the key. */
  #for: ReadonlyMap<string, { readonly id: Id; readonly nth: number }> = new Map();
  readonly #told = new Set<() => void>();

  constructor(game: string | null, actions: Readonly<Record<Id, KeyAction>>) {
    this.#game = game;
    this.#actions = actions;
    this.#ids = Object.keys(actions).filter((k): k is Id => Object.hasOwn(actions, k));
    this.#kept = game === null ? null : settings.keysOf(game);
    this.#apply(this.#resolve(this.#parse(this.#kept)));
    if (game !== null)
      settings.listen((now) => {
        this.#heard(now.keys.get(game) ?? null);
      });
  }

  get changeable(): boolean {
    return this.#game !== null;
  }

  #isId(id: string): id is Id {
    return this.#ids.some((known) => known === id);
  }

  /** An action's keys as the game gives them. */
  #defaults(id: Id): readonly Bind[] {
    return this.#actions[id].keys;
  }

  /** Whether a slot keeps the key the game gives it, whatever the player does. */
  fixed(id: Id, nth: number): boolean {
    const bind = this.#defaults(id)[nth];
    return this.#game === null || bind === undefined || isFixedBind(bind);
  }

  /** An action's keys now, a slot each: a key, or nothing. */
  keysOf(id: Id): Slots {
    return this.#slots.get(id) ?? this.#defaults(id);
  }

  /** A key as a slot of an action may hold it: none for a key no slot may hold, nor with Shift for an action that is held (held keys are known by place alone). */
  #fit(id: Id, bind: unknown): Bind | null {
    if (!isBind(bind) || isFixedBind(bind)) return null;
    return this.#actions[id].held === true && bind.startsWith("Shift+") ? null : bind;
  }

  /** Whether a slot of an action may hold a key. */
  fits(id: string, bind: Bind): boolean {
    return this.#isId(id) && this.#fit(id, bind) !== null;
  }

  /**
   * The player's changes, as kept: each action's whole slots. An action the game does not have, or
   * slots of another number than the action has, are let go; a slot that cannot be changed, or
   * holding what no slot of it may hold, is the game's key if no choice of the player's has it
   * (`undefined`, filled in by `#resolve`).
   */
  #parse(text: string | null): Map<Id, Kept> {
    const out = new Map<Id, Kept>();
    if (text === null) return out;
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      return out;
    }
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return out;
    for (const id of this.#ids) {
      const kept: unknown = Object.hasOwn(raw, id) ? Reflect.get(raw, id) : undefined;
      const defaults = this.#defaults(id);
      if (!Array.isArray(kept) || kept.length !== defaults.length) continue;
      const slots = defaults.map((_, nth): Bind | null | undefined => {
        const slot: unknown = kept[nth];
        if (this.fixed(id, nth)) return undefined;
        return slot === null ? null : (this.#fit(id, slot) ?? undefined);
      });
      out.set(id, slots);
    }
    return out;
  }

  /**
   * The slots of every action: the player's changes first, then the game's keys for every action
   * they have not changed. A game's key the player has put elsewhere leaves its slot empty, so an
   * action the game adds later never takes a key the player gave another. Where the player's keys
   * have one twice (only something broken kept could), the first slot in the keymap's order has it.
   * The game's own keys are as it gives them: one it gives twice is its mistake, which `shared` shows.
   */
  #resolve(changes: ReadonlyMap<Id, Kept>): Map<Id, Slots> {
    const chosen = new Set<Bind>();
    const once = (bind: Bind | null | undefined): Bind | null | undefined => {
      if (bind === undefined || bind === null) return bind;
      if (chosen.has(bind)) return null;
      chosen.add(bind);
      return bind;
    };
    const picked = new Map(this.#ids.map((id) => [id, changes.get(id)?.map(once)]));
    const free = (bind: Bind | undefined): Bind | null => (bind === undefined || chosen.has(bind) ? null : bind);
    return new Map(
      this.#ids.map((id) => {
        const game = this.#defaults(id);
        const mine = picked.get(id);
        return [id, game.map((bind, nth) => (mine === undefined || mine[nth] === undefined ? free(bind) : mine[nth]))];
      }),
    );
  }

  #apply(slots: ReadonlyMap<Id, Slots>): void {
    this.#slots = slots;
    const found = new Map<string, { id: Id; nth: number }>();
    for (const [id, keys] of slots)
      keys.forEach((bind, nth) => {
        if (bind !== null && !found.has(bind)) found.set(bind, { id, nth });
      });
    this.#for = found;
  }

  #tell(): void {
    for (const fn of this.#told) fn();
  }

  /** What is kept for the game has changed, here or on another page. */
  #heard(text: string | null): void {
    if (text === this.#kept) return;
    this.#kept = text;
    const next = this.#resolve(this.#parse(text));
    if (this.#ids.every((id) => sameSlots(next.get(id), this.#slots.get(id)))) return;
    this.#apply(next);
    this.#tell();
  }

  /** Keeps slots the player has made: only the actions whose slots differ from the game's. */
  #keep(slots: ReadonlyMap<Id, Slots>): void {
    const game = this.#game;
    if (game === null) return;
    const changed = this.#ids.filter((id) => !sameSlots(slots.get(id), this.#defaults(id)));
    const text =
      changed.length === 0 ? null : JSON.stringify(Object.fromEntries(changed.map((id) => [id, slots.get(id)])));
    if (text === this.#kept) return;
    this.#kept = text;
    // Worked out from what is kept, as any other page that reads it will.
    this.#apply(this.#resolve(this.#parse(text)));
    settings.setKeys(game, text);
    this.#tell();
  }

  /** The keys given to more than one slot: none, in a keymap that works. */
  shared(): Bind[] {
    const all = this.#ids.flatMap((id) => this.keysOf(id)).filter((bind) => bind !== null);
    return all.filter((bind, i) => all.indexOf(bind) !== i);
  }

  /** What a key down or up is for now, by place, Shift and Ctrl (`of`); nothing with Alt. */
  #at(e: Pick<KeyboardEvent, "code" | "key" | "shiftKey" | "ctrlKey" | "metaKey" | "altKey">) {
    if (e.altKey) return undefined;
    if (e.ctrlKey || e.metaKey) return e.shiftKey ? undefined : this.#for.get(`Ctrl+${e.key.toLowerCase()}`);
    const at = placeOf(e);
    return (e.shiftKey ? this.#for.get(`Shift+${at}`) : undefined) ?? this.#for.get(at);
  }

  /**
   * What a key that went down is for, if anything: by its place, with Shift where Shift is held and
   * the place has a key with it, else as without; by its letter with Ctrl or ⌘. With Alt, nothing.
   * And whether it is the key held down said again, which the action does nothing more for.
   */
  of(
    e: Pick<KeyboardEvent, "code" | "key" | "shiftKey" | "ctrlKey" | "metaKey" | "altKey" | "repeat">,
  ): Pressed<Id> | undefined {
    const at = this.#at(e);
    if (at === undefined) return undefined;
    const { held, repeats } = this.#actions[at.id];
    return { id: at.id, nth: at.nth, again: held !== true && repeats !== true && heldAgain(e) };
  }

  held(id: Id): boolean {
    return this.#actions[id].held === true;
  }

  /** Whether a key of an action is among the places held down (`placeOf`): the keys of what is held never take Shift. */
  isDown(down: ReadonlySet<string>, id: Id): boolean {
    return this.keysOf(id).some((bind) => bind !== null && down.has(bind));
  }

  /** What an action's first key is called on the keyboard the player has; none, if it has no key. */
  name(id: Id): string | null {
    const bind = this.keysOf(id).find((b) => b !== null);
    return bind === undefined || bind === null ? null : bindName(bind);
  }

  /** What each of an action's slots is called on the keyboard the player has: none for an empty one. */
  names(id: Id): (string | null)[] {
    return this.keysOf(id).map((bind) => (bind === null ? null : bindName(bind)));
  }

  /** A name with the action's key after it, as a tip has it (`keyed`). */
  titled(title: string, id: Id): string {
    return keyed(title, this.name(id));
  }

  shelves(): KeyShelf[] {
    const shelves = new Map<string, KeyLine[]>();
    for (const id of this.#ids) {
      const { shelf, does, each } = this.#actions[id];
      const caps = this.names(id).map((name, nth) => ({
        nth,
        does: each === undefined ? does : `${each} ${nth + 1}`,
        name,
        fixed: this.fixed(id, nth),
      }));
      const changed = !sameSlots(this.keysOf(id), this.#defaults(id));
      shelves.set(shelf, [...(shelves.get(shelf) ?? []), { id, does, caps, changed }]);
    }
    return [...shelves].map(([name, lines]) => ({ name, lines }));
  }

  listen(fn: () => void): () => void {
    const own = (): void => fn();
    this.#told.add(own);
    const stop = keyboard.listen(fn);
    return () => {
      this.#told.delete(own);
      stop();
    };
  }

  put(id: string, nth: number, bind: Bind): Moved[] {
    if (!this.#isId(id) || nth < 0 || nth >= this.#defaults(id).length || this.fixed(id, nth)) return [];
    const fit = this.#fit(id, bind);
    if (fit === null || this.keysOf(id)[nth] === fit) return [];
    const next = new Map(this.#slots);
    const was = this.#for.get(fit);
    if (was)
      next.set(
        was.id,
        this.keysOf(was.id).map((b, i) => (i === was.nth ? null : b)),
      );
    next.set(
      id,
      (next.get(id) ?? this.keysOf(id)).map((b, i) => (i === nth ? fit : b)),
    );
    this.#keep(next);
    return was ? [{ bind: fit, from: this.#actions[was.id].does }] : [];
  }

  reset(id: string): Moved[] {
    if (!this.#isId(id)) return [];
    const next = new Map(this.#slots);
    const moved: Moved[] = [];
    for (const bind of this.#defaults(id)) {
      const was = this.#for.get(bind);
      if (!was || was.id === id) continue;
      next.set(
        was.id,
        (next.get(was.id) ?? []).map((b, i) => (i === was.nth ? null : b)),
      );
      moved.push({ bind, from: this.#actions[was.id].does });
    }
    next.set(id, this.#defaults(id));
    this.#keep(next);
    return moved;
  }

  resetAll(): void {
    this.#keep(new Map(this.#ids.map((id) => [id, this.#defaults(id)])));
  }
}

/** The ids of a keymap's actions. */
export type ActionOf<K> = K extends Keymap<infer Id> ? Id : never;

/**
 * Walking, the same in every game where the player is somebody (the town, the Works): up, left, down
 * and right on WASD and the arrows, held. A game's keymap takes them in as they are.
 */
export const WALKING: Readonly<Record<"up" | "left" | "down" | "right", KeyAction>> = {
  up: { shelf: "Walking", does: "Walk up", keys: ["KeyW", "ArrowUp"], held: true },
  left: { shelf: "Walking", does: "Walk left", keys: ["KeyA", "ArrowLeft"], held: true },
  down: { shelf: "Walking", does: "Walk down", keys: ["KeyS", "ArrowDown"], held: true },
  right: { shelf: "Walking", does: "Walk right", keys: ["KeyD", "ArrowRight"], held: true },
};

/**
 * A game's keymap: each action once, by its id. The player may change its keys, kept under `game`
 * (`settings.ts`), but for the few no game may give away (`isFixedBind`).
 */
export const keymap = <Id extends string>(game: string, actions: Readonly<Record<Id, KeyAction>>): Keymap<Id> =>
  new Keymap(game, actions);

/** A keymap the player cannot change: its keys are the browser's own, or another part's. */
export const fixedKeymap = <Id extends string>(actions: Readonly<Record<Id, KeyAction>>): Keymap<Id> =>
  new Keymap(null, actions);
