/**
 * The yard's books, each a panel: the orders, the tier's own screen (`tier.ts`), research
 * (`research.ts`), where the power comes from and goes, and the yard's sheet (`views.ts`: the map,
 * the trouble and what the yard makes and needs, which is the depot's panel). The tier's screen and
 * research are full sheets on a phone.
 */

import {
  ALL_GOALS,
  BENCH,
  BOILER,
  counting,
  type Counts,
  DRAW,
  DRAWN,
  GATHERER,
  GIVES,
  type Goal,
  GOALS,
  HALF,
  holderOf,
  isFilled,
  type Kind,
  KIND_INFO,
  litOf,
  MILL,
  power,
  STUDY,
  SWAP_EVERY,
  swapRefusal,
  TICK_MS,
  tierName,
  unlockedBy,
  WHEEL,
  WORKSHOP,
} from "@sequoia-leaf/factory";
import { amount, asking, asksAgain, el, icon, pressedTwice, replay } from "@sequoia-leaf/kit/dom.ts";
import { whole } from "@sequoia-leaf/kit/say.ts";
import { sfx } from "@sequoia-leaf/kit/sound.ts";
import { tip, tipOff } from "@sequoia-leaf/kit/tip.ts";

import type { Art } from "../art/index.ts";
import { yardSfx } from "../sound.ts";
import { S } from "../state.ts";
import { doNow } from "../yard.ts";
import { board } from "./board.ts";
import {
  goalCard,
  leaves,
  type Listed,
  lockChip,
  type Need,
  needs,
  some,
  unlocks,
  type Wants,
  wants,
  wantsIn,
  wantsOrder,
} from "./goal.ts";
import { feed } from "./notes.ts";
import { $, button, iconButton, shows, wantWords, yardIcon } from "./parts.ts";
import { researchHooks, researchScreen } from "./research.ts";
import { given, needsOf, type Next, nextUp, nextWords, researchOpen, tierOpen } from "./standing.ts";
import { beginButton, tierHooks, tierScreen } from "./tier.ts";
import { sheet, sheetIcon, sheetTitle } from "./views.ts";

export type PanelId = "orders" | "board" | "tier" | "research" | "depot" | "power";

/** What the panels ask of the rest of the screen. */
export const panelHooks: {
  /** Hand a filled standing order over, by its id. */
  handOver: (order: number) => void;
  changed: () => void;
} = { handOver: () => {}, changed: () => {} };

/** What each panel is called: the tier's screen, by the tier. */
const TITLES: Record<PanelId, () => string> = {
  orders: () => "Orders",
  board: () => "Top yards",
  tier: () => tierName(S.world.open.tier),
  research: () => "Research",
  depot: sheetTitle,
  power: () => "Power",
};

/** The lesson that puts the board of side orders up. */
const BOARD_AT = ALL_GOALS.find((g) => unlockedBy(g).some((u) => u.is === "board"));

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

/** An order of the board as the orders panel prints it: its title, line and pay, what it wants, whether it is filled or counts yet, and why it cannot be swapped now. */
interface OrderLine extends Placed {
  readonly title: string;
  readonly line: string;
  readonly pay: number;
  readonly want: Wants;
  readonly counting: boolean;
  readonly why: string | null;
}

/** More than one of a kind, by its name: Mills, Benches, Studies. */
export const plural = (name: string): string =>
  /[^aeiou]y$/.test(name) ? `${name.slice(0, -1)}ies` : /(?:ch|sh|s|x)$/.test(name) ? `${name}es` : `${name}s`;

/**
 * What the orders panel prints: the node in hand and what it still waits on, or with nothing in hand
 * what comes next; whether the board is up and its places; and each order.
 */
export function ordersPrint(): {
  readonly hand: Goal | -1;
  readonly needs: readonly Need[];
  readonly next: Next | null;
  readonly board: boolean;
  readonly hooks: number;
  readonly orders: readonly OrderLine[];
  /** How many side orders the yard has handed over, ever: as the Tally's board in town counts them. */
  readonly handed: number;
} {
  const w = S.world;
  return {
    hand: w.hand,
    needs: w.hand === -1 ? [] : needsOf(w.hand, true),
    next: w.hand === -1 ? nextUp() : null,
    board: w.open.board,
    hooks: w.open.hooks,
    orders: w.board.map((s) => ({
      id: s.id,
      full: isFilled(s.want, s.filled),
      title: s.title,
      line: s.line,
      pay: s.pay,
      want: wantsIn(s.want),
      counting: counting(s, w.tick),
      why: swapRefusal(w, s.id),
    })),
    handed: w.handed,
  };
}

/**
 * What closes the side orders, once there are any: a place for each order Leaf has yet to hang (the
 * order takes that place), then how many the yard has handed over.
 */
const boardEnd = (p: ReturnType<typeof ordersPrint>): HTMLElement[] =>
  p.board
    ? [
        ...Array.from({ length: Math.max(0, p.hooks - p.orders.length) }, () =>
          el("div", "k-card order waiting", {}, el("div", "k-dim", { text: "A new order is on its way." })),
        ),
        el("div", "k-d", { text: `Orders handed over: ${whole(p.handed)}` }),
      ]
    : [];

