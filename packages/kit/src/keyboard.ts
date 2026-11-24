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
 * key is for, its Keys tab is drawn from it, and every hint asks it what a key is called.
 */
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

/** A place on the keyboard a game may give a key to, as `KeyboardEvent.code` names it. */
export type Place = `Key${Letter}` | `Digit${Digit}` | "Minus" | "Equal" | Worded;

/** A key: a place, a place with Shift held (`Shift+Equal`), or a letter with Ctrl (`Ctrl+z`). */
export type Bind = Place | `Shift+${Place}` | `Ctrl+${Lowercase<Letter>}`;

const isLetter = (c: string): c is Letter => /^[A-Z]$/.test(c);

/** The places a layout's `prints` names, in order: the two keys after 0, then the letters' places, row by row. */
const PLACES: readonly Place[] = [
  "Minus",
  "Equal",
  ..."QWERTYUIOPASDFGHJKLZXCVBNM"
    .split("")
    .filter(isLetter)
    .map((c): Place => `Key${c}`),
];

/** The layouts a player may choose, and what each prints at `PLACES`. The number row prints its digits on every one. */
export const LAYOUTS = [
  { id: "qwerty", name: "QWERTY", prints: "-=QWERTYUIOPASDFGHJKLZXCVBNM" },
  { id: "qwertz", name: "QWERTZ", prints: "ß´QWERTZUIOPASDFGHJKLYXCVBNM" },
  { id: "azerty", name: "AZERTY", prints: ")=AZERTYUIOPQSDFGHJKLWXCVBN," },
  { id: "dvorak", name: "Dvorak", prints: "[]',.PYFGCRLAOEUIDHTN;QJKXBM" },
  { id: "colemak", name: "Colemak", prints: "-=QWFPGJLUY;ARSTDHNEIZXCVBKM" },
  { id: "colemak-dh", name: "Colemak-DH", prints: "-=QWFPBJLUY;ARSTGMNEIZXCDVKH" },
  { id: "workman", name: "Workman", prints: "-=QDRWBJFUP;ASHTGYNEOZXMCVKL" },
] as const;

export type Layout = (typeof LAYOUTS)[number]["id"];

/** The layout of an id, if it is one. */
export const layoutOf = (id: string | null): Layout | null => LAYOUTS.find((l) => l.id === id)?.id ?? null;

const isPlace = (code: string): code is Place =>
  isWorded(code) || /^Digit\d$/.test(code) || PLACES.some((place) => place === code);

/** What a place is called on a layout: what it prints there, its digit, or its name in words. */
export function nameOf(place: Place, layout: Layout = keyboard.layout): string {
  const at = PLACES.indexOf(place);
  if (at >= 0) return LAYOUTS.find((l) => l.id === layout)?.prints[at] ?? place;
  return isWorded(place) ? WORDS[place] : place.replace(/^Digit/, "");
}

/** The place of a key, with or without Shift; none for a letter with Ctrl. */
function placeOfBind(bind: Bind): Place | null {
  const place = bind.replace(/^Shift\+/, "");
  return isPlace(place) ? place : null;
}

/** What a key is called on a layout: "R", "Shift+=", "Ctrl+Z". */
export function bindName(bind: Bind, layout: Layout = keyboard.layout): string {
  const place = placeOfBind(bind);
  if (place === null) return `Ctrl+${bind.slice("Ctrl+".length).toUpperCase()}`;
  return `${bind.startsWith("Shift+") ? "Shift+" : ""}${nameOf(place, layout)}`;
}

/** Where a key that went down or up is, as keys are given: the number pad's digits and Enter are the main ones. */
export const placeOf = (code: string): string =>
  code === "NumpadEnter" ? "Enter" : code.replace(/^Numpad(\d)$/, "Digit$1");

/**
 * The layout a map of what the keyboard prints at each place is (Chromium's layout map): the one
 * whose every letter the map prints where that layout prints it. None, if no layout's are.
 */
