/**
 * How a game that is a place in the town talks to the town. Each game is a page of its own and
 * plays alone when opened directly; inside the town it is shown in a frame over the town, and the
 * two speak through these few messages.
 */

import { type Balances, readBalances } from "@sequoia-leaf/core";

import { withLaunch } from "./launch.ts";

export type ToTown =
  /** Back to the town; with `camp`, on to that player's camp. */
  | { readonly town: "leave"; readonly camp?: string }
  /** Something worth a line in the town's feed. */
  | { readonly town: "news"; readonly text: string; readonly tone?: "gold" | "leaf" | "coral" | "rose" }
  /** The game is on screen and ready, so the town can stop covering for it. */
  | { readonly town: "ready" }
  /** Leaf's newest word on the member's balances, as the game heard it (`purse.ts`). */
  | { readonly town: "purse"; readonly purse: Balances }
  /** In a Discord call, an address to open outside Discord, which only the page Discord frames, the town, can ask it to. */
  | { readonly town: "open"; readonly url: string };

export type FromTown =
  /** The town is about to put the game away; save now. */
  | { readonly town: "closing" }
  /** Leaf's newest word on the member's balances, as the town heard it (`purse.ts`). */
  | { readonly town: "purse"; readonly purse: Balances };

/**
 * True when this page is running inside the town: in its door's frame (`#door`), which only a page
 * of Leaf's own origin can see. A page of Leaf's framed by anything else (Discord's apps, or a page
 * standing in for them on Leaf's origin) is not.
 */
export const inTown = (): boolean => {
  try {
    return typeof window !== "undefined" && (window.frameElement?.closest("#door") ?? null) !== null;
  } catch {
    return false;
  }
};

export function tell(msg: ToTown): void {
  if (inTown()) window.parent.postMessage(msg, window.location.origin);
}

/**
 * Go back to the town (with `camp`, on to that player's camp); opened alone, go to where the town
 * lives beside this game, in a Discord call with the launch (`withLaunch`).
 */
export function leave(camp?: string): void {
  if (inTown()) tell(camp === undefined ? { town: "leave" } : { town: "leave", camp });
  else {
    const town = camp === undefined ? "../town/" : `../town/?camp=${encodeURIComponent(camp)}`;
    window.location.assign(withLaunch(town, window.location.href));
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

/** In a game: hear the town. Returns how to stop. */
export function fromTown(fn: (msg: FromTown) => void): () => void {
  const on = (e: MessageEvent): void => {
    if (e.origin !== window.location.origin || !isRecord(e.data)) return;
    const purse = e.data.town === "purse" ? readBalances(e.data.purse) : null;
    if (e.data.town === "closing") fn({ town: "closing" });
    else if (purse) fn({ town: "purse", purse });
  };
  window.addEventListener("message", on);
  return () => window.removeEventListener("message", on);
}

/** In the town: say something to a game in a frame. */
export function toGame(frame: HTMLIFrameElement, msg: FromTown): void {
  frame.contentWindow?.postMessage(msg, window.location.origin);
}

/** In the town: hear a game in a frame. Returns how to stop. */
/** A line's tone in the feed, as a game names it; gold for anything else. */
const toneOf = (v: unknown): "gold" | "leaf" | "coral" | "rose" =>
  v === "leaf" || v === "coral" || v === "rose" ? v : "gold";

/** What a game says to the town, read; null for anything that is not one of its messages. */
function readToTown(d: Record<string, unknown>): ToTown | null {
  if (d.town === "leave") return typeof d.camp === "string" ? { town: "leave", camp: d.camp } : { town: "leave" };
  if (d.town === "ready") return { town: "ready" };
  if (d.town === "open") return typeof d.url === "string" ? { town: "open", url: d.url } : null;
  if (d.town === "purse") {
    const purse = readBalances(d.purse);
    return purse ? { town: "purse", purse } : null;
  }
  return d.town === "news" && typeof d.text === "string" ? { town: "news", text: d.text, tone: toneOf(d.tone) } : null;
}

export function fromGame(frame: HTMLIFrameElement, fn: (msg: ToTown) => void): () => void {
  const on = (e: MessageEvent): void => {
    if (e.origin !== window.location.origin || e.source !== frame.contentWindow || !isRecord(e.data)) return;
    const msg = readToTown(e.data);
    if (msg) fn(msg);
  };
  window.addEventListener("message", on);
  return () => window.removeEventListener("message", on);
}
