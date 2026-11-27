/**
 * The two papers a live table lays over itself: going out (the place, the Coins paid, and watching
 * on or leaving) and the end (every place, the Coins paid, and back to the front page). What the
 * member was paid is the run's own payout (`payout`), as Leaf pays a seat; Leaf pays it within what
 * the member may still earn, and should the purse have grown by less, the paper says so.
 */
import { amount, el, icon } from "@sequoia-leaf/kit/dom.ts";
import { payout, type RunView, summariseRun } from "@sequoia-leaf/raid";
import type { SittingView } from "@sequoia-leaf/raid/sitting/view.ts";

import { glyph } from "../art/icons.ts";
import { snd } from "../sounds.ts";
import { pic } from "../ui/cards.ts";
import { ordinal, placeText, seatName } from "./reads.ts";

export interface PanelAsks {
  /** Stays at the table to watch. */
  watch: () => void;
  /** Back to the front page, done with the table. */
  done: () => void;
}

const P: { box: HTMLElement | null; asks: PanelAsks | null; up: "out" | "end" | null } = {
  box: null,
  asks: null,
  up: null,
};

export function buildPanels(asks: PanelAsks): void {
  P.box = el("div", "", { id: "live-paper", hidden: true });
  P.asks = asks;
  document.body.append(P.box);
}

/** The Coins a run's seat is paid, as the rules count them; and, when the purse grew by less (`gained`), what it took. */
function coinsOf(run: RunView | null, gained: number | null): HTMLElement[] {
  if (!run) return [];
  const coins = payout(summariseRun(run)).coins;
  const lines = [
    el("div", "k-row pay total", {}, el("b", "k-grow", { text: "Coins for this table" }), amount("coin", coins)),
  ];
  if (gained !== null && gained < coins)
    lines.push(el("p", "k-d", { text: `Your purse took ${gained} of them. It has room again within the hour.` }));
  return lines;
}

function paper(title: string, label: string, ...body: (HTMLElement | null)[]): HTMLElement {
  return el(
    "section",
    "k-panel page k-rise live-paper",
    { role: "dialog", "aria-label": label },
    el("header", "k-head", {}, pic(glyph("swords")), el("h1", "k-title", { text: title })),
    el("div", "k-body k-col", {}, ...body),
  );
}

function show(node: HTMLElement, up: "out" | "end"): void {
  if (!P.box) return;
  P.up = up;
  P.box.hidden = false;
  P.box.replaceChildren(node);
  P.box.querySelector<HTMLElement>("button")?.focus({ preventScroll: true });
}

/** Going out: the place, the Coins, and watching on or leaving. */
export function showOut(view: SittingView, gained: number | null): void {
  const mine = view.you === null ? null : view.seats[view.you];
  if (!mine || mine.place === null) return;
  const over = view.stage.at === "over";
  snd.open();
  show(
    paper(
      "You are out",
      "You are out",
      el("p", "k-d", { text: `Your place: ${placeText(mine.place, view.seats.length)}.` }),
      el("p", "k-d", {
        text: over ? "The others played on to the end." : "You may stay and watch the others, or leave the table.",
      }),
      ...coinsOf(view.run, gained),
      el(
        "div",
        "k-wrap ends",
        {},
        el(
          "button",
          "k-btn",
          { type: "button", id: "live-watch", onclick: () => P.asks?.watch() },
          over ? "See the places" : "Watch",
        ),
        el(
          "button",
          "k-btn wood",
          { type: "button", id: "live-leave", onclick: () => P.asks?.done() },
          icon("back"),
          "Leave the table",
        ),
      ),
    ),
    "out",
  );
}

/** The end: every seat by its place (the member's own lit), the Coins, and back to the front page. */
export function showEnd(view: SittingView, gained: number | null): void {
  const mine = view.you === null ? null : view.seats[view.you];
  const places = view.seats
    .map((seat, i) => ({ seat, i }))
    .toSorted((a, b) => (a.seat.place ?? 99) - (b.seat.place ?? 99) || a.i - b.i)
    .map(({ seat, i }) =>
      el(
        "div",
        i === view.you ? "k-card lit board-row" : "board-row",
        {},
        el("span", "place", { text: seat.place === null ? "" : ordinal(seat.place) }),
        el("span", "k-grow", { text: seatName(seat) }),
      ),
    );
  const won = mine?.place === 1;
  snd.open();
  show(
    paper(
      won ? "You won the table" : "The table is over",
      "The table is over",
      mine?.place ? el("p", "k-d", { text: `Your place: ${placeText(mine.place, view.seats.length)}.` }) : null,
      el("div", "k-col tight places", {}, ...places),
      ...(mine ? coinsOf(view.run, gained) : []),
      el(
        "div",
        "k-wrap ends",
        {},
        el(
          "button",
          "k-btn",
          { type: "button", id: "live-done", onclick: () => P.asks?.done() },
          icon("back"),
          "Back to the front page",
        ),
      ),
    ),
    "end",
  );
}

/** Which paper is up, if one is. */
export const paperUp = (): "out" | "end" | null => P.up;
export function hidePaper(): void {
  P.up = null;
  if (!P.box) return;
  P.box.hidden = true;
  P.box.replaceChildren();
}
