/**
 * Pacing the Works: `bun review/balance.ts` (add `--map` to see the yard after every order).
 *
 * It plays the whole story by script on the guild's real land, with the real rules and a purse:
 * for each order it clears away the last order's line, buys whatever plot or plan the order cannot
 * be made without, builds one sensible line for each thing asked for (one gatherer and one machine
 * at every step, belts found by the router, pylons and boilers as needed), waits for the Coins
 * where it is short, and runs the yard until the order is filled. Then it prints how long each
 * order took, what the yard earns an hour along the way, and which plans and plots pay back
 * fastest.
 *
 * The player here has quick hands and never stops to think, so a person will be slower at building
 * than this says; `THINK` is the allowance for that, and both figures are printed.
 */
import {
  at,
  build,
  buyPlan,
  buyPlot,
  claim,
  collect,
  create,
  DEPOT_SHARE,
  type Dir,
  DIRS,
  DX,
  DY,
  forward,
  fresh,
  isFilled,
  ITEM,
  type Item,
  ITEMS,
  KIND,
  type Kind,
  lay,
  type Leg,
  load,
  makeable,
  partsOf,
  type PlanId,
  PLANS,
  planState,
  type PlotId,
  PLOTS,
  plotState,
  power,
  REACH,
  RECIPE,
  refusal,
  remove,
  route,
  save,
  type Spent,
  step,
  STORY,
  TICKS,
  workOf,
  type World,
} from "../src/sim/index.ts";

const SHOW_MAP = process.argv.includes("--map");
/** Ticks of a person's time allowed for: each thing placed, each run of belt, each purchase, and working out each order's line. */
const HANDS = { place: 15, run: 30, buy: 100 } as const;
const THINK = { order: 1200, machine: 150 } as const;

type Cell = readonly [number, number];
/** How a line is laid out: how long the belts run out from a machine's sides, how much room it is given, and which part is built first. */
interface Shape {
  readonly reach: number;
  readonly room: number;
  readonly flip: boolean;
}
const minutes = (ticks: number): string => (ticks / 600).toFixed(1).padStart(6);
const clock = (ticks: number): string => {
  const m = Math.round(ticks / 600);
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
};
const pad = (s: string | number, n: number): string => String(s).padEnd(n);
const lpad = (s: string | number, n: number): string => String(s).padStart(n);

/** Somebody playing the yard: a purse, a clock, and the patience to wait for Coins. */
class Player {
  w: World = create({ seed: 20261121 });
  purse = 0;
  /** Ticks played, and of those, ticks spent waiting for Coins. */
  ticks = 0;
  waited = 0;
  /** Coins from standing orders that filled along the way and were handed over. */
  fromBoard = 0;

  /** A copy to try a layout on, as a person would on paper: adopted if it works, thrown away if not. */
  twin(): Player {
    const twin = new Player();
    const w = load(save(this.w));
    if (!w) throw new Error("the yard would not copy");
    return Object.assign(twin, {
      w,
      purse: this.purse,
      ticks: this.ticks,
      waited: this.waited,
      fromBoard: this.fromBoard,
    });
  }

  /** The middle of where the makings of a thing lie: the nearest deposit of each thing from the ground that goes into it. */
  lies(item: Item, from: Cell): Cell {
    const spots = [...new Set(partsOf(item).filter((k) => !RECIPE[k]))].flatMap((raw) => {
      const tile = this.deposit(raw, from);
      return tile ? [tile] : [];
    });
    if (spots.length === 0) return from;
    return [
      spots.reduce((sum, c) => sum + c[0], 0) / spots.length,
      spots.reduce((sum, c) => sum + c[1], 0) / spots.length,
    ];
  }

  run(ticks: number): void {
    for (let k = 0; k < ticks; k++) step(this.w);
    this.ticks += ticks;
    this.purse += collect(this.w);
    this.w.board.forEach((o, slot) => {
      if (isFilled(o.want, o.filled)) this.fromBoard += claim(this.w, slot) ?? 0;
    });
    this.purse += collect(this.w);
  }

  /** Does something that costs Coins, waiting for them if the purse is short. */
  spend(what: string, act: (coins: number) => Spent): void {
    for (let tries = 0; tries < 2000; tries++) {
      const did = act(this.purse);
      if (did.ok) {
        this.purse -= did.cost;
        return;
      }
      if (did.why !== "Not enough Coins") throw new Error(`${what}: ${did.why}`);
      this.run(50);
      this.waited += 50;
    }
    throw new Error(`${what}: the Coins never came`);
  }

