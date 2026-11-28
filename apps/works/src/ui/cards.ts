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
  CRATE,
  DEPOT_SHARE,
  drawnAt,
  FIXED,
  GIVES,
  type Goal,
  GOALS,
  gradeSays,
  HALF,
  isFolio,
  isNode,
  type Item,
  ITEM_INFO,
  itemName,
  type Kind,
  kind as kindOf,
  KIND_INFO,
  NODES,
  type Numbered,
  numeral,
  type Plot,
  PYLON,
  RECIPES_N,
  SPLITTER,
  STOP,
  STUDYING,
  tierName,
  type Tool,
  TOOL_INFO,
  TUNNEL,
  type Unlock,
  unlockedBy,
} from "@sequoia-leaf/factory";
import {
  type Action,
  type Block,
  describe,
  type Description,
  type Entry,
  type Row,
  type Stat,
} from "@sequoia-leaf/kit/card.ts";
import { amount, el } from "@sequoia-leaf/kit/dom.ts";
import { exact, num, whole } from "@sequoia-leaf/kit/say.ts";

import type { Art } from "../art/index.ts";
import { FLAG_AT } from "../art/machines.ts";
import { stump } from "../art/nature.ts";
import { pageOf } from "../kinds/index.ts";
import type { Standing } from "../kinds/kind.ts";
import { yardSfx } from "../sound.ts";
import { flowNode, ownPace } from "./flow.ts";
import {
  type Given,
  leaves,
  type Listed,
  lockChip,
  type Need,
  needs,
  nodeKind,
  some,
  unlocks,
  wantsGiven,
} from "./goal.ts";
import { groundCard, type GroundPrint, type LandHands, plotCard, type PlotPrint } from "./land.ts";
import { madeRows } from "./made.ts";
import type { Flow } from "./numbers.ts";
import { fitted, TOOL_ICON, yardIcon } from "./parts.ts";
import { itemRef, machineRef, nodeRef, pictureRef } from "./refs.ts";
import type { SorterPrint } from "./sorter.ts";
import { splitterWays, type WaysPrint } from "./splitter.ts";

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
  /** The machines that make it: its recipe's own, and each the yard may build that makes it too. */
  readonly makers: readonly Kind[];
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
  /** What one more costs now, as setting it down charges it: the pieces to hand counted (`costOf`). */
  readonly price: number;
  /** For a tunnel standing, the tiles it passes under, which its prices go by; 0 for any other. */
  readonly span: number;
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

