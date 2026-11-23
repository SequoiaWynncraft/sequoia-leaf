/**
 * Each card drawn from its print (`prints.ts`), and from nothing else: what a card shows of the
 * yard and the purse is in its print, and this module reaches neither (it imports nothing of the
 * page's that holds them; `cards.test.ts` holds it to that). What else a card says (names, words,
 * recipes, prices of the tables) is the rules' tables. Its buttons do what the page hands in
 * (`Hands`). So the card that is up, drawn again when its print changes (`card.ts`), can never show
 * a value it is not kept by.
 *
 * A card is named by a reference, by its number in the rules' tables:
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
 * what they are.
 */
import {
  type Act,
  ALL_ITEMS,
  BELT,
  BOILER,
  CRATE,
  DEADFALL,
  DEPOT,
  DEPOT_SHARE,
  type Dir,
  DRAW,
  GATHERER,
  GIVES,
  type Goal,
  GOALS,
  isMaker,
  isRaw,
  type Item,
  item as itemOf,
  ITEM_INFO,
  itemName,
  type Kind,
  kind as kindOf,
  KIND_INFO,
  LEFT,
  MADE_BY,
  NODES,
  PACE,
  type Plot,
  plot as plotOf,
  PYLON,
  RECIPE,
  RECIPES_N,
  RIGHT,
  TICKS,
  TUNNEL,
  WHEEL,
} from "@sequoia-leaf/factory";
import {
  type Action,
  type Block,
  close,
  type Description,
  type Entry,
  type Row,
  type Stat,
} from "@sequoia-leaf/kit/card.ts";
import { amount, el, icon } from "@sequoia-leaf/kit/dom.ts";
import { sfx } from "@sequoia-leaf/kit/sound.ts";

import { beltTile } from "../art/belts.ts";
import type { Art } from "../art/index.ts";
import { yardSfx } from "../sound.ts";
import { fitted, partsWords, pic, unlockWords, yardIcon } from "./parts.ts";

export const itemRef = (k: Item): string => `item:${k}`;
export const machineRef = (k: Kind): string => `machine:${k}`;
export const tileRef = (i: number): string => `tile:${i}`;
export const plotRef = (id: Plot): string => `plot:${id}`;
export const nodeRef = (g: Goal): string => `node:${g}`;
export const orderRef = (slot: number | "story"): string => `order:${slot}`;

// ---------- prints: what each card shows of the yard and the purse ----------

/** Another card named in a row, as printed: its reference and name, and the words beside it. */
export interface Named {
  readonly ref: string;
  readonly name: string;
  readonly note: string;
  readonly tag?: string;
}

export interface ItemPrint {
  readonly card: "item";
  readonly item: Item;
  /** Why the yard may not make it yet, or nothing. */
  readonly lock: string | null;
  /** For a thing from the ground: each plot it lies in, how many tiles of it, and whether the plot is the yard's. */
  readonly found: readonly (readonly [Plot, number, boolean])[];
  /** The node in hand and the board's orders still asking for it, with how many they are owed. */
  readonly asked: readonly Named[];
}

export interface MachinePrint {
  readonly card: "machine";
  readonly kind: Kind;
  /** A kind this page does not draw (`DRAWN`): its card says only what it is. */
  readonly later: boolean;
  /** What one more costs now, the pieces to hand counted. */
  readonly price: number;
  /** The power it gives: for the depot, as what is open says. */
  readonly gives: number;
  /** Its key in the dock, if it has one there now. */
  readonly key: string | null;
  /** What it can make, of what is open. */
  readonly recipes: readonly Item[];
  /** Whether the yard may build it. */
  readonly open: boolean;
  /** How many the yard has to hand, free to place. */
  readonly spare: number;
}

/** A splitter's three ways out as its card shows them: its picture's arms, way and colour, and each way shut, and led somewhere. */
export interface WaysPrint {
  readonly arms: number;
  readonly dir: Dir;
  readonly tint: number;
  readonly shut: readonly boolean[];
  readonly led: readonly boolean[];
}