  free(x: number, y: number): boolean {
    const i = at(this.w, x, y);
    return i >= 0 && !this.w.cells[i] && refusal(this.w, "belt", x, y, Infinity) === null;
  }
  /** Free ground with nothing to gather under it: where machines and pylons go, leaving the deposits for gatherers. */
  plain(x: number, y: number): boolean {
    return this.free(x, y) && !this.w.land.deposit[at(this.w, x, y)];
  }

  put(kind: Kind, x: number, y: number, dir: Dir): void {
    this.spend(`a ${kind} at ${x},${y}`, (coins) => build(this.w, kind, x, y, dir, coins));
    this.run(HANDS.place);
  }

  /** Stands pylons toward a tile until power reaches it. */
  light(x: number, y: number): void {
    const { w } = this;
    const [cx, cy] = w.land.depot;
    for (let tries = 0; tries < 12 && w.power[at(w, x, y)] !== 1; tries++) {
      const link = REACH.link * w.rates.reach;
      const live: Cell[] = [[cx, cy]];
      w.cells.forEach((b, i) => {
        if (b?.kind === "pylon" && w.power[i] === 1) live.push([i % w.land.w, Math.floor(i / w.land.w)]);
      });
      let best: Cell | null = null;
      let bestD = Infinity;
      for (let py = 0; py < w.land.h; py++)
        for (let px = 0; px < w.land.w; px++) {
          const d = Math.hypot(px - x, py - y);
          if (d >= bestD || d < 1.5 || !this.plain(px, py)) continue;
          if (!live.some(([lx, ly]) => Math.hypot(px - lx, py - ly) <= link)) continue;
          best = [px, py];
          bestD = d;
        }
      if (!best) throw new Error(`no way to carry power to ${x},${y}`);
      this.put("pylon", best[0], best[1], 0);
    }
  }

  /** Lays the shortest run of belt from a tile to a thing. */
  haul(from: Cell, to: Cell): Leg[] {
    const legs = route(this.w, from, to);
    if (!legs) throw new Error(`no way for a belt from ${from.join(",")} to ${to.join(",")}`);
    this.spend("a run of belt", (coins) => lay(this.w, legs, coins));
    this.run(HANDS.run + legs.length * 2);
    return legs;
  }

  /** The free tiles beside a tile, nearest to `toward` first. */
  beside(x: number, y: number, toward: Cell, plain = false): Cell[] {
    return DIRS.map((d): Cell => [x + DX[d], y + DY[d]])
      .filter(([nx, ny]) => (plain ? this.plain(nx, ny) : this.free(nx, ny)))
      .toSorted(
        (a, b) => Math.hypot(a[0] - toward[0], a[1] - toward[1]) - Math.hypot(b[0] - toward[0], b[1] - toward[1]),
      );
  }

  /** Every tile of the map, nearest to a point first. */
  near(point: Cell): Cell[] {
    const all: Cell[] = [];
    for (let y = 0; y < this.w.land.h; y++) for (let x = 0; x < this.w.land.w; x++) all.push([x, y]);
    return all.toSorted(
      (a, b) => Math.hypot(a[0] - point[0], a[1] - point[1]) - Math.hypot(b[0] - point[0], b[1] - point[1]),
    );
  }

  /** Where the nearest free deposit of a thing lies, on the yard's land. */
  deposit(raw: Item, toward: Cell): Cell | null {
    return (
      this.near(toward).find(
        ([x, y]) =>
          this.w.land.deposit[at(this.w, x, y)] === raw &&
          this.free(x, y) &&
          this.beside(x, y, toward, true).length > 0,
      ) ?? null
    );
  }

  /** The way from a tile straight into the thing at `into`, if they are side by side. */
  straight(from: Cell, into: Cell): Dir | null {
    const depot = this.w.cells[at(this.w, into[0], into[1])]?.kind === "depot";
    for (const d of DIRS) {
      const [x, y] = [from[0] + DX[d], from[1] + DY[d]];
      if (depot ? this.w.cells[at(this.w, x, y)]?.kind === "depot" : x === into[0] && y === into[1]) return d;
    }
    return null;
  }

