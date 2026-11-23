/**
 * The yard's books, each a panel: the orders, the projects, what the depot has taken in, and where
 * the power comes from and goes.
 */

import {
  ALL_GOALS,
  ALL_ITEMS,
  ALL_KINDS,
  BENCH,
  BOILER,
  counting,
  type Counts,
  DEPOT_SHARE,
  DRAW,
  DRAWN,
  GATHERER,
  GIVES,
  type Goal,
  goal,
  GOALS,
  HALF,
  isFilled,
  isNode,
  item,
  ITEM_INFO,
  type Kind,
  kind,
  KIND_INFO,
  litOf,
  MILL,
  MILLI,
  NODE_COUNT,
  NODES,
  plot,
  power,
  ready,
  type Standing,
  STARTING,
  STUDY,
  SWAP_EVERY,
  swapRefusal,
  TICK_MS,
  WHEEL,
  WORKSHOP,
} from "@sequoia-leaf/factory";
import { thing } from "@sequoia-leaf/kit/card.ts";
import { amount, asking, asksAgain, el, icon, pressedTwice, replay } from "@sequoia-leaf/kit/dom.ts";
import { sfx } from "@sequoia-leaf/kit/sound.ts";
import { tip, tipOff } from "@sequoia-leaf/kit/tip.ts";

import type { Art } from "../art/index.ts";
import { yardSfx } from "../sound.ts";
import { S } from "../state.ts";
import { takeInHand } from "../tools.ts";
import { doNow } from "../yard.ts";
import { board } from "./board.ts";
import { itemRef, machineRef, nodeRef, plotRef } from "./card.ts";
import { feed, handLabel } from "./notes.ts";
import { $, button, unlockWords, wantWords, when, yardIcon } from "./parts.ts";

export type PanelId = "orders" | "board" | "projects" | "depot" | "power";

/** What the panels ask of the rest of the screen. */
export const panelHooks: {
  /** Hand a filled standing order over, by its id. */
  handOver: (order: number) => void;
  changed: () => void;
} = { handOver: () => {}, changed: () => {} };

const TITLES: Record<PanelId, string> = {
  orders: "Orders",
  board: "Top yards",
  projects: "Projects",
  depot: "The depot",
  power: "Power",
};

// ---------- what an order wants ----------

/** Rows for what an order wants, and a way to bring their bars up to date without rebuilding them. */
function wants(want: Counts, filled: () => Counts | null): { rows: HTMLElement[]; update: () => void } {
  const parts = ALL_ITEMS.filter((k) => (want[k] ?? 0) > 0).map((k) => {
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
      const have = Math.min(f?.[p.k] ?? 0, n);
      p.bar.style.setProperty("--v", `${(have / n) * 100}%`);
      p.count.textContent = `${have} / ${n}`;
      p.holder.classList.toggle("leaf", have >= n);
    }
  };
  update();
  return { rows: parts.map((p) => p.row), update };
}

/** What a node unlocks, each machine, recipe and plot as a thing that explains itself. */
export function opensThings(g: Goal): HTMLElement[] {
  const u = GOALS[g]?.unlocks ?? {};
  return [
    ...(u.kinds ?? []).map((k) => thing(machineRef(kind(k)))),
    ...(u.recipes ?? []).map((n) => thing(itemRef(item(n)))),
    ...(u.plots ?? []).map((id) => thing(plotRef(plot(id)))),
    ...unlockWords(u).map((words) => el("b", "", { text: `${words.charAt(0).toUpperCase()}${words.slice(1)}` })),
  ];
}

