/**
 * The yard's sheet: one panel with three views and a row to move between them, for finding the way
 * round a yard too large to see. It is the depot's panel too: in a yard of one plot it is only its
 * third view, and the other two, the row and the count on its button come with the second plot.
 *
 * - **Map**: the whole land as a plan (`plan.ts`), a mark on every piece in trouble, the part of the
 *   yard on screen as a frame, a price on each plot for sale. A tap goes there (to the piece in
 *   trouble under the finger, with its card); on land that is not the yard's it opens the plot's card.
 * - **Trouble**: the pieces in trouble (`trouble.ts`) in groups by what is wrong, the largest first.
 *   A tap on a group goes to its first piece and opens its card (on a phone, where the card would
 *   cover it, marks it instead), and a bar stays while the member walks the group: what is wrong,
 *   which of how many, back and on, and a way out.
 * - **Items**: for each thing, at most how many the yard's pieces can make and can use a
 *   minute (the rules' `flow`), and what reached the depot in the last minute, counted
 *   (`arrivals.ts`); what they can use more of than they can make first, with by how many. Then the
 *   yard's totals.
 *
 * None of it does anything while the sheet is shut: the map is painted and the lists worked out only
 * for the view that is up.
 */

import {
  isNode,
  type Item,
  type Kind,
  MILLI,
  NODE_COUNT,
  NONE,
  plotPrice,
  power,
  readyToBuy,
  type Yard,
} from "@sequoia-leaf/factory";
import { pick, shown as cardShown, thing } from "@sequoia-leaf/kit/card.ts";
import { el, icon, unit } from "@sequoia-leaf/kit/dom.ts";
import { keepText, keptText } from "@sequoia-leaf/kit/keep.ts";
import { CREAM, INK } from "@sequoia-leaf/kit/palette.ts";
import { PER_MINUTE, perMinute, whole } from "@sequoia-leaf/kit/say.ts";
import { scope } from "@sequoia-leaf/kit/scope.ts";
import { sfx } from "@sequoia-leaf/kit/sound.ts";
import { widthOf } from "@sequoia-leaf/kit/text.ts";
import { must } from "@sequoia-leaf/kit/util.ts";

import { countedOver, reached } from "../arrivals.ts";
import { TILE } from "../art/belts.ts";
import type { Art } from "../art/index.ts";
import { cellOf, flowRows, said, SHORT, yardFlows } from "../flows.ts";
import { layout } from "../layout.ts";
import { alarm, layPlan, makePlan, paintPlan, type Plan } from "../plan.ts";
import { S, seenFrom } from "../state.ts";
import { troubled, troubleGroups } from "../trouble.ts";
import { NOT_WALKING, type Walk, walkAt, type WalkEvent, walkStep } from "../walk.ts";
import { closeCard, itemRef, openCard, plotRef, tileRef } from "./card.ts";
import { mapPress } from "./mappress.ts";
import { price } from "./mapprice.ts";
import { closePanel, openPanel, refreshPanel } from "./panels.ts";
import { $, fitted, iconButton, yardIcon } from "./parts.ts";
import { type Line, table } from "./table.ts";

export type View = "map" | "trouble" | "needs";
const VIEWS: readonly View[] = ["map", "trouble", "needs"];
const NAMES: Readonly<Record<View, string>> = { map: "Map", trouble: "Trouble", needs: "Items" };

/** Where the view last used is kept, beside the screen's other settings. */
const KEPT = "works.view.v1";
const isView = (v: unknown): v is View => VIEWS.some((one) => one === v);
/** The view the sheet opens on: the one last used. */
let view: View | null = null;
const lastView = (): View => {
  if (view === null) {
    const kept = keptText(KEPT);
    view = isView(kept) ? kept : "map";
  }
  return view;
};

/** Whether the yard has the map, the list of trouble and the count: from its second plot. Before that the sheet is the depot's panel alone. */
export const hasViews = (): boolean => S.world.plots.length > 1;
/** How many pieces are in trouble, for the count on the button; nothing is looked at in a yard of one plot. */
export const wrongCount = (): number => (hasViews() ? troubled(S.world).count : 0);

/** The sheet's name and picture: the yard's, or in a yard of one plot the depot's. */
export const sheetTitle = (): string => (hasViews() ? "The yard" : "The depot");
export const sheetIcon = (): Node => yardIcon(hasViews() ? "map" : "depot");

/** What the sheet asks of the rest of the screen: to bring a point of the yard, in its pixels, to the middle of the view at once. */
export const viewHooks: { look: (x: number, y: number) => void } = { look: () => {} };