export interface StandingPrint {
  readonly card: "standing";
  readonly x: number;
  readonly y: number;
  readonly machine: MachinePrint;
  /** What its condition says, and whether it is trouble; the state, the thing it is full of and those it waits for. */
  readonly line: string | null;
  readonly trouble: boolean;
  readonly state: string | null;
  readonly spare: Item | null;
  readonly missing: readonly Item[];
  /** What it holds, with how many of each; how many it may hold, where its card says; how many in all. */
  readonly holding: readonly (readonly [Item, number])[];
  readonly most: number | null;
  readonly count: number;
  /** What it makes or gathers, and how many a minute at the yard's pace now, as the card rounds it (null when none). */
  readonly making: Item | null;
  readonly gathering: Item | null;
  readonly perMinute: number | null;
  /** The one thing it is told to make, or nothing. */
  readonly set: Item | null;
  /** For a crate: whether it is open. */
  readonly open: boolean;
  /** For the depot: whether Projects is there. */
  readonly projects: boolean;
  /** Whether it can be picked up as the tool in hand (Another). */
  readonly another: boolean;
  /** What taking it away gives back, and whether it was one of the pieces to hand. */
  readonly refund: number;
  readonly free: boolean;
  readonly ways: WaysPrint | null;
  readonly visiting: boolean;
}

/** A tile with nothing on it that has a card: the stream, or a redwood. */
export interface GroundPrint {
  readonly card: "ground";
  readonly ground: "stream" | "redwood";
}

export interface PlotPrint {
  readonly card: "plot";
  readonly plot: Plot;
  readonly name: string;
  readonly why: string;
  readonly price: number;
  readonly state: "owned" | "for sale" | "not yet";
  readonly not: string | null;
  /** The stream runs through it. */
  readonly bank: boolean;
  /** What lies in its ground: each thing, and how many tiles. */
  readonly ground: readonly (readonly [Item, number])[];
  /** How many Coins more than there are it costs, or 0. */
  readonly short: number;
  readonly visiting: boolean;
}

export interface NodePrint {
  readonly card: "node";
  readonly goal: Goal;
  readonly done: boolean;
  readonly inHand: boolean;
  /** Whether it may be taken in hand now. */
  readonly may: boolean;
  /** The titles of the nodes it needs first that are not done. */
  readonly needs: readonly string[];
  /** What it wants and has been given: each thing, how many have come, of how many. */
  readonly wants: readonly (readonly [Item, number, number])[];
  readonly visiting: boolean;
}

export interface OrderPrint {
  readonly card: "order";
  readonly title: string;
  readonly from: string;
  readonly line: string;
  readonly pay: number;
  readonly wants: readonly (readonly [Item, number, number])[];
  readonly full: boolean;
}

export type Print = ItemPrint | MachinePrint | StandingPrint | GroundPrint | PlotPrint | NodePrint | OrderPrint;

/** What a card's buttons do: the page's own tools, handed in, so that drawing a card reaches no yard. */
export interface Hands {
  /** Does a command (a recipe, a crate shut or opened, emptying), and says whether it was done. */
  act(a: Act): boolean;
  turn(x: number, y: number): void;
  another(x: number, y: number): void;
  remove(x: number, y: number): void;
  way(x: number, y: number, way: number): void;
  buy(plot: Plot): boolean;
  take(g: Goal): void;
  panel(id: "orders" | "projects" | "depot"): void;
}

// ---------- drawing a card from its print ----------

