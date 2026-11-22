/**
 * The quest board kept in step with the quests. Each note is drawn for one quest and brought up to
 * date in place as it moves. When the quests themselves are no longer the ones on the board (one
 * expired, or was swapped from another page, and another took its slot), the board is drawn again
 * whole, so that no note is left up for a quest that is gone.
 *
 * The board's news (`notes.ts`) is unread while its newest note is not the one the member last
 * opened, which the browser keeps under `town.notes.seen`.
 */

import { keepText, keptText } from "@sequoia-leaf/kit/keep.ts";

import { NOTES } from "./notes.ts";

/** Quest ids as a set, written out the same whatever order they came in. */
const setOf = (ids: readonly string[]): string => [...new Set(ids)].toSorted((a, b) => a.localeCompare(b)).join("\n");

/**
 * A board drawn by `draw`, which gives back how to bring what it drew up to date. The function
 * given back draws the board again whole when the ids `ids` gives are not the set it was last drawn
 * for, and otherwise brings it up to date in place.
 */
export function redrawn(ids: () => readonly string[], draw: () => () => void): () => void {
  let shown = setOf(ids());
  let update = draw();
  return () => {
    const now = setOf(ids());
    if (now !== shown) {
      shown = now;
      update = draw();
    }
    update();
  };
}

export const SEEN = "town.notes.seen";

/** Whether there is news on the board the member has not opened. */
export const unread = (): boolean => NOTES[0] !== undefined && NOTES[0].id !== keptText(SEEN);

/** The member has opened the news: all of it is read. */
export function readNews(): void {
  if (unread()) keepText(SEEN, NOTES[0]?.id ?? null);
}

/** The board's tabs, in order. */
export const TABS = ["Quests", "News"] as const;

/** The tab the board opens on: News while there is news unread, and Quests otherwise. */
export const openingTab = (): (typeof TABS)[number] => (unread() ? "News" : "Quests");

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/**
 * When a note went live as the board shows it, in the reader's own time: "22 Nov, 20:09". An old
 * note has only its day: "22 Nov". `zone` is for the tests.
 */
export function noteWhen(at: string, zone?: string): string {
  if (at.includes("T"))
    return new Intl.DateTimeFormat("en-GB", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      timeZone: zone,
    }).format(new Date(at));
  const [, month, date] = at.split("-");
  return `${Number(date)} ${MONTHS[Number(month) - 1] ?? ""}`;
}