  /**
   * Builds one line that makes a thing and carries it to whatever wants it (`into`: the depot, or
   * the machine it is a part for). Something from the ground is a gatherer; anything worked once is
   * a gatherer and the mill it points at; anything put together is its machine, set down on open
   * ground near `toward`, with a line for each of its parts run in to it. Each piece is joined to
   * what it feeds as soon as it stands, while there is still room to get there.
   */
  make(item: Item, toward: Cell, into: Cell, shape: Shape = { reach: 3, room: 1, flip: false }): void {
    const { w } = this;
    const r = RECIPE[item];
    const way = (from: Cell, to: Cell): Dir => (to[0] > from[0] ? 0 : to[0] < from[0] ? 2 : to[1] > from[1] ? 1 : 3);
    if (!r || r.by === "mill") {
      const raw = r?.from[0] ?? item;
      const tile = this.deposit(raw, toward);
      const spot = tile ? this.beside(tile[0], tile[1], into, true)[0] : undefined;
      if (!tile || !spot) throw new Error(`nowhere left to gather ${raw}`);
      this.put("gatherer", tile[0], tile[1], way(tile, spot));
      this.light(tile[0], tile[1]);
      if (!r) {
        this.haul(spot, into);
        return;
      }
      // A mill stands where its gatherer points, and hands straight to what it feeds if that is beside it.
      const direct = this.straight(spot, into);
      const out = this.beside(spot[0], spot[1], into)[0];
      if (direct === null && !out) throw new Error(`a mill for ${item} at ${spot.join(",")} has no way out`);
      this.put("mill", spot[0], spot[1], direct ?? (out ? way(spot, out) : 0));
      this.light(spot[0], spot[1]);
      if (direct === null && out) this.haul(out, into);
      return;
    }
    // A bench or workshop stands on open ground near where its parts lie, with room all round it.
    const roomy = (x: number, y: number): boolean => {
      for (let dy = -shape.room; dy <= shape.room; dy++)
        for (let dx = -shape.room; dx <= shape.room; dx++) if (!this.free(x + dx, y + dy)) return false;
      return this.plain(x, y);
    };
    const spot = this.near(toward).find(
      ([x, y]) => roomy(x, y) && Math.hypot(x - w.land.depot[0], y - w.land.depot[1]) > 3.5,
    );
    const out = spot ? this.beside(spot[0], spot[1], into)[0] : undefined;
    if (!spot || !out) throw new Error(`nowhere to stand a ${r.by} for ${item}`);
    this.put(r.by, spot[0], spot[1], way(spot, out));
    this.light(spot[0], spot[1]);
    this.haul(out, into);
    // A short belt is run out from each of its other sides first, so that no line coming in can wall a side off.
    const stubs: Cell[][] = [];
    for (const d of DIRS) {
      const stub: Cell[] = [];
      for (let k = 1; k <= shape.reach && this.free(spot[0] + DX[d] * k, spot[1] + DY[d] * k); k++) {
        const cell: Cell = [spot[0] + DX[d] * k, spot[1] + DY[d] * k];
        this.put("belt", cell[0], cell[1], way(cell, spot));
        stub.push(cell);
      }
      if (stub.length > 0) stubs.push(stub);
    }
    for (const part of shape.flip ? r.from.toReversed() : r.from) {
      // Each part comes in by the stub that ends nearest to where its makings lie.
      const lies = this.lies(part, spot);
      const far = (stub: Cell[]): number =>
        Math.hypot((stub.at(-1)?.[0] ?? 0) - lies[0], (stub.at(-1)?.[1] ?? 0) - lies[1]);
      const stub = stubs.toSorted((a, c) => far(a) - far(c))[0];
      const tail = stub?.at(-1);
      if (!stub || !tail) throw new Error(`a ${r.by} for ${item} has no side left for ${part}`);
      stubs.splice(stubs.indexOf(stub), 1);
      this.make(part, [(tail[0] + lies[0]) / 2, (tail[1] + lies[1]) / 2], tail, shape);
    }
    for (const stub of stubs) for (const cell of stub) this.unput(cell);
  }

  /** Takes back something set down only to hold a place. */
  unput(cell: Cell): void {
    const did = remove(this.w, cell[0], cell[1]);
    if (did.ok) this.purse += did.refund;
  }

  /** Stands boilers (or waterwheels, where there are no boilers yet) until there is power for everything drawn. */
  fuel(): void {
    const { w } = this;
    for (let tries = 0; tries < 12; tries++) {
      const p = power(w);
      const burning = w.cells.filter((b) => b?.kind === "boiler").length * KIND.boiler.gives;
      const steady = p.supply - w.cells.filter((b) => b?.kind === "boiler" && b.fuel > 0).length * KIND.boiler.gives;
      if (steady + burning >= p.demand) return;
      if (w.open.kinds.has("boiler")) {
        const tile = this.near(w.land.depot).find(
          ([x, y]) =>
            w.land.deposit[at(w, x, y)] === "deadfall" &&
            this.free(x, y) &&
            this.beside(x, y, w.land.depot, true).length > 0,
        );
        const spot = tile ? this.beside(tile[0], tile[1], w.land.depot, true)[0] : undefined;
        if (!tile || !spot) return;
        this.put(
          "gatherer",
          tile[0],
          tile[1],
          spot[0] > tile[0] ? 0 : spot[0] < tile[0] ? 2 : spot[1] > tile[1] ? 1 : 3,
        );
        this.put("boiler", spot[0], spot[1], 0);
        this.light(tile[0], tile[1]);
        this.light(spot[0], spot[1]);
      } else return;
    }
  }

