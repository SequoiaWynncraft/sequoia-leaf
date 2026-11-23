/**
 * The doors into the games. A game is a page of its own; going through its door puts that page in
 * a frame over the whole town. The frame opens out of the spot the view closed in on, and closes
 * back into it. The game says `ready` when it has drawn, `leave` to come back (and on to somebody's
 * camp, if it names one), and `news` for a line in the town's feed; the town says `closing` before
 * it puts the game away, and `leaf` each time the guild's ledger gives the member a new Leaf while
 * the game is open. A game that does not say `ready` (not built, not served) gets a note and a way
 * back instead of an empty frame; one that says it late opens over the note.
 */

import { close as closeCard } from "@sequoia-leaf/kit/card.ts";
import { el, icon } from "@sequoia-leaf/kit/dom.ts";
import { passPurse } from "@sequoia-leaf/kit/live.ts";
import { fromLeaf } from "@sequoia-leaf/kit/purse.ts";
import { fromGame, toGame } from "@sequoia-leaf/kit/shell.ts";
import { noise, sfx, tone } from "@sequoia-leaf/kit/sound.ts";
import { must, type Pt } from "@sequoia-leaf/kit/util.ts";

import { type Game, READY_WAIT } from "./games.ts";
import type { Tone } from "./guild.ts";

export interface Visit {
  /** The view has closed in: from now the frame (or the note) may show, opening out of `at`. */
  arrived(at: Pt): void;
  /** Put the game away now, as if it had asked to leave. */
  leave(): void;
  /** Where things stand, for looking at from outside. */
  state(): "knocking" | "inside" | "shut" | "leaving";
}

export interface Asks {
  /** A line for the town's feed. */
  news(text: string, tone: Tone): void;
  /** The game has been put away: the town may carry on (with `camp`, on to that player's camp, as the game asked). */
  back(camp?: string): void;
}

/** How long the game has to save after it is told the town is closing it, in milliseconds. */
const SAVING = 140;
const OPENING = 460;
const CLOSING = 320;

const clip = (r: number, at: Pt): string => `circle(${r}px at ${Math.round(at.x)}px ${Math.round(at.y)}px)`;

/** A circle on the page big enough to cover it from a point. */
function reach(at: Pt): number {
  return Math.ceil(Math.hypot(Math.max(at.x, window.innerWidth - at.x), Math.max(at.y, window.innerHeight - at.y)));
}

/** Begins going into a game. The frame starts loading at once, out of sight, while the view closes in. */
export function goIn(game: Game, asks: Asks): Visit {
  // A card pinned in town would sit over the game, out of reach of its keys and taps.
  closeCard();
  const root = must(document.getElementById("door"), "door");
  const frame = el("iframe", "door-frame", { title: game.name, src: game.url });
  const sign = el("div", "door-sign k-over", { text: "Knocking..." });
  root.replaceChildren(frame, sign);
  root.hidden = false;
  root.classList.remove("dark");
  sign.hidden = true;

  let state: ReturnType<Visit["state"]> = "knocking";
  let ready = false;
  /** It will not open: its page is not there, or it has had long enough to say it is ready. */
  let hopeless = false;
  let spot: Pt | null = null;
  let waited = 0;
  let signIn = 0;
  /** The camp the game asked to go on to as it left, if any. */
  let onTo: string | undefined;

  function open(): void {
    // A game that was slow to say it is ready (on the guild's server it fetches the member's saves
    // first) still opens, even after the note has gone up.
    if ((state !== "knocking" && state !== "shut") || !spot || !ready) return;
    state = "inside";
    window.clearTimeout(waited);
    window.clearTimeout(signIn);
    sign.hidden = true;
    root.querySelector(".door-note")?.remove();
    frame.classList.add("open");
    const at = spot;
    frame.animate([{ clipPath: clip(0, at) }, { clipPath: clip(reach(at), at) }], {
      duration: OPENING,
      easing: "cubic-bezier(0.3, 0, 0.2, 1)",
    });
    frame.focus();
  }

  /** The note for a game that will not open: what is wrong, kindly, and the way back. */
  function shut(): void {
    hopeless = true;
    if (state !== "knocking" || !spot || ready) return;
    state = "shut";
    window.clearTimeout(signIn);
    sign.hidden = true;
    sfx.knock();
    const back = el("button", "k-btn wide", { type: "button", onclick: leave }, icon("back"), "Back to town");
    const note = el(
      "div",
      "door-note k-paper k-rise",
      { role: "alertdialog", "aria-label": game.shut[0] },
      el("h2", "k-title big", { text: game.shut[0] }),
      el("p", "", { text: game.shut[1] }),
      back,
    );
    root.append(note);
    back.focus();
  }

  function putAway(): void {
    stop();
    purse.stop();
    root.replaceChildren();
    root.hidden = true;
    root.classList.remove("dark");
    asks.back(onTo);
  }

  function leave(): void {
    if (state === "leaving") return;
    const was = state;
    state = "leaving";
    window.clearTimeout(waited);
    window.clearTimeout(signIn);
    toGame(frame, { town: "closing" });
    if (was !== "inside" || !spot) {
      window.setTimeout(putAway, was === "shut" ? 0 : SAVING);
      return;
    }
    const at = spot;
    window.setTimeout(() => {
      noise(0.14, 380, { vol: 0.08, slide: 0.6, q: 2 });
      const shrink = frame.animate([{ clipPath: clip(reach(at), at) }, { clipPath: clip(0, at) }], {
        duration: CLOSING,
        easing: "cubic-bezier(0.6, 0, 0.8, 1)",
        fill: "forwards",
      });
      shrink.addEventListener("finish", putAway);
    }, SAVING);
  }

  // The game and the town each say Leaf's newest word on the member's balances to the other, as
  // each hears it (the town from the member's news and its own answers, the game from its answers).
  const purse = passPurse((word) => {
    toGame(frame, { town: "purse", purse: word });
  });
  const stop = fromGame(frame, (msg) => {
    if (msg.town === "ready") {
      ready = true;
      purse.ready();
      open();
    } else if (msg.town === "leave") {
      onTo = msg.camp;
      leave();
    } else if (msg.town === "purse") fromLeaf(msg.purse);
    else asks.news(msg.text, msg.tone ?? "gold");
  });

  // A page that is not there will never say it is ready: no need to stand at the door waiting.
  void fetch(game.url, { method: "HEAD" }).then((res) => (res.ok ? null : shut()), shut);
  waited = window.setTimeout(shut, READY_WAIT);

  return {
    arrived(at) {
      if (spot) return;
      spot = at;
      root.classList.add("dark");
      if (ready) open();
      else if (hopeless) shut();
      else
        signIn = window.setTimeout(() => {
          if (state !== "knocking") return;
          sign.hidden = false;
          tone(196, 0.05, { vol: 0.08, type: "square" });
          tone(196, 0.05, { vol: 0.08, type: "square", at: 0.16 });
        }, 500);
    },
    leave,
    state: () => state,
  };
}
