/**
 * Moving the yard on by one tick. Ten ticks are a second.
 *
 * A tick has three parts. First power: what the depot, the waterwheels and the burning boilers give
 * is set against what the machines in reach draw, and if there is not enough to go round every
 * machine works slower by the same share. Then work: gatherers gather, machines make, and things on
 * belts move along their tile. Then every tile hands on what it has finished with, each tile after
 * the one it hands to, so a full belt moves as one.
 *
 * The order of handing on, and who hands to whom, depend only on what stands where, so they are
 * worked out once (`rewire`) and kept until the yard is changed.
 */
import type { Item } from "./content/items.ts";
import { ITEMS } from "./content/items.ts";
import { BUFFER, FUEL, KIND, TICKS } from "./content/machines.ts";
import { MADE_BY, MILLED, RECIPE, type Recipe } from "./content/recipes.ts";
import { BACK, DX, DY, LEFT, RIGHT } from "./grid.ts";
import { besideWater } from "./land.ts";
import { deliver } from "./orders.ts";
import { type Building, put, take, type Wire, type World } from "./world.ts";

/** Works out the yard's plumbing from what stands where. */
export function rewire(w: World): Wire {
  const { land, cells } = w;
  const n = cells.length;
  const next = new Int32Array(n).fill(-1);
  const back = new Int32Array(n).fill(-1);
  const ways = new Int32Array(n * 3).fill(-1);
  const carry: number[] = [];
  const work: number[] = [];
  const boilers: number[] = [];
  let steady = w.rates.depot;
  let demand = 0;
  const cell = (x: number, y: number): number => (x < 0 || y < 0 || x >= land.w || y >= land.h ? -1 : y * land.w + x);
  cells.forEach((b, i) => {
    if (!b) return;
    const x = i % land.w;
    const y = (i - x) / land.w;
    const ahead = cell(x + DX[b.dir], y + DY[b.dir]);
    const behind = cell(x + DX[BACK[b.dir]], y + DY[BACK[b.dir]]);
    const left = cell(x + DX[LEFT[b.dir]], y + DY[LEFT[b.dir]]);
    const right = cell(x + DX[RIGHT[b.dir]], y + DY[RIGHT[b.dir]]);
    back[i] = behind;
    switch (b.kind) {
      case "belt":
        next[i] = ahead;
        carry.push(i);
        break;
      case "splitter":
        // A shut way leads nowhere: nothing is sent there, drawn as going there, or looked for there.
        ways.set(
          [ahead, left, right].map((to, k) => ((b.shut >> k) & 1 ? -1 : to)),
          i * 3,
        );
        carry.push(i);
        break;
      case "joiner":
        next[i] = ahead;
        ways.set([behind, left, right], i * 3);
        carry.push(i);
        break;
      case "tunnel":
        // The way-in mouth hands to the way-out mouth, under whatever lies between.
        next[i] = b.span > 0 ? cell(x + DX[b.dir] * (b.span + 1), y + DY[b.dir] * (b.span + 1)) : ahead;
        carry.push(i);
        break;
      case "gatherer":
      case "mill":
      case "bench":
      case "workshop":
        next[i] = ahead;
        if (w.power[i] === 1) {
          work.push(i);
          demand += KIND[b.kind].draw;
        }
        break;
      case "crate":
        next[i] = ahead;
        break;
      case "wheel":
        if (w.power[i] === 1 && besideWater(land, x, y)) steady += KIND.wheel.gives;
        break;
      case "boiler":
        if (w.power[i] === 1) boilers.push(i);
        break;
      case "pylon":
      case "depot":
        break;
    }
  });
  // Each tile after the tiles it hands to.
  const seen = new Uint8Array(n);
  const order: number[] = [];
  const visit = (i: number): void => {
    if (i < 0 || seen[i] === 1) return;
    seen[i] = 1;
    const b = cells[i];
    if (!b) return;
    switch (b.kind) {
      case "splitter":
        for (let k = 0; k < 3; k++) visit(ways[i * 3 + k] ?? -1);
        order.push(i);
        break;
      case "belt":
      case "joiner":
      case "tunnel":
      case "gatherer":
      case "mill":
      case "bench":
      case "workshop":
      case "crate":
        visit(next[i] ?? -1);
        order.push(i);
        break;
      case "pylon":
      case "wheel":
      case "boiler":
      case "depot":
        break;
    }
  };
  for (let i = 0; i < n; i++) visit(i);
  const wire: Wire = { order, carry, work, boilers, next, back, ways, steady, demand };
  w.wire = wire;
  w.demand = demand;
  w.supply = steady + boilers.filter((i) => (cells[i]?.fuel ?? 0) > 0).length * KIND.boiler.gives;
  return wire;
}