  /** Takes the last order's line away, keeping what carries and makes power. Everything comes back as Coins. */
  clear(): void {
    const { w } = this;
    const stays = new Set<number>();
    w.cells.forEach((b, i) => {
      if (!b) return;
      if (b.kind === "depot" || b.kind === "pylon" || b.kind === "boiler" || b.kind === "wheel") stays.add(i);
      const ahead = at(w, (i % w.land.w) + DX[b.dir], Math.floor(i / w.land.w) + DY[b.dir]);
      if (b.kind === "gatherer" && w.cells[ahead]?.kind === "boiler") stays.add(i);
    });
    w.cells.forEach((b, i) => {
      if (!b || stays.has(i) || !w.cells[i]) return;
      const did = remove(w, i % w.land.w, Math.floor(i / w.land.w));
      if (did.ok) this.purse += did.refund;
    });
  }

  /** Buys the cheapest plots and plans without which a thing cannot be made at all. */
  open(item: Item): string[] {
    const bought: string[] = [];
    const short = (): boolean => !makeable(this.w).includes(item);
    for (let tries = 0; short() && tries < 8; tries++) {
      const helps = <T extends string>(ids: readonly T[], buy: (w: World, id: T) => Spent): T | undefined =>
        ids.find((id) => {
          const twin = load(save(this.w));
          return twin !== null && buy(twin, id).ok && makeable(twin).length > makeable(this.w).length;
        });
      const plot = helps(
        PLOTS.toSorted((a, b) => a.price - b.price).map((p) => p.id),
        (w, id) => buyPlot(w, id, Infinity),
      );
      const plan = helps(
        PLANS.toSorted((a, b) => a.price - b.price).map((p) => p.id),
        (w, id) => buyPlan(w, id, Infinity),
      );
      const plotPrice = PLOTS.find((p) => p.id === plot)?.price ?? Infinity;
      const planPrice = PLANS.find((p) => p.id === plan)?.price ?? Infinity;
      if (plot && plotPrice <= planPrice) this.plot(plot);
      else if (plan) this.plan(plan);
      else throw new Error(`nothing for sale would let the yard make ${item}`);
      bought.push(plot && plotPrice <= planPrice ? plot : (plan ?? ""));
    }
    return bought;
  }
  plot(id: PlotId): void {
    this.spend(`the plot ${id}`, (coins) => buyPlot(this.w, id, coins));
    this.run(HANDS.buy);
  }
  plan(id: PlanId): void {
    this.spend(`the plan ${id}`, (coins) => buyPlan(this.w, id, coins));
    this.run(HANDS.buy);
  }

  /**
   * Buys every plan and plot that is for sale and costs no more than a share of what the purse holds
   * beyond `keep`, cheapest first. `keep` is what the next order will need for land and machines.
   */
  treat(share: number, keep: number): string[] {
    const bought: string[] = [];
    for (const plot of PLOTS.toSorted((a, b) => a.price - b.price))
      if (plotState(this.w, plot.id).state === "for sale" && plot.price <= (this.purse - keep) * share) {
        this.plot(plot.id);
        bought.push(plot.id);
      }
    for (const p of PLANS.toSorted((a, b) => a.price - b.price))
      if (planState(this.w, p.id).state === "for sale" && p.price <= (this.purse - keep) * share) {
        this.plan(p.id);
        bought.push(p.id);
      }
    return bought;
  }

  /** What is built, as numbers. */
  size(): { machines: number; belts: number } {
    let machines = 0;
    let belts = 0;
    for (const b of this.w.cells) {
      if (!b || b.kind === "depot") continue;
      if (b.kind === "belt" || b.kind === "tunnel") belts++;
      else machines++;
    }
    return { machines, belts };
  }

  map(): string {
    const { w } = this;
    const L: Partial<Record<Item, string>> = { deadfall: "d", stone: "s", ore: "o", clay: "c", sand: "a", resin: "r" };
    const K: Record<Kind, string> = {
      belt: "→↓←↑",
      gatherer: "G",
      mill: "M",
      bench: "B",
      workshop: "W",
      splitter: "S",
      joiner: "J",
      tunnel: "U",
      crate: "C",
      pylon: "P",
      wheel: "H",
      boiler: "F",
      depot: "D",
    };
    const owned = w.land.plots.filter((p) => w.plots.includes(p.id));
    const x0 = Math.min(...owned.map((p) => p.x));
    const x1 = Math.max(...owned.map((p) => p.x + p.w));
    const y0 = Math.min(...owned.map((p) => p.y));
    const y1 = Math.max(...owned.map((p) => p.y + p.h));
    const rows: string[] = [];
    for (let y = y0; y < y1; y++) {
      let row = `     ${lpad(y, 2)} `;
      for (let x = x0; x < x1; x++) {
        const i = at(w, x, y);
        const b = w.cells[i];
        const dep = w.land.deposit[i];
        row += b
          ? b.kind === "belt"
            ? (K.belt[b.dir] ?? "?")
            : K[b.kind]
          : w.land.water[i]
            ? "~"
            : w.land.trunk[i]
              ? "T"
              : dep
                ? (L[dep] ?? "?")
                : w.power[i]
                  ? "·"
                  : " ";
      }
      rows.push(row);
    }
    return rows.join("\n");
  }
}

