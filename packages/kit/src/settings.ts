/**
 * The player's settings for how this device plays: how loud, whether the sound is off, which kinds
 * of sound are switched off, and which keyboard they have. They are kept in this browser (`keep.ts`), so the town and every
 * game on this device share them, and an open page hears another page's change at once through the
 * browser's `storage` event: the town, a game in its frame, another tab. None of it is the player's
 * game; that is Leaf's.
 *
 * Each setting has a key of its own, so that one page moving the volume never undoes another page's
 * mute. Mute keeps the key it had before there was a volume (`town.muted`), so nobody's mute is lost.
 */
import { keepText, keptText } from "./keep.ts";
import type { Scope } from "./scope.ts";

/** Where each setting is kept. */
export const SETTING_KEYS = {
  volume: "leaf.settings.volume.v1",
  muted: "town.muted",
  quiet: "leaf.settings.quiet.v1",
  keyboard: "leaf.settings.keyboard.v1",
} as const;

/** The loudest the volume goes, and where it starts: as loud as the games have always been. */
export const LOUDEST = 100;
/** The most kinds of sound kept switched off, and the longest id kept: a guard against junk, far above what the games have. */
const QUIET_MOST = 200;
const ID_LONGEST = 64;

/** The settings as they stand. */
export interface Settings {
  /** How loud, 0 to `LOUDEST`. */
  readonly volume: number;
  /** Sound off, whatever the volume: turning it on again brings back the volume it had. */
  readonly muted: boolean;
  /** The kinds of sound switched off, by id (`sound.ts`). */
  readonly quiet: ReadonlySet<string>;
  /** The keyboard the player chose, by its id (`keyboard.ts` says which there are); none until they have. */
  readonly keyboard: string | null;
}

/** A volume as kept, or `LOUDEST` for none or anything else. */
export function readVolume(text: string | null): number {
  const n = text === null || text.trim() === "" ? Number.NaN : Number(text);
  return Number.isInteger(n) && n >= 0 && n <= LOUDEST ? n : LOUDEST;
}

/** The kinds of sound switched off as kept: a list of ids, anything else in it let go. */
export function readQuiet(text: string | null): Set<string> {
  let raw: unknown;
  try {
    raw = JSON.parse(text ?? "[]");
  } catch {
    return new Set();
  }
  if (!Array.isArray(raw)) return new Set();
  const ids = raw.filter((id): id is string => typeof id === "string" && id.length > 0 && id.length <= ID_LONGEST);
  return new Set(ids.slice(0, QUIET_MOST));
}

const read = (): Settings => ({
  volume: readVolume(keptText(SETTING_KEYS.volume)),
  muted: keptText(SETTING_KEYS.muted) === "1",
  quiet: readQuiet(keptText(SETTING_KEYS.quiet)),
  keyboard: keptText(SETTING_KEYS.keyboard),
});

const same = (a: Settings, b: Settings): boolean =>
  a.volume === b.volume &&
  a.muted === b.muted &&
  a.keyboard === b.keyboard &&
  a.quiet.size === b.quiet.size &&
  [...a.quiet].every((id) => b.quiet.has(id));

/**
 * The settings of this page, kept and shared. A change made here is told to this page's listeners
 * at once and kept; one made on another page is heard once `follow` has been called.
 */
class Store {
  #now: Settings = read();
  readonly #listeners = new Set<(now: Settings) => void>();

  /** The settings as they stand now. */
  get now(): Settings {
    return this.#now;
  }

  /** Sets how loud, rounded to a whole number from 0 to `LOUDEST`. */
  setVolume(volume: number): void {
    const v = Math.round(Math.min(LOUDEST, Math.max(0, Number.isFinite(volume) ? volume : LOUDEST)));
    if (v === this.#now.volume) return;
    this.#set({ ...this.#now, volume: v });
    keepText(SETTING_KEYS.volume, String(v));
  }

  setMuted(muted: boolean): void {
    if (muted === this.#now.muted) return;
    this.#set({ ...this.#now, muted });
    keepText(SETTING_KEYS.muted, muted ? "1" : "0");
  }

  /** Keeps the keyboard the player has, by its id. */
  setKeyboard(id: string): void {
    if (id === this.#now.keyboard) return;
    this.#set({ ...this.#now, keyboard: id });
    keepText(SETTING_KEYS.keyboard, id);
  }

  /** Switches one kind of sound (by its id) on or off. */
  setHeard(id: string, heard: boolean): void {
    this.setHeardAll([id], heard);
  }

  /** Switches some kinds of sound on or off together, in one change. */
  setHeardAll(ids: readonly string[], heard: boolean): void {
    const quiet = new Set(this.#now.quiet);
    for (const id of ids) {
      if (id.length === 0 || id.length > ID_LONGEST) continue;
      if (heard) quiet.delete(id);
      else quiet.add(id);
    }
    if (quiet.size === this.#now.quiet.size && [...quiet].every((id) => this.#now.quiet.has(id))) return;
    this.#set({ ...this.#now, quiet });
    keepText(SETTING_KEYS.quiet, quiet.size === 0 ? null : JSON.stringify([...quiet].toSorted()));
  }

  /** Hears every change, this page's own and, once it follows them, other pages'. Gives back how to stop. */
  listen(fn: (now: Settings) => void): () => void {
    this.#listeners.add(fn);
    return () => {
      this.#listeners.delete(fn);
    };
  }

  /**
   * Hears the changes other pages make (the town, a game in its frame, another tab), and reads the
   * settings again as a page comes back from the browser's cache, for as long as `scope` stands.
   * Every page calls it once, at the start. What is heard is told to this page's listeners only:
   * nothing is kept again, nothing is played.
   */
  follow(scope: Scope): void {
    const keys: ReadonlySet<string | null> = new Set([null, ...Object.values(SETTING_KEYS)]);
    scope.on(window, "storage", (e) => {
      const key = e instanceof StorageEvent ? e.key : null;
      if (key === null || keys.has(key)) this.reread();
    });
    scope.on(window, "pageshow", () => {
      this.reread();
    });
  }

  /** Reads the settings again from where they are kept, telling the listeners if they changed. */
  reread(): void {
    const next = read();
    if (!same(next, this.#now)) this.#set(next);
  }

  #set(next: Settings): void {
    this.#now = next;
    for (const fn of this.#listeners) fn(next);
  }
}

/** This page's settings: the one store every part of the page reads and changes. */
export const settings = new Store();