function orders(_art: Art, body: HTMLElement): () => void {
  let live: Listed[] = [];
  let places: number[] = [];
  const draw = (p: ReturnType<typeof ordersPrint>): void => {
    live = [];
    const g = p.hand;
    const o = g === -1 ? undefined : GOALS[g];
    const kids: HTMLElement[] = [];
    if (g !== -1 && o) {
      // The node in hand, picked out.
      const lists = some(
        wants(wantsIn(o.want), () => S.world.got[g] ?? null),
        needs(p.needs, { given, begin: beginButton }),
        unlocks(g),
        leaves(g),
      );
      live.push(...lists);
      kids.push(goalCard(g, o.pay > 0 ? el("span", "k-chip", {}, amount("coin", o.pay)) : null, lists));
    } else if (p.next) {
      // Nothing in hand: what comes next, as the corner says it, and the way to the tier's screen.
      const { label, title, line } = nextWords(p.next);
      kids.push(
        el(
          "div",
          "k-card lit goal",
          {},
          label ? el("div", "k-label", { text: label }) : null,
          el("div", "k-title", { text: title }),
          p.next.is === "locked" ? lockChip(line) : el("div", "k-d", { text: line }),
          p.next.is === "done" || !tierOpen()
            ? null
            : button("sm", [`Open ${tierName(S.world.open.tier).split(":")[0] ?? ""}`], () => openPanel("tier")),
        ),
      );
    }
    if (!p.board && BOARD_AT !== undefined)
      kids.push(
        el("div", "k-d", {
          text: `Side orders open after lesson ${LESSONS.indexOf(BOARD_AT) + 1}: ${GOALS[BOARD_AT]?.title}.`,
        }),
      );
    const shown = placed(places, p.orders);
    places = shown.map((s) => s.id);
    for (const s of shown) {
      const filled = (): Counts | null => S.world.board.find((b) => b.id === s.id)?.filled ?? null;
      const rows = wantsOrder(s.want, filled);
      if (rows) live.push(rows);
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
      // Its title names what it wants and who asks; what it pays and its button are on the title's
      // line, so the button is in the same spot whatever the card's height; then what it wants, each
      // a picture, a bar and a count; and last and quietest, the asker's line.
      kids.push(
        el(
          "div",
          // One Leaf has just hung is quiet until it counts.
          s.full ? "k-card order ready" : s.counting ? "k-card order" : "k-card order hung",
          { "data-order": s.id },
          el(
            "div",
            "k-row",
            {},
            el("div", "k-name", { text: s.title }),
            el("span", "k-row", {}, amount("coin", s.pay), act),
          ),
          rows?.node ?? null,
          el("div", "k-d", { text: s.line }),
        ),
      );
    }
    kids.push(...boardEnd(p));
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
    for (const l of live) l.update();
  };
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
        ? row(plural(name), `${n} in reach${dark ? `, ${dark} in the dark` : ""}, ${DRAW[k] ?? 0} each`, drawn)
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
  tier: (_art, body) => tierScreen(body),
  research: (_art, body) => researchScreen(body),
  depot: (art, body) => sheet(art, body),
  power: powerBook,
};
const HEAD: Record<PanelId, () => Node> = {
  orders: () => yardIcon("orders"),
  board: () => yardIcon("board"),
  tier: () => yardIcon("projects"),
  research: () => yardIcon("research"),
  depot: () => sheetIcon(),
  power: () => yardIcon("bolt"),
};
/** The panels that are a full sheet on a phone: each is a screen of its own, with rows to tap. */
const FULL: ReadonlySet<PanelId> = new Set<PanelId>(["tier", "research"]);

let refresh: (() => void) | null = null;
let theArt: Art | null = null;
/** The control the focus was on when the panel opened: it has the focus back when the panel shuts. */
let opener: HTMLElement | null = null;

export function initPanels(art: Art): void {
  theArt = art;
  tierHooks.changed = (): void => panelHooks.changed();
  tierHooks.research = (): void => openPanel("research");
  tierHooks.close = closePanel;
  researchHooks.changed = (): void => panelHooks.changed();
}

export function openPanel(id: PanelId): void {
  // A panel is there only once it has something to say.
  if (S.panel === id || !theArt || (id === "tier" && !tierOpen()) || (id === "research" && !researchOpen())) return;
  tipOff();
  S.panel = id;
  const p = $("panel");
  // The control the focus is on, outside the panel; from inside one panel to another, the first's.
  const from = document.activeElement;
  if (from instanceof HTMLElement && from !== document.body && !p.contains(from)) opener = from;
  p.hidden = true;
  p.classList.toggle("full", FULL.has(id));
  p.replaceChildren();
  // Which panel it is, for the page's styles: the yard's sheet is a full sheet on a phone.
  p.dataset.panel = id;
  const x = iconButton("wood sm", icon("close"), "Close", closePanel);
  // A title in two parts ("Tier 2: The stream") breaks between them where it must.
  const [first = "", ...rest] = TITLES[id]().split(": ");
  const title = el(
    "h2",
    "k-title",
    { id: "panel-title" },
    el("span", "", { text: rest.length > 0 ? `${first}:` : first }),
    ...(rest.length > 0 ? [" ", el("span", "", { text: rest.join(": ") })] : []),
  );
  p.append(el("header", "k-head", {}, HEAD[id](), title, x));
  const body = el("div", "k-body k-scroll");
  p.append(body);
  refresh = BUILD[id](theArt, body);
  refresh();
  p.hidden = false;
  // The focus goes into the panel, so the next Tab is in it and not along the toolbar; the control it
  // was on (the book's button, most often) has it back when the panel shuts.
  x.focus({ preventScroll: true });
  replay(p, "slide");
  sfx.open();
  document.body.classList.add("panel-open");
  panelHooks.changed();
}

export function closePanel(): void {
  if (!S.panel) return;
  S.panel = null;
  const inside = $("panel").contains(document.activeElement);
  $("panel").hidden = true;
  $("panel").replaceChildren();
  if (inside && opener?.isConnected) opener.focus({ preventScroll: true });
  opener = null;
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
