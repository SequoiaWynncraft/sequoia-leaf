/**
 * What each card prints of the yard and the purse, worked out from them as they are: plain values,
 * each as the card shows it (a rate rounded as it is printed, the exact Coins short). A card is drawn
 * from its print alone (`cards.ts`), and the card that is up is drawn again whenever its print
 * differs (`card.ts`): so a value a card shows cannot be missing from what it is kept by.
 */
import {
  aim,
  ALL_ITEMS,
  BOILER,
  costOf,
  CRATE,
  DEPOT,
  FUEL,
  GATHERER,
  GIVES,
  type Goal,
  GOALS,
  held,
  highest,
  holderOf,
  isDir,
  isFilled,
  isGoal,
  isGraded,
  isItem,
  isKind,
  isNode,
  isPlot,
  isRaw,
  type Item,
  type Kind,
  LEFT,
  LINE,
  locked,
  makeable,
  NODES,
  NONE,
  type Plot,
  plotState,
  price,
  priceAt,
  rate,
  ready,
  RECIPE,
  recipesFor,
  RIGHT,
  SORTER,
  SPLITTER,
  status,
  STOP,
  stops,
  STUDY,
  takes,
  TOOLS,
  toward,
  type Unlock,
  unlocked,
  worthAt,
} from "@sequoia-leaf/factory";

import { WORKS_KEYS } from "../keymap.ts";
import { layout, sendsRight } from "../layout.ts";
import { draws, S } from "../state.ts";
import { usable } from "../tools.ts";
import { coins } from "../yard.ts";
import type {
  GiftPrint,
  ItemPrint,
  MachinePrint,
  Named,
  NodePrint,
  OrderPrint,
  Print,
  StandingPrint,
  TierPrint,
} from "./cards.ts";
import { openTools } from "./dock.ts";
import { givenIn } from "./goal.ts";
import type { GroundPrint, PlotPrint } from "./land.ts";
import { flowOf, kindNumbers, numbersOf, saysNumbers } from "./numbers.ts";
import { orderRef } from "./refs.ts";
import type { WaysPrint } from "./splitter.ts";
import { given, givenTo, lockOf, needsOf, nextUp, researchOpen, tierOpen } from "./standing.ts";

/** A number read back out of a reference, if it is a whole one. */
const numberIn = (id: string): number => (/^\d+$/.test(id) ? Number(id) : -1);
const asItem = (n: number): Item | null => (isItem(n) ? n : null);
/** A count as a card prints it: "1,200". */
const counted = (v: number): string => v.toLocaleString("en-US", { maximumFractionDigits: 3 });

function itemPrint(k: Item): ItemPrint {
  const w = S.world;
  const owed = (want: Float64Array, filled: Float64Array | null): number =>
    Math.max(0, (want[k] ?? 0) - (filled?.[k] ?? 0));
  const asked: Named[] = [];
  const hand = w.hand === -1 ? undefined : GOALS[w.hand];
  const got = w.hand === -1 ? null : (w.got[w.hand] ?? null);
  if (hand && owed(hand.want, got) > 0)
    asked.push({
      ref: orderRef("story"),
      name: hand.title,
      note: `${counted(owed(hand.want, got))} owed`,
      tag: "in hand",
    });
  w.board.forEach((o, slot) => {
    const left = owed(o.want, o.filled);
    if (left > 0) asked.push({ ref: orderRef(slot), name: o.title, note: `${counted(left)} owed` });
  });
  const found: [Plot, number, boolean][] = [];
  // A thing from the ground says where it lies.
  if (!RECIPE[k] && isRaw(k)) {
    const counts = new Map<number, number>();
    w.land.deposit.forEach((d, i) => {
      if (d === k) counts.set(w.land.plot[i] ?? NONE, (counts.get(w.land.plot[i] ?? NONE) ?? 0) + 1);
    });
    for (const [p, tiles] of counts) {
      const plot = w.land.plots[p];
      if (plot) found.push([plot.plot, tiles, w.plots.includes(plot.plot)]);
    }
  }
  return { card: "item", item: k, lock: RECIPE[k] ? locked(w.open, { make: k }) : null, found, asked };
}

/** A kind of piece at a grade: the first, unless the card names a higher or the piece stands at one. */
function machinePrint(k: Kind, grade = 1): MachinePrint {
  const w = S.world;
  const key = S.visiting ? null : WORKS_KEYS.names("tool")[openTools().indexOf(k)];
  return {
    card: "machine",
    kind: k,
    grade,
    graded: isGraded(k) && (grade > 1 || highest(w.open, k) > 1),
    later: !draws(k),
    price: grade > 1 ? price(k, grade) : costOf(w, k),
    gives: k === DEPOT ? w.open.depot : (GIVES[k] ?? 0),
    key: key ?? null,
    recipes: recipesFor(w.open, k).map((r) => r.out),
    open: k === DEPOT || locked(w.open, { build: k, grade }) === null,
    spare: grade > 1 ? 0 : (w.spare[k] ?? 0),
    // What it carries a minute, once the yard counts; a grade above the first says so in its own sentence.
    numbers: saysNumbers(w) && grade <= 1 ? kindNumbers(k, 1) : [],
    stops: k === STOP ? [stops(w), w.open.stops] : null,
  };
}

