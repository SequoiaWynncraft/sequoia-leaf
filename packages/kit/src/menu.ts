import { dialog } from "./dialog.ts";
/**
 * The settings menu, the same in the town and in every game: opened from the gear in a page's
 * corner, or with Escape when there is nothing else for Escape to put away (the page decides that,
 * and calls `open`). It is a panel over a dimmed page, with a tab for each part:
 *
 * - Sound: the volume, sound on or off, and each kind of sound switched on or off on its own (the
 *   page's own kinds under its name, then those every game shares), each with a button to hear it.
 * - Keys: what each key does on this page.
 *
 * What it changes is the player's settings on this device (`settings.ts`), which every open page
 * follows at once. A page builds its menu once, at the start (`settingsMenu`), and gives it its own
 * kinds of sound and keys; the menu grows by tabs, and a page may add its own later.
 */
import { add, el, icon } from "./dom.ts";
import type { Scope } from "./scope.ts";
import { LOUDEST, type Settings, settings } from "./settings.ts";
import { sample, sfx, SHARED_SOUNDS, type SoundKind, unlock } from "./sound.ts";
import { tip } from "./tip.ts";

/** Kinds of sound under one heading in the menu. */
export interface SoundShelf {
  readonly name: string;
  readonly sounds: readonly SoundKind[];
}

/**
 * One line of the Keys tab: its keys and what they do. A key is a key's place on the keyboard as
 * `KeyboardEvent.code` names it (`KeyW`), shown as this keyboard prints it where the browser can
 * say, or words for one ("Esc", "1 to 9").
 */
export interface KeyLine {
  readonly keys: readonly string[];
  readonly does: string;
}

/** Lines of the Keys tab under one heading. */
export interface KeyShelf {
  readonly name: string;
  readonly lines: readonly KeyLine[];
}

/** What a page tells its menu. */
export interface MenuOf {
  /** The page's own kinds of sound, by heading. The kinds every game shares come after them. */
  readonly sounds: readonly SoundShelf[];
  /** The page's keys, by heading. */
  readonly keys: readonly KeyShelf[];
  /** Told as the menu opens (true) and is put away (false): the page lets go of held keys and takes no play while it is open. */
  readonly opened?: (open: boolean) => void;
}

/** The menu of a page. */
export interface Menu {
  /** A gear for a corner of the page: it opens the menu, and puts it away. A page may have one on each of its screens. */
  gear(): HTMLElement;
  open(tab?: Tab): void;
  close(): void;
  readonly isOpen: boolean;
}

export type Tab = "sound" | "keys";

const TABS: readonly { readonly tab: Tab; readonly name: string }[] = [
  { tab: "sound", name: "Sound" },
  { tab: "keys", name: "Keys" },
];

/** How often the volume slider sounds a tick while it is dragged, at most: often enough to hear the level, not a rattle. */
const TICK_MS = 160;

/** Words for a key's place where the browser cannot say how this keyboard prints it. */
const KEY_WORDS: Readonly<Record<string, string>> = {
  Escape: "Esc",
  Space: "Space",
  Enter: "Enter",
  Delete: "Del",
  ArrowUp: "Up",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
};

/** How a key is shown: its letter on this keyboard where `printed` has it, else from its place's name, else as given. */
function keyName(key: string, printed: ReadonlyMap<string, string> | null): string {
  const own = printed?.get(key);
  if (own) return own.toUpperCase();
  const word = KEY_WORDS[key];
  if (word) return word;
  const letter = /^Key([A-Z])$/.exec(key)?.[1] ?? /^Digit(\d)$/.exec(key)?.[1];
  return letter ?? key;
}

/** How this keyboard prints each key, where the browser can say (Chromium can; others cannot). */
async function printedKeys(): Promise<ReadonlyMap<string, string> | null> {
  const board: unknown = Reflect.get(navigator, "keyboard");
  if (typeof board !== "object" || board === null) return null;
  const ask: unknown = Reflect.get(board, "getLayoutMap");
  if (typeof ask !== "function") return null;
  try {
    const map: unknown = await Reflect.apply(ask, board, []);
    if (!(map instanceof Map)) return null;
    return new Map([...map].filter((e): e is [string, string] => typeof e[0] === "string" && typeof e[1] === "string"));
  } catch {
    return null;
  }
}

/** A switch: on or off, said as `name`, changed by a press. */
function toggle(name: string, on: () => boolean, flip: (on: boolean) => void): HTMLButtonElement {
  const b = el("button", "k-switch", {
    type: "button",
    role: "switch",
    "aria-label": name,
    "aria-checked": String(on()),
    onclick: () => {
      flip(!on());
      b.setAttribute("aria-checked", String(on()));
    },
  });
  return b;
}

