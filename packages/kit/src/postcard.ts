/**
 * What a game tells the town about itself while nobody is in it. A game is a page of its own, and
 * the town cannot look inside it; so each game leaves a postcard in the browser whenever something
 * the town would mention changes, and the town reads the latest one.
 */

export type Sender = "works" | "raid";

export interface Postcard {
  /** What is waiting there, in a line, for the card on the game's door. */
  readonly waiting: string;
  /** Things won or built there that a camp can show, by the game's own names for them. */
  readonly trophies: readonly string[];
  /** Coins earned there and not yet collected. */
  readonly till: number;
}

const key = (from: Sender): string => `town.postcard.${from}.v1`;

export function post(from: Sender, card: Postcard): void {
  try {
    localStorage.setItem(key(from), JSON.stringify(card));
  } catch {
    // Nowhere to leave it; the town says its usual line.
  }
}

/** The latest postcard from a game, or null if it has never sent one (or sent nonsense). */
export function read(from: Sender): Postcard | null {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(key(from)) ?? "null");
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
