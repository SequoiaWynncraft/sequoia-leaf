/**
 * The one kept record, read once when the page opens and written back whenever something in it
 * changes: what the member owns and has on, the quests they have claimed, and their camp. The town
 * and the camp both keep their things here (`save.ts` says what is in it).
 */

import { MOST_PARCELS } from "./camp.ts";
import { changed, G, hooks, watch } from "./game.ts";
import { load, store } from "./keep.ts";
import { waiting } from "./mail.ts";
import type { Kept } from "./save.ts";

export const kept: Kept = load();

/** The member's own camp, as kept. */
export const camp = kept.camp;

G.owned = new Set(kept.owned);
G.wearing = new Set(kept.wearing);
G.claimed = new Set(kept.claimed);
G.sightings = kept.sightings;

/** Writes the record back as things stand now. */
export function remember(): void {
  kept.owned = [...G.owned];
  kept.wearing = [...G.wearing].filter((id) => G.owned.has(id));
  kept.claimed = [...G.claimed];
  kept.sightings = G.sightings;
  // Time spent here is not time away.
  if (G.home) kept.lastSeen = Date.now();
  store(kept);
}

/** Whether another parcel may wait by the trail: no more than `MOST_PARCELS` may, so that none is lost. */
export const roomByTrail = (): boolean => camp.parcels.length < MOST_PARCELS;

/**
 * Something bought or won is on its way to the camp: it waits by the trail to be unpacked there.
 * Says whether it went; while the trail is full it does not.
 */
export function sendToCamp(thing: string): boolean {
  if (!roomByTrail()) return false;
  camp.parcels.push(thing);
  changed();
  return true;
}

/**
 * Buys a thing for the camp. `pay` takes the price, and is not asked while the trail is full, so a
 * thing that cannot be sent costs nothing. Says whether it was sent, or why not.
 */
export function buyForCamp(thing: string, pay: () => boolean): "sent" | "full" | "short" {
  if (!roomByTrail()) return "full";
  if (!pay()) return "short";
  return sendToCamp(thing) ? "sent" : "full";
}

hooks.campNews = (): boolean => camp.parcels.length > 0 || waiting(camp.letters) > 0;

if (typeof window !== "undefined") {
  watch(remember);
  window.setInterval(() => {
    if (G.home && !document.hidden) remember();
  }, 20000);
  window.addEventListener("pagehide", () => {
    if (G.home) remember();
  });
}