/** The power there is, the power drawn, and the share of its plain pace every machine works at. */
export function power(w: World): { supply: number; demand: number; pace: number } {
  if (!w.wire) rewire(w);
  return { supply: w.supply, demand: w.demand, pace: w.demand > w.supply ? w.supply / w.demand : 1 };
}

/** Whether the tile at `i` has something finished that it means to hand to the tile at `to`. */
function ready(w: World, wire: Wire, i: number, to: number): boolean {
  const b = i < 0 ? null : w.cells[i];
  if (!b) return false;
  switch (b.kind) {
    case "belt":
    case "joiner":
    case "tunnel":
      return wire.next[i] === to && b.item !== null && b.prog >= 1;
    case "splitter":
      return (
        b.item !== null &&
        b.prog >= 1 &&
        (wire.ways[i * 3] === to || wire.ways[i * 3 + 1] === to || wire.ways[i * 3 + 2] === to)
      );
    case "gatherer":
    case "mill":
    case "bench":
    case "workshop":
    case "crate":
      return wire.next[i] === to && b.out !== null;
    case "pylon":
    case "wheel":
    case "boiler":
    case "depot":
      return false;
  }
}

/**
 * Whether the tile at `to` is one that takes things from the tile at `from` at all, whatever it
 * holds just now. A splitter passes a way by when this says no, and the picture leaves that way out.
 */
export function takes(w: World, wire: Wire, to: number, from: number): boolean {
  const b = to < 0 ? null : w.cells[to];
  if (!b) return false;
  switch (b.kind) {
    case "belt":
    case "crate":
      // Not from the tile it is itself sending to: two belts facing each other pass nothing.
      return wire.next[to] !== from;
    case "splitter":
      return wire.back[to] === from;
    case "tunnel":
      return b.span > 0 && wire.back[to] === from;
    case "joiner":
      return wire.ways[to * 3] === from || wire.ways[to * 3 + 1] === from || wire.ways[to * 3 + 2] === from;
    case "depot":
    case "mill":
    case "bench":
    case "workshop":
    case "boiler":
      return true;
    case "gatherer":
    case "pylon":
    case "wheel":
      return false;
  }
}

/** Whether the tile at `to` will take `item` handed to it from the tile at `from`. */
function accepts(w: World, wire: Wire, to: number, item: Item, from: number): boolean {
  const b = to < 0 ? null : w.cells[to];
  if (!b || !takes(w, wire, to, from)) return false;
  switch (b.kind) {
    case "depot":
      return true;
    case "belt":
    case "splitter":
    case "tunnel":
      return b.item === null;
    case "joiner": {
      if (b.item !== null) return false;
      const side = [0, 1, 2].find((k) => wire.ways[to * 3 + k] === from);
      // It waits for whoever's turn it is, so long as they have something to give.
      for (let k = b.turn; k !== side; k = (k + 1) % 3)
        if (ready(w, wire, wire.ways[to * 3 + k] ?? -1, to)) return false;
      return true;
    }
    case "mill": {
      const r = MILLED[item];
      if (!r || (b.recipe !== null && b.recipe !== r.out)) return false;
      const have = b.buf[item] ?? 0;
      return have < BUFFER && (b.kinds === 0 || have > 0);
    }
    case "bench":
    case "workshop": {
      if ((b.buf[item] ?? 0) >= BUFFER) return false;
      // It takes a thing if some one recipe uses it together with everything already held.
      for (const r of MADE_BY[b.kind]) {
        if ((b.recipe !== null && r.out !== b.recipe) || !r.from.includes(item)) continue;
        let held = 0;
        for (const k of r.from) if ((b.buf[k] ?? 0) > 0) held++;
        if (held === b.kinds) return true;
      }
      return false;
    }
    case "crate":
      return b.count + (b.out === null ? 0 : 1) < w.rates.crate;
    case "boiler":
      return item === "deadfall" && (b.buf.deadfall ?? 0) < FUEL;
    case "gatherer":
    case "pylon":
    case "wheel":
      return false;
  }
}