/** A splitter's ways out (ahead, left, right) as its card shows them: its picture, each way shut and led somewhere, and the way put first. */
function waysPrint(i: number): WaysPrint {
  const w = S.world;
  const d = w.dir[i] ?? 0;
  const dir = isDir(d) ? d : 0;
  const sides = [dir, LEFT[dir], RIGHT[dir]];
  return {
    arms: layout(w).arms[i] ?? 0,
    dir,
    tint: w.tint[i] ?? 0,
    shut: sides.map((_, n) => (((w.shut[i] ?? 0) >> n) & 1) === 1),
    ins: sides.map((_, n) => (((w.ins[i] ?? 0) >> n) & 1) === 1),
    led: sides.map((side) => takes(w, toward(w.land, i, side), i)),
    first: (w.first[i] ?? 0) - 1,
  };
}

function standingPrint(i: number, k: Kind): StandingPrint {
  const w = S.world;
  const x = i % w.land.w;
  const y = Math.floor(i / w.land.w);
  const st = status(w, i);
  const per = rate(w, i);
  const h = w.holders;
  const r = holderOf(w, i);
  const making = aim(w, i);
  const grade = w.grade[i] ?? 0;
  const set = asItem(w.set[i] ?? NONE);
  // A piece of a grade the yard may build higher is raised where it stands, for what the rules ask.
  const raise = isGraded(k) && grade > 0 && grade < highest(w.open, k) ? priceAt(w, k, x, y, grade + 1) : null;
  // A sorter is told one thing of what the yard can make, or has had at the depot.
  const can = k === SORTER ? new Set(makeable(w)) : null;
  return {
    card: "standing",
    x,
    y,
    machine: machinePrint(k, Math.max(1, grade)),
    line: st?.line ?? null,
    trouble: st?.trouble ?? false,
    state: st?.state ?? null,
    spare: st?.spare ?? null,
    missing: st?.missing ?? [],
    holding: r < 0 ? [] : ALL_ITEMS.filter((t) => held(h, r, t) > 0).map((t) => [t, held(h, r, t)] as const),
    most: k === BOILER ? FUEL : k === CRATE ? w.open.crate : null,
    count: r < 0 ? 0 : (h.count[r] ?? 0),
    making: making ? making.out : null,
    flow: flowOf(w, i, saysNumbers(w)),
    gathering: k === GATHERER ? asItem(w.land.deposit[i] ?? NONE) : null,
    perMinute: per > 0 ? Math.round(per) : null,
    numbers: saysNumbers(w) ? numbersOf(w, i) : [],
    set,
    sorts: can ? ALL_ITEMS.filter((t) => can.has(t) || (w.depot[t] ?? 0) > 0 || set === t) : [],
    right: sendsRight(w, i),
    studying: k === STUDY ? (w.line[0] ?? null) : null,
    research: researchOpen() && S.panel !== "research",
    raise: raise === null ? null : { to: grade + 1, cost: raise, enough: coins() >= raise },
    open: r < 0 || h.open[r] === 1,
    tier: tierOpen() ? w.open.tier : null,
    hints: buttonHints(k),
    move: usable("select"),
    refund: worthAt(w, i),
    free: w.free[i] === 1,
    ways: k === SPLITTER ? waysPrint(i) : null,
    visiting: S.visiting !== null,
  };
}

/** The tips of a standing piece's buttons, each with its key where it has one: Another's only where it can be picked up. */
const buttonHints = (k: Kind): StandingPrint["hints"] => ({
  rotate: WORKS_KEYS.titled("Rotate", "rotate"),
  flip: WORKS_KEYS.titled("Flip", "flip"),
  another: usable(k) ? WORKS_KEYS.titled("Another", "another") : null,
});

function tilePrint(i: number): StandingPrint | GroundPrint | null {
  const w = S.world;
  if (i < 0 || i >= w.kind.length) return null;
  const k = w.kind[i] ?? NONE;
  if (isKind(k)) return standingPrint(i, k);
  if (w.land.water[i] === 1) return { card: "ground", ground: "stream" };
  if (w.land.trunk[i] === 1) return { card: "ground", ground: "redwood" };
  return null;
}

