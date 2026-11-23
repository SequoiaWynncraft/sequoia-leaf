/**
 * What everything in the yard says about itself, in the kit's one card (`card.ts`). Each kind of
 * thing is registered once and named by a reference, by its number in the rules' tables:
 *
 * - `item:<item>` a thing: its step, what it is made from and where, what it goes into, what the
 *   depot pays, and the orders asking for it (or, for one from the ground, where it lies);
 * - `machine:<kind>` a kind of machine: what it does, what it can make, its draw, pace and price;
 * - `tile:<index>` whatever stands on a tile of the yard: its machine's card with what this one is
 *   doing and holds, and what can be done with it (a splitter's three ways out, each to shut or open);
 * - `plot:<plot>`, `node:<goal>` for a lesson, project or commission, and `order:story` (the node in
 *   hand) or `order:<slot>` for the board's orders.
 *
 * The pieces of later tiers that have no art yet (the Study, the cart stop, the sorter) say only
 * what they are. Pointing at a thing on the yard says what it is; clicking or tapping pins its card.
 */
import {
  aim,
  ALL_ITEMS,
  at,
  BELT,
  BOILER,
  carries,
  costOf,
  CRATE,
  DEADFALL,
  DEPOT,
  DEPOT_SHARE,
  DRAW,
  FUEL,
  GATHERER,
  GIVES,
  type Goal,
  GOALS,
  held,
  holderOf,
  isFilled,
  isGoal,
  isItem,
  isKind,
  isMaker,
  isNode,
  isPlot,
  isRaw,
  type Item,
  item as itemOf,
  ITEM_INFO,
  itemName,
  type Kind,
  kind as kindOf,
  KIND_INFO,
  LEFT,
  locked,
  MADE_BY,
  NODES,
  NONE,
  PACE,
  type Plot,
  plot as plotOf,
  plotState,
  PYLON,
  rate,
  ready,
  RECIPE,
  RECIPES_N,
  recipesFor,
  RIGHT,
  SPLITTER,
  status,
  takes,
  TICKS,
  toward,
  TUNNEL,
  WHEEL,
  worthAt,
} from "@sequoia-leaf/factory";
import {
  type Action,
  type Block,
  close,
  type Description,
  type Entry,
  pick,
  refresh,
  register,
  type Row,
  shown,
  type Stat,
  watch,
} from "@sequoia-leaf/kit/card.ts";
import { amount, el, icon } from "@sequoia-leaf/kit/dom.ts";
import { sfx } from "@sequoia-leaf/kit/sound.ts";

import { beltTile, TILE } from "../art/belts.ts";
import type { Art } from "../art/index.ts";
import { layout } from "../layout.ts";
import { yardSfx } from "../sound.ts";
import { draws, S, toPage } from "../state.ts";
import { buyLand, pickFrom, takeAway, takeInHand, turnAt, usable, wayAt } from "../tools.ts";
import { coins, doNow } from "../yard.ts";
import { KEYS, openTools } from "./dock.ts";
import { projectsOpen, togglePanel } from "./panels.ts";
import { fitted, partsWords, pic, unlockWords, yardIcon } from "./parts.ts";

const GROUND: Readonly<Record<string, readonly [string, string]>> = {
  deadfall: ["Deadfall", "Fallen branches. A gatherer here picks them up; a mill saws them into planks."],
  stone: ["A stone outcrop", "A gatherer here picks up stone; a mill fires it into bricks."],
  ore: ["An ore seam", "A gatherer here picks up ore; a mill smelts it into ingots."],
  clay: ["A clay bank", "A gatherer here digs clay; a mill fires it into pots."],
  sand: ["Sand", "A gatherer here shovels sand; a mill melts it into glass."],
  resin: ["Old stumps weeping resin", "A gatherer here collects resin; a mill presses it into lamp oil."],
};

const STEPS = ["From the ground", "Worked once", "Put together", "The guild's goods", "Takes the whole yard"];

let theArt: Art | null = null;

/** Seconds, as a card says them: "1.2s". */
const secs = (ticks: number): string => `${Math.round(ticks) / 10}s`;
const n = (v: number): string => v.toLocaleString("en-US", { maximumFractionDigits: 3 });
const nameOf = (k: number): string => KIND_INFO[k]?.name ?? "";
const many = (k: number): string => ITEM_INFO[k]?.many ?? "";
/** A kind this page does not draw (`DRAWN`: the Study, the cart stop, the sorter): its card says only what it is. */
const later = (k: number): boolean => !draws(k);

