/**
 * The yard's books, each a panel: the orders, the plans, what the depot has taken in, where the
 * power comes from and goes, and the second shift.
 */

import { thing } from "@sequoia-leaf/kit/card.ts";
import { amount, asking, asksAgain, el, icon, pressedTwice, replay } from "@sequoia-leaf/kit/dom.ts";
import { closeLeaf } from "@sequoia-leaf/kit/pursebar.ts";
import { sfx } from "@sequoia-leaf/kit/sound.ts";
import { tip, tipOff } from "@sequoia-leaf/kit/tip.ts";
import {
  AWAY_MOST_MS,
  DEPOT_SHARE,
  isFilled,
  ITEM,
  ITEMS,
  KIND,
  type Kind,
  KINDS,
  type PlanId,
  PLANS,
  planState,
  power,
  repower,
  SHIFT,
  type Standing,
  STARTERS,
  STORY,
  storyOrder,
  SWAP_EVERY,
  swapRefusal,
  type Tally,
  TICK_MS,
} from "@sequoia-leaf/yard";

import type { Art } from "../art/index.ts";
import { yardSfx } from "../sound.ts";
import { S } from "../state.ts";
import { buyIdea } from "../tools.ts";
import { coins, doNow } from "../yard.ts";
import { board } from "./board.ts";
import { itemRef, machineRef, planRef, plotRef } from "./card.ts";
import { feed, storyLabel } from "./notes.ts";
import { $, button, wantWords, when, yardIcon } from "./parts.ts";

export type PanelId = "orders" | "board" | "plans" | "depot" | "power" | "shift";

/** What the panels ask of the rest of the screen. */
export const panelHooks: {
  /** Hand a filled standing order over, by its id. */
  handOver: (order: number) => void;
  changed: () => void;
} = { handOver: () => {}, changed: () => {} };

const TITLES: Record<PanelId, string> = {
  orders: "Orders",
  board: "Top yards",
  plans: "Plans",
  depot: "The depot",
  power: "Power",
  shift: "A second shift",
};

// ---------- what an order wants ----------

/** Rows for what an order wants, and a way to bring their bars up to date without rebuilding them. */
function wants(want: Tally, filled: () => Tally): { rows: HTMLElement[]; update: () => void } {
  const parts = ITEMS.filter((k) => (want[k] ?? 0) > 0).map((k) => {
    const bar = el("i");
    const count = el("span", "n");
    const holder = el("div", "k-bar", {}, bar);
    const row = el("div", "want", {}, thing(itemRef(k)), holder, count);
    return { k, bar, count, holder, row };
  });
  const update = (): void => {
    const f = filled();
    for (const p of parts) {
      const n = want[p.k] ?? 1;
      const have = Math.min(f[p.k] ?? 0, n);
      p.bar.style.setProperty("--v", `${(have / n) * 100}%`);
      p.count.textContent = `${have} / ${n}`;
      p.holder.classList.toggle("leaf", have >= n);
    }
  };
  update();
  return { rows: parts.map((p) => p.row), update };
}

/** What a story order opens, each machine, plot and plan as a thing that explains itself. */
function opensThings(o: (typeof STORY)[number]): HTMLElement[] {
  return [
    ...(o.opens.kinds ?? []).map((k) => thing(machineRef(k))),
    ...(o.opens.plots ?? []).map((id) => thing(plotRef(id))),
    ...(o.opens.plans ?? []).map((id) => thing(planRef(id))),
    ...(o.opens.board ? [el("b", "", { text: "Side orders" })] : []),
  ];
}

/** The story order that unlocks side orders, counted from 0. */
const BOARD_AT = STORY.findIndex((o) => o.opens.board);

const filledFirst = (list: readonly Standing[]): Standing[] =>
  list.toSorted((a, b) => Number(isFilled(b.want, b.filled)) - Number(isFilled(a.want, a.filled)));

/**
 * The side orders in the places the list shows them, given the places it showed them in (by id).
 * An order still on the board keeps its place, so one that fills does not move. When one has left
 * (handed over or swapped), those that stay are put filled first. An order new to the list goes
 * last, where the place waiting for it was; when the list opens, every order is new to it.
 */