/**
 * Builds a line for each thing wanted. It is tried on paper with the machines set down in different
 * places, and the tidiest layout that works (the fewest belts) is the one built. Nothing if none works.
 */
function layOut(p: Player, wanted: readonly Item[]): Player | null {
  const depot = p.w.land.depot;
  const tries: Player[] = [];
  const shapes: { shape: Shape; t: number; spread: number }[] = [];
  for (const room of [1, 2])
    for (const reach of [3, 1, 2])
      for (const flip of [false, true])
        for (const t of [0.35, 0.5, 0.65, 0.8, 0.2, 0.95])
          for (const spread of [0, 3, -3, 6, -6]) shapes.push({ shape: { reach, room, flip }, t, spread });
  for (const { shape, t, spread } of shapes) {
    if (tries.length >= 6) break;
    const twin = p.twin();
    try {
      wanted.forEach((item, k) => {
        // Each thing wanted is put together part of the way from the depot to where its makings lie.
        const lies = twin.lies(item, depot);
        const side = k === 0 ? spread : -spread;
        twin.make(
          item,
          [depot[0] + (lies[0] - depot[0]) * t + side, depot[1] + (lies[1] - depot[1]) * t - side],
          depot,
          shape,
        );
      });
      twin.fuel();
      tries.push(twin);
    } catch (e) {
      if (process.argv.includes("--stuck")) console.log(`\n${String(e)}\n${twin.map()}`);
    }
  }
  return tries.toSorted((a, c) => a.size().belts - c.size().belts)[0] ?? null;
}

/** Things a minute a line turns out with some plans bought, over twenty minutes of every tick. */
function pace(w: World, item: Item, plans: readonly PlanId[]): number {
  const twin = load(save(w));
  if (!twin) return 0;
  for (const id of plans) buyPlan(twin, id, Infinity);
  forward(twin, 3000, true);
  return (forward(twin, 12_000, true).made[item] ?? 0) / 20;
}

// ---------- what things are worth ----------

console.log("THE WORKS: pacing and balance\n");
console.log("1. What each thing is, and what one machine making nothing else turns out");
console.log(
  `   ${pad("thing", 16)}${lpad("step", 5)}${lpad("work", 6)}${lpad("worth", 7)}${lpad("a min", 7)}  ${lpad("orders pay/h", 13)}${lpad("depot pays/h", 14)}  power for its line`,
);
/** The power one line of a thing draws: a gatherer or machine for every part, each working as hard as the last one needs. */
const lineDraw = (item: Item): number =>
  partsOf(item).reduce((sum, part) => sum + KIND[RECIPE[part]?.by ?? "gatherer"].draw, 0);
for (const item of ITEMS) {
  const ticks = RECIPE[item]?.ticks ?? TICKS.gather;
  const perHour = 36_000 / ticks;
  console.log(
    `   ${pad(ITEM[item].name, 16)}${lpad(ITEM[item].step, 5)}${lpad(workOf(item), 6)}${lpad(ITEM[item].worth, 7)}${lpad((600 / ticks).toFixed(1), 7)}  ${lpad(Math.round(perHour * ITEM[item].worth), 13)}${lpad((perHour * ITEM[item].worth * DEPOT_SHARE).toFixed(1), 14)}  ${lpad(lineDraw(item), 5)}`,
  );
}
console.log(
  "   (work: ticks of gathering and making in one, all the way down; ten ticks are a second. worth: Coins an order pays for one.)\n",
);

// ---------- the story, played ----------

