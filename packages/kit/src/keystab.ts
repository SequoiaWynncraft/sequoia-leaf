/**
 * The settings menu's Keys tab (`menu.ts`): which keyboard the player has, and each action of the
 * page's keymap with its keys, named as that keyboard prints them (`keyboard.ts`).
 *
 * A key the player may change is a button. Pressed, it waits for a key, and the line under the tabs
 * says for what; the next key pressed goes there (`caught`), taken from any slot it was in, which
 * is left empty, and the line says so. Escape keeps the key it had, as does a press anywhere else;
 * Shift and the like on their own are waited past, and a key that cannot be used is said so. A line
 * the player has changed has a button to reset it, and the foot of the tab one to reset them all,
 * asked once.
 */
import { el, icon } from "./dom.ts";
import {
  bindName,
  caught,
  keyboard,
  type KeyCap,
  type KeyLine,
  type KeyList,
  layoutOf,
  LAYOUTS,
  type Moved,
} from "./keyboard.ts";
import { heldAgain } from "./keys.ts";
import { sfx } from "./sound.ts";

/** A slot waiting for a key: which, what its action does, and what its key is called now (none: empty). */
export interface Waiting {
  readonly id: string;
  readonly nth: number;
  readonly does: string;
  readonly was: string | null;
}

/** What a key pressed while the menu is up did (`Waiter.key`). */
export interface Heard {
  /** It was the waiting slot's: nothing else hears it, not even Escape closing the menu. */
  readonly taken: boolean;
  /** The browser does nothing of its own with it: Ctrl, Alt and ⌘ with a key stay the browser's and the system's. */
  readonly prevent: boolean;
  /** What the line under the tabs says now, where it changes, and whether as a warning. */
  readonly say?: { readonly text: string; readonly bad: boolean };
}

/** The control of the tab a key names (`data-key`), so that the focus stays on it as the tab is drawn again. */
const capKey = (id: string, nth: number): string => `cap:${id}:${nth}`;

/** What the line says of keys taken from other slots: "W was on Walk up." */
const movedSays = (moved: readonly Moved[]): string =>
  moved.map((m) => `${bindName(m.bind)} was on ${m.from}.`).join(" ");

/**
 * The slot of a keymap waiting for a key, if one is, and what each key pressed does to it: Escape
 * keeps the key it had, Shift and the like on their own are waited past, a key that cannot be used
 * is said so while it waits on, and any other goes in the slot (`KeyList.put`).
 */
export class Waiter {
  readonly #keys: KeyList;
  #slot: Waiting | null = null;

  constructor(keys: KeyList) {
    this.#keys = keys;
  }

  get slot(): Waiting | null {
    return this.#slot;
  }

  /** A slot waits for a key. Gives back what the line says. */
  wait(slot: Waiting): string {
    this.#slot = slot;
    return `Press a key for ${slot.does}. ${slot.was === null ? "Escape leaves it empty." : `Escape keeps ${slot.was}.`}`;
  }

  /** The slot waiting stops, keeping the key it had. */
  stop(): void {
    this.#slot = null;
  }

  key(e: Pick<KeyboardEvent, "code" | "key" | "shiftKey" | "ctrlKey" | "metaKey" | "altKey" | "repeat">): Heard {
    const slot = this.#slot;
    if (!slot) return { taken: false, prevent: false };
    // A key still held from before (the Enter that pressed the cap) saying itself again: no key for the slot.
    if (heldAgain(e)) return { taken: true, prevent: true };
    const got = caught(e);
    if (got.is === "wait") return { taken: true, prevent: false };
    if (got.is === "refused")
      return {
        taken: true,
        // Tab is not let move the focus off the slot.
        prevent: !e.ctrlKey && !e.metaKey && !e.altKey,
        say: { text: `${got.name} can't be used.`, bad: true },
      };
    this.#slot = null;
    if (got.is === "keep") return { taken: true, prevent: true, say: { text: "", bad: false } };
    const moved = this.#keys.put(slot.id, slot.nth, got.bind);
    return { taken: true, prevent: true, say: { text: movedSays(moved), bad: false } };
  }
}

/** A small button of the tab, named by `key` (`data-key`). */
const button = (text: string, key: string, look: string, on: () => void): HTMLElement =>
  el("button", `k-btn sm ${look}`.trim(), { type: "button", "data-key": key, onclick: on }, text);

