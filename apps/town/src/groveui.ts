/**
 * The Grove's words and buttons over its picture, built from the kit: the way back, the pools, the
 * Leaf, the pulls towards a top prize, the pull buttons, Skip, Next where a ceremony waits, the
 * names in the end picture, and one panel with the prizes and their chances (the rules behind its
 * "?"), the Seeds and what they buy, and the last pulls.
 * Everything shown is Leaf's view (`pulls.ts` says how it is worded); a press goes to
 * `grovescene.ts`, which asks Leaf.
 */

import { type Choice, type Choices, choices } from "@sequoia-leaf/kit/choices.ts";
import {
  amount,
  asking,
  asksAgain,
  el,
  icon as glyph,
  keepingFocus,
  pressedTwice,
  replay,
  type Spend,
  when,
} from "@sequoia-leaf/kit/dom.ts";
import { longPress } from "@sequoia-leaf/kit/press.ts";
import { balance, leafOpen, leafShut } from "@sequoia-leaf/kit/purse.ts";
import { closeLeaf } from "@sequoia-leaf/kit/pursebar.ts";
import { whole } from "@sequoia-leaf/kit/say.ts";
import { type Scope, scope } from "@sequoia-leaf/kit/scope.ts";
import { sfx } from "@sequoia-leaf/kit/sound.ts";
import { tipAt } from "@sequoia-leaf/kit/tip.ts";
import { type PullsView, RARITIES, type Rarity, RATES } from "@sequoia-leaf/pulls";
import type { BannerPerson } from "@sequoia-leaf/pulls/wire.ts";

import { $, button, pic, slot } from "./hud.ts";
import {
  cannotPull,
  chances,
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
  poolPrizes,
  prizeBook,
  prizeName,
  pullSpend,
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
  /** A prize's own picture, a pixel to each of its own: a figure of the raid, or the headliner. */
  picture(prize: string): HTMLCanvasElement;
}