const GROUND: Readonly<Record<string, readonly [string, string]>> = {
  deadfall: ["Deadfall", "Fallen branches. A gatherer here picks them up; a mill saws them into planks."],
  stone: ["A stone outcrop", "A gatherer here picks up stone; a mill fires it into bricks."],
  ore: ["An ore seam", "A gatherer here picks up ore; a mill smelts it into ingots."],
  clay: ["A clay bank", "A gatherer here digs clay; a mill fires it into pots."],
  sand: ["Sand", "A gatherer here shovels sand; a mill melts it into glass."],
  resin: ["Old stumps weeping resin", "A gatherer here collects resin; a mill presses it into lamp oil."],
};

const STEPS = ["From the ground", "Worked once", "Put together", "The guild's goods", "Takes the whole yard"];

/** Seconds, as a card says them: "1.2s". */
const secs = (ticks: number): string => `${Math.round(ticks) / 10}s`;
const n = (v: number): string => v.toLocaleString("en-US", { maximumFractionDigits: 3 });
const nameOf = (k: number): string => KIND_INFO[k]?.name ?? "";
const many = (k: number): string => ITEM_INFO[k]?.many ?? "";

/** A machine's picture cut to a card's slot: a tall machine is known by its head. */
const machinePic = (art: Art, k: Kind): HTMLCanvasElement => fitted(art.icon(k), 22, 22);

/** Rows of another card named, with the words beside each. */
const entries = (named: readonly Named[]): Entry[] =>
  named.map((e) => ({ ref: e.ref, name: e.name, note: e.note, ...(e.tag ? { tag: e.tag } : {}) }));

/** What an order or a node wants, each thing with how many have come of how many. */
const wanted = (wants: NodePrint["wants"]): Entry[] =>
  wants.map(([k, have, of]) => ({ ref: itemRef(k), note: `${n(have)} / ${n(of)}`, lit: have >= of }));

function itemCard(art: Art, p: ItemPrint): Description {
  const k = p.item;
  const info = ITEM_INFO[k];
  const recipe = RECIPE[k];
  const usedIn = RECIPES_N.filter((r) => r.from.includes(k)).map((r) => ({ ref: itemRef(r.out) }));
  const rows: Row[] = [];
  if (recipe) {
    rows.push({
      label: "Made from",
      things: recipe.from.map((part, i) => ({ ref: itemRef(part), count: `×${recipe.need[i] ?? 1}` })),
    });
    rows.push({ label: "In", things: [{ ref: machineRef(recipe.by), note: `${secs(recipe.ticks)} for one` }] });
  } else if (isRaw(k)) {
    rows.push({
      label: "Gathered by",
      things: [{ ref: machineRef(GATHERER), note: `${secs(TICKS.gather)} for one` }],
    });
    rows.push({
      label: "Lies in",
      things: p.found.map(([plot, tiles, yours]) => ({
        ref: plotRef(plot),
        note: `${tiles} tiles`,
        ...(yours ? { lit: true, tag: "yours" } : {}),
      })),
    });
  }
  rows.push({ label: "Used in", things: usedIn });
  rows.push({ label: "Asked for by", things: entries(p.asked) });
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
    blocks: [...(ground ? [{ title: ground[0], body: ground[1] }] : []), ...(p.lock ? [{ body: `${p.lock}.` }] : [])],
    rows,
  };
}

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