console.log("2. The story, played by script: one line for each thing an order asks for, cleared away after");
console.log(
  `   ${pad("#", 3)}${pad("order", 31)}${pad("asks for", 26)}${lpad("mach", 5)}${lpad("belt", 5)}${lpad("power", 9)}${lpad("build", 7)}${lpad("fill", 7)}${lpad("think", 7)}${lpad("done at", 9)}${lpad("pay", 7)}${lpad("purse", 7)}  bought on the way`,
);
let p = new Player();
p.purse = collect(p.w);
/** Play time with a person's thinking added in, and the longest stretch between two orders with it. */
let thought = 0;
let longest = { minutes: 0, title: "" };
const doneAt: number[] = [];
const hourly: { title: string; depot: number; orders: number }[] = [];
let late: World | null = null;
/** The yard and its player as they stood after each order, to try other things from. */
const stages = new Map<number, Player>();
for (const [n, order] of STORY.entries()) {
  const began = p.ticks;
  const wanted = ITEMS.filter((k) => (order.want[k] ?? 0) > 0);
  p.clear();
  const bought = wanted.flatMap((item) => p.open(item));
  const waitedBefore = p.waited;
  const laid = layOut(p, wanted);
  if (!laid) throw new Error(`no way was found to lay out a line for ${wanted.join(" and ")}`);
  p = laid;
  const built = p.ticks;
  const { machines, belts } = p.size();
  const pw = power(p.w);
  if (SHOW_MAP) console.log(`\n${p.map()}\n`);
  for (let guard = 0; p.w.story === n; guard++) {
    if (guard > 4000) {
      console.log(`\n${p.map()}\n`);
      p.w.cells.forEach((b, i) => {
        if (b && (b.kind === "bench" || b.kind === "workshop" || b.kind === "mill"))
          console.log(
            `   ${b.kind} at ${i % p.w.land.w},${Math.floor(i / p.w.land.w)} facing ${b.dir}: holds ${JSON.stringify(b.buf)}, out ${b.out}, power ${p.w.power[i]}`,
          );
      });
      throw new Error(`order ${n + 1} never filled: ${JSON.stringify(p.w.filled)} of ${JSON.stringify(order.want)}`);
    }
    p.run(20);
  }
  const filled = p.ticks;
  // What this yard earns an hour left running as it is: measured over ten minutes more.
  const twin = load(save(p.w));
  if (twin) {
    const ten = forward(twin, 6000, true);
    const orders = ITEMS.reduce((sum, k) => sum + (ten.made[k] ?? 0) * ITEM[k].worth, 0) * 6;
    hourly.push({ title: order.title, depot: orders * DEPOT_SHARE, orders });
  }
  if (n === 16) late = load(save(p.w));
  stages.set(n, p.twin());
  const think = THINK.order + THINK.machine * machines;
  thought += filled - began + think;
  doneAt.push(thought);
  if ((filled - began + think) / 600 > longest.minutes)
    longest = { minutes: (filled - began + think) / 600, title: order.title };
  // Spare Coins go on plans and land, but never the Coins the next order's plot, plan and machines will take.
  const next = STORY[n + 1];
  let keep = 400;
  if (next) {
    const ahead = p.twin();
    const before = ahead.purse;
    ahead.purse = 1e9;
    for (const k of ITEMS) if ((next.want[k] ?? 0) > 0) ahead.open(k);
    keep += 1e9 - ahead.purse + (before - before);
  }
  const treats = p.treat(0.6, keep);
  const ask = wanted.map((k) => `${order.want[k]} ${ITEM[k].many}`).join(", ");
  console.log(
    `   ${pad(n + 1, 3)}${pad(order.title, 31)}${pad(ask, 26)}${lpad(machines, 5)}${lpad(belts, 5)}${lpad(`${pw.demand}/${pw.supply}`, 9)}${minutes(built - began)}m${minutes(filled - built)}m${minutes(think)}m${lpad(clock(thought), 9)}${lpad(order.pay, 7)}${lpad(Math.floor(p.purse), 7)}  ${[...bought, ...treats].join(", ")}${p.waited > waitedBefore ? ` (waited ${minutes(p.waited - waitedBefore).trim()}m for Coins)` : ""}`,
  );
}
console.log(
  `   (build: placing things, at ${HANDS.place / 10}s each. think: an allowance of ${THINK.order / 600} minutes an order and ${THINK.machine / 10}s a machine for a person working it out.)`,
);
console.log("   (This player builds only what the story asks for and never works the board: see 5 for that.)\n");

console.log("3. Pacing");
const when = (n: number): string => clock(doneAt[n - 1] ?? 0);
console.log(`   first order filled at      ${when(1)}  (hours:minutes of play, thinking included)`);
console.log(`   fifth order (engines)      ${when(5)}`);
console.log(`   tenth order (lamp oil)     ${when(10)}`);
console.log(`   the Beacon (16th)          ${when(16)}`);
console.log(`   roll call, the last        ${when(20)}`);
console.log(`   longest wait for something new: ${longest.minutes.toFixed(0)} minutes ("${longest.title}")`);
console.log(`   yard time without the thinking: ${clock(p.ticks)}, of which waiting for Coins ${clock(p.waited)}\n`);

