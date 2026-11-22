/**
 * The yard's books, each a panel: the orders, the plans, what the depot has taken in, where the
 * power comes from and goes, and the second shift.
 */

import { thing } from "@sequoia-leaf/kit/card.ts";
import { amount, el, icon, replay } from "@sequoia-leaf/kit/dom.ts";
import { closeLeaf } from "@sequoia-leaf/kit/pursebar.ts";
import { sfx } from "@sequoia-leaf/kit/sound.ts";
import { tip, tipOff } from "@sequoia-leaf/kit/tip.ts";
import {
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
  SHIFT,
  type Standing,
  STARTERS,
  STORY,
  storyOrder,
  swapRefusal,
  type Tally,
} from "@sequoia-leaf/yard";

import type { Art } from "../art/index.ts";
import { yardSfx } from "../sound.ts";
import { S } from "../state.ts";
import { buyIdea } from "../tools.ts";
import { coins, doNow } from "../yard.ts";
import { itemRef, machineRef, planRef, plotRef } from "./card.ts";
import { feed, storyLabel } from "./notes.ts";
import { $, button, wantWords, when, yardIcon } from "./parts.ts";

export type PanelId = "orders" | "plans" | "depot" | "power" | "shift";

/** What the panels ask of the rest of the screen. */
export const panelHooks: {
  /** Hand a filled standing order over, by its id. */
  handOver: (order: number) => void;
  changed: () => void;
} = { handOver: () => {}, changed: () => {} };

const TITLES: Record<PanelId, string> = {
  orders: "Orders",
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
    ...(o.opens.board ? [el("span", "k-read", { text: "the board of standing orders" })] : []),
  ];
}

function orders(_art: Art, body: HTMLElement): () => void {
  let live: (() => void)[] = [];
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
    } else
      kids.push(
        el(
          "div",
          "k-paper order",
          {},
          el("div", "k-title", { text: "The story is told" }),
          el("div", "k-dim", {
            text: "Every order the guild had is filled. The board goes on for as long as you like.",
          }),
        ),
      );
    kids.push(el("div", "k-label", { text: "The board" }));
    if (!w.open.board)
      kids.push(
        el("div", "k-d", { text: "Standing orders from the guild go up on the depot's wall after the fourth order." }),
      );
    w.board.forEach((s: Standing, slot) => {
      const full = isFilled(s.want, s.filled);
      const rows = wants(s.want, () => S.world.board[slot]?.filled ?? {});
      live.push(rows.update);
      const why = swapRefusal(w, s.id);
      const act = full
        ? button("sm", ["Hand over"], () => {
            panelHooks.handOver(s.id);
          })
        : button(why === null ? "wood sm" : "wood sm off", ["Swap"], (b) => {
            const no = swapRefusal(S.world, s.id);
            if (no !== null || "refused" in doNow({ do: "swap", order: s.id })) {
              yardSfx.no();
              replay(b, "shake");
              feed(`${no ?? "It cannot be swapped"}.`, "coral");
              return;
            }
            sfx.paper();
            panelHooks.changed();
          });
      tip(
        act,
        full ? "Hand over" : "Swap",
        full
          ? `${s.from} is at the gate for it. Pays ${s.pay} Coins.`
          : (why ?? "Take this one down and hang a fresh order in its place. Free, once every ten minutes."),
      );
      kids.push(
        el(
          "div",
          full ? "k-card order ready" : "k-card order",
          {},
          el(
            "div",
            "from",
            {},
            el("span", "k-label", { text: s.from }),
            el("span", "k-grow"),
            el("span", "k-chip", {}, amount("coin", s.pay)),
          ),
          el("div", "", { text: s.title }),
          el("div", "k-d", { text: s.line }),
          ...rows.rows,
          el(
            "div",
            "k-row",
            {},
            el("span", "k-grow k-d", { text: full ? "Filled, and waiting to be handed over." : "" }),
            act,
          ),
        ),
      );
    });
    // A place on the board Leaf has yet to hang an order in.
    if (w.open.board)
      for (let n = w.board.length; n < w.rates.slots; n++)
        kids.push(el("div", "k-card order", {}, el("div", "k-d", { text: "A fresh order is on its way from town." })));
    body.replaceChildren(...kids);
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
  { label: "The yard itself", plans: ["flywheel", "tallpylons", "bigcrates", "fourth"] },
];

/** Why a plan cannot be had yet, without its own name on the front: "Unlocks when you fill order 3: Gears and frames." */
function later(why: string, name: string): string {
  const rest = why.startsWith(`${name} `) ? why.slice(name.length + 1) : why;
  return `${rest.charAt(0).toUpperCase()}${rest.slice(1)}.`;
}