export const itemRef = (k: Item): string => `item:${k}`;
export const machineRef = (k: Kind): string => `machine:${k}`;
export const tileRef = (i: number): string => `tile:${i}`;
export const plotRef = (id: Plot): string => `plot:${id}`;
export const nodeRef = (g: Goal): string => `node:${g}`;
export const orderRef = (slot: number | "story"): string => `order:${slot}`;

/** A number read back out of a reference, if it is a whole one. */
const numberIn = (id: string): number => (/^\d+$/.test(id) ? Number(id) : -1);

/** A machine's picture cut to a card's slot: a tall machine is known by its head. */
const machinePic = (art: Art, k: Kind): HTMLCanvasElement => fitted(art.icon(k), 22, 22);

// ---------- things ----------

/** The node in hand and the orders on the board that still want a thing, and how many they are owed. */
function askedFor(k: Item): Entry[] {
  const w = S.world;
  const out: Entry[] = [];
  const owed = (want: Float64Array, filled: Float64Array | null): number =>
    Math.max(0, (want[k] ?? 0) - (filled?.[k] ?? 0));
  const hand = w.hand === -1 ? undefined : GOALS[w.hand];
  const got = w.hand === -1 ? null : (w.got[w.hand] ?? null);
  if (hand && owed(hand.want, got) > 0)
    out.push({ ref: orderRef("story"), note: `${n(owed(hand.want, got))} owed`, tag: "in hand" });
  w.board.forEach((o, slot) => {
    const left = owed(o.want, o.filled);
    if (left > 0) out.push({ ref: orderRef(slot), note: `${n(left)} owed` });
  });
  return out;
}

/** The plots a thing from the ground lies in, with how many tiles of it each has. */
function foundIn(raw: Item): Entry[] {
  const w = S.world;
  const counts = new Map<number, number>();
  w.land.deposit.forEach((d, i) => {
    if (d !== raw) return;
    const p = w.land.plot[i] ?? NONE;
    counts.set(p, (counts.get(p) ?? 0) + 1);
  });
  return [...counts].flatMap(([p, count]) => {
    const plot = w.land.plots[p];
    if (!plot) return [];
    return [
      {
        ref: plotRef(plot.plot),
        note: `${count} tiles`,
        ...(w.plots.includes(plot.plot) ? { lit: true, tag: "yours" } : {}),
      },
    ];
  });
}

function itemDesc(art: Art, k: Item): Description {
  const w = S.world;
  const info = ITEM_INFO[k];
  const recipe = RECIPE[k];
  const usedIn = RECIPES_N.filter((r) => r.from.includes(k)).map((r) => ({ ref: itemRef(r.out) }));
  const rows: Row[] = [];
  if (recipe) {
    rows.push({
      label: "Made from",
      things: recipe.from.map((p, i) => ({ ref: itemRef(p), count: `×${recipe.need[i] ?? 1}` })),
    });
    rows.push({ label: "In", things: [{ ref: machineRef(recipe.by), note: `${secs(recipe.ticks)} for one` }] });
  } else if (isRaw(k)) {
    rows.push({
      label: "Gathered by",
      things: [{ ref: machineRef(GATHERER), note: `${secs(TICKS.gather)} for one` }],
    });
    rows.push({ label: "Lies in", things: foundIn(k) });
  }
  rows.push({ label: "Used in", things: usedIn });
  rows.push({ label: "Asked for by", things: askedFor(k) });
  const lock = recipe ? locked(w.open, { make: k }) : null;
  const ground = GROUND[itemName(k)];
  return {
    name: info?.name ?? "",
    icon: art.item(k),
    tag: STEPS[info?.step ?? 0] ?? "",
    aside: amount("coin", n(info?.worth ?? 0)),
    stats: [
      { label: "Step", value: String(info?.step ?? 0) },
      { label: "Orders pay", value: n(info?.worth ?? 0) },
      { label: "Depot pays", value: n((info?.worth ?? 0) * DEPOT_SHARE) },
    ],
    blocks: [...(ground ? [{ title: ground[0], body: ground[1] }] : []), ...(lock ? [{ body: `${lock}.` }] : [])],
    rows,
  };
}