console.log("4. What the yard earns an hour, left running on the line it built for each order");
console.log(`   ${pad("after", 33)}${lpad("depot only", 12)}${lpad("if orders wanted it all", 26)}`);
for (const h of hourly)
  console.log(`   ${pad(h.title, 33)}${lpad(h.depot.toFixed(0), 12)}${lpad(h.orders.toFixed(0), 26)}`);
console.log("");

// ---------- standing orders ----------

console.log("5. Standing orders: what the board asks for, by how far the story has come (200 orders each)");
console.log(
  `   ${pad("orders done", 13)}${lpad("pay, least", 12)}${lpad("middle", 8)}${lpad("most", 6)}   minutes for one line to fill one, on average`,
);
for (const story of [4, 8, 12, 16, 20]) {
  const w = create({ seed: 5, story });
  for (const plot of PLOTS) if (plotState(w, plot.id).state === "for sale") buyPlot(w, plot.id, Infinity);
  for (const plan of PLANS)
    if (planState(w, plan.id).state === "for sale" && plan.effect.opens) buyPlan(w, plan.id, Infinity);
  const orders = Array.from({ length: 200 }, () => fresh(w)).toSorted((a, b) => a.pay - b.pay);
  const fill = (o: (typeof orders)[number]): number =>
    Math.max(...ITEMS.map((k) => ((o.want[k] ?? 0) * (RECIPE[k]?.ticks ?? TICKS.gather)) / 600));
  const mean = orders.reduce((sum, o) => sum + fill(o), 0) / orders.length;
  console.log(
    `   ${pad(story, 13)}${lpad(orders[0]?.pay ?? 0, 12)}${lpad(orders[100]?.pay ?? 0, 8)}${lpad(orders.at(-1)?.pay ?? 0, 6)}   ${mean.toFixed(1)}`,
  );
}
console.log("\n   Tending the board: one standing order at a time, a line built for it and cleared after");
console.log(
  `   ${pad("orders done", 13)}${lpad("orders", 8)}${lpad("paid", 7)}${lpad("minutes each", 14)}${lpad("Coins an hour", 15)}   (thinking included)`,
);
for (const n of [5, 11, 19]) {
  let tender = stages.get(n)?.twin();
  if (!tender) continue;
  // The board as it would be hung at this point in the story, not as it was when it first went up.
  tender.w.board = [];
  tender.w.board = Array.from({ length: tender.w.rates.slots }, () => fresh(tender?.w ?? create()));
  const began = tender.ticks;
  let thinking = 0;
  let filled = 0;
  let paid = 0;
  for (let k = 0; k < 8; k++) {
    const order = tender.w.board[0];
    if (!order) break;
    tender.clear();
    const laid = layOut(
      tender,
      ITEMS.filter((item) => (order.want[item] ?? 0) > 0),
    );
    if (!laid) {
      // No tidy way to lay it out: a person would swap it for another, and so does this.
      tender.w.board[0] = fresh(tender.w);
      continue;
    }
    tender = laid;
    thinking += THINK.order + THINK.machine * tender.size().machines;
    // Running hands a filled order over, so it is done when another hangs in its place.
    for (let guard = 0; guard < 6000 && tender.w.board[0]?.id === order.id; guard++) tender.run(20);
    filled++;
    paid += order.pay;
    if (process.argv.includes("--board")) console.log(`      ${order.title}: pays ${order.pay}`);
  }
  const spent = tender.ticks - began + thinking;
  console.log(
    `   ${pad(n + 1, 13)}${lpad(filled, 8)}${lpad(paid, 7)}${lpad(filled ? (spent / 600 / filled).toFixed(1) : "-", 14)}${lpad(Math.round((paid / spent) * 36_000), 15)}`,
  );
}
console.log("");

// ---------- plans and plots ----------

