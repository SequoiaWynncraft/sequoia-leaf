/** What the yard says in passing: the purse and Coins flying to it, a line of news, and the notice when a story order is filled. */

import { amount, el, icon, replay } from "@sequoia-leaf/kit/dom.ts";
import { fly, type PurseBar, purseBar } from "@sequoia-leaf/kit/pursebar.ts";
import { sfx } from "@sequoia-leaf/kit/sound.ts";
import type { Pt } from "@sequoia-leaf/kit/util.ts";
import { KIND, PLANS, STORY, type StoryOrder } from "@sequoia-leaf/yard";

import type { Art } from "../art/index.ts";
import { S } from "../state.ts";
import { coins } from "../yard.ts";
import { $, button, fitted, pic, wantWords, yardIcon } from "./parts.ts";

let bar: PurseBar | null = null;

export function initNotes(): void {
  // The Works shows the Coins as Leaf will count them for a price: the purse's, and the till's whole Coins.
  bar = purseBar($("purse"), coins);
}

export function tickNotes(dt: number): void {
  bar?.tick(dt);
}

/** Where a currency's icon is in the purse, for things to fly to and from. */
export const purseAt = (kind: "leaf" | "coins"): Pt => bar?.at(kind) ?? { x: 30, y: 30 };

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

export function closeBanner(): void {
  window.clearTimeout(bannerTimer);
  $("banner").hidden = true;
}

/**
 * A story order has been filled: what it paid, what it opened (each with its picture and what it
 * is for), and what is asked for next. It stays until it is put away or a while has passed.
 */
export function banner(art: Art, done: StoryOrder, next: StoryOrder | null): void {
  const b = $("banner");
  const opened: HTMLElement[] = [];
  for (const kind of done.opens.kinds ?? [])
    opened.push(
      el(
        "div",
        "k-card",
        {},
        fitted(art.icon(kind), 20, 20),
        el(
          "div",
          "k-grow",
          {},
          `New: the ${KIND[kind].name.toLowerCase()}`,
          el("div", "k-d", { text: KIND[kind].what }),
        ),
      ),
    );
  for (const id of done.opens.plots ?? []) {
    const plot = S.world.land.plots.find((p) => p.id === id);
    if (plot)
      opened.push(
        el(
          "div",
          "k-card",
          {},
          icon("star"),
          el("div", "k-grow", {}, `For sale: ${plot.name}`, el("div", "k-d", { text: plot.why })),
        ),
      );
  }
  const plans = (done.opens.plans ?? []).flatMap((id) => PLANS.filter((p) => p.id === id));
  if (plans.length > 0)
    opened.push(
      el(
        "div",
        "k-card",
        {},
        yardIcon("plans"),
        el(
          "div",
          "k-grow",
          {},
          plans.length === 1 ? "A new plan to buy" : "New plans to buy",
          el("div", "k-dim", { text: plans.map((p) => p.name).join(", ") }),
        ),
      ),
    );
  if (done.opens.board)
    opened.push(
      el(
        "div",
        "k-card",
        {},
        yardIcon("orders"),
        el(
          "div",
          "k-grow",
          {},
          "Side orders unlocked",
          el("div", "k-d", {
            text: "Extra orders from the guild, 3 at a time. A new one comes when you hand one over.",
          }),
        ),
      ),
    );
  if (done.gift) opened.push(el("div", "k-card", {}, icon("heart"), el("div", "k-grow k-d", { text: done.gift.line })));
  const close = el(
    "button",
    "k-btn wood icon sm",
    { type: "button", "aria-label": "Close", onclick: closeBanner },
    icon("close"),
  );
  b.replaceChildren(
    el("header", "k-head", {}, icon("check"), el("h2", "k-title", { text: "Order filled" }), close),
    el(
      "div",
      "k-body",
      {},
      el("div", "k-row", {}, el("div", "k-grow", { text: done.title }), amount("coin", `+${done.pay}`)),
      ...opened,
      next
        ? el(
            "div",
            "k-say",
            {},
            el("b", "", { text: `Next, from ${next.from}` }),
            `${next.title}: ${wantWords(next.want)}.`,
          )
        : el(
            "div",
            "k-say",
            {},
            el("b", "", { text: "The guild" }),
            "That was the last story order. Side orders keep coming.",
          ),
      button("wide", ["Back to work"], closeBanner),
    ),
  );
  b.hidden = false;
  replay(b, "k-rise");
  window.clearTimeout(bannerTimer);
  bannerTimer = window.setTimeout(closeBanner, 16000);
  sfx.open();
}

/** How far the story has come, in words for a label. */
export const storyLabel = (): string =>
  S.world.story >= STORY.length ? "The story is told" : `Order ${S.world.story + 1} of ${STORY.length}`;

export { pic };
