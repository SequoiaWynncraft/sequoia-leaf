/**
 * The letter that says what the yard did while the member was away, as Leaf worked it out (the
 * yard's `away`). It is read on paper, a line at a time; putting it away pays the till into the
 * purse.
 */

import { el, icon } from "@sequoia-leaf/kit/dom.ts";
import { sfx } from "@sequoia-leaf/kit/sound.ts";
import { type Away, AWAY_MOST_MS } from "@sequoia-leaf/yard";

import { yardSfx } from "../sound.ts";
import { collect } from "../yard.ts";
import { coinsFrom } from "./notes.ts";
import { $, centre } from "./parts.ts";

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

export function showLetter(away: Away, done: () => void): void {
  const root = $("letter");
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
  if (lines.length === 0)
    line(icon("heart"), el("span", "k-grow", { text: "The yard stood quiet. Nothing was coming in when you left." }));
  const capped =
    away.seconds >= AWAY_MOST_MS / 1000
      ? ` It works ${AWAY_MOST_MS / 3_600_000} hours unwatched, and then waits for you.`
      : "";
  const go = el("button", "k-btn wide", { type: "button", text: "Back to work" });
  const paper = el(
    "div",
    "k-paper k-rise letter",
    { role: "dialog", "aria-label": "While you were away" },
    el("h1", "k-title big", { text: "While you were away" }),
    el("div", "k-dim", { text: `The yard worked on for ${span(away.seconds)}.${capped}` }),
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
    const paid = collect();
    const got = "refused" in paid ? 0 : (paid.coins ?? []).reduce((sum, c) => sum + c.amount, 0);
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
