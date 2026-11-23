/**
 * Moving the yard on by one tick. Ten ticks are a second.
 *
 * A tick has three parts, as today's yard has. Power: boilers burn, and what there is is set against
 * what is drawn; when it falls short every machine works slower by the same share. Work: things on
 * belts move along their tile, gatherers gather, machines make. Handing on: every tile hands on what
 * it has finished with, each after the tile it hands to (`wire.ts`), so a full belt moves as one.
 *
 * This is the hot path: it loops over the plumbing's lists, which hold only tiles where something
 * stands, and makes no arrays, objects, closures or strings (but for the rare order filled).
 */
import { BUFFER, FUEL, SPAN, TICKS } from "./content/machines.ts";
import { deliver } from "./orders.ts";
import {
  BELT,
  BENCH,
  BOILER,
  CRATE,
  DEADFALL,
  DEPOT,
  GATHERER,
  GIVES,
  ITEM_COUNT,
  JOINER,
  MADE_BY,
  MILL,
  MILLED,
  NONE,
  RECIPE,
  type Recipe,
  SPLITTER,
  TUNNEL,
  WORKSHOP,
} from "./tables.ts";
import { ahead, farMouth, nextOf, rewire, wayIn, wayOut } from "./wire.ts";
import { type Holders, put, take, type Yard } from "./yard.ts";

/** How many ticks the pace is measured over before old ticks start to count for less: an hour. */
export const PACE_WINDOW = 36_000;
const BURNS = GIVES[BOILER] ?? 0;
const NO_RECIPES: readonly Recipe[] = [];

/** Moves the whole yard on by one tick. */
export function step(y: Yard): void {
  const wire = y.wire ?? rewire(y);
  const { kind, row, item, prog, span } = y;
  const h = y.holders;
  y.tick++;
  const pace = y.pace;
  if (pace.warm > 0) pace.warm--;
  else if (++pace.ticks >= PACE_WINDOW) {
    // Old ticks count for less and less, so the pace follows the yard as it is now.
    pace.ticks /= 2;
    for (let k = 0; k < ITEM_COUNT; k++) pace.made[k] = (pace.made[k] ?? 0) / 2;
  }

  // Power: boilers burn what they hold, and what there is is set against what is drawn.
  let supply = wire.steady;
  const boilers = wire.boilers;
  for (let b = 0; b < boilers.length; b++) {
    const r = row[boilers[b] ?? 0] ?? 0;
    if ((h.fuel[r] ?? 0) <= 0 && (h.stock[r * ITEM_COUNT + DEADFALL] ?? 0) > 0) {
      take(h, r, DEADFALL);
      h.fuel[r] = TICKS.burn;
    }
    if ((h.fuel[r] ?? 0) > 0) {
      h.fuel[r] = (h.fuel[r] ?? 1) - 1;
      supply += BURNS;
    }
  }
  y.supply = supply;
  const share = wire.demand > supply ? supply / wire.demand : 1;

  // Work: things on belts move along (in eighths of a tile), gatherers gather, machines make.
  const along = (y.rates.belt * 8) / TICKS.belt;
  const carry = wire.carry;
  const under = y.tunnels.under;
  const below = y.tunnels.along;
  for (let c = 0; c < carry.length; c++) {
    const i = carry[c] ?? 0;
    if (item[i] !== NONE && (prog[i] ?? 0) < 8) prog[i] = (prog[i] ?? 0) + along;
    const s = span[i] ?? 0;
    if (s <= 0) continue;
    const at = (row[i] ?? 0) * SPAN;
    for (let k = at; k < at + s; k++) if (under[k] !== NONE && (below[k] ?? 0) < 8) below[k] = (below[k] ?? 0) + along;
  }
  const gather = y.rates.gather * share;
  const craft = y.rates.craft * share;
  const work = wire.work;
  for (let c = 0; c < work.length; c++) {
    const i = work[c] ?? 0;
    const r = row[i] ?? 0;
    if (h.out[r] !== NONE) continue;
    if (kind[i] === GATHERER) {
      h.work[r] = (h.work[r] ?? 0) + gather;
      if ((h.work[r] ?? 0) >= TICKS.gather) {
        h.work[r] = (h.work[r] ?? 0) - TICKS.gather;
        h.out[r] = y.land.deposit[i] ?? NONE;
      }
      continue;
    }
    if (h.making[r] === NONE) {
      if (h.idle[r] === 1) continue;
      const found = choose(h, r, kind[i] ?? NONE);
      if (found === NONE) {
        h.idle[r] = 1;
        continue;
      }
      h.making[r] = found;
    }
    const recipe = RECIPE[h.making[r] ?? NONE];
    if (!recipe) continue;
    h.work[r] = (h.work[r] ?? 0) + craft;
    if ((h.work[r] ?? 0) >= recipe.ticks) {
      h.work[r] = (h.work[r] ?? 0) - recipe.ticks;
      for (let p = 0; p < recipe.from.length; p++) take(h, r, recipe.from[p] ?? NONE);
      h.out[r] = recipe.out;
      h.making[r] = NONE;
    }
  }

  // Then hand things on.
  const order = wire.order;
  const taken = wire.taken;
  for (let o = 0; o < order.length; o++) {
    const i = order[o] ?? 0;
    const k = kind[i];
    if (k === TUNNEL) {
      if ((span[i] ?? 0) > 0) passUnder(y, i);
      else carryOn(y, i, taken);
    } else if (k === BELT || k === JOINER) carryOn(y, i, taken);
    else if (k === SPLITTER) split(y, i, taken);
    else {
      const r = row[i] ?? 0;
      if (k === CRATE) {
        if (h.open[r] === 0) continue;
        if (h.out[r] === NONE && (h.count[r] ?? 0) > 0) {
          // It lets out whatever it holds most of.
          let most = NONE;
          let mostHas = 0;
          for (let n = 0; n < ITEM_COUNT; n++) {
            const has = h.stock[r * ITEM_COUNT + n] ?? 0;
            if (has > mostHas) {
              most = n;
              mostHas = has;
            }
          }
          if (most !== NONE) {
            take(h, r, most);
            h.out[r] = most;
          }
        }
      }
      sendOut(y, i, r, taken);
    }
  }
}