type Tab = "prizes" | "seeds" | "history";
const TABS: readonly Choice<Tab>[] = [
  { id: "prizes", name: "Prizes" },
  { id: "seeds", name: "Seeds" },
  { id: "history", name: "History" },
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

/** The pools beside an open banner, one of them on show: a radio group (`choices.ts`). */
function poolChoices(open: Showing | null, host: GroveHost): Choices<string> {
  const pools = open
    ? [
        { id: open.id, name: open.person.name },
        { id: GROVE, name: EVERGREEN },
      ]
    : [];
  return choices(pools, {
    kind: "radio",
    name: "Pool",
    chosen: host.pool(),
    look: "sm",
    choose: (id) => host.choose(id),
  });
}

/** The last pulls, newest first: for a top prize, the pull it came on. */
function history(host: GroveHost, body: HTMLElement): void {
  const rows = past(host.view().history, host.banners());
  if (rows.length === 0) body.append(el("div", "k-dim", { text: "No pulls yet." }));
  for (const p of rows)
    body.append(
      el(
        "div",
        "grove-past",
        {},
        plate(p.rarity),
        el("span", "k-grow", { text: prizeName(p.prize, host.banners()) }),
        p.top ? el("b", "k-gold", { text: p.top }) : null,
        el("span", "k-read k-dim", { text: `${p.pool}, ${p.when}` }),
      ),
    );
}

/**
 * The button for `n` pulls: its price in Leaf, asked for twice (`confirm`) and only for the pool it
 * was drawn for. One pull is a free pull while one waits. With too little Leaf, or Leaf closed, it is
 * shut and says why. There is one at a time for each count, on the banner or at a ceremony's end,
 * and drawn again, free or paid, the button for the same count keeps the keyboard.
 */
function pullButton(host: GroveHost, n: 1 | 10, confirm: (spend: Spend) => boolean): HTMLElement {
  const waiting = host.view().free.waiting;
  const free = n === 1 && waiting > 0;
  const pool = host.pool();
  const spend = pullSpend(pool, n);
  const b = free
    ? button(
        "leaf grove-pull",
        [el("span", "", { text: "Free pull" }), el("span", "k-sub", { text: `${waiting} waiting` })],
        (pressed) => {
          host.pull(1, "free", pressed);
        },
      )
    : button(
        `leaf grove-pull${asking(spend) ? " asking" : ""}`,
        [asksAgain(spend, [el("span", "", { text: `Pull ${n}` }), amount("leaf", whole(spend.price))], "Pull?")],
        (pressed) => {
          sfx.tap();
          // Drawn for one pool, it never spends in another: a banner may have ended under the pointer.
          if (host.pool() === pool && confirm(spend)) host.pull(n, "leaf", pressed);
        },
      );
  b.dataset.keep = `pull:${n}`;
  const why = free ? null : cannotPull(n, balance().leaf, leafOpen(), leafShut());
  if (why) closeLeaf(b, "Leaf", why);
  return b;
}

export function makeGroveUi(host: GroveHost) {
  /** What the Grove's words and buttons hold for as long as the page stands. */
  const lasting = scope();
  /** What the Grove holds while it shows one thing (`at`, by its state and pool): a pull waiting for its second press. */
  const showing = lasting.turns();
  /** What the Grove shows now, as `showing` names it. */
  const seen = (): string => `${host.state()} ${host.pool()}`;
  const canvas = el("canvas");
  const pools = el("div", "grove-pools");
  const leaf = el("div", "k-plaque grove-leaf");
  const words = el("div", "grove-words");
  const back = button("wood sm grove-back", [glyph("back"), "Back to town"], () => {
    host.leave();
  });
  const banner = el("div", "grove-banner", {}, back, pools, leaf, words);
  const skip = el("button", "k-btn wood sm grove-skip", { type: "button", text: "Skip", hidden: true });
  /** On from a prize the ceremony waits at: shown only there. */
  const go = button("wood grove-go", ["Next"], () => {
    host.next();
  });
  go.hidden = true;
  const names = el("div", "grove-names", { hidden: true });
  const end = el("div", "grove-end", { hidden: true });
  const panel = el("div", "k-panel grove-panel", { hidden: true });
  /** What Leaf refused, said where it stays whatever is drawn again. */
  const said = el("div", "k-plaque k-read grove-said", { hidden: true });
  const stage = el("div", "grove-stage", {}, canvas, banner, skip, go, names, end, said, panel);
  const root = $("grove");
  root.append(stage);

  // A press on Skip goes on to the next prize; held (`press.ts`, one pointer's), to the end picture.
  const heldToEnd = longPress(lasting, skip, { starts: (e) => e.button === 0, asked: () => host.toEnd() });
  lasting.on(skip, "click", (e) => {
    if (!heldToEnd(e)) host.next();
  });

  /** The pool on show is the banner (and not the always-open pool). */
  const onBanner = (): Showing | null => (host.pool() === GROVE ? null : host.banner());
  /** The pulls are offered at a ceremony's end, and not on the banner behind it. */
  const atEnd = (): boolean => host.state() === "end";
  const nameOf = (prize: string): string => prizeName(prize, host.banners());
  // ---------- the pulls ----------

  /** What the last ceremony was for, so that its end picture offers the same again. */
  let again: 1 | 10 | null = null;

  /** The button for `n` pulls, asked for twice while the Grove shows the same thing (`showing`). */
  const pull = (n: 1 | 10): HTMLElement => pullButton(host, n, (spend) => pressedTwice(showing(seen()), spend, render));

  function renderBanner(): void {
    const v = host.view();
    const open = host.banner();
    const b = onBanner();
    pools.hidden = open === null;
    // Drawn again under the keyboard (an arrow chose), the pool chosen keeps it.
    const keyed = pools.contains(document.activeElement);
    const strip = poolChoices(open, host);
    pools.replaceChildren(strip.el);
    if (keyed) strip.focus();
    leaf.replaceChildren(amount("leaf", whole(balance().leaf)));

    const c = b ? v.counters.banner : v.counters.grove;
    const owed = b ? owedLine(c, b.person.name) : null;
    const bar = el("i");
    bar.style.setProperty("--v", `${(c.top / RATES.top.certainAt) * 100}%`);
    const next = nextFree(v.free);
    // Said under the buttons when not even one pull can be made.
    const shut = v.free.waiting > 0 ? null : cannotPull(1, balance().leaf, leafOpen(), leafShut());
    // Drawn again under the keyboard (a pull stopped asking, the Leaf changed), the same button keeps it.
    keepingFocus(words, () =>
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
          ...TABS.map(({ id, name }) => {
            const launcher = button(
              "wood sm",
              [name, id === "seeds" ? el("b", "k-leafy", { text: whole(v.seeds) }) : null],
              () => {
                openPanel(id);
              },
            );
            launcher.dataset.book = id;
            launcher.dataset.keep = `book:${id}`;
            return launcher;
          }),
        ),
        ...(next ? [el("div", "k-read k-over", { text: next })] : []),
        ...(atEnd() ? [] : [el("div", "k-row grove-pulls", {}, pull(1), pull(10))]),
        ...(shut ? [el("div", "k-read k-over", { text: shut })] : []),
      ),
    );
    renderEnd();
  }

  /** What the end of a ceremony offers: the same pull again, and putting it away. */
  function renderEnd(): void {
    const done = button("wood", ["Done"], () => {
      host.done();
    });
    done.dataset.keep = "done";
    keepingFocus(end, () => end.replaceChildren(...(again && atEnd() ? [pull(again)] : []), done));
  }

  // ---------- the panel ----------

  /**
   * The panel while it is open: the tab on show, the row of tabs, the page under it, what the page
   * holds while that tab is on show (an exchange waiting for its second press), and which of the
   * banner's buttons opened it, which has the keyboard back as it closes.
   */
  let book: { tab: Tab; tabs: Choices<Tab>; page: HTMLElement; life: Scope; from: Tab | null } | null = null;
  /** The rules are on show among the prizes: the "?" there shows them and puts them away. */
  let ruled = false;

  /** Opens the panel at a tab, or turns it to another. Opened from the banner with the keyboard, the keyboard goes to the tab. */
  function openPanel(to: Tab): void {
    ruled &&= to === book?.tab;
    if (book) {
      if (book.tab !== to) {
        book.life.close();
        book = { ...book, tab: to, life: lasting.child() };
        book.tabs.select(to);
        book.page.scrollTop = 0;
      }
      renderPanel();
      return;
    }
    sfx.open();
    const page = el("div", "k-body k-scroll");
    const tabs = choices(TABS, {
      kind: "tabs",
      name: "Grove",
      chosen: to,
      look: "sm",
      row: "k-grow",
      page,
      choose: openPanel,
    });
    const close = el(
      "button",
      "k-btn wood icon sm",
      { type: "button", "aria-label": "Close", onclick: closePanel },
      glyph("close"),
    );
    panel.replaceChildren(el("header", "k-head", {}, tabs.el, close), page);
    // The book lies over the banner's words: nothing under it can be pressed or reached while it is open.
    [panel.hidden, words.inert] = [false, true];
    const at = document.activeElement;
    const from = at instanceof HTMLElement ? (TABS.find((t) => t.id === at.dataset.book)?.id ?? null) : null;
    book = { tab: to, tabs, page, life: lasting.child(), from };
    renderPanel();
    if (from) tabs.focus();
  }

  function closePanel(): void {
    if (!book) return;
    const { life, from } = book;
    book = null;
    life.close();
    const inside = panel.contains(document.activeElement);
    [panel.hidden, words.inert] = [true, false];
    panel.replaceChildren();
    // The keyboard was in it: back to the banner's button for the tab it was opened at, drawn again or not.
    if (inside && from) words.querySelector<HTMLElement>(`[data-book="${from}"]`)?.focus({ preventScroll: true });
    sfx.close();
  }

  /** Every prize of the pool on show by rarity, the rarest first: the chance of each rarity, and how many of each prize the player has. */
  function prizes(body: HTMLElement): void {
    const v = host.view();
    const b = onBanner();
    const shown = chances(b !== null);
    /** The prizes this pool can give, by rarity, in the era of Leaf's view. */
    const listed = prizeBook(v, b ? b.id : GROVE);
    const all = listed.flatMap(([, list]) => list);
    body.append(
      el(
        "div",
        "k-row",
        {},
        el("span", "k-grow", { text: `Yours: ${all.filter((prize) => v.have[prize]).length} of ${all.length}` }),
        el("button", "k-btn blue icon sm grove-rules", {
          type: "button",
          "aria-label": "Rules",
          "aria-expanded": String(ruled),
          "data-keep": "rules",
          text: "?",
          onclick: () => {
            ruled = !ruled;
            sfx.tap();
            renderPanel();
          },
        }),
      ),
    );
    if (ruled) for (const line of rules(b ? b.person.name : null)) body.append(el("div", "k-read", { text: line }));
    for (const [rarity, list] of listed.toReversed()) {
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
              el("span", "k-info-tile-pic", {}, pic(host.picture(prize))),
              el("span", "k-info-tile-name k-s", { text: nameOf(prize) }),
              have > 0 ? el("span", "k-info-tagged corner", { text: `x${whole(have)}` }) : null,
            );
          }),
        ),
      );
    }
  }

  /** The Seeds in hand, and each mid-tier prize they buy: the exchange asks twice, while the tab stays on show (`life`). */
  function seeds(body: HTMLElement, life: Scope): void {
    const v = host.view();
    body.append(el("div", "k-title", {}, "Seeds: ", el("span", "k-leafy", { text: whole(v.seeds) })));
    for (const o of offers(v)) {
      const spend: Spend = { on: `seeds:${o.prize}`, price: o.price };
      const buy = button(
        `green sm${asking(spend) ? " asking" : ""}${o.enough ? "" : " off"}`,
        // One the Seeds do not reach is locked, so that it is not told from the others by its colour alone.
        [asksAgain(spend, [o.enough ? null : glyph("lock"), `${whole(o.price)} Seeds`], "Exchange?")],
        (b) => {
          if (!o.enough) refused(b, "Not enough Seeds.");
          else if (pressedTwice(life, spend, renderPanel)) host.exchange(o.prize, b);
        },
      );
      buy.dataset.keep = `seeds:${o.prize}`;
      body.append(
        el(
          "div",
          "k-card",
          {},
          slot(pic(host.picture(o.prize)), 32),
          el(
            "div",
            "k-grow k-col",
            {},
            el("span", "k-pix", { text: nameOf(o.prize) }),
            el("span", "k-wrap", {}, plate(o.rarity)),
          ),
          o.owned ? el("span", "k-dim", { text: "Yours" }) : buy,
        ),
      );
    }
  }

  /**
   * The page under the tabs, drawn again: the tabs and the keyboard on them stay. The keyboard on
   * the page stays on the same button (an offer, by its prize), or with that gone goes to the tab
   * on show, so that closing the panel can give it back to the button that opened it.
   */
  function renderPanel(): void {
    if (!book) return;
    const { tab, tabs, page, life } = book;
    keepingFocus(
      page,
      () => {
        page.replaceChildren();
        if (tab === "prizes") prizes(page);
        else if (tab === "seeds") seeds(page, life);
        else history(host, page);
      },
      () => tabs.focus(),
    );
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
  return {
    root,
    canvas,
    banner,
    skip,
    go,
    end,
    names,
    tick,
    closePanel,
    /**
     * The Grove is in `state` now: what cannot be used in it cannot be pressed or reached, and a
     * pull waiting to be pressed again stops waiting when the state or the pool changes.
     */
    at(state: GroveState): void {
      banner.inert = state !== "banner";
      panel.inert = state !== "banner";
      end.inert = state !== "end";
      showing(`${state} ${host.pool()}`);
    },
    /** Says what Leaf refused, or nothing; the buttons are drawn again, none of them asking. */
    said(line: string | null): void {
      said.textContent = line ?? "";
      said.hidden = line === null;
      if (line !== null) render();
    },
    panelOpen: (): boolean => book !== null,
    /** The name of the pool on show, as the picture writes it. */
    poolName: (): string => onBanner()?.person.name ?? EVERGREEN,
    /**
     * Who stands in the always-open pool's clearing, one a stand: its first three Treants in the era
     * of Leaf's view. One past them (Seqwawa, from 8 December) is in the prize book, not the clearing.
     */
    treants: (): readonly string[] => poolPrizes(host.view(), GROVE).Treant.slice(0, 3),
    /** The frame is `w` by `h` art pixels, `scale` CSS pixels to each, upright or not, `left` and `top` CSS pixels in from the window's corner. */
    fit(w: number, h: number, scale: number, tall: boolean, left: number, top: number): void {
      stage.style.cssText = `left:${left}px;top:${top}px;width:${w * scale}px;height:${h * scale}px;--g:${scale}px;--fx:${left}px;--fy:${top}px`;
      stage.className = `grove-stage ${tall ? "tall" : "desk"}`;
    },
    /** A ceremony begins: the names for its end picture, and what its end offers again (`n` pulls; nothing after an exchange). */
    began(list: readonly { name: string; colour: string; have: number }[], n: 1 | 10 | null): void {
      closePanel();
      again = n;
      names.replaceChildren(
        ...list.map((p) => {
          const tag = el("span", "grove-name", {}, el("i"), p.have > 1 ? `${p.name} x${whole(p.have)}` : p.name);
          tag.style.setProperty("--c", p.colour);
          return tag;
        }),
      );
      renderEnd();
    },
  };
}
