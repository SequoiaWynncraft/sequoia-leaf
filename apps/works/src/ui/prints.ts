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
  holderOf,
  isDir,
  isFilled,
  isGoal,
  isItem,
  isKind,
  isNode,
  isPlot,
  isRaw,
  type Item,
  type Kind,
  LEFT,
  locked,
  NONE,
  type Plot,
  plotState,
  rate,
  ready,
  RECIPE,
  recipesFor,
  RIGHT,
  SPLITTER,
  status,
  takes,
  toward,
  worthAt,
} from "@sequoia-leaf/factory";

import { layout } from "../layout.ts";
import { draws, S } from "../state.ts";
import { usable } from "../tools.ts";
import { coins } from "../yard.ts";
import {
  type GroundPrint,
  type ItemPrint,
  type MachinePrint,
  type Named,
  type NodePrint,
  type OrderPrint,
  orderRef,
  type PlotPrint,
  type Print,
  type StandingPrint,
  type WaysPrint,
} from "./cards.ts";
import { KEYS, openTools } from "./dock.ts";
import { projectsOpen } from "./panels.ts";

/** A number read back out of a reference, if it is a whole one. */
const numberIn = (id: string): number => (/^\d+$/.test(id) ? Number(id) : -1);
const asItem = (n: number): Item | null => (isItem(n) ? n : null);
/** A count as a card prints it: "1,200". */
const counted = (v: number): string => v.toLocaleString("en-US", { maximumFractionDigits: 3 });

/** Each thing a node or an order wants, with how many have come (no more than it wants) of how many. */
const wantsOf = (want: Float64Array, filled: Float64Array | null): (readonly [Item, number, number])[] =>
  ALL_ITEMS.filter((k) => (want[k] ?? 0) > 0).map((k) => {
    const of = want[k] ?? 0;
    return [k, Math.min(filled?.[k] ?? 0, of), of] as const;
  });

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

function machinePrint(k: Kind): MachinePrint {
  const w = S.world;
  const key = S.visiting ? undefined : KEYS[openTools().indexOf(k)];
  return {
    card: "machine",
    kind: k,
    later: !draws(k),
    price: costOf(w, k),
    gives: k === DEPOT ? w.open.depot : (GIVES[k] ?? 0),
    key: key ?? null,
    recipes: recipesFor(w.open, k).map((r) => r.out),
    open: k === DEPOT || locked(w.open, { build: k }) === null,
    spare: w.spare[k] ?? 0,
  };
}

/** A splitter's ways out (ahead, left, right) as its card shows them: its picture, and each way shut, and led somewhere. */
function waysPrint(i: number): WaysPrint {
  const w = S.world;
  const d = w.dir[i] ?? 0;
  const dir = isDir(d) ? d : 0;
  const sides = [dir, LEFT[dir], RIGHT[dir]];
  return {
    arms: layout(w, S.rev).arms[i] ?? 0,
    dir,
    tint: w.tint[i] ?? 0,
    shut: sides.map((_, n) => (((w.shut[i] ?? 0) >> n) & 1) === 1),
    led: sides.map((side) => takes(w, toward(w.land, i, side), i)),
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
  return {
    card: "standing",
    x,
    y,
    machine: machinePrint(k),
    line: st?.line ?? null,
    trouble: st?.trouble ?? false,
    state: st?.state ?? null,
    spare: st?.spare ?? null,
    missing: st?.missing ?? [],
    holding: r < 0 ? [] : ALL_ITEMS.filter((t) => held(h, r, t) > 0).map((t) => [t, held(h, r, t)] as const),
    most: k === BOILER ? FUEL : k === CRATE ? w.open.crate : null,
    count: r < 0 ? 0 : (h.count[r] ?? 0),
    making: making ? making.out : null,
    gathering: k === GATHERER ? asItem(w.land.deposit[i] ?? NONE) : null,
    perMinute: per > 0 ? Math.round(per) : null,
    set: asItem(w.set[i] ?? NONE),
    open: r < 0 || h.open[r] === 1,
    projects: projectsOpen(),
    another: usable(k),
    refund: worthAt(w, i),
    free: w.free[i] === 1,
    ways: k === SPLITTER ? waysPrint(i) : null,
    visiting: S.visiting !== null,
  };
}

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

function nodePrint(g: Goal): NodePrint | null {
  const w = S.world;
  const info = GOALS[g];
  if (!info || !isNode(g)) return null;
  const done = w.open.done[g] === 1;
  const inHand = w.hand === g;
  return {
    card: "node",
    goal: g,
    done,
    inHand,
    may: !done && !inHand && info.kind !== "lesson" && ready(w.open, g),
    needs: info.needs.filter((m) => w.open.done[m] !== 1).map((m) => GOALS[m]?.title ?? ""),
    wants: wantsOf(info.want, done ? info.want : (w.got[g] ?? null)),
    visiting: S.visiting !== null,
  };
}

function orderPrint(slot: string): NodePrint | OrderPrint | null {
  const w = S.world;
  if (slot === "story") return w.hand === -1 ? null : nodePrint(w.hand);
  const o = w.board[numberIn(slot)];
  if (!o) return null;
  return {
    card: "order",
    title: o.title,
    from: o.from,
    line: o.line,
    pay: o.pay,
    wants: wantsOf(o.want, o.filled),
    full: isFilled(o.want, o.filled),
  };
}

/** What the card a reference names prints now, or nothing if there is no such card. */
export function printOf(ref: string): Print | null {
  const at = ref.indexOf(":");
  const kind = ref.slice(0, at);
  const id = ref.slice(at + 1);
  const n = numberIn(id);
  switch (kind) {
    case "item":
      return isItem(n) ? itemPrint(n) : null;
    case "machine":
      return isKind(n) ? machinePrint(n) : null;
    case "tile":
      return tilePrint(n);
    case "plot":
      return isPlot(n) ? plotPrint(n) : null;
    case "node":
      return isGoal(n) ? nodePrint(n) : null;
    case "order":
      return orderPrint(id);
    default:
      return null;
  }
}
