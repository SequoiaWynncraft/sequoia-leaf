/** What the yard says in passing: the purse and Coins flying to it, a line of news, and the notice when the node in hand is finished. */

import { type Goal, GOALS, isNode, NODES } from "@sequoia-leaf/factory";
import { amount, el, icon, replay } from "@sequoia-leaf/kit/dom.ts";
import { fly, type PurseBar, purseBar } from "@sequoia-leaf/kit/pursebar.ts";
import { whole } from "@sequoia-leaf/kit/say.ts";
import { sfx } from "@sequoia-leaf/kit/sound.ts";
import type { Pt } from "@sequoia-leaf/kit/util.ts";

import { coins } from "../yard.ts";
import { head, leaves, some, unlocks } from "./goal.ts";
import { $, button, iconButton, pic, wantWords } from "./parts.ts";
import { nextUp, nextWords } from "./standing.ts";

let bar: PurseBar | null = null;

export function initNotes(): void {
  // The Works shows the Coins as Leaf will count them for a price: the purse's, and the till's whole Coins.
  bar = purseBar($("purse"), coins);
}

export function tickNotes(dt: number): void {
  bar?.tick(dt);
}

/** Where a currency's icon is in the purse, for things to fly to and from. */
export const purseAt = (currency: "leaf" | "coins"): Pt => bar?.at(currency) ?? { x: 30, y: 30 };

/** Coins fly from a spot on the page into the purse. */
export function coinsFrom(from: Pt, pay: number): void {
  fly("coin", from, purseAt("coins"), Math.max(3, Math.min(9, Math.round(pay / 60) + 3)), () => {
    bar?.bump("coins");
  });
}

export type Tone = "gold" | "leaf" | "coral" | "rose";

/** A line of news, said once in the corner and then gone. */
export function feed(text: string, tone: Tone = "gold"): void {
  if (!text) return;
  const f = $("feed");
  const row = el("div", tone === "gold" ? "k-toast" : `k-toast ${tone}`, { text });
  f.append(row);
  while (f.children.length > 3) f.firstElementChild?.remove();
  setTimeout(() => {
    row.classList.add("gone");
  }, 6500);
  setTimeout(() => {
    row.remove();
  }, 7500);
}

let bannerTimer = 0;

/** Puts the notice away. Says whether there was one up to put away. */
export function closeBanner(): boolean {
  window.clearTimeout(bannerTimer);
  const notice = $("banner");
  const up = !notice.hidden;
  notice.hidden = true;
  return up;
}

/** The head of the notice for a goal finished, by what it was. */
const DONE = { lesson: "Lesson done", project: "Project done", commission: "Commission done" } as const;

/**
 * A goal is finished: the node in hand filled, or research known. The sheet says what it is, what it
 * paid, what it unlocked (each a thing with its picture and its card; for a commission the tier it
 * opened and the land now for sale among them), what it left in the town, and what comes next: the
 * node now in hand, or the research now being studied. It stays until it is put away or a while has
 * passed.
 */
export function banner(done: Goal, next: Goal | null): void {
  const b = $("banner");
  const info = GOALS[done];
  if (!info) return;
  const node = isNode(done) ? NODES[done] : undefined;
  const close = iconButton("wood sm", icon("close"), "Close", closeBanner);
  const then = next === null ? undefined : GOALS[next];
  const from = next === null ? undefined : NODES[next]?.from;
  const says = node
    ? then && from
      ? el("div", "k-say", {}, el("b", "", { text: `Next, from ${from}` }), `${then.title}: ${wantWords(then.want)}.`)
      : el("div", "k-say", {}, el("b", "", { text: "Next" }), nextLine())
    : el(
        "div",
        "k-say",
        {},
        el("b", "", { text: "The Study" }),
        then ? `Studied next: ${then.title}.` : "Nothing is studied next. Choose in Research.",
      );
  b.replaceChildren(
    el(
      "header",
      "k-head",
      {},
      icon("check"),
      el("h2", "k-title", { text: node ? DONE[node.kind] : "Research known" }),
      close,
    ),
    el(
      "div",
      "k-body",
      {},
      head(done, info.pay > 0 ? amount("coin", `+${whole(info.pay)}`) : null),
      ...some(unlocks(done), leaves(done)).map((l) => l.node),
      says,
      button("wide", ["Back to work"], closeBanner),
    ),
  );
  b.dataset.goal = info.id;
  b.hidden = false;
  replay(b, "k-rise");
  window.clearTimeout(bannerTimer);
  bannerTimer = window.setTimeout(closeBanner, 16000);
  sfx.open();
}

/** With nothing in hand, what comes next in the corner's words, as one line: "Take a project. 3 ready." */
function nextLine(): string {
  const { title, line } = nextWords(nextUp());
  return `${title}. ${line.endsWith(".") ? line : `${line}.`}`;
}

export { pic };
