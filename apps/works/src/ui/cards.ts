/**
 * Each card drawn from its print (`prints.ts`), and from nothing else: what a card shows of the
 * yard and the purse is in its print, and this module reaches neither (it imports nothing of the
 * page's that holds them; `cards.test.ts` holds it to that). What else a card says (names, words,
 * recipes, prices of the tables) is the rules' tables. Its buttons do what the page hands in
 * (`Hands`). So the card that is up, drawn again when its print changes (`card.ts`), can never show
 * a value it is not kept by.
 *
 * A card is named by a reference (`refs.ts` lists them):
 *
 * - a thing: its step, what it is made from and where, what it goes into, what the depot pays, and
 *   the orders asking for it (or, for one from the ground, where it lies);
 * - a kind of piece, at the first grade or a higher ("Belt II"): what it does, what it can make,
 *   its draw, pace and price at that grade;
 * - whatever stands on a tile of the yard: its kind's card at its grade, with what this one is doing
 *   and holds, what it makes and needs a minute once the yard counts, and what can be done with it
 *   (a recipe pinned, a sorter set, a grade raised, a splitter's three ways out shut or opened);
 * - a plot; a goal (a lesson, a project, a commission or a piece of research) and an order, each
 *   with its lists as `goal.ts` lays them out;
 * - a tool, a number a goal raises, a tier, and what a finished goal leaves in town.
 *
 * Every picture of a tool and of a number is looked up in a table with an entry for each
 * (`TOOL_ICON`, `PERK_ART`), so that a new one without a picture does not build.
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
  DRAWN,
  GATHERER,
  GIVES,
  type Goal,
  GOALS,
  gradeSays,
  HALF,
  isFolio,
  isGraded,
  isMaker,
  isNode,
  isRaw,
  type Item,
  ITEM_INFO,
  itemName,
  type Kind,
  kind as kindOf,
  KIND_INFO,
  LEFT,
  MADE_BY,
  NODES,
  type Numbered,
  numeral,
  PACE,
  type Plot,
  PYLON,
  RECIPE,
  RECIPES_N,
  RIGHT,
  SORTER,
  SPLITTER,
  STOP,
  STUDY,
  TICKS,
  tierName,
  type Tool,
  TOOL_INFO,
  TUNNEL,
  type Unlock,
  unlockedBy,
  WHEEL,
} from "@sequoia-leaf/factory";
import {
  type Action,
  type Block,
  close,
  describe,
  type Description,
  type Entry,
  type Row,
  type Stat,
} from "@sequoia-leaf/kit/card.ts";
import { amount, el, icon } from "@sequoia-leaf/kit/dom.ts";
import { sfx } from "@sequoia-leaf/kit/sound.ts";

import { beltTile } from "../art/belts.ts";
import type { Art } from "../art/index.ts";
import { copyOf } from "../art/items.ts";
import { FLAG_AT } from "../art/machines.ts";
import { yardSfx } from "../sound.ts";
import { type Given, leaves, type Listed, type Need, needs, some, unlocks, wantsGiven } from "./goal.ts";
import { fitted, partsWords, pic, type YardIcon, yardIcon } from "./parts.ts";
import { itemRef, machineRef, nodeRef, pictureRef, plotRef } from "./refs.ts";

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
  /** The grade the card is of: the first, unless it names a higher or the piece stands at one. */
  readonly grade: number;
  /** Whether its name says its grade ("Belt I"): from when the yard may build the kind above the first. */
  readonly graded: boolean;
  /** A kind this page does not draw (`DRAWN`): its card says only what it is. */
  readonly later: boolean;
  /** What one more costs now: at the first grade, the pieces to hand counted. */
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
  /** What the kind does a minute, in sentences (`numbers.ts`): none until the yard counts. */
  readonly numbers: readonly string[];
  /** For a cart stop: how many stand, of how many may. */
  readonly stops: readonly [number, number] | null;
}

