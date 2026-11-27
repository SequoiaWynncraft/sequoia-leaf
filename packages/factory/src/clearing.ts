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

/** Takes on a plot's clearing, with nothing delivered to it yet. Says whether it could. */
export function takeClearing(y: Yard, p: Plot): boolean {
  if (clearRefusal(y, p) !== null) return false;
  y.clearing = { plot: p, filled: counts() };
  return true;
}

/** Stops the clearing being done, giving back nothing delivered to it. Says whether there was one. */
export function stopClearing(y: Yard): boolean {
  const was = y.clearing !== null;
  y.clearing = null;
  return was;
}

/** Why the clearing being done cannot be handed over just now, or nothing if it can. */
export function handRefusal(y: Yard): string | null {
  const c = y.clearing;
  const want = c ? CLEARING[c.plot] : null;
  if (!c || !want) return "You are clearing no plot";
  if (isFilled(want, c.filled)) return null;
  const left = counts();
  for (const k of ALL_ITEMS) left[k] = Math.max(0, (want[k] ?? 0) - (c.filled[k] ?? 0));
  return `${nameOf(y, c.plot)} still wants ${goodsText(left)}`;
}

/** Hands the clearing being done over: its plot is cleared for good, and can be bought. Says whether it could. */
export function handClearing(y: Yard): boolean {
  const c = y.clearing;
  if (!c || handRefusal(y) !== null) return false;
  y.cleared.push(c.plot);
  y.clearing = null;
  return true;
}

/** Whether the clearing being done has all it wants, and waits to be handed over. */
export const clearingReady = (y: Yard): boolean => y.clearing !== null && handRefusal(y) === null;

/** Whether a plot can be bought now: for sale, and cleared where it needs clearing. */
export const readyToBuy = (y: Yard, p: Plot): boolean => {
  const now = clearingState(y, p);
  return plotState(y, p).state === "for sale" && (now === "none" || now === "cleared");
};