/** A heading on its brass rule, and the rows under it. */
export const shelf = (name: string, rows: readonly HTMLElement[]): HTMLElement[] => [
  el("div", "k-label k-settings-shelf", { text: name }),
  el("ul", "k-settings-list", {}, ...rows),
];

/** The Keys tab's first row: which keyboard the player has, chosen from a list. Gives back how to show it as it now is. */
function keyboardRow(): [HTMLElement, () => void] {
  const pick = el(
    "select",
    "k-select",
    {
      onchange: () => {
        const chosen = layoutOf(pick.value);
        if (chosen) keyboard.choose(chosen);
      },
    },
    ...LAYOUTS.map((l) => el("option", "", { value: l.id, text: l.name })),
  );
  const row = el(
    "label",
    "k-card k-settings-keyboard",
    {},
    el("span", "k-name", { text: "Keyboard" }),
    el("span", "k-select-box", {}, pick, icon("down")),
  );
  const paint = (): void => {
    pick.value = keyboard.layout;
  };
  paint();
  return [row, paint];
}

/** The Keys tab of a page's menu, and the slot waiting for a key, if one is. */
export class KeysTab {
  readonly #keys: KeyList;
  /** The line under the tabs: what a slot waits for, and what a key pressed did. */
  readonly line = el("p", "k-settings-said", { "aria-live": "polite" });
  /** The rows of the tab as drawn now, and how to draw them again; none while the tab is not shown. */
  #rows: { readonly root: HTMLElement; readonly paint: () => void } | null = null;
  readonly #waiter: Waiter;
  /** "Reset all keys" has been pressed, and asks whether. */
  #asking = false;
  readonly #cue: () => void;

  /** `cue` shows whether there is more of the page below what shows. */
  constructor(keys: KeyList, cue: () => void) {
    this.#keys = keys;
    this.#waiter = new Waiter(keys);
    this.#cue = cue;
  }

  /** The tab's rows, drawn as the keys and the keyboard now are, whichever page changes them. `keep` holds what the drawing listens to. */
  draw(keep: (stop: () => void) => void): HTMLElement[] {
    const [board, paintBoard] = keyboardRow();
    const root = el("div", "k-settings-keys");
    const paint = (): void => {
      paintBoard();
      this.#paint(root);
      this.#cue();
    };
    this.#rows = { root, paint };
    paint();
    keep(this.#keys.listen(paint));
    keep(() => {
      this.#rows = null;
      this.#waiter.stop();
      this.#asking = false;
      this.#say("");
    });
    return [board, root];
  }

  /** Draws the lines and the foot again, the focus kept on the control that had it. */
  #paint(root: HTMLElement): void {
    const had = document.activeElement instanceof HTMLElement ? document.activeElement.dataset["key"] : undefined;
    const shelves = this.#keys.shelves();
    const foot = this.#foot(shelves.some((s) => s.lines.some((l) => l.changed)));
    root.replaceChildren(
      ...shelves.flatMap((s) =>
        shelf(
          s.name,
          s.lines.map((l) => this.#row(l)),
        ),
      ),
      ...foot,
    );
    const wait = this.#waiter.slot;
    if (wait && !root.querySelector(`[data-key="${capKey(wait.id, wait.nth)}"]`)) this.#waiter.stop();
    if (had === undefined) return;
    // A control gone (a line's reset, once it is reset): the focus goes to its line's first key, else the first key of all.
    const line = had.split(":")[1] ?? "";
    const to =
      root.querySelector(`[data-key="${had}"]`) ??
      root.querySelector(`[data-key^="cap:${line}:"]`) ??
      root.querySelector("[data-key^='cap:']");
    if (to instanceof HTMLElement) to.focus({ preventScroll: true });
  }

  /** A line: its keys, what they do (that it has no key, if it has none), and a reset where they differ from the game's. */
  #row(line: KeyLine): HTMLElement {
    const none = line.caps.every((c) => c.name === null);
    const reset = line.changed
      ? el(
          "button",
          "k-btn sm",
          {
            type: "button",
            "data-key": `reset:${line.id}`,
            "aria-label": `Reset ${line.does}`,
            onclick: () => {
              this.#stopWaiting();
              this.#say(movedSays(this.#keys.reset(line.id)));
            },
          },
          "Reset",
        )
      : null;
    return el(
      "li",
      "k-settings-key",
      {},
      el("span", "k-settings-caps", {}, ...line.caps.map((cap) => this.#cap(line, cap))),
      el("span", "k-settings-does", {}, line.does, none ? el("span", "k-settings-none", { text: " No key" }) : null),
      reset,
    );
  }

  /** A key of a line: a button that waits for a key when it may be changed, else the key as it is. An empty slot shows a dash. */
  #cap(line: KeyLine, cap: KeyCap): HTMLElement {
    const text = cap.name ?? "—";
    const empty = cap.name === null ? " empty" : "";
    if (cap.fixed) return el("kbd", `k-cap fixed${empty}`, { text });
    const wait = this.#waiter.slot;
    const waiting = wait?.id === line.id && wait.nth === cap.nth;
    const b = el(
      "button",
      `k-cap${empty}${waiting ? " waiting" : ""}`,
      {
        type: "button",
        "data-key": capKey(line.id, cap.nth),
        "aria-label": `${line.does}: ${cap.name ?? "no key"}`,
        onclick: () => {
          this.#waitFor({ id: line.id, nth: cap.nth, does: line.does, was: cap.name }, b);
        },
      },
      text,
    );
    return b;
  }

  /** The foot: "Reset all keys" where any differ from the game's, asked once with Yes and No. */
  #foot(changed: boolean): HTMLElement[] {
    if (!changed) {
      this.#asking = false;
      return [];
    }
    if (!this.#asking)
      return [
        el(
          "div",
          "k-settings-foot",
          {},
          button("Reset all keys", "all", "", () => {
            this.#stopWaiting();
            this.#asking = true;
            this.#rows?.paint();
            this.#focus("no");
          }),
        ),
      ];
    const answer = (yes: boolean): void => {
      this.#asking = false;
      this.#say("");
      if (yes) this.#keys.resetAll();
      this.#rows?.paint();
      if (!yes) this.#focus("all");
    };
    return [
      el(
        "div",
        "k-settings-foot",
        {},
        el("span", "k-name", { text: "Reset all keys?" }),
        button("Yes", "yes", "coral", () => answer(true)),
        button("No", "no", "", () => answer(false)),
      ),
    ];
  }

  #focus(key: string): void {
    const to = this.#rows?.root.querySelector(`[data-key="${key}"]`);
    if (to instanceof HTMLElement) to.focus({ preventScroll: true });
  }

