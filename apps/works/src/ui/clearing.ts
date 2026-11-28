/**
 * The plot being cleared, as Orders shows it above the side orders: what it wants, each a picture, a
 * bar and a count kept up to date; its Hand over once everything is delivered, else its Stop, which
 * asks first, saying that what was delivered is not given back (`clearing.ts` in the rules).
 */
import { CLEARING, clearingReady, type Counts, type Plot, plotPrice } from "@sequoia-leaf/factory";
import { asking, asksAgain, el, pressedTwice } from "@sequoia-leaf/kit/dom.ts";
import { coinsText } from "@sequoia-leaf/kit/say.ts";
import type { Scope } from "@sequoia-leaf/kit/scope.ts";

import { handClearing, stopClearing } from "../plots.ts";
import { pressKey, S } from "../state.ts";
import { type Listed, wantsIn, wantsOrder } from "./goal.ts";
import { button } from "./parts.ts";

/** The plot being cleared, as Orders prints it: which, whether everything is delivered, and what buying it costs now. */
export function clearingLine(): {
  readonly plot: Plot;
  readonly begun: number;
  readonly name: string;
  readonly full: boolean;
  readonly price: number;
} | null {
  const w = S.world;
  const c = w.clearing;
  const plot = c ? w.land.plots.find((p) => p.plot === c.plot) : undefined;
  return c && plot
    ? { plot: c.plot, begun: c.begun, name: plot.name, full: clearingReady(w), price: plotPrice(w, c.plot) }
    : null;
}

/** What has been delivered to the plot being cleared, as it is now. */
const filled = (): Counts | null => S.world.clearing?.filled ?? null;

/** Stopping the clearing, as a spend to be pressed twice for: one key for that clearing as it stands. */
const stopKey = (plot: Plot, begun: number): ReturnType<typeof pressKey> => pressKey(`stop-clearing:${plot}:${begun}`);

/**
 * The card of the plot being cleared, its rows put in `live` to be kept up to date; nothing while no
 * plot is being cleared. `again` draws Orders again, for Stop's question.
 */
export function clearingCard(life: Scope, again: () => void, live: Listed[]): HTMLElement[] {
  const line = clearingLine();
  const want = line ? CLEARING[line.plot] : null;
  if (!line || !want) return [];
  const rows = wantsOrder(wantsIn(want), filled);
  if (rows) live.push(rows);
  const ask = stopKey(line.plot, line.begun);
  const act = line.full
    ? button("sm", ["Hand over"], () => void handClearing(line.plot, line.begun))
    : button(`wood sm${asking(ask) ? " asking" : ""}`, [asksAgain(ask, ["Stop"], "Stop?")], () => {
        if (pressedTwice(life, ask, again)) stopClearing(line.plot, line.begun);
      });
  const node = el(
    "div",
    line.full ? "k-card order clearing ready" : "k-card order clearing",
    { "data-order": "clearing" },
    el("div", "k-row", {}, el("div", "k-name", { text: `Clearing ${line.name}` }), act),
    rows?.node ?? null,
    el("div", "k-d", {
      text: asking(ask)
        ? `Stop clearing ${line.name}? The goods delivered are not given back.`
        : `Once it is handed over, it can be bought for ${coinsText(line.price)}.`,
    }),
  );
  return [node];
}
