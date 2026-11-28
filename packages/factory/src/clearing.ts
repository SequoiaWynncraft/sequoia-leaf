/**
 * Clearing a plot: every plot past the first ring is cleared before it is bought, with goods the
 * yard delivers to the depot (`PlotInfo.clearing`, `CLEARING`). A yard clears one plot at a time
 * (`Yard.clearing`), taken on from a plot for sale that touches its land; the depot gives to it after
 * the node in hand and before the side orders (`orders.ts`). Handed over once it has all it wants,
 * the plot is cleared for good (`Yard.cleared`), and only then is it bought, with Coins, at its price
 * then (`plotRefusal`). Stopped, what was delivered to it is not given back.
 *
 * Both copies of a yard clear alike, from the tables and the commands: nothing is drawn from the seed.
 */
import { num } from "@sequoia-leaf/core";

import { plotState } from "./build.ts";
import { isFilled } from "./orders.ts";
import { ALL_ITEMS, CLEARING, ITEM_INFO, type Plot } from "./tables.ts";
import { counts, type Yard } from "./yard.ts";

/** Where a plot's clearing stands: none is needed, it is still to clear, it is being cleared, or it is cleared. */
export type ClearingState = "none" | "to clear" | "clearing" | "cleared";

export function clearingState(y: Yard, p: Plot): ClearingState {
  if (!CLEARING[p]) return "none";
  if (y.cleared.includes(p)) return "cleared";
  return y.clearing?.plot === p ? "clearing" : "to clear";
}

/** A plot's name on the yard's land. */
const nameOf = (y: Yard, p: Plot): string => y.land.plots.find((q) => q.plot === p)?.name ?? "That plot";

/** Goods by how many, in words: "600 lanterns and 900 pipes". */
export function goodsText(want: Float64Array): string {
  const words = ALL_ITEMS.flatMap((k) => {
    const n = want[k] ?? 0;
    return n > 0 ? [`${num(n)} ${ITEM_INFO[k]?.many ?? ""}`] : [];
  });
  const last = words.pop() ?? "";
  return words.length === 0 ? last : `${words.join(", ")} and ${last}`;
}

/** Why a plot's clearing cannot be taken on just now, or nothing if it can. */
export function clearRefusal(y: Yard, p: Plot): string | null {
  const { state, why } = plotState(y, p);
  if (state === "owned") return "You already own that plot";
  if (state === "not yet") return why;
  const now = clearingState(y, p);
  if (now === "none") return `${nameOf(y, p)} needs no clearing`;
  if (now === "cleared") return `${nameOf(y, p)} is cleared already`;
  return y.clearing ? `You are clearing ${nameOf(y, y.clearing.plot)} already` : null;
}

/** Takes on a plot's clearing, with nothing delivered to it yet, numbered as the next the yard begins. Says whether it could. */
export function takeClearing(y: Yard, p: Plot): boolean {
  if (clearRefusal(y, p) !== null) return false;
  y.begun += 1;
  y.clearing = { plot: p, begun: y.begun, filled: counts() };
  return true;
}

/**
 * Why a command for the clearing on plot `p`, the `begun`th the yard began, cannot be done to the
 * clearing being done now, or nothing if it is that one: as the player saw it, not another begun since.
 */
export function sameRefusal(y: Yard, p: Plot, begun: number): string | null {
  const c = y.clearing;
  if (!c) return "You are clearing no plot";
  return c.plot === p && c.begun === begun ? null : "That clearing has changed since";
}

/** Stops the clearing being done, if it is the one named, giving back nothing delivered to it. Says whether it did. */
export function stopClearing(y: Yard, p: Plot, begun: number): boolean {
  if (sameRefusal(y, p, begun) !== null) return false;
  y.clearing = null;
  return true;
}

/** Why the clearing named cannot be handed over just now, or nothing if it can: it is the one being done, and has all it wants. */
export function handRefusal(y: Yard, p: Plot, begun: number): string | null {
  const same = sameRefusal(y, p, begun);
  const c = y.clearing;
  const want = c ? CLEARING[c.plot] : null;
  if (same !== null || !c || !want) return same ?? "You are clearing no plot";
  if (isFilled(want, c.filled)) return null;
  const left = counts();
  for (const k of ALL_ITEMS) left[k] = Math.max(0, (want[k] ?? 0) - (c.filled[k] ?? 0));
  return `${nameOf(y, c.plot)} still wants ${goodsText(left)}`;
}

/** Hands the clearing named over, if it is the one being done: its plot is cleared for good, and can be bought. Says whether it could. */
export function handClearing(y: Yard, p: Plot, begun: number): boolean {
  const c = y.clearing;
  if (!c || handRefusal(y, p, begun) !== null) return false;
  y.cleared.push(c.plot);
  y.clearing = null;
  return true;
}

/** Whether the clearing being done has all it wants, and waits to be handed over. */
export const clearingReady = (y: Yard): boolean =>
  y.clearing !== null && handRefusal(y, y.clearing.plot, y.clearing.begun) === null;

/** Whether a plot can be bought now: for sale, and cleared where it needs clearing. */
export const readyToBuy = (y: Yard, p: Plot): boolean => {
  const now = clearingState(y, p);
  return plotState(y, p).state === "for sale" && (now === "none" || now === "cleared");
};