  #say(text: string, bad = false): void {
    this.line.textContent = text;
    this.line.classList.toggle("bad", bad);
  }

  /** The cap of the slot waiting, as drawn now. */
  #waitingCap(): Element | null {
    const wait = this.#waiter.slot;
    return wait ? (this.#rows?.root.querySelector(`[data-key="${capKey(wait.id, wait.nth)}"]`) ?? null) : null;
  }

  /** A slot waits for a key: its cap shows it, and the line says for what. */
  #waitFor(wait: Waiting, cap: HTMLElement): void {
    this.#stopWaiting();
    this.#asking = false;
    cap.classList.add("waiting");
    sfx.tap();
    this.#say(this.#waiter.wait(wait));
  }

  /** The slot waiting for a key stops waiting, keeping the key it had. Only its cap is drawn again, so a press that stops it still lands where it was aimed. */
  #stopWaiting(): void {
    if (!this.#waiter.slot) return;
    this.#waitingCap()?.classList.remove("waiting");
    this.#waiter.stop();
    this.#say("");
  }

  /** A press somewhere: anywhere but on the slot waiting, it stops waiting. */
  pressed(on: EventTarget | null): void {
    const cap = this.#waitingCap();
    if (this.#waiter.slot && !(on instanceof Node && cap?.contains(on))) this.#stopWaiting();
  }

  /**
   * A key, while the menu is up: taken (true) while a slot waits for one, so that nothing else
   * hears it, not even Escape closing the menu; anything else is the menu's.
   */
  take(e: KeyboardEvent): boolean {
    const cap = this.#waitingCap();
    // The tab is drawn again as the keymap changes, the focus kept on the slot.
    const heard = this.#waiter.key(e);
    if (heard.prevent) e.preventDefault();
    if (!this.#waiter.slot) cap?.classList.remove("waiting");
    if (heard.say) this.#say(heard.say.text, heard.say.bad);
    if (heard.say && !heard.say.bad && heard.say.text !== "") sfx.tap();
    return heard.taken;
  }
}