export function placed(places: readonly number[], hung: readonly Standing[]): Standing[] {
  const kept = places.flatMap((id) => hung.find((s) => s.id === id) ?? []);
  const fresh = hung.filter((s) => !places.includes(s.id));
  return [...(kept.length < places.length ? filledFirst(kept) : kept), ...filledFirst(fresh)];
}

function orders(_art: Art, body: HTMLElement): () => void {
  let live: (() => void)[] = [];
  let places: number[] = [];
  const build = (): void => {
    const w = S.world;
    live = [];
    const o = storyOrder(w);
    const kids: HTMLElement[] = [];
    if (o) {
      const rows = wants(o.want, () => S.world.filled);
      live.push(rows.update);
      const opens = opensThings(o);
      kids.push(
        el(
          "div",
          "k-paper order",
          {},
          el("div", "k-label", { text: `${storyLabel()} · from ${o.from}` }),
          el("div", "k-title", { text: o.title }),
          el("div", "k-read k-dim", { text: o.say }),
          ...rows.rows,
          el(
            "div",
            "k-row",
            {},
            el("div", "k-grow opens", {}, opens.length > 0 ? el("span", "k-label", { text: "Opens" }) : null, ...opens),
            el("span", "k-chip", {}, amount("coin", o.pay)),
          ),
        ),
      );
    } else kids.push(el("div", "k-paper order", {}, el("div", "k-title", { text: "Story complete" })));
    kids.push(el("div", "k-label", { text: "Side orders" }));
    if (!w.open.board)
      kids.push(
        el("div", "k-d", { text: `Unlock when you fill story order ${BOARD_AT + 1}: ${STORY[BOARD_AT]?.title}.` }),
      );
    const shown = placed(places, w.board);
    places = shown.map((s) => s.id);
    for (const s of shown) {
      const full = isFilled(s.want, s.filled);
      const filled = (): Tally => S.world.board.find((b) => b.id === s.id)?.filled ?? {};
      const rows = wants(s.want, filled);
      live.push(rows.update);
      const why = swapRefusal(w, s.id);
      const ask = `swap:${s.id}`;
      const act = full
        ? button("sm", ["Hand over"], () => {
            panelHooks.handOver(s.id);
          })
        : button(
            `wood sm${why === null ? "" : " off"}${asking(ask) ? " asking" : ""}`,
            [asksAgain(ask, ["Swap"], "Swap?")],
            (b) => {
              const no = swapRefusal(S.world, s.id);
              // The list moves up under the pointer after a hand over: what has been delivered is not lost to one press.
              if (no === null && Object.values(filled()).some((n) => n > 0) && !pressedTwice(ask, build)) return;
              if (no !== null || "refused" in doNow({ do: "swap", order: s.id })) {
                yardSfx.no();
                replay(b, "shake");
                feed(`${no ?? "It cannot be swapped"}.`, "coral");
                return;
              }
              sfx.paper();
              panelHooks.changed();
            },
          );
      if (!full)
        tip(
          act,
          "Swap",
          why ?? `Replaces this order with a new one. Free, once every ${(SWAP_EVERY * TICK_MS) / 60_000} minutes.`,
        );
      // The button is in the card's first line, so it is in the same spot whatever the card's height.
      kids.push(
        el(
          "div",
          full ? "k-card order ready" : "k-card order",
          { "data-order": s.id },
          el("div", "from", {}, el("span", "k-label", { text: s.from }), el("span", "k-grow"), act),
          el(
            "div",
            "k-row",
            {},
            el("div", "k-grow k-name", { text: s.title }),
            el("span", "k-chip", {}, amount("coin", s.pay)),
          ),
          el("div", "k-d", { text: s.line }),
          ...rows.rows,
        ),
      );
    }
    // A place on the board Leaf has yet to hang an order in: last, and the order takes this place.
    if (w.open.board)
      for (let n = w.board.length; n < w.rates.slots; n++)
        kids.push(el("div", "k-card order waiting", {}, el("div", "k-dim", { text: "A new order is on its way." })));
    // A list shorter than it is scrolled would slide down: it keeps that much room at its end.
    const top = body.scrollTop;
    const need = top + body.clientHeight;
    // Whoever is on an order's button with the keyboard is put back on that order's button, drawn again.
    const on = document.activeElement?.closest<HTMLElement>("[data-order]")?.dataset.order;
    body.replaceChildren(...kids);
    if (on !== undefined)
      body.querySelector<HTMLElement>(`[data-order="${on}"] .k-btn`)?.focus({ preventScroll: true });
    if (top > 0 && need > body.scrollHeight)
      body.append(el("div", "", { style: `flex: none; height: ${need - body.scrollHeight}px` }));
    body.scrollTop = top;
  };
  const shape = when(
    () =>
      `${S.world.story}|${S.world.open.board}|${S.world.rates.slots}|${S.world.board
        .map((s) => `${s.id}:${isFilled(s.want, s.filled)}:${swapRefusal(S.world, s.id) === null}`)
        .join()}`,
    build,
  );
  return () => {
    shape();
    for (const f of live) f();
  };
}

