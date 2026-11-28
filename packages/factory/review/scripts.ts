/**
 * The goldens' command scripts (`golden.ts`): for each, the yard it starts from, made as the tests
 * make one, and what is sent off the wire, in order, as the page sends it, or how long the yard is run
 * on between. A command is written as the page writes it, things, kinds, plots and goals by name;
 * where it names what only the yard can say (a route, a price, a blueprint's code, an order), it is
 * worked out from the yard at that moment, as the page works it out. Every place is from the depot
 * (`near`), so more land round the yard moves none of them.
 */
import * as F from "../src/index.ts";
import { learn } from "../test/goals.ts";
import { near, xy } from "../test/near.ts";
import { boardFilled } from "../test/player.ts";
import { buying, delivering, must, staged } from "../test/yards.ts";

type Rec = Readonly<Record<string, unknown>>;
/** A command off the wire, or one worked out from the yard as it stands; or the yard run on for a number of ticks. */
export type Step = { readonly send: Rec | ((y: F.Yard) => Rec) } | { readonly wait: number };
export interface Script {
  readonly name: string;
  readonly yard: () => F.Yard;
  readonly steps: readonly Step[];
  /** How many more Coins the player may earn (`Ctx.room`): as good as no end, but where a script plays at the earnings cap. */
  readonly room?: number;
}

const send = (c: Rec | ((y: F.Yard) => Rec)): Step => ({ send: c });
const wait = (ticks: number): Step => ({ wait: ticks });
/** A tile from the depot, as the commands that take tiles name it. */
const tileOf = (y: F.Yard, dx: number, dy: number): number => F.at(y, ...xy(dx, dy));
/** The run of belt the router finds from a tile to another, as the page lays it. */
const laid =
  (from: readonly [number, number], to: readonly [number, number]) =>
  (y: F.Yard): Rec => {
    const legs = F.route(y, xy(...from), xy(...to));
    return legs ? F.writeAct({ do: "lay", legs }) : { do: "lay", legs: [] };
  };
/** The command to buy a plot at what it costs the yard now. */
const buy = (plot: string) => (y: F.Yard) => buying(y, plot);
/** The code of a blueprint the yard keeps, as a player copies it. */
const codeOf = (y: F.Yard, slot: number): string => {
  const b = y.blueprints[slot];
  return b ? (F.blueprintCode(b) ?? "") : "";
};
/** The `n`th order on the board, by its id. */
const orderAt = (y: F.Yard, n: number): number => y.board[n]?.id ?? -1;

/** A yard in tier 5 that owns the Meadow, where a redwood stands, with felling known. */
function meadow(): F.Yard {
  const y = F.create({ seed: 5, tier: 5 });
  must(y, buying(y, "meadow"));
  learn(y, F.goal("felling"));
  y.history = [];
  return y;
}