function plotPrint(id: Plot): PlotPrint | null {
  const w = S.world;
  const index = w.land.plots.findIndex((p) => p.plot === id);
  const plot = w.land.plots[index];
  if (!plot) return null;
  const { state, why } = plotState(w, id);
  const ground = new Map<Item, number>();
  w.land.deposit.forEach((d, i) => {
    if (isItem(d) && w.land.plot[i] === index) ground.set(d, (ground.get(d) ?? 0) + 1);
  });
  return {
    card: "plot",
    plot: id,
    name: plot.name,
    why: plot.why,
    price: plot.price,
    state,
    not: why,
    bank: w.land.water.some((v, i) => v === 1 && w.land.plot[i] === index),
    ground: [...ground],
    short: Math.max(0, plot.price - coins()),
    visiting: S.visiting !== null,
  };
}

/** A goal: a lesson, a project, a commission or a piece of research. */
function nodePrint(g: Goal): NodePrint | null {
  const w = S.world;
  const info = GOALS[g];
  if (!info) return null;
  const node = isNode(g);
  const done = w.open.done[g] === 1;
  const inHand = w.hand === g;
  const lined = w.line.includes(g);
  const needs = needsOf(g);
  const studied = needs.find((n) => n.stands === "being studied");
  const far = studied ? given(studied.goal) : { have: 0, of: 0 };
  return {
    card: "node",
    goal: g,
    done,
    inHand,
    may: node && !done && !inHand && info.kind !== "lesson" && ready(w.open, g),
    study: node || done ? null : lined ? "out" : ready(w.open, g) && w.line.length < LINE ? "in" : null,
    research: researchOpen() && S.panel !== "research",
    lock: lockOf(g),
    wants: givenTo(g),
    needs,
    studied: [far.have, far.of],
    visiting: S.visiting !== null,
  };
}

function orderPrint(slot: string): NodePrint | OrderPrint | null {
  const w = S.world;
  if (slot === "story") {
    // With nothing in hand, the goal the corner names as waited on.
    const next = w.hand === -1 ? nextUp() : null;
    return w.hand !== -1 ? nodePrint(w.hand) : next?.is === "locked" ? nodePrint(next.goal) : null;
  }
  const o = w.board[numberIn(slot)];
  if (!o) return null;
  return {
    card: "order",
    title: o.title,
    from: o.from,
    line: o.line,
    pay: o.pay,
    wants: givenIn(o.want, o.filled),
    full: isFilled(o.want, o.filled),
  };
}

const NUMBERED = ["stops", "crate", "reach", "depot", "span", "away", "hooks"] as const;
/** The unlocks that are one thing or none: the board, a splitter's flags and its ways in. */
const FLAGGED = ["board", "first", "ins"] as const;

/** The unlock a `perk:` reference names, as the rules make it. */
function perkOf(id: string): Unlock | null {
  const [of = "", a = "", b = ""] = id.split(".");
  const flag = FLAGGED.find((f) => f === of);
  if (flag !== undefined) return unlocked({ [flag]: true })[0] ?? null;
  if (of === "blueprints" && numberIn(a) >= 0 && numberIn(b) >= 0)
    return unlocked({ blueprints: { count: numberIn(a), pieces: numberIn(b) } })[0] ?? null;
  const numbered = NUMBERED.find((f) => f === of);
  return numbered !== undefined && numberIn(a) >= 0 ? (unlocked({ [numbered]: numberIn(a) })[0] ?? null) : null;
}

/** A tier: whether it is open yet. */
const tierPrint = (tier: number): TierPrint => ({ card: "tier", tier, open: tier <= S.world.open.tier });

/** What a finished goal leaves in town, if it leaves anything. */
const giftPrint = (g: Goal): GiftPrint | null => (isNode(g) && NODES[g]?.gift ? { card: "gift", goal: g } : null);

/** What the card a reference names prints now, or nothing if there is no such card. */
export function printOf(ref: string): Print | null {
  const at = ref.indexOf(":");
  const kind = ref.slice(0, at);
  const id = ref.slice(at + 1);
  const n = numberIn(id);
  switch (kind) {
    case "item":
      return isItem(n) ? itemPrint(n) : null;
    case "machine": {
      // A kind, or a kind at a grade: `machine:<kind>.<grade>`.
      const [k = "", grade] = id.split(".");
      const kindOf = numberIn(k);
      return isKind(kindOf) ? machinePrint(kindOf, grade === undefined ? 1 : Math.max(1, numberIn(grade))) : null;
    }
    case "tile":
      return tilePrint(n);
    case "plot":
      return isPlot(n) ? plotPrint(n) : null;
    case "node":
      return isGoal(n) ? nodePrint(n) : null;
    case "order":
      return orderPrint(id);
    case "tool": {
      const tool = TOOLS.find((t) => t === id);
      return tool === undefined ? null : { card: "tool", tool };
    }
    case "perk": {
      const unlock = perkOf(id);
      return unlock === null ? null : { card: "perk", unlock };
    }
    case "tier":
      return n >= 0 ? tierPrint(n) : null;
    case "gift":
      return isGoal(n) ? giftPrint(n) : null;
    default:
      return null;
  }
}