/** A splitter's three ways out as its card shows them: its picture's arms, way and colour, each way shut and led somewhere, and the way put first. */
export interface WaysPrint {
  readonly arms: number;
  readonly dir: Dir;
  readonly tint: number;
  readonly shut: readonly boolean[];
  readonly led: readonly boolean[];
  /** The way put first (0 ahead, 1 left, 2 right), or -1. */
  readonly first: number;
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
  /** What it makes, needs, gathers, studies or carries a minute, in sentences (`numbers.ts`): none until the yard counts. */
  readonly numbers: readonly string[];
  /** The one thing it is told to make, or a sorter to send left, or nothing. */
  readonly set: Item | null;
  /** For a sorter: the things it may be told to send left. */
  readonly sorts: readonly Item[];
  /** For a Study: the research being studied, and whether research's screen is there to open (not while it is the one open). */
  readonly studying: Goal | null;
  readonly research: boolean;
  /** The grade it may be raised to where it stands, what that costs, and whether the Coins to hand cover it. */
  readonly raise: { readonly to: number; readonly cost: number; readonly enough: boolean } | null;
  /** For a crate: whether it is open. */
  readonly open: boolean;
  /** For the depot: the tier whose screen is there, or nothing. */
  readonly tier: number | null;
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

/** A goal: a lesson, a project, a commission or a piece of research. */
export interface NodePrint {
  readonly card: "node";
  readonly goal: Goal;
  readonly done: boolean;
  readonly inHand: boolean;
  /** A node: whether it may be taken in hand now. */
  readonly may: boolean;
  /** Research: whether it is in the line (and may be taken out), or may be put in it, or neither. */
  readonly study: "out" | "in" | null;
  /** Whether research's screen is there to open: not while it is the one open, as the button opens and shuts it. */
  readonly research: boolean;
  /** What it wants and has been given: each thing, how many have come, of how many. */
  readonly wants: Given;
  /** What it still waits on, each with how it stands; and how far the one being studied has come, of how far. */
  readonly needs: readonly Need[];
  readonly studied: readonly [number, number];
  readonly visiting: boolean;
}

export interface OrderPrint {
  readonly card: "order";
  readonly title: string;
  readonly from: string;
  readonly line: string;
  readonly pay: number;
  readonly wants: Given;
  readonly full: boolean;
}

export interface ToolPrint {
  readonly card: "tool";
  readonly tool: Tool;
}

/** A number a goal raises, as the rules make it (`unlocked`): what it is called, the number, and its sentence. */
export interface PerkPrint {
  readonly card: "perk";
  readonly unlock: Unlock;
}

export interface TierPrint {
  readonly card: "tier";
  readonly tier: number;
  readonly open: boolean;
}

/** What a finished goal leaves in town. */
export interface GiftPrint {
  readonly card: "gift";
  readonly goal: Goal;
}

export type Print =
  | ItemPrint
  | MachinePrint
  | StandingPrint
  | GroundPrint
  | PlotPrint
  | NodePrint
  | OrderPrint
  | ToolPrint
  | PerkPrint
  | TierPrint
  | GiftPrint;

/** What a card's buttons do: the page's own tools, handed in, so that drawing a card reaches no yard. */
export interface Hands {
  /** Does a command (a recipe, a crate shut or opened, emptying), and says whether it was done. */
  act(a: Act): boolean;
  turn(x: number, y: number): void;
  another(x: number, y: number): void;
  remove(x: number, y: number): void;
  /** Raises the piece on a tile to the next grade, where it stands. */
  raise(x: number, y: number): void;
  way(x: number, y: number, way: number): void;
  buy(plot: Plot): boolean;
  take(g: Goal): void;
  /** Puts a piece of research in the line, or takes it out. */
  study(g: Goal, into: boolean): void;
  panel(id: "orders" | "tier" | "research" | "depot"): void;
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

/** Sentences as one block of a card, each on a line of its own. */
const lines = (sentences: readonly string[]): Block[] =>
  sentences.length === 0 ? [] : [{ body: el("div", "said", {}, ...sentences.map((text) => el("div", "", { text }))) }];
/** Lists of a goal (`goal.ts`), each a block of a card. */
const listBlocks = (...lists: readonly (Listed | null)[]): Block[] => some(...lists).map((l) => ({ body: l.node }));

/** A machine's picture cut to a card's slot: a tall machine is known by its head. */
const machinePic = (art: Art, k: Kind, grade = 1): HTMLCanvasElement => fitted(art.icon(k, grade), 22, 22);

/** What a kind of piece is called on its card: "Belt", and once the yard may build it higher, "Belt I" or "Belt II". */
const gradedName = (p: MachinePrint): string =>
  p.graded ? `${nameOf(p.kind)} ${numeral(Math.max(1, p.grade))}` : nameOf(p.kind);

/** Rows of another card named, with the words beside each. */
const entries = (named: readonly Named[]): Entry[] =>
  named.map((e) => ({ ref: e.ref, name: e.name, note: e.note, ...(e.tag ? { tag: e.tag } : {}) }));

function itemCard(art: Art, p: ItemPrint): Description {
  const k = p.item;
  const info = ITEM_INFO[k];
  const recipe = RECIPE[k];
  const usedIn = RECIPES_N.filter((r) => r.from.includes(k)).map((r) => ({ ref: itemRef(r.out) }));
  const rows: Row[] = [];
  if (recipe) {
    rows.push({
      label: "Made from",
      // A count only where it is more than 1.
      things: recipe.from.map((part, i) => ({
        ref: itemRef(part),
        ...((recipe.need[i] ?? 1) > 1 ? { count: `×${recipe.need[i]}` } : {}),
      })),
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
  if (isFolio(k)) rows.push({ label: "Studied in", things: [{ ref: machineRef(STUDY) }] });
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

/** How long a machine takes over one thing, at a grade's pace. */
function paceOf(k: Kind, grade: number): string {
  // A grade works its first grade's ticks in so many of its own.
  const faster = (PACE[1] ?? 2) / (PACE[grade] ?? PACE[1] ?? 2);
  if (k === GATHERER) return secs(TICKS.gather * faster);
  if (k === STUDY) return `${secs(TICKS.study * faster)} a folio`;
  if (k === TUNNEL || k === BELT) return `${secs(Math.ceil(8 / (PACE[grade] ?? 2)))} a tile`;
  if (k === BOILER) return `${secs(TICKS.burn)} a piece`;
  if (isMaker(k)) {
    const ticks = (MADE_BY[k] ?? []).map((r) => r.ticks * faster);
    const lo = Math.min(...ticks);
    const hi = Math.max(...ticks);
    return lo === hi ? secs(lo) : `${secs(lo)}–${secs(hi)}`;
  }
  return "";
}

/** A kind's own blocks: how many are free to place. A price needs no sentence: the card shows it, and taking a piece away gives all of it back. */
const spareBlocks = (p: MachinePrint): Block[] => (p.spare > 0 ? [{ body: `${p.spare} free to place.` }] : []);

/** A kind of piece at a grade: what it is, what it draws, its pace and its price there. */
function machineCard(art: Art, p: MachinePrint): Description {
  const k = p.kind;
  const grade = p.grade;
  // Above the first grade it says what that grade does more, and costs; at the first, what the kind is.
  const what = grade > 1 ? gradeSays(k, grade) : (KIND_INFO[k]?.what ?? "");
  if (p.later) return { name: nameOf(k), icon: machinePic(art, k), tag: what };
  const stats: Stat[] = [];
  const draw = ((DRAW[k] ?? 0) * (DRAWN[isGraded(k) ? grade : 0] ?? HALF)) / HALF;
  if (draw > 0) stats.push({ label: "Draws", value: n(draw) });
  if ((GIVES[k] ?? 0) > 0) stats.push({ label: "Gives", value: String(p.gives) });
  if (p.stops) stats.push({ label: "Built", value: `${p.stops[0]} of ${p.stops[1]}` });
  const pace = paceOf(k, grade);
  if (pace) stats.push({ label: "Pace", value: pace });
  if (p.key) stats.push({ label: "Key", value: p.key });
  const rows: Row[] = [];
  if (isMaker(k)) rows.push({ label: "Can make", things: p.recipes.map((r) => ({ ref: itemRef(r) })) });
  if (k === GATHERER)
    rows.push({ label: "Gathers", things: ALL_ITEMS.filter(isRaw).map((r) => ({ ref: itemRef(r) })) });
  if (k === BOILER) rows.push({ label: "Burns", things: [{ ref: itemRef(DEADFALL) }] });
  return {
    name: gradedName(p),
    icon: machinePic(art, k, grade),
    tag: p.open ? what : `${what} Not unlocked yet.`,
    blocks: [...spareBlocks(p), ...lines(p.numbers)],
    ...(k === DEPOT ? {} : { aside: amount("coin", p.price === 0 ? "free" : p.price) }),
    stats,
    rows,
  };
}

/** Where on a card each side of a splitter is, round its picture: east, south, west, north. */
const SIDES = ["2 / 3", "3 / 2", "2 / 1", "1 / 2"] as const;

/**
 * A splitter's three ways out round its picture, as they lie in the yard: each says whether it is
 * open, shut, open with nothing to take from it, or once the yard may put a way first, first, and
 * a press moves it on (open, first, shut, open; before, open and shut). The way put first wears its
 * flag in the picture. A visitor is shown the same, with nothing to press.
 */
function waysOf(art: Art, p: StandingPrint, ways: WaysPrint, hands: Hands): HTMLElement {
  const box = el("div", "ways");
  const d = ways.dir;
  // A copy: the tile is the belts' own, kept for every splitter that looks the same, and the
  // arrowheads and the flag drawn on it here are this splitter's alone.
  const tile = copyOf(beltTile(ways.arms, d, 5, 0, ways.tint));
  const g = tile.getContext("2d");
  [d, LEFT[d], RIGHT[d]].forEach((side, k) => {
    const head = art.m.heads[k]?.[d];
    if (head && ((ways.arms >> (side * 2)) & 3) === 2) g?.drawImage(head, 0, 0);
    const flag = art.m.pennant[side];
    const at = FLAG_AT[side];
    if (ways.first === k && flag && at) g?.drawImage(flag.c, at[0] - flag.ax, at[1] - flag.ay);
    const shut = ways.shut[k] === true;
    const led = ways.led[k] === true;
    const state = shut ? "Shut" : ways.first === k ? "First" : led ? "Open" : "No belt";
    // Seen, a button's place says which way it is; read out, its name has to.
    const named = { "aria-label": `${["Ahead", "Left", "Right"][k]}: ${state}` };
    const way = el(
      p.visiting ? "span" : "button",
      `k-btn ${shut ? "coral" : ways.first === k ? "" : led ? "green" : "slate"}`,
      p.visiting ? named : { ...named, type: "button", onclick: () => hands.way(p.x, p.y, k) },
      state,
    );
    way.style.gridArea = SIDES[side] ?? "";
    box.append(way);
  });
  box.append(pic(tile, 3));
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
  // Once the card says what it makes a minute in a sentence, the row names the thing and no more.
  const per = p.numbers.length === 0 ? p.perMinute : null;
  if (p.making !== null)
    rows.push({
      label: "Making",
      things: [{ ref: itemRef(p.making), note: per !== null ? `up to ${per} a minute` : "" }],
    });
  if (p.gathering !== null)
    rows.push({
      label: "Gathering",
      things: [{ ref: itemRef(p.gathering), note: per !== null ? `${per} a minute` : "" }],
    });
  if (p.studying !== null) rows.push({ label: "Studying", things: [{ ref: nodeRef(p.studying) }] });
  if (k === SORTER && p.set !== null) rows.push({ label: "Sends left", things: [{ ref: itemRef(p.set) }] });
  rows.push(...(base.rows ?? []));

  const actions: Action[] = [];
  if (k === SORTER) {
    // The thing it sends left, chosen as a machine's recipe is.
    const sort = (item: Item | null): void => {
      hands.act({ do: "sort", x, y, item });
      sfx.tap();
    };
    actions.push({
      label: "Nothing",
      look: "slot",
      icon: icon("more"),
      lit: p.set === null,
      hint: "Nothing",
      about: "With nothing set it is a belt.",
      on: () => sort(null),
    });
    for (const t of p.sorts)
      actions.push({
        label: ITEM_INFO[t]?.name ?? "",
        look: "slot",
        icon: art.item(t),
        lit: p.set === t,
        hint: ITEM_INFO[t]?.name ?? "",
        on: () => sort(p.set === t ? null : t),
      });
  }
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
      ...(p.tier !== null ? [{ label: `Tier ${p.tier}`, on: () => hands.panel("tier") }] : []),
      { label: "Makes and needs", on: () => hands.panel("depot") },
    );
  } else {
    if (k === STUDY && p.research) actions.push({ label: "Research", on: () => hands.panel("research") });
    // A piece of a grade the yard may build higher is raised where it stands, for the difference.
    const raise = p.raise;
    if (raise)
      actions.push({
        label: `Raise to ${numeral(raise.to)}`,
        look: raise.enough ? "sm" : "sm off",
        after: amount("coin", raise.cost),
        hint: `Raise to ${numeral(raise.to)}`,
        about: gradeSays(k, raise.to),
        on: () => hands.raise(x, y),
      });
    // What takes things in from every side and hands none on has no way to face.
    if (k !== TUNNEL && k !== PYLON && k !== WHEEL && k !== BOILER && k !== STUDY && k !== STOP)
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
  // A cart stop and a sorter say what they do in their own words: the rules' line for either is of
  // every belt. What is wrong with one is the rules' to say.
  const said =
    p.trouble && p.line !== null
      ? p.line
      : k === STOP
        ? "Items handed in here reach the depot at once."
        : k === SORTER
          ? p.set !== null
            ? "Everything else goes ahead."
            : "With nothing set it is a belt."
          : (p.line ?? KIND_INFO[k]?.what ?? "");
  return {
    ...base,
    tag: el("span", p.trouble ? "k-coral" : "", { text: said }),
    // What is wrong and what to do about it comes first; the numbers are under it.
    blocks: [
      ...spareBlocks(m),
      ...(k === DEPOT ? [{ body: `Each thing that arrives pays ${DEPOT_SHARE * 100}% of its worth.` }] : []),
      ...(advice ? [{ body: advice }] : []),
      ...lines(p.numbers),
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
export function nodeKind(g: Goal): string {
  const info = GOALS[g];
  if (!info) return "";
  if (info.kind !== "lesson") return `Tier ${info.tier} ${info.kind}`;
  const lessons = GOALS.flatMap((o, k) => (o.kind === "lesson" ? [k] : []));
  return `Lesson ${lessons.indexOf(g) + 1} of ${lessons.length}`;
}

/** A goal's picture: that of the thing that stands for it, or a note for a goal with nothing to show. */
function goalPic(g: Goal): Node {
  const ref = pictureRef(g);
  return (ref === null ? null : describe(ref)?.icon) ?? yardIcon("orders");
}

/**
 * A lesson, a project, a commission or a piece of research: who asks and what they say, what it
 * wants and has been given, what it needs first, what it unlocks and leaves, and what may be done
 * with it now: a node taken in hand, research put in the line or taken out.
 */
function nodeCard(p: NodePrint, hands: Hands): Description | null {
  const g = p.goal;
  const info = GOALS[g];
  if (!info) return null;
  const node = isNode(g) ? NODES[g] : undefined;
  const actions: Action[] = [];
  if (p.may) actions.push({ label: "Take it in hand", look: "sm wide", on: () => hands.take(g) });
  if (p.study === "out") actions.push({ label: "Take out", look: "wood sm", on: () => hands.study(g, false) });
  if (p.study === "in") actions.push({ label: "Study", look: "sm", on: () => hands.study(g, true) });
  if (!node && !p.done && p.research)
    actions.push({ label: "Research", look: "wood sm", on: () => hands.panel("research") });
  const [have, of] = p.studied;
  // A node says what whoever asked says; research, what it is, in the sentence of the one thing it
  // unlocks. Of several, each is a row below with its own card: run together, the sentences would not
  // say whose each is.
  const [only, more] = unlockedBy(g);
  const says = node ? node.say : only && !more ? only.says : "";
  return {
    name: info.title,
    icon: goalPic(g),
    tag: node ? `${nodeKind(g)}, from ${node.from}` : `Tier ${info.tier} research`,
    ...(info.pay > 0 ? { aside: amount("coin", info.pay.toLocaleString("en-US")) } : {}),
    blocks: [
      ...(says === "" ? [] : [{ body: says }]),
      ...(p.done
        ? [{ body: node ? "Done." : "Known." }]
        : p.inHand
          ? [{ body: "In hand: what reaches the depot goes to it first." }]
          : []),
      ...listBlocks(wantsGiven(p.wants), needs(p.needs, { given: () => ({ have, of }) }), unlocks(g), leaves(g)),
    ],
    actions: p.visiting ? [] : actions,
  };
}

const orderCard = (p: OrderPrint): Description => ({
  name: p.title,
  icon: yardIcon("orders"),
  tag: `From ${p.from}`,
  aside: amount("coin", p.pay.toLocaleString("en-US")),
  blocks: [
    { body: p.line },
    ...(p.full ? [{ body: "Filled, and waiting to be handed over." }] : []),
    ...listBlocks(wantsGiven(p.wants)),
  ],
});

/** Each tool's picture: the one it has in the dock. */
export const TOOL_ICON: Readonly<Record<Tool, YardIcon>> = { paint: "brush", select: "select", upgrade: "upgrade" };

/** The picture of what each kind of number changes. */
export const PERK_ART: Readonly<Record<Numbered | "blueprints" | "board" | "first", (art: Art) => HTMLCanvasElement>> =
  {
    stops: (art) => art.icon(STOP),
    crate: (art) => art.m.crate[1]?.[0]?.c ?? art.icon(CRATE),
    reach: (art) => art.m.pylon[1]?.[2]?.c ?? art.icon(PYLON),
    depot: (art) => art.m.fly[0] ?? art.icon(kindOf("depot")),
    span: (art) => art.icon(TUNNEL),
    away: () => yardIcon("moon"),
    hooks: () => yardIcon("orders"),
    blueprints: () => yardIcon("print"),
    board: () => yardIcon("orders"),
    first: (art) => {
      const c = art.icon(SPLITTER);
      const flag = art.m.pennant[0];
      const [x, y] = FLAG_AT[0];
      if (flag) c.getContext("2d")?.drawImage(flag.c, x - flag.ax, y - flag.ay);
      return c;
    },
  };

/** A tool a goal unlocks, with its picture from the dock. */
const toolCard = (p: ToolPrint): Description => ({
  name: TOOL_INFO[p.tool].name,
  icon: yardIcon(TOOL_ICON[p.tool]),
  tag: TOOL_INFO[p.tool].says,
});

/** A number a goal raises, as it will be: the picture of what it changes, and the rules' sentence for it, which says what it was before. */
function perkCard(art: Art, p: PerkPrint): Description | null {
  const u = p.unlock;
  const of = u.is === "number" ? u.of : u.is === "blueprints" || u.is === "board" || u.is === "first" ? u.is : null;
  if (of === null) return null;
  const shown = "amount" in u && u.amount !== undefined ? `${u.name} ${u.amount}` : u.name;
  return { name: shown, icon: PERK_ART[of](art), tag: u.says };
}

/** A tier: by its number and its name once it is open, by its number alone before. */
const tierCard = (p: TierPrint): Description => ({
  name: p.open ? tierName(p.tier) : `Tier ${p.tier}`,
  icon: yardIcon("projects"),
  tag: p.open ? "Open." : "The next tier.",
});

/** What a finished goal leaves in the town. */
function giftCard(p: GiftPrint): Description | null {
  const gift = NODES[p.goal]?.gift;
  return gift ? { name: "In town", icon: yardIcon("town"), tag: gift.line } : null;
}

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
    case "tool":
      return toolCard(p);
    case "perk":
      return perkCard(art, p);
    case "tier":
      return tierCard(p);
    case "gift":
      return giftCard(p);
  }
}
