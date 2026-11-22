/**
 * What a game tells the town about itself while nobody is in it. A game is a page of its own, and
 * the town cannot look inside it; so each game leaves a postcard in the browser whenever something
 * the town would mention changes, and the town reads the latest one.
 */

import type { Postcard } from "@sequoia-leaf/core";

import { keepText, keptText } from "./keep.ts";

export type Sender = "works" | "raid";

/** Where a game's postcard is kept. */
const cardKey = (from: Sender): string => `town.postcard.${from}.v1`;

/** Leaves a postcard. Where there is nowhere to leave it, the town says its usual line. */
export function post(from: Sender, card: Postcard): void {
  keepText(cardKey(from), JSON.stringify(card));
}

/** The latest postcard from a game, or null if it has never sent one (or sent nonsense). */
export function read(from: Sender): Postcard | null {
  try {
    const raw: unknown = JSON.parse(keptText(cardKey(from)) ?? "null");
    if (typeof raw !== "object" || raw === null) return null;
    if (!("waiting" in raw) || !("trophies" in raw) || !("till" in raw)) return null;
    const { waiting, trophies, till } = raw;
    if (typeof waiting !== "string" || typeof till !== "number" || !(till >= 0) || !Array.isArray(trophies))
      return null;
    return {
      waiting: waiting.slice(0, 120),
      trophies: trophies.filter((t): t is string => typeof t === "string").slice(0, 32),
      till: Math.floor(till),
    };
  } catch {
    return null;
  }
}
