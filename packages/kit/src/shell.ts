/**
 * How a game that is a place in the town talks to the town. Each game is a page of its own and
 * plays alone when opened directly; inside the town it is shown in a frame over the town, and the
 * two speak through these few messages.
 */

import { type Balances, readBalances } from "@sequoia-leaf/core";

export type ToTown =
  /** Back to the town; with `camp`, on to that player's camp. */
  | { readonly town: "leave"; readonly camp?: string }
  /** Something worth a line in the town's feed. */
  | { readonly town: "news"; readonly text: string; readonly tone?: "gold" | "leaf" | "coral" | "rose" }
  /** The game is on screen and ready, so the town can stop covering for it. */
  | { readonly town: "ready" }
  /** Leaf's newest word on the member's balances, as the game heard it (`purse.ts`). */
  | { readonly town: "purse"; readonly purse: Balances };

export type FromTown =
  /** The town is about to put the game away; save now. */
  | { readonly town: "closing" }
  /** Leaf's newest word on the member's balances, as the town heard it (`purse.ts`). */
  | { readonly town: "purse"; readonly purse: Balances };

/** True when this page is running inside the town. */
export const inTown = (): boolean => {
  try {
    return window.parent !== window && window.parent.location.origin === window.location.origin;
  } catch {
    return false;
  }
};

export function tell(msg: ToTown): void {
  if (inTown()) window.parent.postMessage(msg, window.location.origin);
}

/** Go back to the town (with `camp`, on to that player's camp); opened alone, go to where the town lives beside this game. */
export function leave(camp?: string): void {
  if (inTown()) tell(camp === undefined ? { town: "leave" } : { town: "leave", camp });
  else window.location.href = camp === undefined ? "../town/" : `../town/?camp=${encodeURIComponent(camp)}`;
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
export function fromGame(frame: HTMLIFrameElement, fn: (msg: ToTown) => void): () => void {
  const on = (e: MessageEvent): void => {
    if (e.origin !== window.location.origin || e.source !== frame.contentWindow || !isRecord(e.data)) return;
    const d = e.data;
    if (d.town === "leave") fn(typeof d.camp === "string" ? { town: "leave", camp: d.camp } : { town: "leave" });
    else if (d.town === "ready") fn({ town: "ready" });
    else if (d.town === "purse") {
      const purse = readBalances(d.purse);
      if (purse) fn({ town: "purse", purse });
    } else if (d.town === "news" && typeof d.text === "string") {
      const tone = d.tone === "leaf" || d.tone === "coral" || d.tone === "rose" || d.tone === "gold" ? d.tone : "gold";
      fn({ town: "news", text: d.text, tone });
    }
  };
  window.addEventListener("message", on);
  return () => window.removeEventListener("message", on);
}
