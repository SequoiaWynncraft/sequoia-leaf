/**
 * The letter that says what the yard did while the member was away. It is read on paper, a line at
 * a time; putting it away pays what the yard earned into the purse.
 */

import { amount, el, icon } from "@sequoia-leaf/kit/dom.ts";
import { sfx } from "@sequoia-leaf/kit/sound.ts";
import { type Away, AWAY_MOST_MS, ITEM, ITEMS } from "@sequoia-leaf/yard";

import type { Art } from "../art/index.ts";
import { yardSfx } from "../sound.ts";
import { bank, holdTill } from "../yard.ts";
import { coinsFrom } from "./notes.ts";
import { $, centre, pic } from "./parts.ts";

/** How long the yard worked, in words: "3 hours and 20 minutes". */
function span(seconds: number): string {
  const mins = Math.max(1, Math.round(seconds / 60));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const hours = h > 0 ? `${h} hour${h === 1 ? "" : "s"}` : "";
  const minutes = m > 0 || h === 0 ? `${m} minute${m === 1 ? "" : "s"}` : "";
  return hours && minutes ? `${hours} and ${minutes}` : hours || minutes;
}

let put: (() => void) | null = null;

/** Whether the letter is up. */
export const reading = (): boolean => put !== null;

/** Puts the letter away, if it is up. Says whether it was. */
export function putAway(): boolean {
  if (!put) return false;
  put();
  return true;
}

export function showLetter(art: Art, away: Away, done: () => void): void {
  const root = $("letter");
  holdTill(true);
  const made = ITEMS.filter((k) => (away.made[k] ?? 0) > 0)
    .toSorted((a, b) => ITEM[b].step - ITEM[a].step || (away.made[b] ?? 0) - (away.made[a] ?? 0))
    .slice(0, 8);
  const coinArt = icon("coin");
  const lines: HTMLElement[] = [];
  const line = (...kids: (Node | string | null)[]): void => {
    lines.push(el("div", "line", {}, el("hr"), el("div", "k-row", {}, ...kids)));
  };
  if (away.coins > 0)
    line(
      coinArt,
      el("span", "k-grow", { text: "Earned, and waiting in the till" }),
      el("b", "", { text: `+${away.coins.toLocaleString("en-US")}` }),
    );
  if (made.length > 0)
    line(
      el(
        "div",
        "k-grow",
        {},
        "The depot took in",
        el(
          "div",
          "made",
          {},
          ...made.map((k) => el("span", "", {}, pic(art.item(k), 1), (away.made[k] ?? 0).toLocaleString("en-US"))),
        ),
      ),
    );
  for (const title of away.orders.slice(0, 4)) line(icon("check"), el("span", "k-grow", { text: `Filled: ${title}` }));
  if (away.orders.length > 4)
    line(icon("check"), el("span", "k-grow", { text: `and ${away.orders.length - 4} more orders.` }));
  if (away.waiting > 0)
    line(
      icon("star"),
      el("span", "k-grow", { text: "On the board, waiting to be handed over" }),
      amount("coin", away.waiting.toLocaleString("en-US")),
    );
  if (lines.length === 0)
    line(icon("heart"), el("span", "k-grow", { text: "The yard stood quiet. Nothing was coming in when you left." }));
  const shift = away.boosted > 0 ? ` A second shift ran for ${span(away.boosted)} of it.` : "";
  const capped = away.capped ? ` It works ${AWAY_MOST_MS / 3_600_000} hours unwatched, and then waits for you.` : "";
  const go = el("button", "k-btn wide", { type: "button", text: "Back to work" });
  const paper = el(
    "div",
    "k-paper k-rise letter",
    { role: "dialog", "aria-label": "While you were away" },
    el("h1", "k-title big", { text: "While you were away" }),
    el("div", "k-dim", { text: `The yard worked on for ${span(away.seconds)}.${shift}${capped}` }),
    ...lines,
    el("hr"),
    go,
  );
  root.replaceChildren(paper);
  root.classList.remove("gone");
  root.hidden = false;
  lines.forEach((row, i) => {
    setTimeout(
      () => {
        row.classList.add("in");
        if (put) yardSfx.letter();
      },
      380 + i * 280,
    );
  });
  put = (): void => {
    put = null;
    for (const row of lines) row.classList.add("in");
    const from = centre(away.coins > 0 ? coinArt : paper);
    root.classList.add("gone");
    setTimeout(() => {
      root.hidden = true;
      root.replaceChildren();
    }, 350);
    sfx.open();
    holdTill(false);
    const got = bank();
    if (got > 0) coinsFrom(from, got);
    done();
  };
  root.addEventListener(
    "click",
    () => {
      put?.();
    },
    { once: true },
  );
  go.focus({ preventScroll: true });
}
