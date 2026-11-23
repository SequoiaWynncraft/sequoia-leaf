/**
 * The story played by script, as today's `apps/works/review/balance.ts` plays it: for each order,
 * clear the last order's line, buy the plot or plan the order cannot be made without, build one
 * line for each thing asked for (a gatherer and a machine at every step, belts found by the
 * router, pylons and boilers as needed), and run the yard until the order is filled, handing over
 * standing orders that fill on the way. Each layout is tried first on a copy of today's yard; the
 * commands of the one that works are then given to the pair, which compares after each.
 */
import * as Y from "@sequoia-leaf/yard";

import type { Pair } from "./sides.ts";

type Rec = Record<string, unknown>;
type Cell = readonly [number, number];
interface Shape {
  readonly reach: number;
  readonly room: number;
  readonly flip: boolean;
}
/** Ticks of a person's time allowed for each thing placed, each run of belt and each purchase. */
const HANDS = { place: 15, run: 30, buy: 100 } as const;

/** Where commands go: a copy being tried, which keeps what it was given, or the pair itself. */
abstract class Hands {
  abstract readonly w: Y.World;
  abstract give(c: Rec): boolean;
  abstract run(ticks: number): void;
}
class Twin extends Hands {
  readonly w: Y.World;
  readonly log: { c: Rec; tick: number }[] = [];
  constructor(w: Y.World) {
    super();
    const twin = Y.load(Y.save(w));
    if (!twin) throw new Error("the yard would not copy");
    this.w = twin;
  }
  give(c: Rec): boolean {
    const wire = { ...c, tick: this.w.tick };
    this.log.push({ c: wire, tick: this.w.tick });
    const read = Y.readCommand(wire);
    return read !== null && !("refused" in Y.play(this.w, read));
  }
  run(ticks: number): void {
    for (let k = 0; k < ticks; k++) Y.step(this.w);
  }
}
class Both extends Hands {
  readonly pair: Pair;
  constructor(pair: Pair) {
    super();
    this.pair = pair;
  }
  get w(): Y.World {
    return this.pair.yard;
  }
  give(c: Rec): boolean {
    const a = this.pair.do({ ...c, tick: this.w.tick }, "story");
    this.pair.same(`story, after ${String(c.do)}`);
    return a !== null && typeof a === "object" && !("refused" in a);
  }
  run(ticks: number): void {
    this.pair.run(ticks, 100, "story");
  }
}

/** Somebody playing the story with their hands on a yard. */
class Player {
  readonly h: Hands;
  constructor(h: Hands) {
    this.h = h;
  }
  get w(): Y.World {
    return this.h.w;
  }

