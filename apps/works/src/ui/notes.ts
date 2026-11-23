/** What the yard says in passing: the purse and Coins flying to it, a line of news, and the notice when the node in hand is finished. */

import { type Goal, GOALS, item, ITEM_INFO, kind, KIND_INFO, NODES, plot, RECIPE } from "@sequoia-leaf/factory";
import { amount, el, icon, replay } from "@sequoia-leaf/kit/dom.ts";
import { fly, type PurseBar, purseBar } from "@sequoia-leaf/kit/pursebar.ts";
import { sfx } from "@sequoia-leaf/kit/sound.ts";
import type { Pt } from "@sequoia-leaf/kit/util.ts";

import type { Art } from "../art/index.ts";
import { S } from "../state.ts";
import { coins } from "../yard.ts";
import { $, button, fitted, partsWords, pic, wantWords, yardIcon } from "./parts.ts";

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

export function closeBanner(): void {
  window.clearTimeout(bannerTimer);
  $("banner").hidden = true;
}

/** What each tool that a node may unlock is, in a line. */
/** The head of the notice for a goal finished, by what it was. */
const DONE = { lesson: "Lesson done", project: "Project done", commission: "Commission done" } as const;

const TOOL_WORDS = {
  paint: ["Paint", "Gives a belt's whole line a colour, to tell lines apart."],
  select: ["Select", "Mark out an area to move, copy, remove or save as a blueprint."],
  upgrade: ["Upgrading an area", "Raises every piece in a marked area to the highest grade the yard may build."],
} as const;

/**
 * The node in hand is finished: what it paid, what it unlocked (each with its picture and what it is
 * for), what it left in the town, and the node now in hand. It stays until it is put away or a while
 * has passed.
 */
export function banner(art: Art, done: Goal, next: Goal | null): void {
  const b = $("banner");
  const info = GOALS[done];
  const node = NODES[done];
  if (!info) return;
  const u = info.unlocks;
  const opened: HTMLElement[] = [];
  for (const name of u.kinds ?? []) {
    const k = kind(name);
    const what = KIND_INFO[k];
    opened.push(
      el(
        "div",
        "k-card",
        {},
        fitted(art.icon(k), 20, 20),
        el(
          "div",
          "k-grow",
          {},
          `New: the ${(what?.name ?? "").toLowerCase()}`,
          el("div", "k-d", { text: what?.what ?? "" }),
        ),
      ),
    );
  }
  for (const name of u.tools ?? []) {
    const [title, what] = TOOL_WORDS[name];
    opened.push(
      el(
        "div",
        "k-card",
        {},
        yardIcon(name === "paint" ? "brush" : "select"),
        el("div", "k-grow", {}, `New: ${title}`, el("div", "k-d", { text: what })),
      ),
    );
  }
  for (const name of u.recipes ?? []) {
    const n = item(name);
    const r = RECIPE[n];
    opened.push(
      el(
        "div",
        "k-card",
        {},
        pic(art.item(n), 1),
        el(
          "div",
          "k-grow",
          {},
          `New recipe: ${ITEM_INFO[n]?.many ?? ""}`,
          el("div", "k-d", {
            text: `From ${partsWords(n)}, at a ${(KIND_INFO[r?.by ?? kind("bench")]?.name ?? "").toLowerCase()}.`,
          }),
        ),
      ),
    );
  }
  for (const name of u.plots ?? []) {
    const p = S.world.land.plots.find((q) => q.plot === plot(name));
    if (p)
      opened.push(
        el(
          "div",
          "k-card",
          {},
          icon("star"),
          el("div", "k-grow", {}, `For sale: ${p.name}`, el("div", "k-d", { text: p.why })),
        ),
      );
  }
  if (u.board)
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
  if (node?.gift)
    opened.push(el("div", "k-card", {}, icon("heart"), el("div", "k-grow k-d", { text: node.gift.line })));
  const close = el(
    "button",
    "k-btn wood icon sm",
    { type: "button", "aria-label": "Close", onclick: closeBanner },
    icon("close"),
  );
  const then = next === null ? undefined : NODES[next];
  const nextInfo = next === null ? undefined : GOALS[next];
  b.replaceChildren(
    el(
      "header",
      "k-head",
      {},
      icon("check"),
      el("h2", "k-title", { text: node ? DONE[node.kind] : "Order filled" }),
      close,
    ),
    el(
      "div",
      "k-body",
      {},
      el(
        "div",
        "k-row",
        {},
        el("div", "k-grow", { text: info.title }),
        info.pay > 0 ? amount("coin", `+${info.pay}`) : null,
      ),
      ...opened,
      then && nextInfo
        ? el(
            "div",
            "k-say",
            {},
            el("b", "", { text: `Next, from ${then.from}` }),
            `${then.title}: ${wantWords(nextInfo.want)}.`,
          )
        : el(
            "div",
            "k-say",
            {},
            el("b", "", { text: "The guild" }),
            "Nothing is in hand. Take a project in Projects. Side orders keep coming.",
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

/** How many lessons there are, and the place of each among them. */
const LESSONS = GOALS.flatMap((g, n) => (g.kind === "lesson" ? [n] : []));

/** The node in hand, in words for a label: "Lesson 2 of 4", "Tier 1 project", "Tier 1 commission"; or the tier, with nothing in hand. */
export function handLabel(): string {
  const w = S.world;
  const info = w.hand === -1 ? undefined : GOALS[w.hand];
  if (!info) return `Tier ${w.open.tier}`;
  if (info.kind === "lesson") return `Lesson ${LESSONS.indexOf(w.hand) + 1} of ${LESSONS.length}`;
  return `Tier ${info.tier} ${info.kind}`;
}

export { pic };