// ---------- plans ----------

/** The plans as the small tree they are: each line is one branch, a later plan hanging off an earlier. */
const BRANCHES: readonly { label: string; plans: readonly PlanId[] }[] = [
  { label: "Gatherers", plans: ["rakes", "barrows"] },
  { label: "Machines", plans: ["tooling", "jigs"] },
  { label: "Belts", plans: ["waxed", "rollers"] },
  { label: "New things to build", plans: ["boiler", "tunnel", "workshop"] },
  { label: "The yard", plans: ["flywheel", "tallpylons", "bigcrates", "fourth"] },
];

/** Why a plan cannot be had yet, without its own name on the front: "Unlocks when you fill order 3: Gears and frames." */
function later(why: string, name: string): string {
  const rest = why.startsWith(`${name} `) ? why.slice(name.length + 1) : why;
  return `${rest.charAt(0).toUpperCase()}${rest.slice(1)}.`;
}

function plans(_art: Art, body: HTMLElement): () => void {
  const build = (): void => {
    const w = S.world;
    const kids: HTMLElement[] = [];
    for (const branch of BRANCHES) {
      kids.push(el("div", "k-label", { text: branch.label }));
      const chained = branch.plans.length === 2;
      const cards = branch.plans.flatMap((id, n) => {
        const plan = PLANS.find((p) => p.id === id);
        if (!plan) return [];
        const { state, why } = planState(w, id);
        const side =
          state === "owned"
            ? el("span", "k-chip lit", {}, icon("check"), "Yours")
            : state === "for sale"
              ? button(
                  `${coins() >= plan.price ? "sm" : "sm off"}${asking(planRef(id)) ? " asking" : ""}`,
                  [asksAgain(planRef(id), [icon("coin"), plan.price.toLocaleString("en-US")], "Buy?")],
                  (b) => {
                    // What spends is asked once more, when the Coins are there to spend.
                    if (coins() >= plan.price && !pressedTwice(planRef(id), build)) return;
                    if (!buyIdea(id)) replay(b, "shake");
                    else feed(`${plan.name}: ${plan.what}`, "gold");
                    panelHooks.changed();
                  },
                )
              : el("span", "k-chip", {}, icon("lock"), plan.price.toLocaleString("en-US"));
        const card = el(
          "div",
          `k-card plan ${state === "owned" ? "owned" : state === "not yet" ? "locked" : ""}`,
          {},
          el("div", "k-row", {}, el("div", "k-grow", {}, thing(planRef(id))), side),
          el("div", "k-d", { text: plan.what }),
          state === "not yet" && why ? el("div", "k-d k-gold", { text: later(why, plan.name) }) : null,
        );
        return chained && n > 0 ? [el("div", "twig"), card] : [card];
      });
      if (chained) kids.push(el("div", "branch", {}, ...cards));
      else kids.push(...cards);
    }
    body.replaceChildren(...kids);
  };
  return when(
    () => `${S.world.story}|${S.world.plans.join()}|${PLANS.map((p) => (coins() >= p.price ? 1 : 0)).join("")}`,
    build,
  );
}

// ---------- the depot's books ----------