console.log("6. Plans: what the quickening ones add to a line's pace, bought in the order they come up");
{
  // Three lines to try them on, each built alone on a late yard that has every plot and none of the quickening plans.
  const bench = new Player();
  bench.w = create({ seed: 3, story: STORY.length });
  bench.purse = 1e9;
  for (const plot of PLOTS) if (plotState(bench.w, plot.id).state === "for sale") bench.plot(plot.id);
  for (const id of ["boiler", "flywheel", "workshop", "tunnel"] as const) bench.plan(id);
  const lines = (["pot", "tool", "kit"] as const).flatMap((item) => {
    const built = layOut(bench, [item]);
    return built ? [{ item, w: built.w }] : [];
  });
  console.log(
    `   ${pad("after buying", 24)}${lpad("price", 6)}${lines.map((l) => lpad(`${ITEM[l.item].many}/min`, 15)).join("")}${lpad("pays back in", 15)}`,
  );
  const owned: PlanId[] = [];
  let before = lines.map((l) => pace(l.w, l.item, owned));
  console.log(`   ${pad("nothing", 24)}${lpad("", 6)}${before.map((n) => lpad(n.toFixed(1), 15)).join("")}`);
  for (const id of ["rakes", "tooling", "barrows", "jigs"] as const) {
    owned.push(id);
    const plan = PLANS.find((pl) => pl.id === id);
    const after = lines.map((l) => pace(l.w, l.item, owned));
    // What it is worth: the most it adds to any one line, in Coins an hour at what orders pay.
    const gain = Math.max(...lines.map((l, k) => ((after[k] ?? 0) - (before[k] ?? 0)) * 60 * ITEM[l.item].worth));
    console.log(
      `   ${pad(plan?.name ?? id, 24)}${lpad(plan?.price ?? 0, 6)}${after.map((n) => lpad(n.toFixed(1), 15)).join("")}${lpad(gain > 1 ? `${((plan?.price ?? 0) / gain).toFixed(1)} h` : "-", 15)}`,
    );
    before = after;
  }
  console.log(
    "   (pays back: its price against the most it adds to one of these lines, at what orders pay for the goods.)",
  );
  console.log("   The others change what can be built, not how fast a line runs:");
  for (const plan of PLANS) {
    if (plan.effect.gather || plan.effect.craft) continue;
    const opened = STORY.findIndex((o) => (o.opens.plans ?? []).some((id) => id === plan.id));
    console.log(`   ${pad(plan.name, 24)}${lpad(plan.price, 6)}  after order ${lpad(opened + 1, 2)}: ${plan.what}`);
  }
}
console.log("\n7. Plots, by what they hold and what the story pays for needing them");
console.log(`   ${pad("plot", 18)}${lpad("price", 7)}  ${pad("in the ground", 44)}the story needs it for`);
for (const plot of PLOTS.toSorted((a, b) => a.price - b.price)) {
  if (plot.id === "yard") continue;
  const w = create();
  const index = w.land.plots.findIndex((pl) => pl.id === plot.id);
  const lies: Partial<Record<Item, number>> = {};
  w.land.deposit.forEach((d, i) => {
    if (d && w.land.plot[i] === index) lies[d] = (lies[d] ?? 0) + 1;
  });
  let bank = 0;
  for (let i = 0; i < w.land.water.length; i++)
    if (
      w.land.plot[i] === index &&
      !w.land.water[i] &&
      DIRS.some((d) => w.land.water[at(w, (i % w.land.w) + DX[d], Math.floor(i / w.land.w) + DY[d])] === 1)
    )
      bank++;
  const ground = [
    ...ITEMS.filter((k) => lies[k]).map((k) => `${lies[k]} ${k}`),
    ...(bank ? [`${bank} tiles of bank`] : []),
  ].join(", ");
  // The orders that ask for something no cheaper plot has in the ground.
  const elsewhere = new Set<Item>();
  w.land.deposit.forEach((d, i) => {
    const other = w.land.plots[w.land.plot[i] ?? -1];
    if (d && other && other.id !== plot.id && other.price < plot.price) elsewhere.add(d);
  });
  const only = new Set(ITEMS.filter((k) => lies[k] && !elsewhere.has(k)));
  const needs = STORY.filter((o) =>
    ITEMS.some((k) => (o.want[k] ?? 0) > 0 && partsOf(k).some((part) => only.has(part))),
  );
  const pays = needs.reduce((sum, o) => sum + o.pay, 0);
  console.log(
    `   ${pad(plot.name, 18)}${lpad(plot.price, 7)}  ${pad(ground, 44)}${needs.length ? `${needs.length} orders paying ${pays} (${(pays / plot.price).toFixed(1)}x its price)` : "nothing: room, and more of what the yard has"}`,
  );
}

// ---------- away ----------

console.log("\n8. Catching up after eight hours away, on the biggest yard the script built");
if (late) {
  const quick = load(save(late));
  const exact = load(save(late));
  if (quick && exact) {
    let started = performance.now();
    const a = forward(quick, 288_000);
    const quickMs = performance.now() - started;
    started = performance.now();
    const b = forward(exact, 288_000, true);
    const exactMs = performance.now() - started;
    const size = late.cells.filter((c) => c).length;
    console.log(
      `   ${size} things built. The quick way ran ${a.run} ticks in ${quickMs.toFixed(1)} ms; every tick, ${exactMs.toFixed(0)} ms.`,
    );
    console.log(
      `   Coins: quick ${a.coins}, every tick ${b.coins}. Things taken in: quick ${ITEMS.reduce((s, k) => s + (a.made[k] ?? 0), 0)}, every tick ${ITEMS.reduce((s, k) => s + (b.made[k] ?? 0), 0)}.`,
    );
  }
}