/**
 * Whether the sheet leaves the yard too little room to stay open while the yard is looked at: a full
 * sheet, as on a phone (the page's own breakpoint), or a short screen, where the panel beside the
 * yard reaches down over the tools. A walk, or a pick on its map, puts it away.
 */
const narrow = (): boolean =>
  window.matchMedia("(max-width: 760px), (max-height: 500px), (orientation: portrait)").matches;

// ---------- going to a place ----------

/**
 * Brings a tile to the middle of the view at once, and with `card` pins the card of what stands there,
 * whose mark then closes in on it. On a phone the card would cover the piece: any card is put away,
 * and the piece is marked with none; a tap on it opens it.
 */
function goTo(i: number, card: boolean): void {
  const W = S.world.land.w;
  const x = i % W;
  const y = Math.floor(i / W);
  viewHooks.look(x * TILE + TILE / 2, y * TILE + TILE / 2);
  if (!card) return;
  const opens = !narrow();
  // Pinning the card that is already pinned would put it away.
  if (!opens) closeCard();
  else if (cardShown()?.ref !== tileRef(i)) openCard(x, y);
  S.brought = { tile: i, at: S.t, card: opens };
}

// ---------- walking a group ----------

/** The walk (`walk.ts`): the one value the bar and the page's look follow. */
let walking: Walk = NOT_WALKING;
/** The bar, made the first time a walk begins. */
let bar: {
  el: HTMLElement;
  title: HTMLElement;
  at: HTMLElement;
} | null = null;

const tilesOf = (title: string): readonly number[] | null =>
  troubleGroups(S.world).find((g) => g.title === title)?.tiles ?? null;

/** Where the bar sits now: at the head of the panel beside the yard; on a phone, under the top row, where the sheet was. None while the panel is shut. */
const barHome = (): HTMLElement | null =>
  narrow() ? $("walk") : document.querySelector<HTMLElement>("#panel .walk-slot");

/** Moves the walk, and brings the bar and the page's look into line with it; a walk at a new piece goes there, with its card. Ended, what it was at is no longer marked. */
function walk(e: WalkEvent): void {
  const was = walking;
  walking = walkStep(walking, e);
  const w = walking;
  if (was.is === "walking" && w.is !== "walking") S.brought = null;
  if (w.is === "walking" && (was.is !== "walking" || was.tile !== w.tile)) {
    if (was.is === "walking") sfx.tap();
    goTo(w.tile, true);
  }
  showWalk();
}

/** The bar as the walk has it: what is wrong and which of how many, or hidden. */
function showWalk(): void {
  const w = walking;
  const home = barHome();
  const tiles = w.is === "walking" ? tilesOf(w.title) : null;
  document.body.classList.toggle("walking", w.is === "walking");
  if (w.is !== "walking" || !home || !tiles) {
    if (bar) bar.el.hidden = true;
    return;
  }
  bar ??= makeBar();
  if (bar.el.parentElement !== home) home.append(bar.el);
  const where = walkAt(w.tile, tiles);
  if (bar.title.textContent !== w.title) bar.title.textContent = w.title;
  if (bar.at.textContent !== where) bar.at.textContent = where;
  bar.el.hidden = false;
}

/** Back or on along the group, as it is now. */
const stepWalk = (by: 1 | -1): void => {
  walk({ do: "step", by, tiles: walking.is === "walking" ? tilesOf(walking.title) : null });
};

/** One of the bar's buttons: a picture, and what it is called for whoever cannot see it. */
const press = (label: string, kid: Node, on: () => void): HTMLElement => iconButton("wood sm", kid, label, on);

function makeBar(): NonNullable<typeof bar> {
  const title = el("span", "k-grow walk-what");
  const at = el("span", "walk-at");
  const on = icon("back");
  on.classList.add("flip");
  const made = el(
    "div",
    "k-plaque walk",
    { hidden: true },
    title,
    at,
    press("Back", icon("back"), () => stepWalk(-1)),
    press("On", on, () => stepWalk(1)),
    press("Stop", icon("close"), () => walk({ do: "stop" })),
  );
  return { el: made, title, at };
}

/** A group was pressed: its first piece, with its card, and the bar to walk the rest. On a phone the sheet gives way to the bar. */
function startWalk(title: string): void {
  const tiles = tilesOf(title);
  if (!tiles) return;
  if (narrow()) closePanel();
  walk({ do: "start", title, tiles });
}

