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
  holderOf,
  isFilled,
  isNode,
  type Item,
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
import { $, button, shows, unlockWords, wantWords, yardIcon } from "./parts.ts";

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

/** Each thing an order or a node wants, with how many: as a panel prints it, and builds its bars from. */
type Wants = readonly (readonly [Item, number])[];
const wantsIn = (want: Counts): Wants =>
  ALL_ITEMS.filter((k) => (want[k] ?? 0) > 0).map((k) => [k, want[k] ?? 0] as const);

/**
 * Rows for what an order wants, and a way to bring their bars up to date without rebuilding them:
 * the bars are drawn from the yard at every refresh, and so are never behind it.
 */
function wants(want: Wants, filled: () => Counts | null): { rows: HTMLElement[]; update: () => void } {
  const parts = want.map(([k, of]) => {
    const bar = el("i");
    const count = el("span", "n");
    const holder = el("div", "k-bar", {}, bar);
    const row = el("div", "want", {}, thing(itemRef(k)), holder, count);
    return { k, of, bar, count, holder, row };
  });
  const update = (): void => {
    const f = filled();
    for (const p of parts) {
      const have = Math.min(f?.[p.k] ?? 0, p.of);
      p.bar.style.setProperty("--v", `${(have / p.of) * 100}%`);
      p.count.textContent = `${have} / ${p.of}`;
      p.holder.classList.toggle("leaf", have >= p.of);
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

/** An order on the list, as far as where it goes in the list is concerned: which it is, and whether it is filled. */
interface Placed {
  readonly id: number;
  readonly full: boolean;
}

const filledFirst = <T extends Placed>(list: readonly T[]): T[] =>
  list.toSorted((a, b) => Number(b.full) - Number(a.full));

/**
 * The side orders in the places the list shows them, given the places it showed them in (by id).
 * An order still on the board keeps its place, so one that fills does not move. When one has left
 * (handed over or swapped), those that stay are put filled first. An order new to the list goes
 * last, where the place waiting for it was; when the list opens, every order is new to it.
 */
export function placed<T extends Placed>(places: readonly number[], hung: readonly T[]): T[] {
  const kept = places.flatMap((id) => hung.find((s) => s.id === id) ?? []);
  const fresh = hung.filter((s) => !places.includes(s.id));
  return [...(kept.length < places.length ? filledFirst(kept) : kept), ...filledFirst(fresh)];
}

/** An order of the board as the orders panel prints it: its words and pay, what it wants, whether it is filled or counts yet, and why it cannot be swapped now. */
interface OrderLine extends Placed {
  readonly from: string;
  readonly title: string;
  readonly line: string;
  readonly pay: number;
  readonly want: Wants;
  readonly counting: boolean;
  readonly why: string | null;
}

/** What the orders panel prints: the node in hand and how it is spoken of, whether the board is up and its places, and each order. */
export function ordersPrint(): {
  readonly hand: Goal | -1;
  readonly label: string;
  readonly board: boolean;
  readonly hooks: number;
  readonly orders: readonly OrderLine[];
} {
  const w = S.world;
  return {
    hand: w.hand,
    label: handLabel(),
    board: w.open.board,
    hooks: w.open.hooks,
    orders: w.board.map((s) => ({
      id: s.id,
      full: isFilled(s.want, s.filled),
      from: s.from,
      title: s.title,
      line: s.line,
      pay: s.pay,
      want: wantsIn(s.want),
      counting: counting(s, w.tick),
      why: swapRefusal(w, s.id),
    })),
  };
}

function orders(_art: Art, body: HTMLElement): () => void {
  let live: (() => void)[] = [];
  let places: number[] = [];
  const draw = (p: ReturnType<typeof ordersPrint>): void => {
    live = [];
    const g = p.hand;
    const o = g === -1 ? undefined : GOALS[g];
    const node = g === -1 ? undefined : NODES[g];
    const kids: HTMLElement[] = [];
    if (g !== -1 && o && node) {
      const rows = wants(wantsIn(o.want), () => S.world.got[g] ?? null);
      live.push(rows.update);
      const opens = opensThings(g);
      kids.push(
        el(
          "div",
          "k-paper order",
          {},
          el("div", "k-label", { text: `${p.label} · from ${node.from}` }),
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
    if (!p.board)
      kids.push(
        el("div", "k-d", {
          text: `Unlock when you fill lesson ${LESSONS.indexOf(BOARD_AT) + 1}: ${GOALS[BOARD_AT]?.title}.`,
        }),
      );
    const shown = placed(places, p.orders);
    places = shown.map((s) => s.id);
    for (const s of shown) {
      const filled = (): Counts | null => S.world.board.find((b) => b.id === s.id)?.filled ?? null;
      const rows = wants(s.want, filled);
      live.push(rows.update);
      const ask = `swap:${s.id}`;
      const act = s.full
        ? button("sm", ["Hand over"], () => {
            panelHooks.handOver(s.id);
          })
        : button(
            `wood sm${s.why === null ? "" : " off"}${asking(ask) ? " asking" : ""}`,
            [asksAgain(ask, ["Swap"], "Swap?")],
            (b) => {
              const no = swapRefusal(S.world, s.id);
              // The list moves up under the pointer after a hand over: what has been delivered is not lost to one press.
              if (no === null && (filled()?.some((n) => n > 0) ?? false) && !pressedTwice(ask, again)) return;
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
      if (!s.full)
        tip(
          act,
          "Swap",
          s.why ?? `Replaces this order with a new one. Free, once every ${(SWAP_EVERY * TICK_MS) / 60_000} minutes.`,
        );
      // The button is in the card's first line, so it is in the same spot whatever the card's height.
      kids.push(
        el(
          "div",
          // One Leaf has just hung is quiet until it counts.
          s.full ? "k-card order ready" : s.counting ? "k-card order" : "k-card order hung",
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
    if (p.board)
      for (let n = p.orders.length; n < p.hooks; n++)
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
  /** Draws the list again as it is now: for a button that asks to be pressed twice. */
  const again = (): void => draw(ordersPrint());
  const shape = shows(ordersPrint, draw);
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
 * What the projects panel prints: the node in hand; each project or commission of the tiers open
 * not yet done that may be taken (or a commission that may not yet), with the titles of what it still
 * needs first; and those done.
 */
export function projectsPrint(): {
  readonly hand: Goal | -1;
  readonly open: readonly { readonly goal: Goal; readonly take: boolean; readonly needs: readonly string[] }[];
  readonly done: readonly Goal[];
} {
  const w = S.world;
  const nodes = nodesOpen();
  return {
    hand: w.hand,
    open: nodes.flatMap((g) => {
      const info = GOALS[g];
      if (!info || w.open.done[g] === 1) return [];
      const take = ready(w.open, g);
      // Nothing that is not ready is shown, but for the commission, with what it still needs.
      if (!take && info.kind !== "commission") return [];
      return [
        { goal: g, take, needs: info.needs.filter((n) => w.open.done[n] !== 1).map((n) => GOALS[n]?.title ?? "") },
      ];
    }),
    done: nodes.filter((g) => w.open.done[g] === 1),
  };
}

/**
 * The projects as a list: each that may be taken up (and the commission), with what it wants and
 * has been given and what it unlocks, and one button that takes it in hand; the one in hand marked.
 * A commission not ready yet says what it still needs. The done ones follow, plainly.
 */
function projects(_art: Art, body: HTMLElement): () => void {
  let live: (() => void)[] = [];
  const draw = (p: ReturnType<typeof projectsPrint>): void => {
    live = [];
    const kids: HTMLElement[] = [];
    for (const { goal: g, take, needs } of p.open) {
      const info = GOALS[g];
      if (!info) continue;
      const held = p.hand === g;
      const side = held
        ? el("span", "k-chip lit", {}, icon("check"), "In hand")
        : take
          ? button("sm", ["Take"], (b) => {
              if (takeInHand(g) !== null) replay(b, "shake");
              else feed(`In hand: ${info.title}.`, "gold");
              panelHooks.changed();
            })
          : el("span", "k-chip", {}, icon("lock"), "Not yet");
      const rows = wants(wantsIn(info.want), () => S.world.got[g] ?? null);
      live.push(rows.update);
      const opens = opensThings(g);
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
    if (p.done.length > 0) kids.push(el("div", "k-label", { text: "Done" }));
    for (const g of p.done)
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
  const shape = shows(projectsPrint, draw);
  return () => {
    shape();
    for (const f of live) f();
  };
}

// ---------- the depot's books ----------

/**
 * What the depot's book prints, each number as it is printed: what the depot has taken in of each
 * thing and how many an hour come in now, what that is worth an hour (or that the yard is still
 * being measured), what has been earned in all, the nodes done and orders handed over, the pieces to
 * hand, and how long the yard works on while its owner is away.
 */
export function depotPrint(): {
  readonly rows: readonly (readonly [Item, string, string])[];
  readonly measuring: boolean;
  readonly hourly: string;
  readonly alone: number;
  readonly paid: string;
  readonly sold: string;
  readonly nodes: number;
  readonly handed: number;
  readonly spare: readonly string[];
  readonly away: number;
} {
  const w = S.world;
  const ticks = w.pace.ticks;
  const perHour = (k: number): number => (ticks > 0 ? ((w.pace.made[k] ?? 0) / ticks) * 36_000 : 0);
  const hourly = ALL_ITEMS.reduce((sum, k) => sum + perHour(k) * (ITEM_INFO[k]?.worth ?? 0), 0);
  return {
    rows: ALL_ITEMS.flatMap((k) =>
      (w.depot[k] ?? 0) > 0 || perHour(k) > 0
        ? [
            [
              k,
              perHour(k) >= 1 ? `${Math.round(perHour(k)).toLocaleString("en-US")} an hour` : "",
              Math.floor(w.depot[k] ?? 0).toLocaleString("en-US"),
            ] as const,
          ]
        : [],
    ),
    measuring: w.pace.warm > 0 || ticks < 200,
    hourly: Math.round(hourly).toLocaleString("en-US"),
    alone: Math.max(0, Math.round(hourly * DEPOT_SHARE)),
    paid: Math.floor(w.paid / MILLI).toLocaleString("en-US"),
    sold: Math.floor(w.sold / MILLI).toLocaleString("en-US"),
    nodes: w.done.filter(isNode).length,
    handed: w.handed,
    spare: ALL_KINDS.flatMap((k) => {
      const left = w.spare[k] ?? 0;
      const name = (KIND_INFO[k]?.name ?? "").toLowerCase();
      return left > 0 && (STARTING[k] ?? 0) > 0 ? [`${left} ${name}${left === 1 ? "" : "s"}`] : [];
    }),
    away: (w.open.away * TICK_MS) / 3_600_000,
  };
}

function depot(_art: Art, body: HTMLElement): () => void {
  const draw = (p: ReturnType<typeof depotPrint>): void => {
    const rows = p.rows.flatMap(([k, hour, total]) => [
      thing(itemRef(k)),
      el("span", "num k-gold", { text: hour }),
      el("span", "num k-dim", { text: total }),
    ]);
    body.replaceChildren(
      el("div", "k-label", { text: "How you are paid" }),
      el("div", "k-d", { text: "A lesson or a commission pays when it is filled." }),
      el("div", "k-d", { text: "A side order pays when you hand it over." }),
      el("div", "k-d", {
        text: `Every item the depot takes also pays ${DEPOT_SHARE * 100}% of its worth, whether or not an order asks for it.`,
      }),
      el("div", "k-d", {
        text: `The yard keeps working for up to ${p.away} hours while you are away. What it earned is added to your Coins when you come back to the Works.`,
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
            text: p.measuring
              ? "Still measuring: the yard changed a moment ago."
              : `Worth ${p.hourly} Coins per hour when it fills orders. The depot alone pays ${p.alone} per hour.`,
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
            text: `${p.paid} Coins from orders, ${p.sold} from the depot. ${p.nodes} of ${NODE_COUNT} lessons, projects and commissions, ${p.handed} side orders.`,
          }),
        ),
      ),
      ...(p.spare.length > 0
        ? [el("div", "k-dim", { text: `Free pieces left to place: ${p.spare.join(", ")}.` })]
        : []),
    );
  };
  return shows(depotPrint, draw);
}

// ---------- power ----------

/** A line of the power book: what, how many, and the power that comes to. */
const row = (name: string, about: string, n: number, lit = false): HTMLElement[] => [
  el("span", "", { text: name }),
  el("span", "k-s k-dim", { text: about }),
  el("span"),
  el("span", lit ? "num k-gold" : "num", { text: String(n) }),
];

/**
 * What the power book prints: the power made and used, and the pace when short; what the depot
 * gives; the waterwheels turning and out of reach; the boilers burning and cold; and for each kind
 * that draws, how many are in reach and in the dark, and what those in reach draw.
 */
export function powerPrint(): {
  readonly supply: number;
  readonly demand: number;
  readonly pace: number;
  readonly depot: number;
  readonly wheels: readonly [number, number];
  readonly boilers: readonly [number, number, number];
  readonly draws: readonly (readonly [Kind, number, number, number])[];
} {
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
    const r = holderOf(w, i);
    return n + (there === BOILER && lit[i] === 1 && r >= 0 && (w.holders.fuel[r] ?? 0) > 0 ? 1 : 0);
  }, 0);
  return {
    supply: p.supply,
    demand: p.demand,
    // Rounded down: a yard a little short of power is at 99%, never at 100%.
    pace: Math.floor(p.pace * 100),
    depot: w.open.depot,
    wheels: [count(WHEEL, true), count(WHEEL, false)],
    boilers: [count(BOILER, true), count(BOILER, false), burning],
    draws: [GATHERER, MILL, BENCH, WORKSHOP, STUDY].map((k) => [k, count(k, true), count(k, false), drawn(k)] as const),
  };
}

function powerBook(_art: Art, body: HTMLElement): () => void {
  const draw = (p: ReturnType<typeof powerPrint>): void => {
    const [turning, away] = p.wheels;
    const [hot, far, burning] = p.boilers;
    const cold = hot - burning;
    const short = p.pace < 100;
    const gives = [
      ...row("The depot", "always", p.depot, true),
      ...(turning + away > 0
        ? row(
            "Waterwheels",
            `${turning} turning${away ? `, ${away} out of reach` : ""}`,
            turning * (GIVES[WHEEL] ?? 0),
            true,
          )
        : []),
      ...(hot + far > 0
        ? row("Boilers", `${burning} burning${cold ? `, ${cold} cold` : ""}`, burning * (GIVES[BOILER] ?? 0), true)
        : []),
    ];
    const draws = p.draws.flatMap(([k, n, dark, drawn]) => {
      const name = KIND_INFO[k]?.name ?? "";
      return n + dark > 0
        ? row(`${name}s`, `${n} in reach${dark ? `, ${dark} in the dark` : ""}, ${DRAW[k] ?? 0} each`, drawn)
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
        short ? "k-card lit" : "k-card",
        {},
        el(
          "div",
          "k-grow",
          {},
          short ? `Not enough power: every machine works at ${p.pace}% speed` : "Enough power",
          el("div", "k-d", {
            text: short
              ? "To make more power, build a waterwheel beside the stream or a boiler fed with deadfall. To use less, remove machines that are doing nothing."
              : `${p.supply - p.demand} power to spare.`,
          }),
        ),
      ),
    );
  };
  return shows(powerPrint, draw);
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