// ---------- machines ----------

/** How long a machine takes over one thing, at the first grade's pace. */
function paceOf(k: Kind): string {
  if (k === GATHERER) return secs(TICKS.gather);
  if (k === TUNNEL || k === BELT) return `${secs(8 / (PACE[1] ?? 2))} a tile`;
  if (k === BOILER) return `${secs(TICKS.burn)} a piece`;
  if (isMaker(k)) {
    const ticks = (MADE_BY[k] ?? []).map((r) => r.ticks);
    const lo = Math.min(...ticks);
    const hi = Math.max(...ticks);
    return lo === hi ? secs(lo) : `${secs(lo)}–${secs(hi)}`;
  }
  return "";
}

function machineDesc(art: Art, k: Kind): Description {
  const w = S.world;
  const info = KIND_INFO[k];
  const what = info?.what ?? "";
  if (later(k)) return { name: nameOf(k), icon: machinePic(art, k), tag: what };
  const price = costOf(w, k);
  const stats: Stat[] = [];
  if ((DRAW[k] ?? 0) > 0) stats.push({ label: "Draws", value: String(DRAW[k]) });
  if ((GIVES[k] ?? 0) > 0) stats.push({ label: "Gives", value: String(k === DEPOT ? w.open.depot : GIVES[k]) });
  const pace = paceOf(k);
  if (pace) stats.push({ label: "Pace", value: pace });
  const key = KEYS[openTools().indexOf(k)];
  if (key && !S.visiting) stats.push({ label: "Key", value: key });
  const rows: Row[] = [];
  if (isMaker(k)) rows.push({ label: "Can make", things: recipesFor(w.open, k).map((r) => ({ ref: itemRef(r.out) })) });
  if (k === GATHERER)
    rows.push({ label: "Gathers", things: ALL_ITEMS.filter(isRaw).map((r) => ({ ref: itemRef(r) })) });
  if (k === BOILER) rows.push({ label: "Burns", things: [{ ref: itemRef(DEADFALL) }] });
  const open = k === DEPOT || locked(w.open, { build: k }) === null;
  const spare = w.spare[k] ?? 0;
  // A price needs no sentence: the card shows it, and taking a piece away gives all of it back.
  const blocks = spare > 0 ? [{ body: `${spare} free to place.` }] : [];
  return {
    name: nameOf(k),
    icon: machinePic(art, k),
    tag: open ? what : `${what} Not unlocked yet.`,
    blocks,
    ...(k === DEPOT ? {} : { aside: amount("coin", price === 0 ? "free" : price) }),
    stats,
    rows,
  };
}

/** Where on a card each side of a splitter is, round its picture: east, south, west, north. */
const SIDES = ["2 / 3", "3 / 2", "2 / 1", "1 / 2"] as const;

/**
 * A splitter's three ways out round its picture, as they lie in the yard: each says whether it is
 * open, shut, or open with nothing to take from it, and a press shuts or opens it. A visitor is
 * shown the same, with nothing to press.
 */
function waysOf(art: Art, i: number): HTMLElement {
  const w = S.world;
  const box = el("div", "ways");
  if (w.kind[i] !== SPLITTER) return box;
  const d = w.dir[i] === 1 ? 1 : w.dir[i] === 2 ? 2 : w.dir[i] === 3 ? 3 : 0;
  const arms = layout(w, S.rev).arms[i] ?? 0;
  const here = pic(beltTile(arms, d, 5, 0, w.tint[i] ?? 0), 3);
  const g = here.getContext("2d");
  [d, LEFT[d], RIGHT[d]].forEach((side, k) => {
    const head = art.m.heads[k]?.[d];
    if (head && ((arms >> (side * 2)) & 3) === 2) g?.drawImage(head, 0, 0);
    const shut = (((w.shut[i] ?? 0) >> k) & 1) === 1;
    const led = takes(w, toward(w.land, i, side), i);
    const state = shut ? "Shut" : led ? "Open" : "No belt";
    // Seen, a button's place says which way it is; read out, its name has to.
    const named = { "aria-label": `${["Ahead", "Left", "Right"][k]}: ${state}` };
    const way = el(
      S.visiting ? "span" : "button",
      `k-btn ${shut ? "coral" : led ? "green" : "slate"}`,
      S.visiting
        ? named
        : { ...named, type: "button", onclick: () => wayAt(i % w.land.w, Math.floor(i / w.land.w), k) },
      state,
    );
    way.style.gridArea = SIDES[side] ?? "";
    box.append(way);
  });
  box.append(here);
  return box;
}