/** Hands `item` to the tile at `to`. `over` is how far past the edge of its last tile it had already come. */
function give(w: World, wire: Wire, to: number, item: Item, from: number, over: number): void {
  const b = w.cells[to];
  if (!b) return;
  switch (b.kind) {
    case "depot":
      deliver(w, item, 1);
      break;
    case "joiner":
      b.turn = ([0, 1, 2].find((k) => wire.ways[to * 3 + k] === from) ?? 0) + 1;
      if (b.turn > 2) b.turn = 0;
      b.item = item;
      b.prog = over;
      b.via = from;
      break;
    case "belt":
    case "splitter":
    case "tunnel":
      b.item = item;
      b.prog = over;
      b.via = from;
      break;
    case "mill":
    case "bench":
    case "workshop":
    case "crate":
    case "boiler":
      put(b, item);
      break;
    case "gatherer":
    case "pylon":
    case "wheel":
      break;
  }
}

/** The recipe a machine can start on with what it holds, if any. */
function choose(b: Building, recipes: readonly Recipe[]): Recipe | null {
  for (const r of recipes) {
    if (b.recipe !== null && r.out !== b.recipe) continue;
    if (r.from.every((k) => (b.buf[k] ?? 0) > 0)) return r;
  }
  return null;
}

/** Moves what is under a tunnel along, and brings it up at the far mouth. */
function passUnder(w: World, wire: Wire, b: Building, i: number): void {
  const last = b.span - 1;
  const mouth = w.cells[wire.next[i] ?? -1];
  for (let k = last; k >= 0; k--) {
    const item = b.under[k] ?? null;
    const over = (b.underProg[k] ?? 0) - 1;
    if (item === null || over < 0) continue;
    if (k === last) {
      if (!mouth || mouth.item !== null) continue;
      mouth.item = item;
      mouth.prog = over;
      mouth.via = -1;
    } else {
      if ((b.under[k + 1] ?? null) !== null) continue;
      b.under[k + 1] = item;
      b.underProg[k + 1] = over;
    }
    b.under[k] = null;
    b.underProg[k] = 0;
  }
  if (b.item !== null && b.prog >= 1 && (b.under[0] ?? null) === null) {
    b.under[0] = b.item;
    b.underProg[0] = b.prog - 1;
    b.item = null;
    b.prog = 0;
    b.via = -1;
  }
}

