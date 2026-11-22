/**
 * The Grove's words and buttons over its picture, built from the kit: the way back, the pools, the
 * Leaf, the pulls towards a top prize, the pull buttons, Skip, the names in the end picture, and
 * one panel with the prizes and their chances, the Seeds and what they buy, and the last pulls.
 * Everything shown is Leaf's view (`pulls.ts` says how it is worded); a press goes to
 * `grovescene.ts`, which asks Leaf.
 */

import {
  amount,
  asking,
  asksAgain,
  el,
  icon as glyph,
  pressedTwice,
  replay,
  unask,
  when,
} from "@sequoia-leaf/kit/dom.ts";
import { isGuest } from "@sequoia-leaf/kit/live.ts";
import { balance, leafOpen, leafShown, leafShut } from "@sequoia-leaf/kit/purse.ts";
import { closeLeaf } from "@sequoia-leaf/kit/pursebar.ts";
import { sfx } from "@sequoia-leaf/kit/sound.ts";
import { tipAt } from "@sequoia-leaf/kit/tip.ts";
import { headliner, PRIZES, type PullsView, RARITIES, type Rarity, RATES } from "@sequoia-leaf/pulls";
import type { BannerPerson } from "@sequoia-leaf/pulls/wire.ts";

import { $, button, pic, slot } from "./hud.ts";
import {
  cannotPull,
  chances,
  count,
  dayAndTime,
  EVERGREEN,
  GROVE,
  type GroveState,
  nextFree,
  offers,
  owedLine,
  past,
  percent,
  pityLine,
  prizeIs,
  prizeName,
  pullKey,
  RARITY_NAMES,
  rules,
  type Showing,
} from "./pulls.ts";

/** What the words and buttons ask of the scene behind them. */
export interface GroveHost {
  view(): PullsView;
  banners(): readonly BannerPerson[];
  /** The banner that is open and has a person, if any. */
  banner(): Showing | null;
  /** The pool on show, and showing another. */
  pool(): string;
  choose(pool: string): void;
  /** What the Grove is doing: only at the banner and at a ceremony's end do its pulls and exchanges take a press. */
  state(): GroveState;
  pull(n: 1 | 10, paid: "leaf" | "free", button: HTMLElement): void;
  exchange(prize: string, button: HTMLElement): void;
  leave(): void;
  /** The ceremony is put away. */
  done(): void;
  /** On to the next beat of the ceremony, and straight to its end picture. */
  next(): void;
  toEnd(): void;
  /** A prize's own picture, a pixel to each of its own. */
  picture(prize: string): HTMLCanvasElement;
}

type Tab = "prizes" | "seeds" | "history";
const TABS: readonly (readonly [Tab, string])[] = [
  ["prizes", "Prizes"],
  ["seeds", "Seeds"],
  ["history", "History"],
];

/** A rarity's name on its colour. */
const plate = (rarity: Rarity): HTMLElement => {
  const b = el("b", "grove-rarity", { text: rarity });
  b.style.setProperty("--c", RARITIES[rarity].colour);
  return b;
};

/** A button that will not do what it says: it looks shut, and a press shakes it and says why. */
function refused(b: HTMLElement, why: string): void {
  replay(b, "shake");
  const box = b.getBoundingClientRect();
  tipAt({ x: box.left, y: box.top, w: box.width, h: box.height }, why, "", b);
}

/** How long Skip is held before it goes straight to the end picture, in milliseconds. */
const HOLD = 450;