export const SCRIPTS: readonly Script[] = [
  {
    name: "the first lesson",
    yard: () => F.create({ seed: 1 }),
    steps: [
      send({ do: "build", kind: "gatherer", ...near(5, 3), dir: 3 }),
      send({ do: "build", kind: "mill", ...near(5, 2), dir: 2 }),
      send(laid([4, 2], [0, 0])),
      wait(6000),
      send({ do: "collect" }),
      send({ do: "build", kind: "bench", ...near(-6, 3), dir: 0 }),
      wait(6000),
      send({ do: "collect" }),
    ],
  },
  {
    name: "a line built",
    yard: () => F.create({ seed: 1, tier: 4 }),
    steps: [
      send({ do: "build", kind: "gatherer", ...near(5, 3), dir: 3 }),
      send({ do: "build", kind: "mill", ...near(5, 2), dir: 2 }),
      send(laid([4, 2], [0, 0])),
      // On a piece already there: refused.
      send({ do: "build", kind: "gatherer", ...near(5, 3), dir: 3 }),
      wait(1200),
      send({ do: "build", kind: "gatherer", ...near(-5, -3), dir: 0 }),
      send(laid([-4, -3], [0, 0])),
      send({ do: "build", kind: "bench", ...near(-6, 3), dir: 0 }),
      send({ do: "recipe", ...near(-6, 3), item: "tool" }),
      send({ do: "recipe", ...near(5, 2), item: "brick" }),
      send({ do: "remove", ...near(4, 2) }),
      send({ do: "undo", entry: "c10" }),
      send({ do: "undo", entry: "c10" }),
      send((y) => ({ do: "upgrade", tiles: [tileOf(y, 3, 2), tileOf(y, 2, 2)] })),
      send({ do: "turn", ...near(-6, 3), dir: 1 }),
      send({ do: "paint", ...near(3, 2), tint: 2 }),
      wait(3000),
      send({ do: "collect" }),
      send({ do: "take", node: "flags" }),
      wait(3000),
      send({ do: "collect" }),
    ],
  },
  {
    name: "research",
    yard: () => staged("study"),
    steps: [
      // The line is full: four pieces of research.
      send({ do: "study", research: "carttrack" }),
      send({ do: "unstudy", research: "sorter" }),
      send({ do: "study", research: "carttrack" }),
      send({ do: "unstudy", research: "planchest" }),
      send({ do: "study", research: "nightshift" }),
      send({ do: "study", research: "nightshift" }),
      wait(3000),
      send({ do: "study", research: "oilpress" }),
      send({ do: "unstudy", research: "oilpress" }),
      wait(6000),
      send({ do: "collect" }),
    ],
  },
  {
    name: "blueprints",
    // Tier 4 open: blueprints and Select are unlocked; a line of deadfall from the north-west into the depot.
    yard: () => delivering(3),
    steps: [
      // Three of its belts, and the line with its gatherer.
      send((y) => ({ do: "saveBlueprint", slot: 0, tiles: F.within(y, ...xy(-4, -3), ...xy(-2, -3)) })),
      send((y) => ({ do: "saveBlueprint", slot: 2, tiles: F.within(y, ...xy(-5, -3), ...xy(-1, -3)) })),
      send((y) => ({ do: "pasteBlueprint", slot: 1, code: codeOf(y, 0) })),
      send({ do: "pasteBlueprint", slot: 3, code: "not a code" }),
      send({ do: "placeBlueprint", slot: 1, turns: 0, ...near(-4, 4) }),
      send({ do: "undo", entry: "c4" }),
      send({ do: "placeBlueprint", slot: 1, turns: 1, ...near(-7, -1) }),
      // Off the yard's own plot, and a gatherer off any deposit: refused.
      send({ do: "placeBlueprint", slot: 1, turns: 0, ...near(-5, 6) }),
      send({ do: "placeBlueprint", slot: 2, turns: 1, ...near(-8, -6) }),
      send({ do: "placeBlueprint", slot: 2, turns: 0, ...near(-5, -3) }),
      send({ do: "deleteBlueprint", slot: 0 }),
      send({ do: "saveYard", slot: 3 }),
      wait(2000),
      send({ do: "collect" }),
    ],
  },
  {
    name: "the gate's blueprints and grades",
    // Kept by the version before (9), as a yard naming nothing the last Leaf of version 10 did not know is.
    yard: () => staged("gate"),
    steps: [
      send((y) => ({ do: "saveBlueprint", slot: 0, tiles: F.within(y, ...xy(-3, -3), ...xy(-1, -3)) })),
      send((y) => ({ do: "upgrade", tiles: F.within(y, ...xy(-3, -3), ...xy(-1, -3)) })),
      send({ do: "placeBlueprint", slot: 0, turns: 0, ...near(-3, -5) }),
      send((y) => ({ do: "saveBlueprint", slot: 1, tiles: F.within(y, ...xy(-3, -5), ...xy(-1, -5)) })),
      send({ do: "take", node: "flags" }),
      send({ do: "queue", node: "shelves" }),
      wait(3000),
      send({ do: "collect" }),
    ],
  },
  {
    name: "orders and plots",
    yard: boardFilled,
    steps: [
      send((y) => ({ do: "handOver", order: orderAt(y, 0) })),
      send((y) => ({ do: "handOver", order: orderAt(y, 0) })),
      send((y) => ({ do: "swap", order: orderAt(y, 1) })),
      send({ do: "handOver", order: 999 }),
      send(buy("meadow")),
      send({ do: "buyPlot", plot: "stream", price: 1 }),
      wait(3000),
      send({ do: "collect" }),
    ],
  },
  {
    name: "felling and clearing",
    yard: meadow,
    steps: [
      send((y) => ({ do: "fell", ...near(-2, 15), price: F.fellPrice(y) })),
      send((y) => ({ do: "fell", ...near(-2, 15), price: F.fellPrice(y) })),
      send({ do: "build", kind: "belt", ...near(-2, 15), dir: 0 }),
      send({ do: "undo", entry: "c2" }),
      send({ do: "undo", entry: "c0" }),
      send({ do: "clearPlot", plot: "workings" }),
      send((y) => ({ do: "stopClearing", plot: "workings", start: y.clearing?.start ?? "" })),
      send({ do: "clearPlot", plot: "workings" }),
      wait(1000),
      send({ do: "collect" }),
    ],
  },
  {
    name: "a delivering yard",
    yard: () => delivering(2),
    steps: [
      wait(6000),
      send({ do: "collect" }),
      send((y) => ({ do: "upgrade", tiles: F.within(y, ...xy(1, 2), ...xy(4, 2)) })),
      wait(6000),
      send({ do: "collect" }),
    ],
  },
  {
    name: "at the earnings cap",
    // The player may earn nothing more: a till paid in, a piece taken up and Undo's Coins back are
    // each free of the cap, or Leaf would pay them nothing.
    room: 0,
    yard: () => staged("small"),
    steps: [
      wait(3000),
      send({ do: "collect" }),
      send({ do: "remove", ...near(-1, -3) }),
      send({ do: "undo", entry: "c2" }),
      send({ do: "build", kind: "belt", ...near(-1, -5), dir: 0 }),
      send({ do: "remove", ...near(-1, -5) }),
    ],
  },
];