/** A row of the Sound tab for one kind of sound: a button to hear it, its name, and its switch. */
function soundRow(kind: SoundKind): HTMLElement {
  const hear = el(
    "button",
    "k-btn wood icon sm",
    {
      type: "button",
      "aria-label": `Hear ${kind.name}`,
      onclick: () => {
        unlock();
        sample(kind.sample);
      },
    },
    icon("play"),
  );
  const on = (): boolean => !settings.now.quiet.has(kind.id);
  const row = el("li", "k-card k-settings-sound");
  const sw = toggle(kind.name, on, (next) => {
    settings.setHeard(kind.id, next);
    row.classList.toggle("off", !next);
  });
  row.classList.toggle("off", !on());
  add(row, hear, el("span", "k-name", { text: kind.name }), sw);
  return row;
}

/** A heading on its brass rule, and the rows under it. */
const shelf = (name: string, rows: readonly HTMLElement[]): HTMLElement[] => [
  el("div", "k-label k-settings-shelf", { text: name }),
  el("ul", "k-settings-list", {}, ...rows),
];

/** A line of the Keys tab: its keys as printed on this keyboard (`printed`, where known), and what they do. */
const keyRow = (line: KeyLine, printed: ReadonlyMap<string, string> | null): HTMLElement =>
  el(
    "li",
    "k-settings-key",
    {},
    el("span", "k-settings-caps", {}, ...line.keys.map((k) => el("kbd", "k-cap", { text: keyName(k, printed) }))),
    el("span", "k-settings-does", { text: line.does }),
  );

/** The menu as a page has it: its panel over a dimmed page, the tab shown, and what is held while it is open. */
class SettingsMenu implements Menu {
  readonly #of: MenuOf;
  /** The gears made for the page (`gear`): each says whether the menu is open. */
  readonly #gears = new Set<HTMLElement>();
  readonly #scrim = el("div", "k-scrim k-settings-scrim", { hidden: true });
  readonly #title = el("h2", "k-title", { text: "Settings" });
  readonly #tabs = el("div", "k-tabs", { role: "tablist", "aria-label": "Settings" });
  readonly #page = el("div", "k-settings-page k-scroll", { role: "tabpanel" });
  readonly #panel: HTMLElement;
  /** Listeners of the rows drawn for the tab shown, let go of as it is drawn again or the menu is put away. */
  readonly #drops: (() => void)[] = [];
  #at: Tab = "sound";
  /** While open: what lets go of the menu's layer (`dialog`). */
  #put: (() => void) | null = null;
  #lastTick = 0;
  #printed: ReadonlyMap<string, string> | null = null;

  constructor(of: MenuOf, scope: Scope) {
    this.#of = of;
    const shut = el("button", "k-btn coral icon", { type: "button", "aria-label": "Close" }, icon("close"));
    this.#panel = el(
      "section",
      "k-panel k-settings",
      {},
      el("header", "k-head", {}, el("span", "k-settings-mark", {}, icon("gear")), this.#title, shut),
      this.#tabs,
      this.#page,
    );
    this.#scrim.append(this.#panel);
    document.body.append(this.#scrim);
    scope.on(shut, "click", () => {
      this.close();
    });
    // A press on the dimmed page around the panel puts it away; one inside it does not.
    scope.on(this.#scrim, "pointerdown", (e) => {
      if (e.target === this.#scrim) this.close();
    });
    scope.on(this.#tabs, "keydown", (e) => {
      this.#stepTab(e);
    });
    scope.on(window, "pagehide", () => {
      this.close();
    });
    void this.#readKeys();
  }

  /** Learns how this keyboard prints its keys, where the browser can say, and shows them if the Keys tab is up. */
  async #readKeys(): Promise<void> {
    this.#printed = await printedKeys();
    if (this.#put && this.#at === "keys") this.#draw();
  }