/** A machine standing in the yard: its kind's card, with what this one is doing and holds, and what can be done with it. */
function standingDesc(art: Art, i: number): Description | null {
  const w = S.world;
  const k = w.kind[i] ?? NONE;
  if (!isKind(k)) return null;
  const base = machineDesc(art, k);
  if (later(k)) return base;
  const x = i % w.land.w;
  const y = Math.floor(i / w.land.w);
  const st = status(w, i);
  const per = rate(w, i);
  const h = w.holders;
  const r = holderOf(w, i);
  const rows: Row[] = [];
  const holding = r < 0 ? [] : ALL_ITEMS.filter((t) => held(h, r, t) > 0);
  if (holding.length > 0)
    rows.push({
      label: k === BOILER ? `Holds, of ${FUEL}` : k === CRATE ? `Holds, of ${w.open.crate}` : "Holds",
      things: holding.map((t) => ({ ref: itemRef(t), count: `×${held(h, r, t)}` })),
    });
  const making = aim(w, i);
  if (making)
    rows.push({
      label: "Making",
      things: [{ ref: itemRef(making.out), note: per > 0 ? `up to ${Math.round(per)} a minute` : "" }],
    });
  if (k === GATHERER) {
    const raw = w.land.deposit[i] ?? NONE;
    if (isItem(raw))
      rows.push({
        label: "Gathering",
        things: [{ ref: itemRef(raw), note: per > 0 ? `${Math.round(per)} a minute` : "" }],
      });
  }
  rows.push(...(base.rows ?? []));

  const actions: Action[] = [];
  const set = w.set[i] ?? NONE;
  if (isMaker(k)) {
    actions.push({
      label: "Any recipe",
      look: "slot",
      icon: icon("more"),
      lit: set === NONE,
      hint: "Any recipe",
      about: "It makes whichever item its inputs combine into.",
      on: () => {
        doNow({ do: "recipe", x, y, item: null });
        sfx.tap();
      },
    });
    for (const rec of recipesFor(w.open, k))
      actions.push({
        label: `Only ${many(rec.out)}`,
        look: "slot",
        icon: art.item(rec.out),
        lit: set === rec.out,
        hint: `Only ${many(rec.out)}`,
        about: `From ${partsWords(rec.out)}. It takes in no other item.`,
        on: () => {
          doNow({ do: "recipe", x, y, item: set === rec.out ? null : rec.out });
          sfx.tap();
        },
      });
  }
  const spare = st?.spare ?? null;
  const count = r < 0 ? 0 : (h.count[r] ?? 0);
  if (count > 0 && (k === CRATE || spare !== null || st?.state === "idle"))
    actions.push({
      label: spare === null ? "Empty it" : `Empty the ${many(spare)}`,
      look: spare === null ? "wood sm" : "sm",
      hint: "Empty",
      about:
        spare === null
          ? "Removes the items inside. They are lost."
          : `It is full of ${many(spare)}, so the other item it needs cannot get in. Emptying them clears it. To stop this, bring each input in on its own belt.`,
      on: () => {
        if (!("refused" in doNow({ do: "tipOut", x, y, item: spare }))) yardSfx.take();
      },
    });
  if (k === CRATE) {
    const open = r < 0 || h.open[r] === 1;
    actions.push({
      label: open ? "Shut it" : "Open it",
      hint: open ? "Shut" : "Open",
      about: "While shut, it takes items in and lets none out.",
      on: () => {
        doNow({ do: "crate", x, y, open: !open });
        sfx.clack();
      },
    });
  }
  if (k === DEPOT) {
    actions.push(
      { label: "Orders", on: () => togglePanel("orders") },
      ...(projectsOpen() ? [{ label: "Projects", on: () => togglePanel("projects") }] : []),
      { label: "Stats", on: () => togglePanel("depot") },
    );
  } else {
    if (k !== TUNNEL && k !== PYLON && k !== WHEEL && k !== BOILER)
      actions.push({
        label: "Rotate",
        hint: "Rotate (R)",
        on: () => turnAt(x, y),
      });
    if (usable(k))
      actions.push({
        label: "Another",
        hint: "Another (Q)",
        about: `Picks the ${nameOf(k).toLowerCase()} as your tool, facing the same way.`,
        on: () => pickFrom(x, y),
      });
    const refund = worthAt(w, i);
    actions.push({
      label: "Remove",
      look: "coral sm",
      after: refund > 0 ? amount("coin", `+${refund}`) : null,
      hint: "Remove",
      ...(w.free[i] === 1 ? {} : { about: "Any items inside it are lost." }),
      on: () => takeAway(x, y),
    });
  }
  const advice =
    st?.state === "starved" && st.spare !== undefined
      ? `A bench takes things in at its back and both sides. Bring ${many(st.spare)} in one way and ${(st.missing ?? []).map(many).join(" and ")} another, and it cannot fill up with the wrong one.`
      : null;
  return {
    ...base,
    tag: el("span", st?.trouble ? "k-coral" : "", { text: st?.line ?? KIND_INFO[k]?.what ?? "" }),
    blocks: [
      ...(base.blocks ?? []),
      ...(advice ? [{ body: advice }] : []),
      ...(k === SPLITTER ? [{ title: "Ways out", body: waysOf(art, i) }] : []),
    ],
    rows,
    actions,
  };
}