/** The walk looked at again (each refresh of the screen): its group mended, or the panel it sits in shut, it ends. */
export function refreshWalk(): void {
  if (walking.is !== "walking") return;
  walk({ do: "look", tiles: tilesOf(walking.title), shown: barHome() !== null });
}

// ---------- the map ----------

/** The map's plan: 3 pixels to a tile, kept while the page is open, painted only while the map is up. */
let mapPlan: Plan | null = null;
const MAP = 3;
/** How near a tap must be to a piece in trouble to mean it, in CSS pixels: a finger's reach. */
const REACH = 14;

/**
 * The plots that can be bought now (for sale, and cleared where they need clearing), each with its
 * price as it is written, the middle of it on the map, and whether it is in an odd column of plots:
 * worked out when what stands changes, not each frame.
 */
let sales: { yard: Yard; rev: number; plots: { price: string; x: number; y: number; odd: boolean }[] } | null = null;
function forSale(y: Yard): readonly { price: string; x: number; y: number; odd: boolean }[] {
  if (sales?.yard === y && sales.rev === y.rev) return sales.plots;
  const plots = y.land.plots.flatMap((plot) =>
    !y.plots.includes(plot.plot) && readyToBuy(y, plot.plot)
      ? [
          {
            price: whole(plotPrice(y, plot.plot)),
            x: (plot.x + plot.w / 2) * MAP,
            y: (plot.y + plot.h / 2) * MAP,
            odd: Math.floor(plot.x / plot.w) % 2 === 1,
          },
        ]
      : [],
  );
  sales = { yard: y, rev: y.rev, plots };
  return plots;
}

/** The price on each plot for sale. One wider than its plot would run into the next one's: neighbours' go above and below the middle. */
function prices(g: CanvasRenderingContext2D, y: Yard): void {
  const room = (y.land.plots[0]?.w ?? 0) * MAP;
  for (const plot of forSale(y)) {
    const wide = widthOf(g, plot.price, 1) + 7 > room;
    price(g, plot.price, plot.x, plot.y + (wide ? (plot.odd ? 5 : -5) : 0));
  }
}