/** Moves the whole yard on by one tick. */
export function step(w: World): void {
  const wire = w.wire ?? rewire(w);
  const { cells, land } = w;
  w.tick++;
  if (w.pace.warm > 0) w.pace.warm--;
  else if (++w.pace.ticks >= PACE_WINDOW) {
    // Old ticks count for less and less, so the pace follows the yard as it is now.
    w.pace.ticks /= 2;
    for (const item of ITEMS) {
      const n = w.pace.made[item];
      if (n !== undefined) w.pace.made[item] = n / 2;
    }
  }

  // Power: boilers burn what they hold, and what there is is set against what is drawn.
  let supply = wire.steady;
  for (const i of wire.boilers) {
    const b = cells[i];
    if (!b) continue;
    if (b.fuel <= 0 && (b.buf.deadfall ?? 0) > 0) {
      take(b, "deadfall");
      b.fuel = TICKS.burn;
    }
    if (b.fuel > 0) {
      b.fuel--;
      supply += KIND.boiler.gives;
    }
  }
  w.supply = supply;
  const share = wire.demand > supply ? supply / wire.demand : 1;

  // Work: things on belts move along, gatherers gather, machines make.
  const along = w.rates.belt / TICKS.belt;
  for (const i of wire.carry) {
    const b = cells[i];
    if (!b) continue;
    if (b.item !== null && b.prog < 1) b.prog += along;
    for (let k = 0; k < b.span; k++)
      if ((b.under[k] ?? null) !== null && (b.underProg[k] ?? 0) < 1) b.underProg[k] = (b.underProg[k] ?? 0) + along;
  }
  const gather = w.rates.gather * share;
  const craft = w.rates.craft * share;
  for (const i of wire.work) {
    const b = cells[i];
    if (!b || b.out !== null) continue;
    if (b.kind === "gatherer") {
      b.work += gather;
      if (b.work >= TICKS.gather) {
        b.work -= TICKS.gather;
        b.out = land.deposit[i] ?? null;
      }
      continue;
    }
    if (b.kind !== "mill" && b.kind !== "bench" && b.kind !== "workshop") continue;
    if (b.making === null) {
      if (b.idle) continue;
      const found = choose(b, MADE_BY[b.kind]);
      if (!found) {
        b.idle = true;
        continue;
      }
      b.making = found.out;
    }
    const r = RECIPE[b.making];
    if (!r) continue;
    b.work += craft;
    if (b.work >= r.ticks) {
      b.work -= r.ticks;
      for (const k of r.from) take(b, k);
      b.out = r.out;
      b.making = null;
    }
  }

  // Then hand things on.
  for (const i of wire.order) {
    const b = cells[i];
    if (!b) continue;
    switch (b.kind) {
      case "tunnel":
        if (b.span > 0) passUnder(w, wire, b, i);
        else carryOn(w, wire, b, i);
        break;
      case "belt":
      case "joiner":
        carryOn(w, wire, b, i);
        break;
      case "splitter": {
        if (b.item === null || b.prog < 1) break;
        // Ahead, then left, then right, starting from the way after the one it last sent something.
        for (let k = 0; k < 3; k++) {
          const way = (k + b.turn) % 3;
          const to = wire.ways[i * 3 + way] ?? -1;
          if (!accepts(w, wire, to, b.item, i)) continue;
          give(w, wire, to, b.item, i, b.prog - 1);
          b.item = null;
          b.prog = 0;
          b.via = -1;
          b.turn = (way + 1) % 3;
          break;
        }
        break;
      }
      case "crate":
        if (!b.open) break;
        if (b.out === null && b.count > 0) {
          // It lets out whatever it holds most of.
          let most: Item | null = null;
          for (const item of ITEMS) if ((b.buf[item] ?? 0) > (most === null ? 0 : (b.buf[most] ?? 0))) most = item;
          if (most !== null) {
            take(b, most);
            b.out = most;
          }
        }
        sendOut(w, wire, b, i);
        break;
      case "gatherer":
      case "mill":
      case "bench":
      case "workshop":
        sendOut(w, wire, b, i);
        break;
      case "pylon":
      case "wheel":
      case "boiler":
      case "depot":
        break;
    }
  }
}

/** A belt, joiner or tunnel's far mouth hands on the thing it carries once it has crossed the tile. */
function carryOn(w: World, wire: Wire, b: Building, i: number): void {
  const to = wire.next[i] ?? -1;
  if (b.item === null || b.prog < 1 || !accepts(w, wire, to, b.item, i)) return;
  give(w, wire, to, b.item, i, b.prog - 1);
  b.item = null;
  b.prog = 0;
  b.via = -1;
}

/** A machine or crate hands on its finished piece. */
function sendOut(w: World, wire: Wire, b: Building, i: number): void {
  const to = wire.next[i] ?? -1;
  if (b.out === null || !accepts(w, wire, to, b.out, i)) return;
  give(w, wire, to, b.out, i, 0);
  b.out = null;
}

/** How many ticks the pace is measured over before old ticks start to count for less: an hour. */
export const PACE_WINDOW = 36_000;