function machineCard(art: Art, p: MachinePrint): Description {
  const k = p.kind;
  const what = KIND_INFO[k]?.what ?? "";
  if (p.later) return { name: nameOf(k), icon: machinePic(art, k), tag: what };
  const stats: Stat[] = [];
  if ((DRAW[k] ?? 0) > 0) stats.push({ label: "Draws", value: String(DRAW[k]) });
  if ((GIVES[k] ?? 0) > 0) stats.push({ label: "Gives", value: String(p.gives) });
  const pace = paceOf(k);
  if (pace) stats.push({ label: "Pace", value: pace });
  if (p.key) stats.push({ label: "Key", value: p.key });
  const rows: Row[] = [];
  if (isMaker(k)) rows.push({ label: "Can make", things: p.recipes.map((r) => ({ ref: itemRef(r) })) });
  if (k === GATHERER)
    rows.push({ label: "Gathers", things: ALL_ITEMS.filter(isRaw).map((r) => ({ ref: itemRef(r) })) });
  if (k === BOILER) rows.push({ label: "Burns", things: [{ ref: itemRef(DEADFALL) }] });
  // A price needs no sentence: the card shows it, and taking a piece away gives all of it back.
  const blocks = p.spare > 0 ? [{ body: `${p.spare} free to place.` }] : [];
  return {
    name: nameOf(k),
    icon: machinePic(art, k),
    tag: p.open ? what : `${what} Not unlocked yet.`,
    blocks,
    ...(k === DEPOT ? {} : { aside: amount("coin", p.price === 0 ? "free" : p.price) }),
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
function waysOf(art: Art, p: StandingPrint, ways: WaysPrint, hands: Hands): HTMLElement {
  const box = el("div", "ways");
  const d = ways.dir;
  const here = pic(beltTile(ways.arms, d, 5, 0, ways.tint), 3);
  const g = here.getContext("2d");
  [d, LEFT[d], RIGHT[d]].forEach((side, k) => {
    const head = art.m.heads[k]?.[d];
    if (head && ((ways.arms >> (side * 2)) & 3) === 2) g?.drawImage(head, 0, 0);
    const shut = ways.shut[k] === true;
    const led = ways.led[k] === true;
    const state = shut ? "Shut" : led ? "Open" : "No belt";
    // Seen, a button's place says which way it is; read out, its name has to.
    const named = { "aria-label": `${["Ahead", "Left", "Right"][k]}: ${state}` };
    const way = el(
      p.visiting ? "span" : "button",
      `k-btn ${shut ? "coral" : led ? "green" : "slate"}`,
      p.visiting ? named : { ...named, type: "button", onclick: () => hands.way(p.x, p.y, k) },
      state,
    );
    way.style.gridArea = SIDES[side] ?? "";
    box.append(way);
  });
  box.append(here);
  return box;
}

/** A machine standing in the yard: its kind's card, with what this one is doing and holds, and what can be done with it. */
function standingCard(art: Art, p: StandingPrint, hands: Hands): Description {
  const m = p.machine;
  const k = m.kind;
  const base = machineCard(art, m);
  if (m.later) return base;
  const { x, y } = p;
  const rows: Row[] = [];
  if (p.holding.length > 0)
    rows.push({
      label: p.most !== null ? `Holds, of ${p.most}` : "Holds",
      things: p.holding.map(([t, c]) => ({ ref: itemRef(t), count: `×${c}` })),
    });
  if (p.making !== null)
    rows.push({
      label: "Making",
      things: [{ ref: itemRef(p.making), note: p.perMinute !== null ? `up to ${p.perMinute} a minute` : "" }],
    });
  if (p.gathering !== null)
    rows.push({
      label: "Gathering",
      things: [{ ref: itemRef(p.gathering), note: p.perMinute !== null ? `${p.perMinute} a minute` : "" }],
    });
  rows.push(...(base.rows ?? []));

  const actions: Action[] = [];
  if (isMaker(k)) {
    actions.push({
      label: "Any recipe",
      look: "slot",
      icon: icon("more"),
      lit: p.set === null,
      hint: "Any recipe",
      about: "It makes whichever item its inputs combine into.",
      on: () => {
        hands.act({ do: "recipe", x, y, item: null });
        sfx.tap();
      },
    });
    for (const out of m.recipes)
      actions.push({
        label: `Only ${many(out)}`,
        look: "slot",
        icon: art.item(out),
        lit: p.set === out,
        hint: `Only ${many(out)}`,
        about: `From ${partsWords(out)}. It takes in no other item.`,
        on: () => {
          hands.act({ do: "recipe", x, y, item: p.set === out ? null : out });
          sfx.tap();
        },
      });
  }
  if (p.count > 0 && (k === CRATE || p.spare !== null || p.state === "idle"))
    actions.push({
      label: p.spare === null ? "Empty it" : `Empty the ${many(p.spare)}`,
      look: p.spare === null ? "wood sm" : "sm",
      hint: "Empty",
      about:
        p.spare === null
          ? "Removes the items inside. They are lost."
          : `It is full of ${many(p.spare)}, so the other item it needs cannot get in. Emptying them clears it. To stop this, bring each input in on its own belt.`,
      on: () => {
        if (hands.act({ do: "tipOut", x, y, item: p.spare })) yardSfx.take();
      },
    });
  if (k === CRATE)
    actions.push({
      label: p.open ? "Shut it" : "Open it",
      hint: p.open ? "Shut" : "Open",
      about: "While shut, it takes items in and lets none out.",
      on: () => {
        hands.act({ do: "crate", x, y, open: !p.open });
        sfx.clack();
      },
    });
  if (k === DEPOT) {
    actions.push(
      { label: "Orders", on: () => hands.panel("orders") },
      ...(p.projects ? [{ label: "Projects", on: () => hands.panel("projects") }] : []),
      { label: "Makes and needs", on: () => hands.panel("depot") },
    );
  } else {
    if (k !== TUNNEL && k !== PYLON && k !== WHEEL && k !== BOILER)
      actions.push({ label: "Rotate", hint: "Rotate (R)", on: () => hands.turn(x, y) });
    if (p.another)
      actions.push({
        label: "Another",
        hint: "Another (Q)",
        about: `Picks the ${nameOf(k).toLowerCase()} as your tool, facing the same way.`,
        on: () => hands.another(x, y),
      });
    actions.push({
      label: "Remove",
      look: "coral sm",
      after: p.refund > 0 ? amount("coin", `+${p.refund}`) : null,
      hint: "Remove",
      ...(p.free ? {} : { about: "Any items inside it are lost." }),
      on: () => hands.remove(x, y),
    });
  }
  const advice =
    p.state === "starved" && p.spare !== null
      ? `A bench takes things in at its back and both sides. Bring ${many(p.spare)} in one way and ${p.missing.map(many).join(" and ")} another, and it cannot fill up with the wrong one.`
      : null;
  return {
    ...base,
    tag: el("span", p.trouble ? "k-coral" : "", { text: p.line ?? KIND_INFO[k]?.what ?? "" }),
    blocks: [
      ...(base.blocks ?? []),
      ...(k === DEPOT ? [{ body: `Each thing that arrives pays ${DEPOT_SHARE * 100}% of its worth.` }] : []),
      ...(advice ? [{ body: advice }] : []),
      ...(p.ways ? [{ title: "Ways out", body: waysOf(art, p, p.ways, hands) }] : []),
    ],
    rows,
    actions: p.visiting ? [] : actions,
  };
}

const groundCard = (p: GroundPrint): Description =>
  p.ground === "stream"
    ? {
        name: "The stream",
        tag: "Nothing can be built on it. A waterwheel beside it makes power, and a tunnel can go under it.",
      }
    : { name: "A redwood", tag: "Nothing can be built on it. Belts go round it, or under it by tunnel." };

/** What a button that buys says once it has been pressed: the second press buys. */
const AGAIN = "Press again to buy";

function plotCard(p: PlotPrint, hands: Hands): Description {
  const enough = p.short === 0;
  const blocks: Block[] = [
    ...(p.bank ? [{ body: "The stream runs through it. A waterwheel must be beside the stream." }] : []),
    ...(p.state === "not yet" ? [{ body: `${p.not ?? "Not for sale yet"}.` }] : []),
    ...(p.state === "for sale" && !enough ? [{ body: `You need ${p.short.toLocaleString("en-US")} more Coins.` }] : []),
  ];
  return {
    name: p.name,
    icon: icon("star"),
    tag: p.why,
    aside:
      p.state === "owned"
        ? el("span", "k-chip lit", {}, icon("check"), "Yours")
        : amount("coin", p.price.toLocaleString("en-US")),
    blocks,
    rows: [
      {
        label: "In the ground",
        things: p.ground.map(([raw, tiles]) => ({ ref: itemRef(raw), note: `${tiles} tiles` })),
      },
    ],
    actions:
      p.state === "for sale" && !p.visiting
        ? [
            {
              label: `Buy for ${p.price.toLocaleString("en-US")}`,
              look: enough ? "sm wide" : "sm wide off",
              icon: icon("coin"),
              ...(enough ? { ask: AGAIN } : {}),
              on: () => {
                // Bought, the card has nothing more to offer: it is put away, so it does not sit over the new land.
                if (hands.buy(p.plot)) close();
              },
            },
          ]
        : [],
  };
}

/** How a node is spoken of: "Lesson 2 of 4", "Tier 1 project", "Tier 1 commission". */
function nodeKind(g: Goal): string {
  const info = GOALS[g];
  if (!info) return "";
  if (info.kind !== "lesson") return `Tier ${info.tier} ${info.kind}`;
  const lessons = GOALS.flatMap((o, k) => (o.kind === "lesson" ? [k] : []));
  return `Lesson ${lessons.indexOf(g) + 1} of ${lessons.length}`;
}

/** A lesson, a project or a commission: who asks and what for, what it wants and has been given, what it unlocks, and whether it may be taken in hand. */
function nodeCard(p: NodePrint, hands: Hands): Description | null {
  const g = p.goal;
  const info = GOALS[g];
  const node = NODES[g];
  if (!info || !node) return null;
  const u = info.unlocks;
  const also = unlockWords(u);
  return {
    name: info.title,
    icon: yardIcon("orders"),
    tag: `${nodeKind(g)}, from ${node.from}`,
    ...(info.pay > 0 ? { aside: amount("coin", info.pay.toLocaleString("en-US")) } : {}),
    blocks: [
      { body: node.say },
      ...(p.done
        ? [{ body: "Done." }]
        : p.inHand
          ? [{ body: "In hand: what reaches the depot goes to it first." }]
          : []),
      ...(p.needs.length > 0 ? [{ body: `Needs ${p.needs.join(" and ")} first.` }] : []),
      ...(also.length > 0 ? [{ body: `Also unlocks ${also.join(", ")}.` }] : []),
      ...(node.gift ? [{ body: node.gift.line }] : []),
    ],
    rows: [
      { label: "Wants", things: wanted(p.wants) },
      {
        label: "Unlocks",
        things: [
          ...(u.kinds ?? []).map((k) => ({ ref: machineRef(kindOf(k)) })),
          ...(u.recipes ?? []).map((k) => ({ ref: itemRef(itemOf(k)) })),
          ...(u.plots ?? []).map((id) => ({ ref: plotRef(plotOf(id)) })),
        ],
      },
    ],
    actions: p.may && !p.visiting ? [{ label: "Take it in hand", look: "sm wide", on: () => hands.take(g) }] : [],
  };
}

const orderCard = (p: OrderPrint): Description => ({
  name: p.title,
  icon: yardIcon("orders"),
  tag: `From ${p.from}`,
  aside: amount("coin", p.pay.toLocaleString("en-US")),
  blocks: [{ body: p.line }, ...(p.full ? [{ body: "Filled, and waiting to be handed over." }] : [])],
  rows: [{ label: "Wants", things: wanted(p.wants) }],
});

/** A card, drawn from its print alone. */
export function cardOf(art: Art, p: Print, hands: Hands): Description | null {
  switch (p.card) {
    case "item":
      return itemCard(art, p);
    case "machine":
      return machineCard(art, p);
    case "standing":
      return standingCard(art, p, hands);
    case "ground":
      return groundCard(p);
    case "plot":
      return plotCard(p, hands);
    case "node":
      return nodeCard(p, hands);
    case "order":
      return orderCard(p);
  }
}