function depot(_art: Art, body: HTMLElement): () => void {
  const build = (): void => {
    const w = S.world;
    const ticks = w.pace.ticks;
    const perHour = (k: (typeof ITEMS)[number]): number => (ticks > 0 ? ((w.pace.made[k] ?? 0) / ticks) * 36_000 : 0);
    const rows = ITEMS.flatMap((k) => ((w.depot[k] ?? 0) > 0 || perHour(k) > 0 ? [k] : [])).flatMap((k) => [
      thing(itemRef(k)),
      el("span", "num k-gold", {
        text: perHour(k) >= 1 ? `${Math.round(perHour(k)).toLocaleString("en-US")} an hour` : "",
      }),
      el("span", "num k-dim", { text: Math.floor(w.depot[k] ?? 0).toLocaleString("en-US") }),
    ]);
    const hourly = ITEMS.reduce((sum, k) => sum + perHour(k) * ITEM[k].worth, 0);
    const spare = KINDS.flatMap((kind) => {
      const left = w.spare[kind] ?? 0;
      return left > 0 && STARTERS[kind] ? [`${left} ${KIND[kind].name.toLowerCase()}${left === 1 ? "" : "s"}`] : [];
    });
    body.replaceChildren(
      el("div", "k-label", { text: "How you are paid" }),
      el("div", "k-d", { text: "A story order pays when it is filled." }),
      el("div", "k-d", { text: "A side order pays when you hand it over." }),
      el("div", "k-d", {
        text: `Every item the depot takes also pays ${DEPOT_SHARE * 100}% of its worth, whether or not an order asks for it.`,
      }),
      el("div", "k-d", {
        text: `The yard keeps working for up to ${AWAY_MOST_MS / 3_600_000} hours while you are away. What it earned is added to your Coins when you come back to the Works.`,
      }),
      el(
        "div",
        "k-card",
        {},
        el(
          "div",
          "k-grow",
          {},
          "Coming in now",
          el("div", "k-d", {
            text:
              w.pace.warm > 0 || ticks < 200
                ? "Still measuring: the yard changed a moment ago."
                : `Worth ${Math.round(hourly).toLocaleString("en-US")} Coins per hour when it fills orders. The depot alone pays ${Math.max(0, Math.round(hourly * DEPOT_SHARE))} per hour.`,
          }),
        ),
      ),
      rows.length > 0
        ? el("div", "rows", {}, ...rows)
        : el("div", "k-dim", { text: "Nothing has reached the depot yet." }),
      el(
        "div",
        "k-card",
        {},
        el(
          "div",
          "k-grow",
          {},
          "In total",
          el("div", "k-d", {
            text: `${Math.floor(w.paid).toLocaleString("en-US")} Coins from orders, ${Math.floor(w.sold).toLocaleString("en-US")} from the depot. ${w.story} of ${STORY.length} story orders, ${w.done} side orders.`,
          }),
        ),
      ),
      ...(spare.length > 0 ? [el("div", "k-dim", { text: `Free pieces left to place: ${spare.join(", ")}.` })] : []),
    );
  };
  return when(() => `${Math.floor(S.world.tick / 20)}|${S.rev}`, build);
}

// ---------- power ----------

/** A line of the power book: what, how many, and the power that comes to. */
const row = (name: string, about: string, n: number, lit = false): HTMLElement[] => [
  el("span", "", { text: name }),
  el("span", "k-s k-dim", { text: about }),
  el("span"),
  el("span", lit ? "num k-gold" : "num", { text: String(n) }),
];