// ---------- land, nodes, orders ----------

/** What lies in a plot's ground, by thing, with how many tiles of each. */
function inTheGround(id: Plot): Entry[] {
  const w = S.world;
  const index = w.land.plots.findIndex((p) => p.plot === id);
  const counts = new Map<Item, number>();
  w.land.deposit.forEach((d, i) => {
    if (isItem(d) && w.land.plot[i] === index) counts.set(d, (counts.get(d) ?? 0) + 1);
  });
  return [...counts].map(([raw, count]) => ({ ref: itemRef(raw), note: `${count} tiles` }));
}

/** What a button that buys says once it has been pressed: the second press buys. */
const AGAIN = "Press again to buy";

/** For something that costs more Coins than there are: how many more it takes. */
const short = (price: number): Block[] =>
  coins() >= price ? [] : [{ body: `You need ${(price - coins()).toLocaleString("en-US")} more Coins.` }];

function plotDesc(id: Plot): Description | null {
  const w = S.world;
  const plot = w.land.plots.find((p) => p.plot === id);
  if (!plot) return null;
  const { state, why } = plotState(w, id);
  const index = w.land.plots.indexOf(plot);
  const bank = w.land.water.some((v, i) => v === 1 && w.land.plot[i] === index);
  return {
    name: plot.name,
    icon: icon("star"),
    tag: plot.why,
    aside:
      state === "owned"
        ? el("span", "k-chip lit", {}, icon("check"), "Yours")
        : amount("coin", plot.price.toLocaleString("en-US")),
    blocks: [
      ...(bank ? [{ body: "The stream runs through it. A waterwheel must be beside the stream." }] : []),
      ...(state === "not yet" ? [{ body: `${why ?? "Not for sale yet"}.` }] : []),
      ...(state === "for sale" ? short(plot.price) : []),
    ],
    rows: [{ label: "In the ground", things: inTheGround(id) }],
    actions:
      state === "for sale"
        ? [
            {
              label: `Buy for ${plot.price.toLocaleString("en-US")}`,
              look: coins() >= plot.price ? "sm wide" : "sm wide off",
              icon: icon("coin"),
              ...(coins() >= plot.price ? { ask: AGAIN } : {}),
              on: () => {
                // Bought, the card has nothing more to offer: it is put away, so it does not sit over the new land.
                if (buyLand(id)) close();
              },
            },
          ]
        : [],
  };
}

/** What an order or a node wants, each thing with how many have come of how many. */
const wantsOf = (want: Float64Array, filled: Float64Array | null): Entry[] =>
  ALL_ITEMS.filter((k) => (want[k] ?? 0) > 0).map((k) => {
    const of = want[k] ?? 0;
    const have = Math.min(filled?.[k] ?? 0, of);
    return { ref: itemRef(k), note: `${n(have)} / ${n(of)}`, lit: have >= of };
  });

/** How a node is spoken of: "Lesson 2 of 4", "Tier 1 project", "Tier 1 commission". */
function nodeKind(g: Goal): string {
  const info = GOALS[g];
  if (!info) return "";
  if (info.kind !== "lesson") return `Tier ${info.tier} ${info.kind}`;
  const lessons = GOALS.flatMap((o, k) => (o.kind === "lesson" ? [k] : []));
  return `Lesson ${lessons.indexOf(g) + 1} of ${lessons.length}`;
}

