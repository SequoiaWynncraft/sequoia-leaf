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

/** Whether a value is a clearing's name as a command carries it: a command's id, or a start's own (`#` and a count). */
export const isStart = (v: unknown): v is string => typeof v === "string" && /^#?[\w.:-]{1,64}$/.test(v);

/**
 * Takes on a plot's clearing, with nothing delivered to it yet, asking for what the table asks for
 * now, for as long as it runs. It is named by the id of the command that took it on (`id`), which the
 * page gives the command before either copy of the yard does it, so the page and Leaf name it alike
 * and no other start, on any page, has its name; a start with no id is named by the count of starts
 * (`Yard.begun`). Says whether it could.
 */
export function takeClearing(y: Yard, p: Plot, id: string): boolean {
  const want = CLEARING[p];
  if (!want || clearRefusal(y, p) !== null) return false;
  y.begun += 1;
  const start = id === "" ? `#${y.begun}` : id;
  y.clearing = { plot: p, start, want: Float64Array.from(want), filled: counts() };
  return true;
}

/** What a plot's clearing asks for: the clearing being done's own, kept from when it began; else the table's now. */
export const clearingWant = (y: Yard, p: Plot): Float64Array | null =>
  y.clearing?.plot === p ? y.clearing.want : (CLEARING[p] ?? null);

/**
 * Why a command for the clearing on plot `p` named `start` cannot be done to the clearing being done
 * now, or nothing if it is that one: as the player saw it, not another taken on since, here or on
 * another page.
 */
export function sameRefusal(y: Yard, p: Plot, start: string): string | null {
  const c = y.clearing;
  if (!c) return "You are clearing no plot";
  return c.plot === p && c.start === start ? null : "That clearing has changed since";
}

/**
 * Stops the clearing being done, if it is the one named and still wants something, giving back
 * nothing delivered to it: one that has all it wants is handed over, never thrown away. Says why it
 * could not, or nothing once it has.
 */
export function stopClearing(y: Yard, p: Plot, start: string): string | null {
  const same = sameRefusal(y, p, start);
  const c = y.clearing;
  if (same !== null || !c) return same ?? "You are clearing no plot";
  if (isFilled(c.want, c.filled)) return "That clearing is complete: hand it over";
  y.clearing = null;
  return null;
}

/** Why the clearing named cannot be handed over just now, or nothing if it can: it is the one being done, and has all it wants. */
export function handRefusal(y: Yard, p: Plot, start: string): string | null {
  const same = sameRefusal(y, p, start);
  const c = y.clearing;
  if (same !== null || !c) return same ?? "You are clearing no plot";
  const want = c.want;
  if (isFilled(want, c.filled)) return null;
  const left = counts();
  for (const k of ALL_ITEMS) left[k] = Math.max(0, (want[k] ?? 0) - (c.filled[k] ?? 0));
  return `${nameOf(y, c.plot)} still wants ${goodsText(left)}`;
}

/** Hands the clearing named over, if it is the one being done and has all it wants: its plot is cleared for good, and can be bought. Says why it could not, or nothing once it has. */
export function handClearing(y: Yard, p: Plot, start: string): string | null {
  const why = handRefusal(y, p, start);
  const c = y.clearing;
  if (why !== null || !c) return why ?? "You are clearing no plot";
  y.cleared.push(c.plot);
  y.clearing = null;
  return null;
}

/** Whether the clearing being done has all it wants, and waits to be handed over. */
export const clearingReady = (y: Yard): boolean =>
  y.clearing !== null && handRefusal(y, y.clearing.plot, y.clearing.start) === null;

/** Whether a plot can be bought now: for sale, and cleared where it needs clearing. */
export const readyToBuy = (y: Yard, p: Plot): boolean => {
  const now = clearingState(y, p);
  return plotState(y, p).state === "for sale" && (now === "none" || now === "cleared");
};