export interface StandingPrint extends SorterPrint {
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
  /** What it makes or gathers, and how many a minute at the yard's pace now, as the card says it ("40 /min"; null when none). */
  readonly making: Item | null;
  /** A machine's recipe as its card draws it: what goes in, what comes out, and how many a minute. */
  readonly flow: Flow | null;
  readonly gathering: Item | null;
  readonly perMinute: string | null;
  /** How many it makes a minute now, as a number (`perMinute` says it): null where it makes nothing of its own. */
  readonly rate: number | null;
  /** What it makes, needs, gathers, studies or carries a minute, in sentences (`numbers.ts`): none until the yard counts. */
  readonly numbers: readonly string[];
  /** The one thing it is told to make, or a sorter to send to its side, or nothing. */
  readonly set: Item | null;
  /** For a Study: the research being studied, and whether research's screen is there to open (not while it is the one open). */
  readonly studying: Goal | null;
  readonly research: boolean;
  /** The grade it may be raised to where it stands, what that costs, and whether the Coins to hand cover it. */
  readonly raise: { readonly to: number; readonly cost: number; readonly enough: boolean } | null;
  /** For a crate: whether it is open. */
  readonly open: boolean;
  /** For the depot: the tier whose screen is there, or nothing. */
  readonly tier: number | null;
  /**
   * The tips of its buttons, each with its key as the player's keyboard calls it where it has one
   * (`keymap.ts`): Another's only where it can be picked up as the tool in hand.
   */
  readonly hints: { readonly rotate: string; readonly flip: string; readonly another: string | null };
  /** Whether it can be taken up to move: once Select is open. */
  readonly move: boolean;
  /** What taking it away gives back, and whether it was one of the pieces to hand. */
  readonly refund: number;
  readonly free: boolean;
  readonly ways: WaysPrint | null;
  /** For a piece that breaks a mix (the breaker): the place in its mix of the next thing it gives. */
  readonly mix: number | null;
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
  /** While it is not open, what is left before it opens: "9 research left". */
  readonly lock: string | null;
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
export interface Hands extends LandHands {
  /** Does a command (a recipe, a crate shut or opened, emptying), and says whether it was done. */
  act(a: Act): boolean;
  turn(x: number, y: number): void;
  /** Flips a sorter to send to its other side. */
  flip(x: number, y: number): void;
  another(x: number, y: number): void;
  /** Takes the piece in hand to set down somewhere else. */
  move(x: number, y: number): void;
  remove(x: number, y: number): void;
  /** Raises the piece on a tile to the next grade, where it stands. */
  raise(x: number, y: number): void;
  way(x: number, y: number, way: number): void;
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

const nameOf = (k: number): string => KIND_INFO[k]?.name ?? "";
/** A kind as a sentence starts with one: "A bench", "An assembler". */
const aKind = (k: number): string => `${/^[AEIOU]/.test(nameOf(k)) ? "An" : "A"} ${nameOf(k).toLowerCase()}`;
const many = (k: number): string => ITEM_INFO[k]?.many ?? "";

/** Sentences as one block of a card, each on a line of its own. */
const lines = (sentences: readonly string[]): Block[] =>
  sentences.length === 0 ? [] : [{ body: el("div", "said", {}, ...sentences.map((text) => el("div", "", { text }))) }];
/** Lists of a goal (`goal.ts`), each a block of a card. */
const listBlocks = (...lists: readonly (Listed | null)[]): Block[] => some(...lists).map((l) => ({ body: l.node }));

/** A machine's picture cut to a card's slot: a tall machine is known by its head. */
const machinePic = (art: Art, k: Kind, grade = 1): HTMLCanvasElement => fitted(art.icon(k, grade), 22, 22);

/**
 * What a kind of piece is called on its card: "Belt", and once the yard may build it higher, "Belt I"
 * or "Belt II", its grade held to its name by a space that does not break, so the title stays whole
 * and the price beside it goes onto a line of its own first.
 */
const gradedName = (p: MachinePrint): string =>
  p.graded ? `${nameOf(p.kind)}\u00a0${numeral(Math.max(1, p.grade))}` : nameOf(p.kind);

/** Rows of another card named, with the words beside each. */
const entries = (named: readonly Named[]): Entry[] =>
  named.map((e) => ({ ref: e.ref, name: e.name, note: e.note, ...(e.tag ? { tag: e.tag } : {}) }));

function itemCard(art: Art, p: ItemPrint): Description {
  const k = p.item;
  const info = ITEM_INFO[k];
  const usedIn = RECIPES_N.filter((r) => r.from.includes(k)).map((r) => ({ ref: itemRef(r.out) }));
  const rows: Row[] = [];
  rows.push(...madeRows(p));
  rows.push({ label: "Used in", things: usedIn });
  if (isFolio(k)) rows.push({ label: "Studied in", things: [{ ref: machineRef(STUDYING) }] });
  rows.push({ label: "Asked for by", things: entries(p.asked) });
  const ground = GROUND[itemName(k)];
  return {
    name: info?.name ?? "",
    icon: art.item(k),
    tag: STEPS[info?.step ?? 0] ?? "",
    aside: amount("coin", exact(info?.worth ?? 0)),
    stats: [
      { label: "Step", value: String(info?.step ?? 0) },
      { label: "Orders pay", value: exact(info?.worth ?? 0) },
      { label: "Depot pays", value: exact((info?.worth ?? 0) * DEPOT_SHARE) },
    ],
    blocks: [...(ground ? [{ title: ground[0], body: ground[1] }] : []), ...(p.lock ? [{ body: `${p.lock}.` }] : [])],
    rows,
  };
}

/**
 * What a piece does a minute at a grade's pace, working flat out (the rules' planner), as its kind
 * says (`KindPage.pace`): what a gatherer gathers, a machine makes (from its quickest recipe to its
 * slowest), a Study takes in, a boiler burns, and a belt or what stands in a line of belt carries.
 */
export const paceOf = (k: Kind, grade: number): Stat | null => pageOf(k)?.pace?.(k, grade) ?? null;

/** A kind's own blocks: how many are free to place. A price needs no sentence: the card shows it, and taking a piece away gives all of it back. */
const spareBlocks = (p: MachinePrint): Block[] => (p.spare > 0 ? [{ body: `${p.spare} free to place.` }] : []);

/** A kind of piece at a grade: what it is, what it draws, its pace and its price there. */
function machineCard(art: Art, p: MachinePrint): Description {
  const { kind: k, grade } = p;
  // Above the first grade it says what that grade does more, and costs; at the first, what the kind is.
  const what = grade > 1 ? gradeSays(k, grade, p.span) : (KIND_INFO[k]?.what ?? "");
  if (p.later) return { name: nameOf(k), icon: machinePic(art, k), tag: what };
  const stats: Stat[] = [];
  const draw = drawnAt(k, grade) / HALF;
  if (draw > 0) stats.push({ label: "Draws", value: num(draw) });
  if ((GIVES[k] ?? 0) > 0) stats.push({ label: "Gives", value: String(p.gives) });
  if (p.stops) stats.push({ label: "Built", value: `${p.stops[0]} of ${p.stops[1]}` });
  const pace = paceOf(k, grade);
  if (pace) stats.push(pace);
  if (p.key) stats.push({ label: "Key", value: p.key });
  const rows: Row[] = pageOf(k)?.rows?.(p) ?? [];
  return {
    name: gradedName(p),
    icon: machinePic(art, k, grade),
    tag: p.open ? what : `${what} Not unlocked yet.`,
    blocks: [...spareBlocks(p), ...lines(p.numbers)],
    ...(FIXED[k] === 1 ? {} : { aside: amount("coin", p.price === 0 ? "free" : p.price) }),
    stats,
    rows,
  };
}

/** What a press on a way of a standing splitter does: moves it on a step. Nothing for a visitor. */
const pressWay = (p: StandingPrint, hands: Hands): ((way: number) => void) | null =>
  p.visiting ? null : (way) => hands.way(p.x, p.y, way);

/** What takes a standing piece up: as the tool in hand, facing the same way (Another), or itself, to set down elsewhere (Move). */
function takeUp(p: StandingPrint, hands: Hands): Action[] {
  const { x, y } = p;
  const name = nameOf(p.machine.kind).toLowerCase();
  return [
    ...(p.hints.another === null
      ? []
      : [
          {
            label: "Another",
            hint: p.hints.another,
            about: `Picks the ${name} as your tool, facing the same way.`,
            on: () => hands.another(x, y),
          },
        ]),
    ...(p.move ? [{ label: "Move", on: () => hands.move(x, y) }] : []),
  ];
}

/** What a machine full of one part says to do about it, naming its kind; nothing for any other. */
export const adviceOf = (p: StandingPrint): string | null =>
  p.state === "starved" && p.spare !== null
    ? `${aKind(p.machine.kind)} takes things in at its back and both sides. Bring ${many(p.spare)} in one way and ${p.missing.map(many).join(" and ")} another, and it cannot fill up with the wrong one.`
    : null;

/**
 * The line under a standing piece's name. What is wrong with it is the rules' to say, as the Trouble
 * list says it; a machine waiting for its parts, which it is short of is in its rows, not in a
 * sentence; else a kind may say what it does in its own words (a cart stop, a sorter: the rules' line
 * for either is of every sink or belt).
 */
export function saidOf(p: StandingPrint): string {
  if (p.trouble && p.line !== null) return p.line;
  if (p.flow?.waiting === true) return `Waiting to make ${many(p.flow.out)}.`;
  const k = p.machine.kind;
  return pageOf(k)?.standing?.said?.(p) ?? p.line ?? KIND_INFO[k]?.what ?? "";
}

/** A standing piece's pace now, where its kind gives its own (`Standing.pace`). */
const paceNow = (own: Standing | undefined, p: StandingPrint): Stat | null => own?.pace?.(p) ?? null;

/** A machine standing in the yard: its kind's card, with what this one is doing and holds, and what can be done with it. */
function standingCard(art: Art, p: StandingPrint, hands: Hands): Description {
  const { machine: m, x, y } = p;
  const k = m.kind;
  const base = machineCard(art, m);
  if (m.later) return base;
  const rows: Row[] = [];
  // A machine's parts are in its recipe's slots: what it holds besides is listed.
  const holding = p.holding.filter(([t]) => !p.flow?.parts.some((part) => part.item === t));
  if (holding.length > 0)
    rows.push({
      label: p.most !== null ? `Holds, of ${p.most}` : "Holds",
      things: holding.map(([t, c]) => ({ ref: itemRef(t), count: `×${c}` })),
    });
  // Once the card says what it gathers a minute in a sentence, the row names the thing and no more.
  const per = p.numbers.length === 0 ? p.perMinute : null;
  if (p.gathering !== null) rows.push({ label: "Gathering", things: [{ ref: itemRef(p.gathering), note: per ?? "" }] });
  if (p.studying !== null) rows.push({ label: "Studying", things: [{ ref: nodeRef(p.studying) }] });
  const page = pageOf(k);
  const own = page?.standing;
  rows.push(...(own?.rows?.(p) ?? []));
  // Its kind's rows, but where it has its own of the same name: a breaker's mix with the next picked out.
  rows.push(...(base.rows ?? []).filter((r) => !rows.some((o) => o.label === r.label)));

  const actions: Action[] = own?.actions?.(art, p, hands) ?? [];
  if (p.count > 0 && (page?.empties === true || p.spare !== null || p.state === "idle"))
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
  actions.push(...(own?.more?.(art, p, hands) ?? []));
  // The depot is land: it is neither raised, turned, taken up nor taken away.
  if (FIXED[k] !== 1) {
    // A piece of a grade the yard may build higher is raised where it stands, for the difference.
    const raise = p.raise;
    if (raise)
      actions.push({
        label: `Raise to ${numeral(raise.to)}`,
        look: raise.enough ? "sm" : "sm off",
        after: amount("coin", raise.cost),
        hint: `Raise to ${numeral(raise.to)}`,
        about: gradeSays(k, raise.to, p.machine.span),
        on: () => hands.raise(x, y),
      });
    // What takes things in from every side and hands none on has no way to face (`KindPage.faces`).
    if (page?.faces) actions.push({ label: "Rotate", hint: p.hints.rotate, on: () => hands.turn(x, y) });
    if (page?.flips) actions.push({ label: "Flip", hint: p.hints.flip, on: () => hands.flip(x, y) });
    actions.push(...takeUp(p, hands));
    actions.push({
      label: "Remove",
      look: "coral sm",
      after: p.refund > 0 ? amount("coin", `+${whole(p.refund)}`) : null,
      hint: "Remove",
      ...(p.free ? {} : { about: "Any items inside it are lost." }),
      on: () => hands.remove(x, y),
    });
  }
  const advice = adviceOf(p);
  const said = saidOf(p);
  return {
    ...base,
    stats: ownPace(base.stats, p.flow, paceNow(own, p)),
    tag: el("span", p.trouble ? "k-coral" : "", { text: said }),
    // What is wrong and what to do about it comes first; the numbers are under it.
    blocks: [
      ...spareBlocks(m),
      ...(own?.blocks?.(p) ?? []),
      ...(advice ? [{ body: advice }] : []),
      ...(p.flow ? [{ body: flowNode(art, p.flow) }] : []),
      ...lines(p.numbers),
      ...(p.ways ? [{ title: "Ways out", body: splitterWays(art, m.grade, p.ways, pressWay(p, hands)) }] : []),
    ],
    rows,
    actions: p.visiting ? [] : actions,
  };
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
    ...(info.pay > 0 ? { aside: amount("coin", info.pay) } : {}),
    blocks: [
      ...(says === "" ? [] : [{ body: says }]),
      ...(p.done
        ? [{ body: node ? "Done." : "Known." }]
        : p.inHand
          ? [{ body: "In hand: what reaches the depot goes to it first." }]
          : p.lock === null
            ? []
            : [{ body: lockChip(p.lock) }]),
      ...listBlocks(
        wantsGiven(p.wants, p.lock !== null),
        needs(p.needs, { given: () => ({ have, of }) }),
        unlocks(g),
        leaves(g),
      ),
    ],
    actions: p.visiting ? [] : actions,
  };
}

const orderCard = (p: OrderPrint): Description => ({
  name: p.title,
  icon: yardIcon("orders"),
  tag: `From ${p.from}`,
  aside: amount("coin", p.pay),
  blocks: [
    { body: p.line },
    ...(p.full ? [{ body: "Filled, and waiting to be handed over." }] : []),
    ...listBlocks(wantsGiven(p.wants)),
  ],
});

/** The unlocks shown as a perk that are not a number: blueprints, and each that is one thing or none. */
const FLAGS = ["blueprints", "board", "first", "ins", "felling", "mouths"] as const;
type Flag = (typeof FLAGS)[number];
const isFlag = (is: string): is is Flag => FLAGS.some((f) => f === is);

/** The picture of what each kind of number changes. */
export const PERK_ART: Readonly<Record<Numbered | Flag, (art: Art) => HTMLCanvasElement>> = {
  stops: (art) => art.icon(STOP),
  crate: (art) => art.m.crate[1]?.[0]?.c ?? art.icon(CRATE),
  reach: (art) => art.m.pylon[1]?.[2]?.c ?? art.icon(PYLON),
  depot: (art) => art.m.fly[0] ?? art.icon(kindOf("depot")),
  span: (art) => art.icon(TUNNEL),
  away: () => yardIcon("moon"),
  hooks: () => yardIcon("orders"),
  range: () => yardIcon("map"),
  blueprints: () => yardIcon("print"),
  board: () => yardIcon("orders"),
  first: (art) => {
    const c = art.icon(SPLITTER);
    const flag = art.m.pennant[0];
    const [x, y] = FLAG_AT[0];
    if (flag) c.getContext("2d")?.drawImage(flag.c, x - flag.ax, y - flag.ay);
    return c;
  },
  ins: (art) => art.waysIn,
  felling: () => stump(5, false),
  mouths: (art) => art.icon(TUNNEL),
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
  const of = u.is === "number" ? u.of : isFlag(u.is) ? u.is : null;
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
      return groundCard(p, hands);
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