/** The lesson that unlocks side orders, and its place among the lessons. */
const BOARD_AT = ALL_GOALS.find((g) => GOALS[g]?.unlocks.board === true) ?? goal("gears");

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
    const g = w.hand;
    const o = g === -1 ? undefined : GOALS[g];
    const node = g === -1 ? undefined : NODES[g];
    const kids: HTMLElement[] = [];
    if (g !== -1 && o && node) {
      const rows = wants(o.want, () => S.world.got[g] ?? null);
      live.push(rows.update);
      const opens = opensThings(g);
      kids.push(
        el(
          "div",
          "k-paper order",
          {},
          el("div", "k-label", { text: `${handLabel()} · from ${node.from}` }),
          el("div", "k-title", { text: o.title }),
          el("div", "k-read k-dim", { text: node.say }),
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
    } else
      kids.push(
        el(
          "div",
          "k-paper order",
          {},
          el("div", "k-title", { text: "No project in hand" }),
          el("div", "k-read k-dim", { text: "Take one in Projects." }),
        ),
      );
    kids.push(el("div", "k-label", { text: "Side orders" }));
    if (!w.open.board)
      kids.push(
        el("div", "k-d", {
          text: `Unlock when you fill lesson ${LESSONS.indexOf(BOARD_AT) + 1}: ${GOALS[BOARD_AT]?.title}.`,
        }),
      );
    const shown = placed(places, w.board);
    places = shown.map((s) => s.id);
    for (const s of shown) {
      const full = isFilled(s.want, s.filled);
      const filled = (): Counts | null => S.world.board.find((b) => b.id === s.id)?.filled ?? null;
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
              if (no === null && (filled()?.some((n) => n > 0) ?? false) && !pressedTwice(ask, build)) return;
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
          // One Leaf has just hung is quiet until it counts.
          full ? "k-card order ready" : counting(s, w.tick) ? "k-card order" : "k-card order hung",
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
      for (let n = w.board.length; n < w.open.hooks; n++)
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
      `${S.world.hand}|${S.world.open.board}|${S.world.open.hooks}|${S.world.board
        .map(
          (s) =>
            `${s.id}:${isFilled(s.want, s.filled)}:${swapRefusal(S.world, s.id) === null}:${counting(s, S.world.tick)}`,
        )
        .join()}`,
    build,
  );
  return () => {
    shape();
    for (const f of live) f();
  };
}

// ---------- projects ----------

/** Whether there are projects at all: from tier 1 on, and not in somebody else's yard. */
export const projectsOpen = (): boolean => S.world.open.tier >= 1 && S.visiting === null;

/** The projects and commissions of the tiers open, in their order. */
const nodesOpen = (): Goal[] =>
  ALL_GOALS.filter((g) => {
    const info = GOALS[g];
    return isNode(g) && info !== undefined && info.kind !== "lesson" && info.tier <= S.world.open.tier;
  });

/** The projects and the commission that may be taken in hand now, but for the one in hand. */
export const takeable = (): Goal[] => nodesOpen().filter((g) => g !== S.world.hand && ready(S.world.open, g));

/**
 * The projects as a list: each that may be taken up (and the commission), with what it wants and
 * has been given and what it unlocks, and one button that takes it in hand; the one in hand marked.
 * A commission not ready yet says what it still needs. The done ones follow, plainly.
 */
function projects(_art: Art, body: HTMLElement): () => void {
  let live: (() => void)[] = [];
  const build = (): void => {
    const w = S.world;
    live = [];
    const kids: HTMLElement[] = [];
    const nodes = nodesOpen();
    const open = nodes.filter((g) => w.open.done[g] !== 1);
    const done = nodes.filter((g) => w.open.done[g] === 1);
    for (const g of open) {
      const info = GOALS[g];
      if (!info) continue;
      const take = ready(w.open, g);
      // Nothing that is not ready is shown, but for the commission, with what it still needs.
      if (!take && info.kind !== "commission") continue;
      const held = w.hand === g;
      const side = held
        ? el("span", "k-chip lit", {}, icon("check"), "In hand")
        : take
          ? button("sm", ["Take"], (b) => {
              if (takeInHand(g) !== null) replay(b, "shake");
              else feed(`In hand: ${info.title}.`, "gold");
              panelHooks.changed();
            })
          : el("span", "k-chip", {}, icon("lock"), "Not yet");
      const rows = wants(info.want, () => S.world.got[g] ?? null);
      live.push(rows.update);
      const opens = opensThings(g);
      const needs = info.needs.filter((n) => w.open.done[n] !== 1).map((n) => GOALS[n]?.title ?? "");
      kids.push(
        el(
          "div",
          `k-card plan${held ? " owned" : take ? "" : " locked"}`,
          {},
          el("div", "k-row", {}, el("div", "k-grow", {}, thing(nodeRef(g))), side),
          el("div", "k-d", { text: NODES[g]?.say ?? "" }),
          ...rows.rows,
          opens.length > 0 ? el("div", "k-grow opens", {}, el("span", "k-label", { text: "Unlocks" }), ...opens) : null,
          needs.length > 0 ? el("div", "k-d k-gold", { text: `Needs ${needs.join(" and ")} first.` }) : null,
        ),
      );
    }
    if (done.length > 0) kids.push(el("div", "k-label", { text: "Done" }));
    for (const g of done)
      kids.push(
        el(
          "div",
          "k-card plan owned",
          {},
          el(
            "div",
            "k-row",
            {},
            el("div", "k-grow", {}, thing(nodeRef(g))),
            el("span", "k-chip lit", {}, icon("check"), "Done"),
          ),
        ),
      );
    body.replaceChildren(...kids);
  };
  const shape = when(() => `${S.world.hand}|${S.world.done.length}|${S.world.open.tier}`, build);
  return () => {
    shape();
    for (const f of live) f();
  };
}

// ---------- the depot's books ----------

function depot(_art: Art, body: HTMLElement): () => void {
  const build = (): void => {
    const w = S.world;
    const ticks = w.pace.ticks;
    const perHour = (k: number): number => (ticks > 0 ? ((w.pace.made[k] ?? 0) / ticks) * 36_000 : 0);
    const rows = ALL_ITEMS.flatMap((k) => ((w.depot[k] ?? 0) > 0 || perHour(k) > 0 ? [k] : [])).flatMap((k) => [
      thing(itemRef(k)),
      el("span", "num k-gold", {
        text: perHour(k) >= 1 ? `${Math.round(perHour(k)).toLocaleString("en-US")} an hour` : "",
      }),
      el("span", "num k-dim", { text: Math.floor(w.depot[k] ?? 0).toLocaleString("en-US") }),
    ]);
    const hourly = ALL_ITEMS.reduce((sum, k) => sum + perHour(k) * (ITEM_INFO[k]?.worth ?? 0), 0);
    const spare = ALL_KINDS.flatMap((k) => {
      const left = w.spare[k] ?? 0;
      const name = (KIND_INFO[k]?.name ?? "").toLowerCase();
      return left > 0 && (STARTING[k] ?? 0) > 0 ? [`${left} ${name}${left === 1 ? "" : "s"}`] : [];
    });
    body.replaceChildren(
      el("div", "k-label", { text: "How you are paid" }),
      el("div", "k-d", { text: "A lesson or a commission pays when it is filled." }),
      el("div", "k-d", { text: "A side order pays when you hand it over." }),
      el("div", "k-d", {
        text: `Every item the depot takes also pays ${DEPOT_SHARE * 100}% of its worth, whether or not an order asks for it.`,
      }),
      el("div", "k-d", {
        text: `The yard keeps working for up to ${(w.open.away * TICK_MS) / 3_600_000} hours while you are away. What it earned is added to your Coins when you come back to the Works.`,
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
            text: `${Math.floor(w.paid / MILLI).toLocaleString("en-US")} Coins from orders, ${Math.floor(w.sold / MILLI).toLocaleString("en-US")} from the depot. ${w.done.filter(isNode).length} of ${NODE_COUNT} lessons, projects and commissions, ${w.handed} side orders.`,
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
    const lit = litOf(w);
    const count = (k: Kind, live: boolean): number =>
      w.kind.reduce((n, there, i) => n + (there === k && (lit[i] === 1) === live ? 1 : 0), 0);
    /** What the pieces of a kind in reach draw, each at its grade. */
    const drawn = (k: Kind): number =>
      w.kind.reduce(
        (n, there, i) =>
          n + (there === k && lit[i] === 1 ? ((DRAW[k] ?? 0) * (DRAWN[w.grade[i] ?? 1] ?? HALF)) / HALF : 0),
        0,
      );
    const burning = w.kind.reduce((n, there, i) => {
      const r = w.row[i] ?? -1;
      return n + (there === BOILER && lit[i] === 1 && r >= 0 && (w.holders.fuel[r] ?? 0) > 0 ? 1 : 0);
    }, 0);
    const cold = count(BOILER, true) - burning;
    const gives = [
      ...row("The depot", "always", w.open.depot, true),
      ...(count(WHEEL, true) + count(WHEEL, false) > 0
        ? row(
            "Waterwheels",
            `${count(WHEEL, true)} turning${count(WHEEL, false) ? `, ${count(WHEEL, false)} out of reach` : ""}`,
            count(WHEEL, true) * (GIVES[WHEEL] ?? 0),
            true,
          )
        : []),
      ...(count(BOILER, true) + count(BOILER, false) > 0
        ? row("Boilers", `${burning} burning${cold ? `, ${cold} cold` : ""}`, burning * (GIVES[BOILER] ?? 0), true)
        : []),
    ];
    const draws = [GATHERER, MILL, BENCH, WORKSHOP, STUDY].flatMap((k) => {
      const n = count(k, true);
      const dark = count(k, false);
      const name = KIND_INFO[k]?.name ?? "";
      return n + dark > 0
        ? row(`${name}s`, `${n} in reach${dark ? `, ${dark} in the dark` : ""}, ${DRAW[k] ?? 0} each`, drawn(k))
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

// ---------- opening and closing ----------

const BUILD: Record<PanelId, (art: Art, body: HTMLElement) => () => void> = {
  orders,
  board,
  projects,
  depot,
  power: powerBook,
};
const HEAD: Record<PanelId, () => Node> = {
  orders: () => yardIcon("orders"),
  board: () => yardIcon("board"),
  projects: () => yardIcon("projects"),
  depot: () => yardIcon("depot"),
  power: () => yardIcon("bolt"),
};

let refresh: (() => void) | null = null;
let theArt: Art | null = null;

export function initPanels(art: Art): void {
  theArt = art;
}

export function openPanel(id: PanelId): void {
  // A panel is there only once it has something to say.
  if (S.panel === id || !theArt || (id === "projects" && !projectsOpen())) return;
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
export const asks = (want: Counts): string => wantWords(want);
/** The lessons, in their order. */
const LESSONS = ALL_GOALS.filter((g) => GOALS[g]?.kind === "lesson");