function mapView(_art: Art, host: HTMLElement): () => void {
  const plan = (mapPlan ??= makePlan(MAP));
  const c = el("canvas", "k-px map", { "aria-label": "Map of the yard" });
  const g = must(c.getContext("2d"), "2d context");
  host.append(c);

  /** The map at a whole number of screen pixels to each of its own, as large as the sheet has room for. */
  const fit = (): void => {
    const { land } = S.world;
    if (c.width !== land.w * MAP) c.width = land.w * MAP;
    if (c.height !== land.h * MAP) c.height = land.h * MAP;
    const dpr = window.devicePixelRatio || 1;
    // As wide as the sheet, and no taller than the window leaves under the row of views.
    const room = host.clientWidth - 2;
    const high = window.innerHeight - host.getBoundingClientRect().top - unit() * 12;
    const n = Math.max(1, Math.floor(Math.min((room * dpr) / c.width, (high * dpr) / c.height)));
    const width = `${(c.width * n) / dpr}px`;
    if (c.style.width !== width) {
      c.style.width = width;
      c.style.height = `${(c.height * n) / dpr}px`;
    }
  };

  const draw = (): void => {
    const y = S.world;
    const { land } = y;
    const W = land.w;
    fit();
    paintPlan(plan, y, layout(y));
    g.clearRect(0, 0, c.width, c.height);
    layPlan(g, plan, y, 0, 0);
    const wrong = troubled(y);
    for (let n = 0; n < wrong.count; n++) {
      const i = wrong.tiles[n] ?? 0;
      alarm(g, MAP, i % W, Math.floor(i / W), 0, 0, S.t);
    }
    prices(g, y);
    // The part of the yard now on screen.
    const k = MAP / TILE;
    const x0 = Math.max(0, Math.round(seenFrom(S.cam.x) * k));
    const y0 = Math.max(0, Math.round(seenFrom(S.cam.y) * k));
    const x1 = Math.min(c.width, Math.round((seenFrom(S.cam.x) + S.view.w) * k));
    const y1 = Math.min(c.height, Math.round((seenFrom(S.cam.y) + S.view.h) * k));
    if (x1 > x0 && y1 > y0)
      for (const [grow, col] of [
        [1, INK],
        [0, CREAM],
      ] as const) {
        g.fillStyle = col;
        g.fillRect(x0 - grow, y0 - grow, x1 - x0 + grow * 2, 1);
        g.fillRect(x0 - grow, y1 - 1 + grow, x1 - x0 + grow * 2, 1);
        g.fillRect(x0 - grow, y0 - grow, 1, y1 - y0 + grow * 2);
        g.fillRect(x1 - 1 + grow, y0 - grow, 1, y1 - y0 + grow * 2);
      }
  };

  /** The tile of the map under a point of the page, and how many CSS pixels a tile is there. */
  const tileUnder = (e: PointerEvent): { x: number; y: number; size: number } => {
    const box = c.getBoundingClientRect();
    const size = (box.width / c.width) * MAP;
    const { land } = S.world;
    return {
      x: Math.min(land.w - 1, Math.max(0, Math.floor((e.clientX - box.left) / size))),
      y: Math.min(land.h - 1, Math.max(0, Math.floor((e.clientY - box.top) / size))),
      size,
    };
  };

  /** A tap: land that is not the yard's opens its plot's card; a piece in trouble under the finger is gone to, with its card; else that place. */
  const tap = (e: PointerEvent): void => {
    const y = S.world;
    const { land } = y;
    const at = tileUnder(e);
    const plot = land.plots[land.plot[at.y * land.w + at.x] ?? NONE];
    if (plot && !y.plots.includes(plot.plot)) {
      pick(plotRef(plot.plot), e.clientX - 1, e.clientY - 1, 2, 2);
      return;
    }
    const wrong = troubled(y);
    let near = -1;
    let best = (REACH / at.size + 0.5) ** 2;
    for (let n = 0; n < wrong.count; n++) {
      const i = wrong.tiles[n] ?? 0;
      const d = ((i % land.w) - at.x) ** 2 + (Math.floor(i / land.w) - at.y) ** 2;
      if (d < best) {
        best = d;
        near = i;
      }
    }
    sfx.tap();
    if (narrow()) closePanel();
    goTo(near >= 0 ? near : at.y * land.w + at.x, near >= 0);
  };

  // What the map listens to and asks for is held while it is up, and let go once it has gone.
  const life = scope();
  mapPress(life, c, {
    tap,
    // Beside the yard, a drag moves the camera with it.
    drag: (e) => {
      if (narrow()) return;
      const at = tileUnder(e);
      viewHooks.look(at.x * TILE + TILE / 2, at.y * TILE + TILE / 2);
    },
  });

  // The marks fade and come back, and the frame follows the camera: drawn each frame, while the map is up.
  const frame = (): void => {
    if (!c.isConnected) {
      life.close();
      return;
    }
    draw();
    life.frame(frame);
  };
  life.frame(frame);
  return draw;
}

// ---------- trouble ----------

/** The trouble view's row for power, while the yard is short of it: power used, made, and the speed machines work at (the rules' `speed`). */
export function shortRow(y: Yard): readonly [string, string, string] | null {
  const p = power(y);
  return p.speed < 100 ? [String(p.demand), String(p.supply), `${p.speed}%`] : null;
}

function troubleView(art: Art, host: HTMLElement): () => void {
  const short = table("Power", ["Used", "Made", "Speed"]);
  const list = table("", ["Pieces"], { cards: true });
  const none = el("div", "k-dim");
  host.append(short.el, list.el, none);
  /** What is wrong, and the kinds of piece it is wrong with, as pictures: a belt carrying what is stuck on it. */
  const head = (title: string, kinds: readonly Kind[], stuck: Item | null): Node =>
    el(
      "span",
      "wrong",
      {},
      el("span", "k-grow", { text: title }),
      el("span", "kinds", {}, ...kinds.slice(0, 4).map((k) => fitted(art.icon(k, 1, stuck ?? undefined), 12, 12))),
    );
  return () => {
    const y = S.world;
    const cells = shortRow(y);
    short.el.hidden = cells === null;
    short.set(
      cells
        ? [
            {
              key: "power",
              head: () =>
                el("span", "wrong", {}, yardIcon("bolt"), el("span", "k-grow k-coral", { text: "Not enough" })),
              cells: [...cells],
            },
          ]
        : [],
    );
    const groups = troubleGroups(y);
    list.el.hidden = groups.length === 0;
    none.hidden = groups.length > 0;
    // Short of power is trouble too, in the row above: then it is only the pieces that are fine.
    none.textContent = cells ? "No piece is in trouble." : "Nothing is wrong.";
    list.set(
      groups.map((g): Line => ({
        // Its pictures are built once for a row: a group that gains a kind of piece is a new row.
        key: `${g.title}|${g.kinds.join()}`,
        head: () => head(g.title, g.kinds, g.stuck),
        cells: [String(g.tiles.length)],
        on: () => startWalk(g.title),
      })),
    );
  };
}