function powerBook(_art: Art, body: HTMLElement): () => void {
  const build = (): void => {
    const w = S.world;
    const p = power(w);
    const lit = w.power ?? repower(w);
    const count = (kind: Kind, live: boolean): number =>
      w.cells.reduce((n, b, i) => n + (b?.kind === kind && (lit[i] === 1) === live ? 1 : 0), 0);
    const burning = w.cells.reduce((n, b, i) => n + (b?.kind === "boiler" && lit[i] === 1 && b.fuel > 0 ? 1 : 0), 0);
    const cold = count("boiler", true) - burning;
    const gives = [
      ...row("The depot", "always", w.rates.depot, true),
      ...(count("wheel", true) + count("wheel", false) > 0
        ? row(
            "Waterwheels",
            `${count("wheel", true)} turning${count("wheel", false) ? `, ${count("wheel", false)} out of reach` : ""}`,
            count("wheel", true) * KIND.wheel.gives,
            true,
          )
        : []),
      ...(count("boiler", true) + count("boiler", false) > 0
        ? row("Boilers", `${burning} burning${cold ? `, ${cold} cold` : ""}`, burning * KIND.boiler.gives, true)
        : []),
    ];
    const draws = (["gatherer", "mill", "bench", "workshop"] as const).flatMap((k) => {
      const n = count(k, true);
      const dark = count(k, false);
      return n + dark > 0
        ? row(
            `${KIND[k].name}s`,
            `${n} in reach${dark ? `, ${dark} in the dark` : ""}, ${KIND[k].draw} each`,
            n * KIND[k].draw,
          )
        : [];
    });
    body.replaceChildren(
      el(
        "div",
        "k-d",
        {},
        "Lit tiles have power. The depot and every pylon connected to it light the tiles around them. A machine on a dark tile does not work and uses no power.",
      ),
      el("div", "k-dim", { text: `Made: ${p.supply}` }),
      el("div", "rows", {}, ...gives),
      el("div", "k-dim", { text: `Used: ${p.demand}` }),
      draws.length > 0 ? el("div", "rows", {}, ...draws) : el("div", "k-dim", { text: "Nothing is using power yet." }),
      el(
        "div",
        p.pace < 1 ? "k-card lit" : "k-card",
        {},
        el(
          "div",
          "k-grow",
          {},
          p.pace < 1 ? `Not enough power: every machine works at ${Math.round(p.pace * 100)}% speed` : "Enough power",
          el("div", "k-d", {
            text:
              p.pace < 1
                ? "To make more power, build a waterwheel beside the stream or a boiler fed with deadfall. To use less, remove machines that are doing nothing."
                : `${p.supply - p.demand} power to spare.`,
          }),
        ),
      ),
    );
  };
  return when(() => `${S.rev}|${power(S.world).supply}|${power(S.world).demand}`, build);
}

// ---------- the second shift ----------

function shift(_art: Art, body: HTMLElement): () => void {
  // It is bought with Leaf, which nothing in town may spend yet: the button shows itself closed.
  const go = el(
    "button",
    "k-btn leaf wide",
    { type: "button" },
    icon("leaf"),
    el("span", "", { text: String(SHIFT.leaf) }),
    "Start a second shift",
  );
  closeLeaf(go, `${SHIFT.leaf} Leaf`);
  body.append(
    el(
      "div",
      "k-d",
      {},
      `For ${SHIFT.minutes} minutes, gatherers, machines and belts all work twice as fast, whether or not the page is open. It unlocks nothing.`,
    ),
    go,
  );
  return () => {};
}

// ---------- opening and closing ----------

const BUILD: Record<PanelId, (art: Art, body: HTMLElement) => () => void> = {
  orders,
  board,
  plans,
  depot,
  power: powerBook,
  shift,
};
const HEAD: Record<PanelId, () => Node> = {
  orders: () => yardIcon("orders"),
  board: () => yardIcon("board"),
  plans: () => yardIcon("plans"),
  depot: () => yardIcon("depot"),
  power: () => yardIcon("bolt"),
  shift: () => yardIcon("shift"),
};

let refresh: (() => void) | null = null;
let theArt: Art | null = null;

export function initPanels(art: Art): void {
  theArt = art;
}

export function openPanel(id: PanelId): void {
  if (S.panel === id || !theArt) return;
  tipOff();
  S.panel = id;
  const p = $("panel");
  p.hidden = true;
  p.replaceChildren();
  const x = el(
    "button",
    "k-btn wood icon sm",
    { type: "button", "aria-label": "Close", onclick: closePanel },
    icon("close"),
  );
  p.append(el("header", "k-head", {}, HEAD[id](), el("h2", "k-title", { text: TITLES[id] }), x));
  const body = el("div", "k-body k-scroll");
  p.append(body);
  refresh = BUILD[id](theArt, body);
  refresh();
  p.hidden = false;
  replay(p, "slide");
  sfx.open();
  document.body.classList.add("panel-open");
  panelHooks.changed();
}

export function closePanel(): void {
  if (!S.panel) return;
  S.panel = null;
  $("panel").hidden = true;
  $("panel").replaceChildren();
  refresh = null;
  tipOff();
  sfx.close();
  document.body.classList.remove("panel-open");
  panelHooks.changed();
}

export function togglePanel(id: PanelId): void {
  if (S.panel === id) closePanel();
  else openPanel(id);
}

export function refreshPanel(): void {
  refresh?.();
}

/** The part of the page the panel is covering, if one is open. */
export function panelBox(): DOMRect | null {
  return S.panel ? $("panel").getBoundingClientRect() : null;
}

/** What an order asks for, in a sentence, for a tip. */
export const asks = (want: Tally): string => wantWords(want);