export function layoutOfMap(map: ReadonlyMap<string, string>): Layout | null {
  const fits = (prints: string): boolean =>
    PLACES.every((place, i) => {
      const c = prints[i] ?? "";
      return !isLetter(c) || map.get(place)?.toUpperCase() === c;
    });
  return LAYOUTS.find((l) => fits(l.prints))?.id ?? null;
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
  /** Its keys: the first is the one a hint names. */
  readonly keys: readonly [Bind, ...Bind[]];
  /** It goes on while its key is down (moving), where any other is a press. */
  readonly held?: boolean;
}

/** What a key is for: an action, and which of its keys it is (the first is 0). */
export interface Pressed<Id extends string> {
  readonly id: Id;
  readonly nth: number;
}

/** A heading of the Keys tab, and its lines: what each action does, and its keys as this keyboard names them. */
export interface KeyShelf {
  readonly name: string;
  readonly lines: readonly { readonly does: string; readonly keys: readonly string[] }[];
}

/** What the settings menu draws its Keys tab from. */
export interface KeyList {
  shelves(): KeyShelf[];
}

/** A game's keys: each action once, by its id. */
export class Keymap<Id extends string> implements KeyList {
  readonly #actions: Readonly<Record<Id, KeyAction>>;
  readonly #ids: readonly Id[];
  /** What each key is for, by the key. */
  readonly #for = new Map<string, Pressed<Id>>();

  constructor(actions: Readonly<Record<Id, KeyAction>>) {
    this.#actions = actions;
    this.#ids = Object.keys(actions).filter((k): k is Id => Object.hasOwn(actions, k));
    for (const id of this.#ids)
      this.keysOf(id).forEach((bind, nth) => {
        if (!this.#for.has(bind)) this.#for.set(bind, { id, nth });
      });
  }

  /** An action's keys. */
  keysOf(id: Id): readonly [Bind, ...Bind[]] {
    return this.#actions[id].keys;
  }

  /** The keys given to more than one action, or twice to one: none, in a keymap that works. */
  shared(): Bind[] {
    const all = this.#ids.flatMap((id) => this.keysOf(id));
    return all.filter((bind, i) => all.indexOf(bind) !== i);
  }

  /**
   * What a key that went down or up is for, if anything: by its place, with Shift where Shift is
   * held and the place has a key with it, else as without; by its letter with Ctrl or ⌘. With
   * Alt, nothing.
   */
  of(e: Pick<KeyboardEvent, "code" | "key" | "shiftKey" | "ctrlKey" | "metaKey" | "altKey">): Pressed<Id> | undefined {
    if (e.altKey) return undefined;
    if (e.ctrlKey || e.metaKey) return e.shiftKey ? undefined : this.#for.get(`Ctrl+${e.key.toLowerCase()}`);
    const at = placeOf(e.code);
    return (e.shiftKey ? this.#for.get(`Shift+${at}`) : undefined) ?? this.#for.get(at);
  }

  held(id: Id): boolean {
    return this.#actions[id].held === true;
  }

  /** Whether a key of an action is among the places held down (`placeOf`). */
  isDown(down: ReadonlySet<string>, id: Id): boolean {
    return this.keysOf(id).some((bind) => down.has(bind));
  }

  /** What an action's first key is called on the keyboard the player has. */
  name(id: Id): string {
    return bindName(this.keysOf(id)[0]);
  }

  /** What each of an action's keys is called on the keyboard the player has. */
  names(id: Id): string[] {
    return this.keysOf(id).map((bind) => bindName(bind));
  }

  shelves(): KeyShelf[] {
    const shelves = new Map<string, { does: string; keys: string[] }[]>();
    for (const id of this.#ids) {
      const { shelf, does } = this.#actions[id];
      shelves.set(shelf, [...(shelves.get(shelf) ?? []), { does, keys: this.names(id) }]);
    }
    return [...shelves].map(([name, lines]) => ({ name, lines }));
  }
}

/** The ids of a keymap's actions. */
export type ActionOf<K> = K extends Keymap<infer Id> ? Id : never;

/** A game's keymap: each action once, by its id. */
export const keymap = <Id extends string>(actions: Readonly<Record<Id, KeyAction>>): Keymap<Id> => new Keymap(actions);