/** The recipe a machine can start on with what it holds, by what it makes, or `NONE`. */
function choose(h: Holders, r: number, k: number): number {
  const recipes = MADE_BY[k] ?? NO_RECIPES;
  const only = h.recipe[r] ?? NONE;
  for (let n = 0; n < recipes.length; n++) {
    const recipe = recipes[n];
    if (!recipe || (only !== NONE && recipe.out !== only)) continue;
    let all = true;
    for (let p = 0; p < recipe.from.length; p++)
      if ((h.stock[r * ITEM_COUNT + (recipe.from[p] ?? 0)] ?? 0) <= 0) all = false;
    if (all) return recipe.out;
  }
  return NONE;
}

/** Whether the tile at `i` has something finished that it means to hand to the tile at `to`. */
function ready(y: Yard, i: number, to: number): boolean {
  if (i < 0) return false;
  const k = y.kind[i];
  if (k === BELT || k === JOINER || k === TUNNEL)
    return nextOf(y, i) === to && y.item[i] !== NONE && (y.prog[i] ?? 0) >= 8;
  if (k === SPLITTER)
    return (
      y.item[i] !== NONE &&
      (y.prog[i] ?? 0) >= 8 &&
      (wayOut(y, i, 0) === to || wayOut(y, i, 1) === to || wayOut(y, i, 2) === to)
    );
  if (k === GATHERER || k === MILL || k === BENCH || k === WORKSHOP || k === CRATE)
    return nextOf(y, i) === to && y.holders.out[y.row[i] ?? 0] !== NONE;
  return false;
}

/** Which of a joiner's ways in (0 behind, 1 left, 2 right) is on the side `side` of it, or -1 for ahead. */
function wayInOn(y: Yard, to: number, side: number): number {
  const d = y.dir[to] ?? 0;
  return side === ((d + 2) & 3) ? 0 : side === ((d + 3) & 3) ? 1 : side === ((d + 1) & 3) ? 2 : -1;
}

/**
 * Whether the tile at `to` will take the thing `n` handed to it from the tile beside it on its side
 * `side` (a way); `taken` is which sides each tile takes from, as the plumbing worked it out.
 */
function accepts(y: Yard, to: number, n: number, side: number, taken: Uint8Array): boolean {
  if (to < 0 || (((taken[to] ?? 0) >> side) & 1) === 0) return false;
  const k = y.kind[to];
  if (k === DEPOT) return true;
  if (k === BELT || k === SPLITTER || k === TUNNEL) return y.item[to] === NONE;
  if (k === JOINER) {
    if (y.item[to] !== NONE) return false;
    const way = wayInOn(y, to, side);
    if (way < 0) return false;
    // It waits for whoever's turn it is, so long as they have something to give.
    for (let w = y.turn[to] ?? 0; w !== way; w = (w + 1) % 3) if (ready(y, wayIn(y, to, w), to)) return false;
    return true;
  }
  const h = y.holders;
  const r = y.row[to] ?? 0;
  const have = h.stock[r * ITEM_COUNT + n] ?? 0;
  if (k === MILL) {
    const recipe = MILLED[n];
    if (!recipe || (h.recipe[r] !== NONE && h.recipe[r] !== recipe.out)) return false;
    return have < BUFFER && (h.kinds[r] === 0 || have > 0);
  }
  if (k === BENCH || k === WORKSHOP) {
    if (have >= BUFFER) return false;
    // It takes a thing if some one recipe uses it together with everything already held.
    const recipes = MADE_BY[k] ?? NO_RECIPES;
    const only = h.recipe[r] ?? NONE;
    for (let c = 0; c < recipes.length; c++) {
      const recipe = recipes[c];
      if (!recipe || (only !== NONE && recipe.out !== only)) continue;
      let used = false;
      let held = 0;
      for (let p = 0; p < recipe.from.length; p++) {
        const part = recipe.from[p] ?? NONE;
        if (part === n) used = true;
        if ((h.stock[r * ITEM_COUNT + part] ?? 0) > 0) held++;
      }
      if (used && held === h.kinds[r]) return true;
    }
    return false;
  }
  if (k === CRATE) return (h.count[r] ?? 0) + (h.out[r] === NONE ? 0 : 1) < y.rates.crate;
  if (k === BOILER) return n === DEADFALL && have < FUEL;
  return false;
}