export function makeGroveUi(host: GroveHost) {
  const canvas = el("canvas");
  const pools = el("div", "k-tabs grove-pools");
  const leaf = el("div", "k-plaque grove-leaf");
  const words = el("div", "grove-words");
  const back = button("wood sm grove-back", [glyph("back"), "Back to town"], () => {
    host.leave();
  });
  const banner = el("div", "grove-banner", {}, back, pools, leaf, words);
  const skip = el("button", "k-btn wood sm grove-skip", { type: "button", text: "Skip", hidden: true });
  const names = el("div", "grove-names", { hidden: true });
  const end = el("div", "grove-end", { hidden: true });
  const panel = el("div", "k-panel grove-panel", { hidden: true });
  /** What Leaf refused, said where it stays whatever is drawn again. */
  const said = el("div", "k-plaque k-read grove-said", { hidden: true });
  const stage = el("div", "grove-stage", {}, canvas, banner, skip, names, end, said, panel);
  const root = $("grove");
  root.append(stage);

  // A press on Skip goes on to the next prize; held, to the end picture.
  let held = 0;
  let wentToEnd = false;
  skip.addEventListener("pointerdown", () => {
    wentToEnd = false;
    held = window.setTimeout(() => {
      wentToEnd = true;
      host.toEnd();
    }, HOLD);
  });
  skip.addEventListener("pointerleave", () => window.clearTimeout(held));
  skip.addEventListener("click", () => {
    window.clearTimeout(held);
    if (!wentToEnd) host.next();
  });

  /** The pool on show is the banner (and not the always-open pool). */
  const onBanner = (): Showing | null => (host.pool() === GROVE ? null : host.banner());
  /** The pulls are offered at a ceremony's end, and not on the banner behind it. */
  const atEnd = (): boolean => host.state() === "end";
  const nameOf = (prize: string): string => prizeName(prize, host.banners());
  /** A prize's picture in a hollow `box` units square, at the largest of these sizes that fits it. */
  function hollow(prize: string, box: number): HTMLElement {
    const src = host.picture(prize);
    const scale = [3, 2, 1, 0.5].find((k) => src.width * k <= box - 2 && src.height * k <= box - 2) ?? 0.25;
    return slot(pic(src, scale), box);
  }
  // ---------- the pulls ----------

  /** What the last ceremony was for, so that its end picture offers the same again. */
  let again: 1 | 10 | null = null;

  /**
   * The button for `n` pulls: its price in Leaf, asked for twice. One pull is a free pull while one
   * waits. With too little Leaf, or Leaf closed, it is shut and says why. There is one at a time for
   * each count: on the banner, or at a ceremony's end.
   */
  function pullButton(n: 1 | 10): HTMLElement {
    const waiting = host.view().free.waiting;
    if (n === 1 && waiting > 0 && !isGuest())
      return button(
        "leaf grove-pull",
        [el("span", "", { text: "Free pull" }), el("span", "k-sub", { text: `${waiting} waiting` })],
        (b) => {
          host.pull(1, "free", b);
        },
      );
    const pool = host.pool();
    const key = pullKey(pool, n);
    const b = button(
      `leaf grove-pull${asking(key) ? " asking" : ""}`,
      [asksAgain(key, [el("span", "", { text: `Pull ${n}` }), amount("leaf", count(n * RATES.leaf))], "Pull?")],
      (pressed) => {
        sfx.tap();
        // Drawn for one pool, it never spends in another: a banner may have ended under the pointer.
        if (host.pool() === pool && pressedTwice(key, render)) host.pull(n, "leaf", pressed);
      },
    );
    const why = cannotPull(n, balance().leaf, leafOpen(), leafShut());
    if (why) closeLeaf(b, "Leaf", why);
    return b;
  }

  function renderBanner(): void {
    const v = host.view();
    const open = host.banner();
    const b = onBanner();
    pools.hidden = open === null;
    pools.replaceChildren(
      ...(open
        ? [
            [open.id, open.person.name],
            [GROVE, EVERGREEN],
          ]
        : []
      ).map(([id = GROVE, name = ""]) =>
        el("button", "k-btn sm", {
          type: "button",
          "aria-selected": String(id === host.pool()),
          text: name,
          onclick: () => {
            host.choose(id);
          },
        }),
      ),
    );
    leaf.hidden = !leafShown();
    leaf.replaceChildren(amount("leaf", count(balance().leaf)));

    const c = b ? v.counters.banner : v.counters.grove;
    const owed = b ? owedLine(c, b.person.name) : null;
    const bar = el("i");
    bar.style.setProperty("--v", `${(c.top / RATES.top.certainAt) * 100}%`);
    const next = isGuest() ? null : nextFree(v.free);
    // Said under the buttons when not even one pull can be made.
    const shut = v.free.waiting > 0 && !isGuest() ? null : cannotPull(1, balance().leaf, leafOpen(), leafShut());
    words.replaceChildren(
      // Only beside a banner does the always-open pool need saying.
      ...(open ? [el("div", "k-over", { text: b ? `Until ${dayAndTime(b.until)}` : "Always open" })] : []),
      el(
        "div",
        "k-plaque grove-pity",
        {},
        el("span", "", {}, "Top prize: ", el("b", "", { text: pityLine(c) })),
        el("div", "k-bar", {}, bar),
        owed ? el("div", "k-read", { text: owed }) : null,
      ),
      el(
        "div",
        "k-row",
        {},
        ...TABS.map(([tab, name]) =>
          button("wood sm", [name, tab === "seeds" ? el("b", "k-leafy", { text: count(v.seeds) }) : null], () => {
            openPanel(tab);
          }),
        ),
      ),
      ...(next ? [el("div", "k-read k-over", { text: next })] : []),
      ...(atEnd() ? [] : [el("div", "k-row grove-pulls", {}, pullButton(1), pullButton(10))]),
      ...(shut ? [el("div", "k-read k-over", { text: shut })] : []),
    );
    renderEnd();
  }

  /** What the end of a ceremony offers: the same pull again, and putting it away. */
  function renderEnd(): void {
    end.replaceChildren(
      ...(again && atEnd() ? [pullButton(again)] : []),
      button("wood", ["Done"], () => {
        host.done();
      }),
    );
  }

  // ---------- the panel ----------

  let tab: Tab | null = null;

  function openPanel(to: Tab): void {
    if (tab === null) sfx.open();
    tab = to;
    panel.hidden = false;
    renderPanel();
  }

  function closePanel(): void {
    if (tab === null) return;
    tab = null;
    panel.hidden = true;
    panel.replaceChildren();
    sfx.close();
  }

  /** Every prize of the pool on show by rarity, the rarest first: the chance of each rarity, and how many of each prize the player has. */
  function prizes(body: HTMLElement): void {
    const v = host.view();
    const b = onBanner();
    const shown = chances(b !== null);
    for (const line of rules(b ? b.person.name : null)) body.append(el("div", "k-read", { text: line }));
    /** The prizes this pool can give, by rarity. */
    const listOf = (rarity: Rarity): readonly string[] =>
      shown[rarity] === 0 ? [] : rarity === "Yggdrasil" ? (b ? [headliner(b.id)] : []) : PRIZES[rarity];
    const all = RARITY_NAMES.flatMap(listOf);
    body.append(el("div", "", { text: `Yours: ${all.filter((prize) => v.have[prize]).length} of ${all.length}` }));
    for (const rarity of RARITY_NAMES.toReversed()) {
      if (shown[rarity] === 0) continue;
      const list = listOf(rarity);
      body.append(
        el("div", "k-row", {}, plate(rarity), el("span", "k-dim", { text: percent(shown[rarity]) })),
        el(
          "div",
          "grove-tiles",
          {},
          ...list.map((prize) => {
            const have = v.have[prize] ?? 0;
            return el(
              "div",
              `k-slot k-info-tile${have > 0 ? " lit" : ""}`,
              {},
              el("span", "k-info-tile-pic", {}, pic(host.picture(prize), host.picture(prize).width > 40 ? 0.5 : 1)),
              el("span", "k-info-tile-name k-s", { text: nameOf(prize) }),
              have > 0 ? el("span", "k-info-tagged corner", { text: `x${count(have)}` }) : null,
            );
          }),
        ),
      );
    }
  }

  /** The Seeds in hand, and each mid-tier prize they buy: the exchange asks twice. */
  function seeds(body: HTMLElement): void {
    const v = host.view();
    body.append(el("div", "k-title", {}, "Seeds: ", el("span", "k-leafy", { text: count(v.seeds) })));
    for (const o of offers(v, PRIZES)) {
      const key = `seeds:${o.prize}`;
      const buy = button(
        `green sm${asking(key) ? " asking" : ""}${o.enough ? "" : " off"}`,
        [asksAgain(key, [`${count(o.price)} Seeds`], "Exchange?")],
        (b) => {
          if (!o.enough) refused(b, "Not enough Seeds.");
          else if (pressedTwice(key, renderPanel)) host.exchange(o.prize, b);
        },
      );
      body.append(
        el(
          "div",
          "k-card",
          {},
          hollow(o.prize, 28),
          el(
            "div",
            "k-grow k-col",
            {},
            el("span", "k-pix", { text: nameOf(o.prize) }),
            el("span", "k-wrap", {}, plate(o.rarity), el("span", "k-read k-dim", { text: prizeIs(o.prize) })),
          ),
          o.owned ? el("span", "k-dim", { text: "Yours" }) : buy,
        ),
      );
    }
  }

  /** The last pulls, newest first: for a top prize, the pull it came on. */
  function history(body: HTMLElement): void {
    const rows = past(host.view().history, host.banners());
    if (rows.length === 0) body.append(el("div", "k-dim", { text: "No pulls yet." }));
    for (const p of rows)
      body.append(
        el(
          "div",
          "grove-past",
          {},
          plate(p.rarity),
          el("span", "k-grow", { text: nameOf(p.prize) }),
          p.top ? el("b", "k-gold", { text: p.top }) : null,
          el("span", "k-read k-dim", { text: `${p.pool}, ${p.when}` }),
        ),
      );
  }

  function renderPanel(): void {
    if (tab === null) return;
    const body = el("div", "k-body k-scroll");
    panel.replaceChildren(
      el(
        "header",
        "k-head",
        {},
        el(
          "div",
          "k-tabs k-grow",
          {},
          ...TABS.map(([id, name]) =>
            el("button", "k-btn sm", {
              type: "button",
              "aria-selected": String(id === tab),
              text: name,
              onclick: () => {
                openPanel(id);
              },
            }),
          ),
        ),
        el(
          "button",
          "k-btn wood icon sm",
          { type: "button", "aria-label": "Close", onclick: closePanel },
          glyph("close"),
        ),
      ),
      body,
    );
    if (tab === "prizes") prizes(body);
    else if (tab === "seeds") seeds(body);
    else history(body);
  }

  function render(): void {
    renderBanner();
    renderPanel();
  }
  /** Everything the words show: drawn again only when any of it has changed. */
  const tick = when(() => {
    const v = host.view();
    return JSON.stringify([
      host.pool(),
      host.banner(),
      v.counters,
      v.seeds,
      v.free,
      v.pulls,
      Object.keys(v.have).length,
      balance().leaf,
      leafOpen(),
      again,
      atEnd(),
    ]);
  }, render);
  /** The state and the pool last seen: a confirmation is let go when either changes. */
  let seen = "";

  return {
    root,
    canvas,
    banner,
    skip,
    end,
    names,
    tick,
    closePanel,
    /**
     * The Grove is in `state` now: what cannot be used in it cannot be pressed or reached, and a
     * button waiting to be pressed again stops waiting when the state or the pool changes.
     */
    at(state: GroveState): void {
      banner.inert = state !== "banner";
      panel.inert = state !== "banner";
      end.inert = state !== "end";
      const now = `${state} ${host.pool()}`;
      if (now === seen) return;
      seen = now;
      unask();
    },
    /** Says what Leaf refused, or nothing; the buttons are drawn again, none of them asking. */
    said(line: string | null): void {
      said.textContent = line ?? "";
      said.hidden = line === null;
      if (line !== null) render();
    },
    panelOpen: (): boolean => tab !== null,
    /** The name of the pool on show, as the picture writes it. */
    poolName: (): string => onBanner()?.person.name ?? EVERGREEN,
    /** The picture is `w` by `h` art pixels, `scale` screen pixels to each, upright or not. */
    fit(w: number, h: number, scale: number, tall: boolean): void {
      stage.style.width = `${w * scale}px`;
      stage.style.height = `${h * scale}px`;
      stage.style.left = `${Math.max(0, Math.floor((innerWidth - w * scale) / 2))}px`;
      stage.style.top = `${Math.max(0, Math.floor((innerHeight - h * scale) / 2))}px`;
      stage.style.setProperty("--g", `${scale}px`);
      stage.className = `grove-stage ${tall ? "tall" : "desk"}`;
    },
    /** A ceremony begins: the names for its end picture, and what its end offers again (`n` pulls; nothing after an exchange). */
    began(list: readonly { name: string; colour: string; have: number }[], n: 1 | 10 | null): void {
      closePanel();
      again = n;
      names.replaceChildren(
        ...list.map((p) => {
          const tag = el("span", "grove-name", {}, el("i"), p.have > 1 ? `${p.name} x${count(p.have)}` : p.name);
          tag.style.setProperty("--c", p.colour);
          return tag;
        }),
      );
      renderEnd();
    },
  };
}