function plans(_art: Art, body: HTMLElement): () => void {
  const build = (): void => {
    const w = S.world;
    const kids: HTMLElement[] = [
      el("div", "k-d", {
        text: "Bought once with Coins, and the yard keeps them. Each comes up for sale as the story goes.",
      }),
    ];
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
                  coins() >= plan.price ? "sm" : "sm off",
                  [icon("coin"), plan.price.toLocaleString("en-US")],
                  (b) => {
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
      el(
        "div",
        "k-d",
        {},
        "Everything that comes in goes to an order that wants it. The depot pays a little for whatever it takes, wanted or not.",
      ),
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
                ? "Still counting: the yard was changed a moment ago."
                : `Worth ${Math.round(hourly).toLocaleString("en-US")} Coins an hour to orders, ${Math.max(0, Math.round(hourly * DEPOT_SHARE))} to the depot alone.`,
          }),
        ),
      ),
      rows.length > 0
        ? el("div", "rows", {}, ...rows)
        : el("div", "k-d", { text: "Nothing has come in yet. A belt that ends at the depot's wall will see to that." }),
      el(
        "div",
        "k-card",
        {},
        el(
          "div",
          "k-grow",
          {},
          "All told",
          el("div", "k-d", {
            text: `${Math.floor(w.paid).toLocaleString("en-US")} Coins from orders, ${Math.floor(w.sold).toLocaleString("en-US")} from the depot. ${w.story} of ${STORY.length} story orders, ${w.done} from the board.`,
          }),
        ),
      ),
      spare.length > 0
        ? el("div", "k-d", { text: `Still to hand, and free to stand: ${spare.join(", ")}.` })
        : el("div", "k-d", {
            text: "Taking a thing away gives back all it cost, so the yard can be laid out again as often as you like.",
          }),
    );
  };
  return when(() => `${Math.floor(S.world.tick / 20)}|${S.rev}`, build);
}

// ---------- power ----------

/** A line of the power book: what, how many, and the power that comes to. */
const row = (name: string, about: string, n: number, lit = false): HTMLElement[] => [
  el("span", "", { text: name }),
  el("span", "k-d", { text: about }),
  el("span"),
  el("span", lit ? "num k-gold" : "num", { text: String(n) }),
];

function powerBook(_art: Art, body: HTMLElement): () => void {
  const build = (): void => {
    const w = S.world;
    const p = power(w);
    const count = (kind: Kind, live: boolean): number =>
      w.cells.reduce((n, b, i) => n + (b?.kind === kind && (w.power[i] === 1) === live ? 1 : 0), 0);
    const burning = w.cells.reduce(
      (n, b, i) => n + (b?.kind === "boiler" && w.power[i] === 1 && b.fuel > 0 ? 1 : 0),
      0,
    );
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
        "The lamplight is the power: it reaches as far as the depot's lamps and every joined pylon's. A machine in the dark does nothing and draws nothing.",
      ),
      el("div", "k-label", { text: `Given: ${p.supply}` }),
      el("div", "rows", {}, ...gives),
      el("div", "k-label", { text: `Drawn: ${p.demand}` }),
      draws.length > 0 ? el("div", "rows", {}, ...draws) : el("div", "k-d", { text: "Nothing is drawing power yet." }),
      el(
        "div",
        p.pace < 1 ? "k-card lit" : "k-card",
        {},
        el(
          "div",
          "k-grow",
          {},
          p.pace < 1 ? `Short: everything works at ${Math.round(p.pace * 100)}% of its pace` : "Enough to go round",
          el("div", "k-d", {
            text:
              p.pace < 1
                ? "Nothing stops, it all slows together. A waterwheel by the stream or a boiler fed deadfall gives more; taking an idle machine away draws less."
                : `${p.supply - p.demand} to spare before anything slows.`,
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
      "k-row",
      {},
      yardIcon("shift", 2),
      el("div", "k-grow", { text: "The night shift comes in, and the yard works on at double pace." }),
    ),
    el(
      "div",
      "k-d",
      {},
      `For ${SHIFT.minutes} minutes by the clock, gatherers, machines and belts all go twice as fast, whether you stay to watch or not. It opens nothing: only Coins and the story do that.`,
    ),
    go,
  );
  return () => {};
}

// ---------- opening and closing ----------

const BUILD: Record<PanelId, (art: Art, body: HTMLElement) => () => void> = {
  orders,
  plans,
  depot,
  power: powerBook,
  shift,
};
const HEAD: Record<PanelId, () => Node> = {
  orders: () => yardIcon("orders"),
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