/**
 * Hands the thing `n` to the tile at `to` from the tile beside it on its side `side` (a way).
 * `over` is how far past the edge of its last tile it had already come, in eighths.
 */
function give(y: Yard, to: number, n: number, side: number, over: number): void {
  const k = y.kind[to];
  if (k === DEPOT) {
    deliver(y, n, 1);
    return;
  }
  if (k === JOINER) {
    const way = wayInOn(y, to, side);
    y.turn[to] = way + 1 > 2 ? 0 : way + 1;
  }
  if (k === JOINER || k === BELT || k === SPLITTER || k === TUNNEL) {
    y.item[to] = n;
    y.prog[to] = over;
    y.via[to] = 1 + side;
    return;
  }
  put(y.holders, y.row[to] ?? 0, n);
}

/** Moves what is under a tunnel along, and brings it up at the far mouth. */
function passUnder(y: Yard, i: number): void {
  const under = y.tunnels.under;
  const along = y.tunnels.along;
  const at = (y.row[i] ?? 0) * SPAN;
  const last = at + (y.span[i] ?? 0) - 1;
  const mouth = farMouth(y, i);
  for (let k = last; k >= at; k--) {
    const n = under[k] ?? NONE;
    const over = (along[k] ?? 0) - 8;
    if (n === NONE || over < 0) continue;
    if (k === last) {
      if (mouth < 0 || y.kind[mouth] === NONE || y.item[mouth] !== NONE) continue;
      y.item[mouth] = n;
      y.prog[mouth] = over;
      y.via[mouth] = 0;
    } else {
      if (under[k + 1] !== NONE) continue;
      under[k + 1] = n;
      along[k + 1] = over;
    }
    under[k] = NONE;
    along[k] = 0;
  }
  if (y.item[i] !== NONE && (y.prog[i] ?? 0) >= 8 && under[at] === NONE) {
    under[at] = y.item[i] ?? NONE;
    along[at] = (y.prog[i] ?? 8) - 8;
    y.item[i] = NONE;
    y.prog[i] = 0;
    y.via[i] = 0;
  }
}

/** A belt, joiner or tunnel's far mouth hands on the thing it carries once it has crossed the tile. */
function carryOn(y: Yard, i: number, taken: Uint8Array): void {
  const n = y.item[i] ?? NONE;
  if (n === NONE || (y.prog[i] ?? 0) < 8) return;
  const to = ahead(y, i);
  const side = ((y.dir[i] ?? 0) + 2) & 3;
  if (!accepts(y, to, n, side, taken)) return;
  give(y, to, n, side, (y.prog[i] ?? 8) - 8);
  y.item[i] = NONE;
  y.prog[i] = 0;
  y.via[i] = 0;
}

/** A splitter sends what it carries to its ways out in turn: ahead, left, right, from the way after the last. */
function split(y: Yard, i: number, taken: Uint8Array): void {
  const n = y.item[i] ?? NONE;
  if (n === NONE || (y.prog[i] ?? 0) < 8) return;
  const turn = y.turn[i] ?? 0;
  for (let k = 0; k < 3; k++) {
    const way = (k + turn) % 3;
    const to = wayOut(y, i, way);
    const side = ((y.dir[i] ?? 0) + (way === 0 ? 2 : way === 1 ? 1 : 3)) & 3;
    if (!accepts(y, to, n, side, taken)) continue;
    give(y, to, n, side, (y.prog[i] ?? 8) - 8);
    y.item[i] = NONE;
    y.prog[i] = 0;
    y.via[i] = 0;
    y.turn[i] = (way + 1) % 3;
    return;
  }
}

/** A gatherer, machine or crate hands on its finished piece. */
function sendOut(y: Yard, i: number, r: number, taken: Uint8Array): void {
  const h = y.holders;
  const n = h.out[r] ?? NONE;
  if (n === NONE) return;
  const to = ahead(y, i);
  const side = ((y.dir[i] ?? 0) + 2) & 3;
  if (!accepts(y, to, n, side, taken)) return;
  give(y, to, n, side, 0);
  h.out[r] = NONE;
}