  free(x: number, y: number): boolean {
    const i = Y.at(this.w, x, y);
    return i >= 0 && !this.w.cells[i] && Y.refusal(this.w, "belt", x, y, Infinity) === null;
  }
  plain(x: number, y: number): boolean {
    return this.free(x, y) && !this.w.land.deposit[Y.at(this.w, x, y)];
  }
  put(kind: Y.Kind, x: number, y: number, dir: Y.Dir): void {
    if (!this.h.give({ do: "build", kind, x, y, dir })) throw new Error(`a ${kind} at ${x},${y}`);
    this.h.run(HANDS.place);
  }
  near(point: Cell): Cell[] {
    const all: Cell[] = [];
    for (let y = 0; y < this.w.land.h; y++) for (let x = 0; x < this.w.land.w; x++) all.push([x, y]);
    return all.toSorted(
      (a, b) => Math.hypot(a[0] - point[0], a[1] - point[1]) - Math.hypot(b[0] - point[0], b[1] - point[1]),
    );
  }
  beside(x: number, y: number, toward: Cell, plain = false): Cell[] {
    return Y.DIRS.map((d): Cell => [x + Y.DX[d], y + Y.DY[d]])
      .filter(([nx, ny]) => (plain ? this.plain(nx, ny) : this.free(nx, ny)))
      .toSorted(
        (a, b) => Math.hypot(a[0] - toward[0], a[1] - toward[1]) - Math.hypot(b[0] - toward[0], b[1] - toward[1]),
      );
  }
  deposit(raw: Y.Item, toward: Cell): Cell | null {
    return (
      this.near(toward).find(
        ([x, y]) =>
          this.w.land.deposit[Y.at(this.w, x, y)] === raw &&
          this.free(x, y) &&
          this.beside(x, y, toward, true).length > 0,
      ) ?? null
    );
  }
  lies(item: Y.Item, from: Cell): Cell {
    const spots = [...new Set(Y.partsOf(item).filter((k) => !Y.RECIPE[k]))].flatMap((raw) => {
      const tile = this.deposit(raw, from);
      return tile ? [tile] : [];
    });
    if (spots.length === 0) return from;
    return [spots.reduce((s, c) => s + c[0], 0) / spots.length, spots.reduce((s, c) => s + c[1], 0) / spots.length];
  }
  /** Stands pylons toward a tile until power reaches it. */
  light(x: number, y: number): void {
    const w = this.w;
    const [cx, cy] = w.land.depot;
    for (let tries = 0; tries < 12 && (w.power ?? Y.repower(w))[Y.at(w, x, y)] !== 1; tries++) {
      const link = Y.REACH.link * w.rates.reach;
      const live: Cell[] = [[cx, cy]];
      const lit = w.power ?? Y.repower(w);
      w.cells.forEach((b, i) => {
        if (b?.kind === "pylon" && lit[i] === 1) live.push([i % w.land.w, Math.floor(i / w.land.w)]);
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
  haul(from: Cell, to: Cell): void {
    const legs = Y.route(this.w, from, to);
    if (!legs || !this.h.give({ do: "lay", legs }))
      throw new Error(`no way for a belt from ${from.join(",")} to ${to.join(",")}`);
    this.h.run(HANDS.run + legs.length * 2);
  }
  straight(from: Cell, into: Cell): Y.Dir | null {
    const depot = this.w.cells[Y.at(this.w, into[0], into[1])]?.kind === "depot";
    for (const d of Y.DIRS) {
      const [x, y] = [from[0] + Y.DX[d], from[1] + Y.DY[d]];
      if (depot ? this.w.cells[Y.at(this.w, x, y)]?.kind === "depot" : x === into[0] && y === into[1]) return d;
    }
    return null;
  }

  /** One line that makes a thing and carries it to whatever wants it: the depot, or the machine it is a part for. */
  make(item: Y.Item, toward: Cell, into: Cell, shape: Shape): void {
    const r = Y.RECIPE[item];
    const way = (from: Cell, to: Cell): Y.Dir => (to[0] > from[0] ? 0 : to[0] < from[0] ? 2 : to[1] > from[1] ? 1 : 3);
    if (!r || r.by === "mill") {
      const raw = r?.from[0] ?? item;
      const tile = this.deposit(raw, toward);
      const spot = tile ? this.beside(tile[0], tile[1], into, true)[0] : undefined;
      if (!tile || !spot) throw new Error(`nowhere left to gather ${raw}`);
      this.put("gatherer", tile[0], tile[1], way(tile, spot));
      this.light(tile[0], tile[1]);
      if (!r) return this.haul(spot, into);
      const direct = this.straight(spot, into);
      const out = this.beside(spot[0], spot[1], into)[0];
      if (direct === null && !out) throw new Error(`a mill for ${item} has no way out`);
      this.put("mill", spot[0], spot[1], direct ?? (out ? way(spot, out) : 0));
      this.light(spot[0], spot[1]);
      if (direct === null && out) this.haul(out, into);
      return;
    }
    const roomy = (x: number, y: number): boolean => {
      for (let dy = -shape.room; dy <= shape.room; dy++)
        for (let dx = -shape.room; dx <= shape.room; dx++) if (!this.free(x + dx, y + dy)) return false;
      return this.plain(x, y);
    };
    const [dx0, dy0] = this.w.land.depot;
    const spot = this.near(toward).find(([x, y]) => roomy(x, y) && Math.hypot(x - dx0, y - dy0) > 3.5);
    const out = spot ? this.beside(spot[0], spot[1], into)[0] : undefined;
    if (!spot || !out) throw new Error(`nowhere to stand a ${r.by} for ${item}`);
    this.put(r.by, spot[0], spot[1], way(spot, out));
    this.light(spot[0], spot[1]);
    this.haul(out, into);
    // A short belt is run out from each of its other sides first, so no line coming in can wall a side off.
    const stubs: Cell[][] = [];
    for (const d of Y.DIRS) {
      const stub: Cell[] = [];
      for (let k = 1; k <= shape.reach && this.free(spot[0] + Y.DX[d] * k, spot[1] + Y.DY[d] * k); k++) {
        const cell: Cell = [spot[0] + Y.DX[d] * k, spot[1] + Y.DY[d] * k];
        this.put("belt", cell[0], cell[1], way(cell, spot));
        stub.push(cell);
      }
      if (stub.length > 0) stubs.push(stub);
    }
    for (const part of shape.flip ? r.from.toReversed() : r.from) {
      const lies = this.lies(part, spot);
      const far = (stub: Cell[]): number =>
        Math.hypot((stub.at(-1)?.[0] ?? 0) - lies[0], (stub.at(-1)?.[1] ?? 0) - lies[1]);
      const stub = stubs.toSorted((a, c) => far(a) - far(c))[0];
      const tail = stub?.at(-1);
      if (!stub || !tail) throw new Error(`a ${r.by} for ${item} has no side left for ${part}`);
      stubs.splice(stubs.indexOf(stub), 1);
      this.make(part, [(tail[0] + lies[0]) / 2, (tail[1] + lies[1]) / 2], tail, shape);
    }
    for (const stub of stubs) for (const [x, y] of stub) this.h.give({ do: "remove", x, y });
  }

  /** Stands waterwheels and boilers until there is power for everything drawn. */
  fuel(): void {
    const w = this.w;
    for (let tries = 0; tries < 16; tries++) {
      const p = Y.power(w);
      const boilers = w.cells.filter((b) => b?.kind === "boiler");
      const short = p.demand - (p.supply - boilers.filter((b) => (b?.fuel ?? 0) > 0).length * 30 + boilers.length * 30);
      if (short <= 0) return;
      const bank = w.open.kinds.has("wheel")
        ? this.near(w.land.depot).find(([x, y]) => this.plain(x, y) && Y.besideWater(w.land, x, y))
        : undefined;
      const tile = w.open.kinds.has("boiler")
        ? this.near(w.land.depot).find(
            ([x, y]) =>
              w.land.deposit[Y.at(w, x, y)] === "deadfall" &&
              this.free(x, y) &&
              this.beside(x, y, w.land.depot, true).length > 0,
          )
        : undefined;
      const spot = tile ? this.beside(tile[0], tile[1], w.land.depot, true)[0] : undefined;
      if (bank && (short <= 20 || !tile || !spot)) {
        this.put("wheel", bank[0], bank[1], 0);
        this.light(bank[0], bank[1]);
      } else if (tile && spot) {
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

  /** Takes the last order's line away, keeping what carries and makes power. */
  clear(): void {
    const w = this.w;
    const tiles: number[] = [];
    w.cells.forEach((b, i) => {
      if (!b || b.kind === "depot" || b.kind === "pylon" || b.kind === "boiler" || b.kind === "wheel") return;
      const ahead = Y.at(w, (i % w.land.w) + Y.DX[b.dir], Math.floor(i / w.land.w) + Y.DY[b.dir]);
      if (b.kind === "gatherer" && w.cells[ahead]?.kind === "boiler") return;
      tiles.push(i);
    });
    if (tiles.length > 0) this.h.give({ do: "clear", tiles });
  }

  /** Buys the cheapest plots and plans without which a thing cannot be made at all. */
  open(item: Y.Item): void {
    for (let tries = 0; !Y.makeable(this.w).includes(item) && tries < 8; tries++) {
      const helps = <T extends string>(ids: readonly T[], buy: (w: Y.World, id: T) => Y.Spent): T | undefined =>
        ids.find((id) => {
          const twin = Y.load(Y.save(this.w));
          return twin !== null && buy(twin, id).ok && Y.makeable(twin).length > Y.makeable(this.w).length;
        });
      const plot = helps(
        Y.PLOTS.toSorted((a, b) => a.price - b.price).map((p) => p.id),
        (w, id) => Y.buyPlot(w, id, Infinity),
      );
      const plan = helps(
        Y.PLANS.toSorted((a, b) => a.price - b.price).map((p) => p.id),
        (w, id) => Y.buyPlan(w, id, Infinity),
      );
      const plotPrice = Y.PLOTS.find((p) => p.id === plot)?.price ?? Infinity;
      const planPrice = Y.PLANS.find((p) => p.id === plan)?.price ?? Infinity;
      if (plot && plotPrice <= planPrice) this.h.give({ do: "buyPlot", plot });
      else if (plan) this.h.give({ do: "buyPlan", plan });
      else throw new Error(`nothing for sale would let the yard make ${item}`);
      this.h.run(HANDS.buy);
    }
  }
}

/** Builds a line for each thing wanted, tried on copies until one layout works; its commands, or null. */
function layOut(w: Y.World, wanted: readonly Y.Item[]): { c: Rec; tick: number }[] | null {
  const depot = w.land.depot;
  for (const room of [1, 2])
    for (const reach of [3, 1, 2])
      for (const flip of [false, true])
        for (const t of [0.35, 0.5, 0.65, 0.8])
          for (const spread of [0, 3, -3]) {
            const twin = new Twin(w);
            const p = new Player(twin);
            try {
              wanted.forEach((item, k) => {
                const lies = p.lies(item, depot);
                const side = k === 0 ? spread : -spread;
                p.make(
                  item,
                  [depot[0] + (lies[0] - depot[0]) * t + side, depot[1] + (lies[1] - depot[1]) * t - side],
                  depot,
                  {
                    reach,
                    room,
                    flip,
                  },
                );
              });
              p.fuel();
              return twin.log;
            } catch {
              // That layout does not fit: try the next.
            }
          }
  return null;
}

/** Plays the story on a pair from where it stands through `orders` story orders, comparing all the way. */
export function playStory(pair: Pair, orders: number): void {
  const both = new Both(pair);
  const p = new Player(both);
  for (let n = pair.yard.story; n < orders; n++) {
    const order = Y.STORY[n];
    if (!order) return;
    const wanted = Y.ITEMS.filter((k) => (order.want[k] ?? 0) > 0);
    p.clear();
    for (const item of wanted) p.open(item);
    const log = layOut(pair.yard, wanted);
    if (!log) throw new Error(`no layout for order ${n + 1}`);
    for (const { c, tick } of log) {
      both.run(Math.max(0, tick - pair.yard.tick));
      both.give(c);
    }
    for (let guard = 0; pair.yard.story === n; guard++) {
      if (guard > 3000) throw new Error(`order ${n + 1} never filled`);
      both.run(100);
      if (guard % 6 === 5) both.give({ do: "collect" });
      for (const o of pair.yard.board) if (Y.isFilled(o.want, o.filled)) both.give({ do: "handOver", order: o.id });
    }
  }
}