// ---------- makes and needs ----------

/** Coins kept in thousandths, as whole Coins. */
const coins = (thousandths: number): string => whole(Math.floor(thousandths / MILLI));

function needsView(_art: Art, host: HTMLElement): () => void {
  const things = table("Items", ["Can make", "Can use", "Reached the depot"], { unit: PER_MINUTE, stack: true });
  const none = el("div", "k-dim", { text: "Nothing is made yet." });
  const over = el("div", "k-s k-dim");
  const totals = table("In total", [""], { wide: 60 });
  host.append(things.el, none, over, totals.el);
  let drawn = "";
  return () => {
    const y = S.world;
    const flows = yardFlows(y);
    const rows = flowRows(flows.made, flows.needed, reached);
    const seconds = countedOver();
    // Everything shown, as one line: the tables are written again only when it differs.
    const now = JSON.stringify([rows, seconds, y.paid, y.sold, y.done.length, y.handed]);
    if (now === drawn) return;
    drawn = now;
    things.el.hidden = rows.length === 0;
    none.hidden = rows.length > 0;
    things.set(
      rows.map((f): Line => {
        const short = f.needed - f.made;
        const lacks = short >= SHORT;
        const need = cellOf(f.needed);
        return {
          key: String(f.item),
          head: () => thing(itemRef(f.item)),
          ...(lacks ? { note: `Can use ${perMinute(short)} more than it makes` } : {}),
          cells: [cellOf(f.made), lacks ? [said(need), "coral"] : need, cellOf(f.reached)],
        };
      }),
    );
    // For the first minute the last column is a minute's worth of what was counted so far.
    over.hidden = seconds >= 60 || rows.length === 0;
    over.textContent = `Reached the depot: counted over ${seconds} second${seconds === 1 ? "" : "s"} so far.`;
    totals.set([
      { key: "orders", head: () => "Coins from orders", cells: [[coins(y.paid), "gold"]] },
      { key: "depot", head: () => "Coins from the depot", cells: [[coins(y.sold), "gold"]] },
      { key: "goals", head: () => "Goals done", cells: [`${y.done.filter(isNode).length} of ${NODE_COUNT}`] },
      { key: "handed", head: () => "Side orders handed over", cells: [whole(y.handed)] },
    ]);
  };
}

// ---------- the sheet ----------

const BUILD: Readonly<Record<View, (art: Art, host: HTMLElement) => () => void>> = {
  map: mapView,
  trouble: troubleView,
  needs: needsView,
};

/** Whether the sheet is the panel that is open. */
const open = (): boolean => S.panel === "depot";

/**
 * Builds the sheet into a panel's body: the bar's place at its head, the row of views, and the view
 * that is up. What it gives brings it up to date: the row (there only with a second plot), the view
 * (in a yard of one plot, the third), and what the view shows.
 */
export function sheet(art: Art, body: HTMLElement): () => void {
  body.classList.add("views");
  const slot = el("div", "walk-slot");
  const tabs = el("div", "k-tabs", { role: "tablist" });
  const pressed = new Map<View, HTMLElement>();
  for (const v of VIEWS) {
    const tab = el("button", "k-btn", { type: "button", role: "tab", text: NAMES[v] });
    tab.addEventListener("click", () => {
      showView(v);
      sfx.tap();
    });
    pressed.set(v, tab);
    tabs.append(tab);
  }
  const host = el("div", "view k-scroll");
  body.append(slot, tabs, host);
  let up: View | null = null;
  let refresh: (() => void) | null = null;
  return () => {
    const many = hasViews();
    const want = many ? lastView() : "needs";
    tabs.hidden = !many;
    if (want !== up) {
      up = want;
      host.replaceChildren();
      host.dataset.view = want;
      host.scrollTop = 0;
      refresh = BUILD[want](art, host);
      for (const [v, tab] of pressed) tab.setAttribute("aria-selected", String(v === want));
    }
    refresh?.();
    refreshWalk();
  };
}

/** Shows a view, and keeps it as the one last used; the sheet is opened if it is shut. */
export function showView(v: View): void {
  view = v;
  keepText(KEPT, v);
  if (open()) refreshPanel();
  else openPanel("depot");
}

/** Opens the sheet on a view, or shuts it if it is open on that view: for a key. */
export function toggleView(v: View): void {
  if (open() && (lastView() === v || !hasViews())) closePanel();
  else showView(v);
}