/** A lesson, a project or a commission: who asks and what for, what it wants and has been given, what it unlocks, and whether it may be taken in hand. */
function nodeDesc(g: Goal): Description | null {
  const w = S.world;
  const info = GOALS[g];
  const node = NODES[g];
  if (!info || !node || !isNode(g)) return null;
  const u = info.unlocks;
  const done = w.open.done[g] === 1;
  const inHand = w.hand === g;
  const may = !done && !inHand && info.kind !== "lesson" && ready(w.open, g);
  const needs = info.needs.filter((m) => w.open.done[m] !== 1).map((m) => GOALS[m]?.title ?? "");
  const also = unlockWords(u);
  return {
    name: info.title,
    icon: yardIcon("orders"),
    tag: `${nodeKind(g)}, from ${node.from}`,
    ...(info.pay > 0 ? { aside: amount("coin", info.pay.toLocaleString("en-US")) } : {}),
    blocks: [
      { body: node.say },
      ...(done ? [{ body: "Done." }] : inHand ? [{ body: "In hand: what reaches the depot goes to it first." }] : []),
      ...(needs.length > 0 ? [{ body: `Needs ${needs.join(" and ")} first.` }] : []),
      ...(also.length > 0 ? [{ body: `Also unlocks ${also.join(", ")}.` }] : []),
      ...(node.gift ? [{ body: node.gift.line }] : []),
    ],
    rows: [
      { label: "Wants", things: done ? wantsOf(info.want, info.want) : wantsOf(info.want, w.got[g] ?? null) },
      {
        label: "Unlocks",
        things: [
          ...(u.kinds ?? []).map((k) => ({ ref: machineRef(kindOf(k)) })),
          ...(u.recipes ?? []).map((k) => ({ ref: itemRef(itemOf(k)) })),
          ...(u.plots ?? []).map((p) => ({ ref: plotRef(plotOf(p)) })),
        ],
      },
    ],
    actions: may ? [{ label: "Take it in hand", look: "sm wide", on: () => void takeInHand(g) }] : [],
  };
}

function orderDesc(slot: string): Description | null {
  const w = S.world;
  if (slot === "story") return w.hand === -1 ? null : nodeDesc(w.hand);
  const o = w.board[Number(slot)];
  if (!o) return null;
  return {
    name: o.title,
    icon: yardIcon("orders"),
    tag: `From ${o.from}`,
    aside: amount("coin", o.pay.toLocaleString("en-US")),
    blocks: [
      { body: o.line },
      ...(isFilled(o.want, o.filled) ? [{ body: "Filled, and waiting to be handed over." }] : []),
    ],
    rows: [{ label: "Wants", things: wantsOf(o.want, o.filled) }],
  };
}

// ---------- the yard's tiles ----------

/** What a tile of the yard stands for: what is built on it, the land it is part of, or what lies in it. */
export function refAt(x: number, y: number): string | null {
  const w = S.world;
  const i = at(w, x, y);
  if (i < 0) return null;
  const plot = w.land.plots[w.land.plot[i] ?? NONE];
  if (plot && !w.plots.includes(plot.plot)) return plotRef(plot.plot);
  if (w.kind[i] !== NONE) return tileRef(i);
  const raw = w.land.deposit[i] ?? NONE;
  if (isItem(raw)) return itemRef(raw);
  if (w.land.water[i] === 1 || w.land.trunk[i] === 1) return tileRef(i);
  return null;
}

/** What is riding a belt on a tile, if anything: pointing there is asking about it. */
export function riderAt(x: number, y: number): string | null {
  const w = S.world;
  const i = at(w, x, y);
  const carried = i < 0 ? NONE : (w.item[i] ?? NONE);
  return i >= 0 && carries(w.kind[i] ?? NONE) && isItem(carried) ? itemRef(carried) : null;
}

function tileDesc(art: Art, i: number): Description | null {
  const w = S.world;
  if (i < 0 || i >= w.kind.length) return null;
  if (w.kind[i] !== NONE) return standingDesc(art, i);
  if (w.land.water[i] === 1)
    return {
      name: "The stream",
      tag: "Nothing can be built on it. A waterwheel beside it makes power, and a tunnel can go under it.",
    };
  if (w.land.trunk[i] === 1)
    return {
      name: "A redwood",
      tag: "Nothing can be built on it. Belts go round it, or under it by tunnel.",
    };
  return null;
}

