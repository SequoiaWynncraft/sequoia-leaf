/**
 * The letter that says what the yard did while the member was away, as Leaf counted it (the
 * yard's `away`): how long it worked, the Coins it earned, what the depot took in most of, the
 * lessons, projects and commissions finished meanwhile and the research that became known (the
 * rules' `finishedSince` and `knownSince`), and the orders waiting to be handed over. It is read on paper, a line at a time; putting it away pays the till into the purse.
 */

import { ALL_ITEMS, type Away, finishedSince, isFilled, knownSince, TICK_MS } from "@sequoia-leaf/factory";
import { el, icon } from "@sequoia-leaf/kit/dom.ts";
import type { Scope } from "@sequoia-leaf/kit/scope.ts";
import { sfx } from "@sequoia-leaf/kit/sound.ts";

import { yardSfx } from "../sound.ts";
import { S } from "../state.ts";
import { collect } from "../yard.ts";
import { itemRef, orderRef } from "./card.ts";
import { counted, goals, type Listed } from "./goal.ts";
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

/** Where the letter is: put away; up and being read; or going, its paper fading. */
type Letter =
  | { readonly at: "hidden" }
  | { readonly at: "reading"; readonly scope: Scope; readonly put: () => void }
  | { readonly at: "fading"; readonly scope: Scope };

const HIDDEN: Letter = { at: "hidden" };

/** The page's letter: one at a time, each held in a scope of its own, which goes as it changes. */
export interface Letters {
  /** Whether the letter is up. */
  reading(): boolean;
  /** Puts the letter away, if it is up. Says whether it was. */
  putAway(): boolean;
  /** Shows the letter for what the yard did while the member was away; `done` once it is put away. */
  show(away: Away, done: () => void): void;
}

export function letters(owner: Scope): Letters {
  let letter: Letter = HIDDEN;
  /** Every change of the letter goes through here: the letter it leaves lets go of all it held. */
  const to = (next: Letter): void => {
    if (letter.at !== "hidden" && letter !== next) letter.scope.close();
    letter = next;
  };
  const putAway = (): boolean => {
    if (letter.at !== "reading") return false;
    const { put } = letter;
    const root = $("letter");
    const fading = owner.child();
    to({ at: "fading", scope: fading });
    root.classList.add("gone");
    fading.after(350, () => {
      root.hidden = true;
      root.replaceChildren();
      to(HIDDEN);
    });
    put();
    return true;
  };
  return {
    reading: () => letter.at === "reading",
    putAway,
    show(away, done) {
      // A letter up or fading makes way first: its timers and its click go with it.
      to(HIDDEN);
      const scope = owner.child();
      const put = write(scope, away, done);
      scope.on($("letter"), "click", putAway);
      to({ at: "reading", scope, put });
    },
  };
}

/** Writes the letter on the page, its lines coming one at a time while `scope` lasts; gives back what putting it away does. */
function write(scope: Scope, away: Away, done: () => void): () => void {
  const root = $("letter");
  const coinArt = icon("coin");
  const lines: HTMLElement[] = [];
  const line = (...kids: (Node | string | null)[]): void => {
    lines.push(el("div", "line", {}, el("hr"), el("div", "k-row", {}, ...kids)));
  };
  /** A list of things under a small word saying what they are, one a line. */
  const list = (made: Listed | null): void => {
    if (made) lines.push(el("div", "line", {}, el("hr"), made.node));
  };
  if (away.coins > 0)
    line(
      coinArt,
      el("span", "k-grow", { text: "Earned" }),
      el("b", "", { text: `+${away.coins.toLocaleString("en-US")}` }),
    );
  const most = ALL_ITEMS.filter((k) => (away.made[k] ?? 0) > 0)
    .toSorted((a, b) => (away.made[b] ?? 0) - (away.made[a] ?? 0))
    .slice(0, 5);
  list(
    counted(
      "The depot took in",
      most.map((k) => [itemRef(k), (away.made[k] ?? 0).toLocaleString("en-US")] as const),
    ),
  );
  if (lines.length === 0) line(icon("heart"), el("span", "k-grow", { text: "Nothing reached the depot." }));
  // What the yard finished while nobody watched, and what the Studies made known: each a thing that
  // says what it unlocked.
  list(goals("Finished", finishedSince(S.world)));
  list(goals("Became known", knownSince(S.world)));
  list(
    counted(
      "To hand over",
      S.world.board.flatMap((o, slot) =>
        isFilled(o.want, o.filled) ? [[orderRef(slot), `${o.pay.toLocaleString("en-US")} Coins`] as const] : [],
      ),
    ),
  );
  const mostMs = S.world.open.away * TICK_MS;
  const capped =
    away.seconds >= mostMs / 1000
      ? ` Then it stopped: it works for at most ${mostMs / 3_600_000} hours while you are away.`
      : "";
  const go = el("button", "k-btn wide", { type: "button", text: "Back to work" });
  const paper = el(
    "div",
    "k-paper k-rise letter",
    { role: "dialog", "aria-label": "While you were away" },
    el("h1", "k-title big", { text: "While you were away" }),
    el("div", "k-dim", { text: `The yard worked for ${span(away.seconds)}.${capped}` }),
    ...lines,
    el("hr"),
    go,
  );
  root.replaceChildren(paper);
  root.classList.remove("gone");
  root.hidden = false;
  lines.forEach((row, i) => {
    scope.after(380 + i * 280, () => {
      row.classList.add("in");
      yardSfx.letter();
    });
  });
  go.focus({ preventScroll: true });
  return () => {
    for (const row of lines) row.classList.add("in");
    const from = centre(away.coins > 0 ? coinArt : paper);
    sfx.open();
    const paid = collect();
    const got = "refused" in paid ? 0 : (paid.coins ?? []).reduce((sum, c) => sum + c.amount, 0);
    if (got > 0) coinsFrom(from, got);
    done();
  };
}
