/**
 * What the table keeps in the browser: how fast the member watches a fight, and which of the
 * first-time nudges they have already had. Nothing of the game: the run, the almanac, the looks and
 * the trail picked are Leaf's, and the page only ever holds a copy. It is text with a version on
 * it; text that is not this version's starts over, and inside it each part that makes no sense is
 * put back to how a new member has it. (An older page kept more under the same name; only these
 * two parts of it are read.)
 */

import { keepText, keptText } from "@sequoia-leaf/kit/keep.ts";

import { NUDGES } from "./logic.ts";

export const PREFS_VERSION = 1;
export const PREFS_KEY = "raid.prefs.v1";

export type Speed = 1 | 2 | 4;

export interface Prefs {
  speed: Speed;
  /** Nudges already given, by name. */
  taught: string[];
}

export const newPrefs = (): Prefs => ({ speed: 1, taught: [] });

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export const savePrefs = (prefs: Prefs): string =>
  JSON.stringify({ game: "little-raid-prefs", v: PREFS_VERSION, prefs });

/** Prefs from text. Anything that is not this version's gives a new member's prefs. */
export function loadPrefs(text: string | null): Prefs {
  const fresh = newPrefs();
  let raw: unknown;
  try {
    raw = JSON.parse(text ?? "null");
  } catch {
    return fresh;
  }
  if (!isRecord(raw) || raw.game !== "little-raid-prefs" || raw.v !== PREFS_VERSION || !isRecord(raw.prefs)) {
    return fresh;
  }
  const p = raw.prefs;
  const prefs: Prefs = fresh;
  if (p.speed === 1 || p.speed === 2 || p.speed === 4) prefs.speed = p.speed;
  if (Array.isArray(p.taught)) {
    for (const name of p.taught) {
      if (
        typeof name === "string" &&
        // Only nudges the game still has: an old name must not take the place of a real one.
        NUDGES.some((known) => known === name) &&
        !prefs.taught.includes(name)
      )
        prefs.taught.push(name);
    }
  }
  return prefs;
}

/** The prefs kept in this browser, or a new member's. */
export const readPrefs = (): Prefs => loadPrefs(keptText(PREFS_KEY));
/** Keeps the prefs. Without storage, or once the page has stopped, they simply do not last. */
export function keepPrefs(prefs: Prefs): void {
  keepText(PREFS_KEY, savePrefs(prefs));
}