/** In a visit, nothing on a card does anything: its buttons are left off. */
const looked = (d: Description | null): Description | null => (d && S.visiting ? { ...d, actions: [] } : d);

/** Says what every kind of thing in the yard is. */
export function initCard(art: Art): void {
  theArt = art;
  register("item", (id) => {
    const k = numberIn(id);
    return isItem(k) ? itemDesc(art, k) : null;
  });
  register("machine", (id) => {
    const k = numberIn(id);
    return isKind(k) ? machineDesc(art, k) : null;
  });
  register("tile", (i) => looked(tileDesc(art, numberIn(i))));
  register("plot", (id) => {
    const p = numberIn(id);
    return looked(isPlot(p) ? plotDesc(p) : null);
  });
  register("node", (id) => {
    const g = numberIn(id);
    return looked(isGoal(g) ? nodeDesc(g) : null);
  });
  register("order", (slot) => looked(orderDesc(slot)));
}

/** What the card that is up is about would say differently now: a key that changes when it would. */
export function cardKey(ref: string | null): string {
  const w = S.world;
  if (!ref) return "";
  if (ref.startsWith("tile:")) {
    const i = numberIn(ref.slice(5));
    const k = w.kind[i] ?? NONE;
    const st = k === NONE ? null : status(w, i);
    const r = holderOf(w, i);
    const holds = r < 0 ? "" : ALL_ITEMS.map((t) => held(w.holders, r, t)).join("");
    const open = r < 0 ? "" : String(w.holders.open[r]);
    return `${ref}|${S.rev}|${k}|${st?.line}|${holds}|${w.set[i]}|${open}|${w.shut[i]}|${w.item[i]}|${Math.floor(coins() / 50)}`;
  }
  const given = [w.hand === -1 ? null : w.got[w.hand], ...w.board.map((o) => o.filled)]
    .map((f) => f?.join(",") ?? "")
    .join("|");
  return `${ref}|${S.rev}|${w.hand}|${w.done.length}|${w.plots.join()}|${Math.floor(coins() / 50)}|${given}`;
}

/** The art the cards draw from, once it is made. */
export const cardArt = (): Art | null => theArt;

/** Where a tile is on the page, for a card to sit beside. */
export function tileBox(x: number, y: number): { x: number; y: number; w: number; h: number } {
  const a = toPage(x * TILE, y * TILE);
  const b = toPage((x + 1) * TILE, (y + 1) * TILE);
  return { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y };
}

/** Pins the card for whatever is on a tile (or puts it away, if it was the one pinned). Gives whether one is up. */
export function openCard(x: number, y: number): boolean {
  const ref = refAt(x, y);
  if (!ref) {
    close();
    return false;
  }
  const b = tileBox(x, y);
  return pick(ref, b.x, b.y, b.w, b.h);
}

export function closeCard(): void {
  close();
}

let lastKey = "";
/** The card that is up says again what its thing is, when what it would say has changed. */
export function refreshCard(): void {
  const key = cardKey(shown()?.ref ?? null);
  if (key === lastKey) return;
  lastKey = key;
  refresh();
}

/**
 * Keeps the yard in step with the cards: the tile whose card is pinned is marked on the yard, and
 * a sheet along the bottom (a finger's card) does not cover what it is about.
 */
export function followCards(pan: (dx: number, dy: number) => void): void {
  watch((_pointed, pinned) => {
    const was = S.picked;
    S.picked = pinned?.startsWith("tile:") ? numberIn(pinned.slice(5)) : -1;
    if (S.picked < 0 || S.picked === was) return;
    if (S.picked !== was) sfx.tap();
    requestAnimationFrame(() => {
      const sheet = document.querySelector(".k-info.sheet");
      if (!sheet || S.picked < 0) return;
      const w = S.world;
      const spot = toPage((S.picked % w.land.w) * TILE + 8, Math.floor(S.picked / w.land.w) * TILE + 8);
      const top = sheet.getBoundingClientRect().top;
      // Moved up just far enough to stand clear of the card.
      if (spot.y > top - 24) pan(0, top - 40 - spot.y);
    });
  });
}