  gear(): HTMLElement {
    const gear = el(
      "button",
      "k-btn wood icon",
      {
        type: "button",
        "aria-label": "Settings",
        "aria-expanded": String(this.#put !== null),
        onclick: () => {
          if (this.#put) this.close();
          else this.open();
        },
      },
      icon("gear"),
    );
    tip(gear, "Settings (Esc)");
    this.#gears.add(gear);
    return gear;
  }

  /** Tells every gear still on the page whether the menu is open; gears gone from the page are let go. */
  #tellGears(open: boolean): void {
    for (const gear of this.#gears) {
      if (gear.isConnected) gear.setAttribute("aria-expanded", String(open));
      else this.#gears.delete(gear);
    }
  }

  get isOpen(): boolean {
    return this.#put !== null;
  }

  open(tab: Tab = this.#at): void {
    if (this.#put) {
      this.#choose(tab);
      return;
    }
    this.#at = tab;
    this.#draw();
    this.#scrim.hidden = false;
    // The panel rises each time it opens.
    this.#panel.classList.remove("k-rise");
    void this.#panel.offsetWidth;
    this.#panel.classList.add("k-rise");
    this.#put = dialog(this.#panel, this.#title, () => {
      this.close();
    });
    this.#tellGears(true);
    sfx.open();
    this.#of.opened?.(true);
  }

  close(): void {
    const done = this.#put;
    if (!done) return;
    this.#put = null;
    this.#letGo();
    this.#scrim.hidden = true;
    this.#tellGears(false);
    done();
    sfx.close();
    this.#of.opened?.(false);
  }

  #letGo(): void {
    for (const stop of this.#drops.splice(0)) stop();
  }

  #draw(): void {
    this.#letGo();
    this.#tabs.replaceChildren(
      ...TABS.map(({ tab, name }) =>
        el(
          "button",
          "k-btn",
          {
            type: "button",
            role: "tab",
            id: `k-settings-tab-${tab}`,
            "aria-selected": String(tab === this.#at),
            tabindex: tab === this.#at ? "0" : "-1",
            onclick: () => {
              this.#choose(tab);
            },
          },
          name,
        ),
      ),
    );
    this.#page.setAttribute("aria-labelledby", `k-settings-tab-${this.#at}`);
    this.#page.replaceChildren(...(this.#at === "sound" ? this.#soundPage() : this.#keysPage()));
  }

  #choose(tab: Tab): void {
    if (tab === this.#at) return;
    this.#at = tab;
    sfx.tap();
    this.#draw();
    this.#page.scrollTop = 0;
    document.getElementById(`k-settings-tab-${tab}`)?.focus();
  }

  /** Left and right go from tab to tab, as a row of tabs does. */
  #stepTab(e: Event): void {
    if (!(e instanceof KeyboardEvent)) return;
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (step === 0) return;
    e.preventDefault();
    const i = TABS.findIndex((t) => t.tab === this.#at);
    const next = TABS[(i + step + TABS.length) % TABS.length];
    if (next) this.#choose(next.tab);
  }

  #soundPage(): HTMLElement[] {
    return [
      this.#volumeRow(),
      ...this.#of.sounds.flatMap((s) => shelf(s.name, s.sounds.map(soundRow))),
      ...shelf("Every game", SHARED_SOUNDS.map(soundRow)),
    ];
  }

  #keysPage(): HTMLElement[] {
    return this.#of.keys.flatMap((s) =>
      shelf(
        s.name,
        s.lines.map((line) => keyRow(line, this.#printed)),
      ),
    );
  }

  /** The volume: the speaker that turns the sound off and on, the slider, and the level as a number. */
  #volumeRow(): HTMLElement {
    const speaker = el("button", "k-btn wood icon", {
      type: "button",
      "aria-label": "Sound on",
      onclick: () => {
        unlock();
        settings.setMuted(!settings.now.muted);
        if (!settings.now.muted) sample(() => sfx.tap());
      },
    });
    const slider = el("input", "k-slider", {
      type: "range",
      min: "0",
      max: String(LOUDEST),
      step: "1",
      "aria-label": "Volume",
      oninput: () => {
        unlock();
        settings.setVolume(Number(slider.value));
        this.#tick();
      },
    });
    const shown = el("output", "k-settings-percent", { "aria-hidden": "true" });
    const row = el(
      "div",
      "k-card k-settings-volume",
      {},
      speaker,
      el("label", "k-name k-settings-label", {}, "Volume", slider),
      shown,
    );
    const paint = (now: Settings): void => {
      speaker.replaceChildren(icon(now.muted ? "mute" : "sound"));
      speaker.setAttribute("aria-label", now.muted ? "Sound off" : "Sound on");
      speaker.setAttribute("aria-pressed", String(!now.muted));
      slider.style.setProperty("--v", `${now.volume}%`);
      slider.setAttribute("aria-valuetext", now.muted ? `${now.volume}%, sound off` : `${now.volume}%`);
      if (document.activeElement !== slider) slider.value = String(now.volume);
      shown.textContent = now.muted ? "Off" : `${now.volume}%`;
      row.classList.toggle("muted", now.muted);
    };
    paint(settings.now);
    this.#drops.push(settings.listen(paint));
    return row;
  }

  /** A tick as the volume slider moves, so the level is heard: no more often than `TICK_MS`. */
  #tick(): void {
    const now = performance.now();
    if (now - this.#lastTick < TICK_MS) return;
    this.#lastTick = now;
    sample(() => sfx.tap());
  }
}

/**
 * Makes the page's settings menu and its gear, and has the page follow the settings other pages
 * change (`settings.follow`), all for as long as `scope` stands. Call once, at the start.
 */
export function settingsMenu(of: MenuOf, scope: Scope): Menu {
  settings.follow(scope);
  return new SettingsMenu(of, scope);
}
