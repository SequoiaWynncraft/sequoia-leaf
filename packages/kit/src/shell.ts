/**
 * How a game that is a place in the town talks to the town. Each game is a page of its own and
 * plays alone when opened directly; inside the town it is shown in a frame over the town, and the
 * two speak through these few messages.
 */

export type ToTown =
  | { readonly town: "leave" }
  /** Something worth a line in the town's feed. */
  | { readonly town: "news"; readonly text: string; readonly tone?: "gold" | "leaf" | "coral" | "rose" }
  /** The game is on screen and ready, so the town can stop covering for it. */
  | { readonly town: "ready" };

export type FromTown =
  /** The town is about to put the game away; save now. */
  | { readonly town: "closing" }
  /** The guild's ledger says the member holds this much Leaf now (the town heard it from their news). */
  | { readonly town: "leaf"; readonly leaf: number }
  /** Leaf's Coins ledger says the member holds this many Coins now (the town's purse changed). */
  | { readonly town: "coins"; readonly coins: number };

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

/** Go back to the town; opened alone, go to where the town lives beside this game. */
export function leave(): void {
  if (inTown()) tell({ town: "leave" });
  else window.location.href = "../town/";
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
/** Leaf, or Coins, as a ledger holds them: a whole number, never below nothing. */
const isLeaf = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;

/** In a game: hear the town. Returns how to stop. */
export function fromTown(fn: (msg: FromTown) => void): () => void {
  const on = (e: MessageEvent): void => {
    if (e.origin !== window.location.origin || !isRecord(e.data)) return;
    const { town, leaf, coins } = e.data;
    if (town === "closing") fn({ town: "closing" });
    else if (town === "leaf" && isLeaf(leaf)) fn({ town: "leaf", leaf });
    else if (town === "coins" && isLeaf(coins)) fn({ town: "coins", coins });
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
    if (d.town === "leave" || d.town === "ready") fn({ town: d.town });
    else if (d.town === "news" && typeof d.text === "string") {
      const tone = d.tone === "leaf" || d.tone === "coral" || d.tone === "rose" || d.tone === "gold" ? d.tone : "gold";
      fn({ town: "news", text: d.text, tone });
    }
  };
  window.addEventListener("message", on);
  return () => window.removeEventListener("message", on);
}
