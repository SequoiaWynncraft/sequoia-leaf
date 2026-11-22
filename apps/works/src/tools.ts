/**
 * What the member does to the yard: setting things down, laying runs of belt, turning things,
 * taking them away, picking a tool up off something already built, undoing the last thing, and
 * buying land and plans. Each of these lands in the yard with a movement and a sound.
 */

import { CREAM, GOLD, GREEN } from "@sequoia-leaf/kit/palette.ts";
import {
  ahead,
  at,
  type Dir,
  DX,
  DY,
  type Item,
  type Kind,
  type Leg,
  type PlanId,
  planRefusal,
  PLANS,
  type PlotId,
  plotRefusal,
  priceAt,
  refusal,
  replaces,
  RIGHT,
  route,
  runCost,
  type WorksAct,
} from "@sequoia-leaf/yard";

import { TILE } from "./art/belts.ts";
import { float, flutter, puff, ring, sparkle } from "./fx.ts";
import { layout } from "./layout.ts";
import { yardSfx } from "./sound.ts";
import { S, type Tool, touched } from "./state.ts";
import { coins, doNow } from "./yard.ts";

const DUST = "#cbb894";

/** Called whenever the tool in hand, or what it is aimed at, changes: the interface listens. */
export const toolHooks: { changed: () => void; said: (text: string) => void } = { changed: () => {}, said: () => {} };

interface Stood {
  kind: Kind;
  x: number;
  y: number;
  dir: Dir;
  span: number;
  recipe: Item | null;
  open: boolean;
}
/** Something done that can be undone: things built (`under`: the piece one of them took the place of), things taken away, a thing turned. */
type Done =
  | { did: "built"; cells: number[]; turned: { i: number; was: Dir }[]; under?: Stood }
  | { did: "took"; what: Stood[] }
  | { did: "turned"; i: number; was: Dir };
const done: Done[] = [];
const remember = (d: Done): void => {
  done.push(d);
  if (done.length > 60) done.shift();
};

const W = (): number => S.world.land.w;

/**
 * Does something to the yard (on the page's copy at once, and on Leaf), unless `why` (the rules'
 * reason, worked out with the Coins to hand as Leaf will count them) says it cannot be. Gives back
 * why it was not done, or null.
 */
function attempt(why: string | null, act: WorksAct): string | null {
  if (why !== null) return why;
  const did = doNow(act);
  return "refused" in did ? did.why : null;
}
/** What a thing done paid in or took, in all. */
const coinsOf = (did: ReturnType<typeof doNow>): number =>
  "refused" in did ? 0 : (did.coins ?? []).reduce((sum, c) => sum + c.amount, 0);
const xy = (i: number): { x: number; y: number } => ({ x: i % W(), y: Math.floor(i / W()) });

export function setTool(tool: Tool): void {
  const w = S.world;
  if (tool !== null && tool !== "remove" && !w.open.kinds.has(tool)) return;
  S.tool = tool;
  S.aim = null;
  S.run = null;
  S.from = null;
  path = [];
  faced = -1;
  if (tool !== null) S.picked = -1;
  if (S.hover && tool !== null) aimAt(S.hover.x, S.hover.y);
  toolHooks.changed();
}

/** The tile the tool in hand last took its facing from. */
let faced = -1;

/**
 * Works out what would come of using the tool in hand on a tile. A splitter or a joiner brought
 * over a belt faces the way the belt runs, until it is turned.
 */
export function aimAt(x: number, y: number): void {
  const w = S.world;
  const tool = S.tool;
  if (tool === null) {
    S.aim = null;
    return;
  }
  const there = w.cells[at(w, x, y)];
  if (faced !== at(w, x, y)) {
    faced = at(w, x, y);
    if (there && tool !== "remove" && replaces(tool, there) && S.dir !== there.dir) {
      S.dir = there.dir;
      toolHooks.changed();
    }
  }
  if (tool === "remove") {
    S.aim = {
      x,
      y,
      why: there ? (there.kind === "depot" ? "The depot cannot be removed" : null) : "Nothing to remove here",
      cost: 0,
    };
    return;
  }
  S.aim = { x, y, why: refusal(w, tool, x, y, coins(), S.dir), cost: priceAt(w, tool, x, y) };
}

function landed(x: number, y: number, belt: boolean, n = 0): void {
  const px = x * TILE + 8;
  const py = (y + 1) * TILE - 2;
  puff(px, py, belt ? 3 : 7, DUST, belt ? 4 : 7);
  if (!belt) ring(px, py - 4, CREAM, 9);
  if (belt) yardSfx.belt(n);
  else yardSfx.place();
}

/** Uses the tool in hand on a tile. Says whether anything was done. */
export function place(x: number, y: number): boolean {
  const tool = S.tool;
  if (tool === null) return false;
  if (tool === "remove") return takeAway(x, y);
  const w = S.world;
  const i = at(w, x, y);
  const there = i >= 0 ? w.cells[i] : null;
  const was = there?.dir;
  const under = there && replaces(tool, there) ? standing(i) : null;
  const cost = priceAt(w, tool, x, y);
  const no = attempt(refusal(w, tool, x, y, coins(), S.dir), { do: "build", kind: tool, x, y, dir: S.dir });
  if (no !== null) {
    S.aim = { x, y, why: no, cost: 0 };
    yardSfx.no();
    toolHooks.changed();
    return false;
  }
  if (there && !under) {
    if (was !== undefined && was !== S.dir) {
      remember({ did: "turned", i, was });
      yardSfx.turn();
    }
  } else {
    const cells = [i];
    const made = w.cells[i];
    if (made?.kind === "tunnel") {
      const far = at(w, x + DX[made.dir] * (made.span + 1), y + DY[made.dir] * (made.span + 1));
      cells.push(far);
      landed(far % W(), Math.floor(far / W()), false);
    }
    remember({ did: "built", cells, turned: [], ...(under ? { under } : {}) });
    landed(x, y, tool === "belt");
    if (cost !== 0) float(x * TILE + 8, y * TILE - 2, cost > 0 ? `-${cost}` : `+${-cost}`, GOLD[cost > 0 ? 0 : 2], 0.9);
  }
  touched();
  aimAt(x, y);
  toolHooks.changed();
  return true;
}

/** What stands on a tile, as it would need to be put back. A tunnel is told by the mouth things go in at. */
function standing(i: number): Stood | null {
  const w = S.world;
  const b = w.cells[i];
  if (!b || b.kind === "depot") return null;
  let { x, y } = xy(i);
  if (b.kind === "tunnel" && b.span < 0) {
    x -= DX[b.dir] * (1 - b.span);
    y -= DY[b.dir] * (1 - b.span);
  }
  return { kind: b.kind, x, y, dir: b.dir, span: Math.abs(b.span), recipe: b.recipe, open: b.open };
}

/** Takes away whatever stands on a tile, and gives back what it cost. */
export function takeAway(x: number, y: number, quiet = false): boolean {
  const w = S.world;
  const i = at(w, x, y);
  const was = i >= 0 ? standing(i) : null;
  const did = doNow({ do: "remove", x, y });
  if ("refused" in did || !was) {
    if (!quiet) {
      S.aim = { x, y, why: "refused" in did ? did.why : null, cost: 0 };
      yardSfx.no();
    }
    return false;
  }
  remember({ did: "took", what: [was] });
  const px = x * TILE + 8;
  const py = (y + 1) * TILE - 4;
  puff(px, py, 6, DUST, 9);
  const refund = coinsOf(did);
  if (refund > 0) float(px, py - 10, `+${refund}`, GOLD[2], 1);
  yardSfx.take();
  if (S.picked === i) S.picked = -1;
  touched();
  toolHooks.changed();
  return true;
}

/** Turns what stands on a tile a quarter turn to the right. */
export function turnAt(x: number, y: number): boolean {
  const w = S.world;
  const i = at(w, x, y);
  const b = w.cells[i];
  if (!b || b.kind === "depot" || b.kind === "tunnel") {
    yardSfx.no();
    return false;
  }
  const was = b.dir;
  if (attempt(null, { do: "turn", x, y, dir: RIGHT[b.dir] }) !== null) return false;
  remember({ did: "turned", i, was });
  yardSfx.turn();
  touched();
  return true;
}

/** R: turns the thing in hand, or with nothing in hand the thing pointed at. */
export function rotate(): void {
  if (S.tool === null) {
    const on = S.picked >= 0 ? xy(S.picked) : S.hover;
    if (on) turnAt(on.x, on.y);
    return;
  }
  if (S.tool === "remove") return;
  S.dir = RIGHT[S.dir];
  yardSfx.turn();
  if (S.aim) aimAt(S.aim.x, S.aim.y);
  toolHooks.changed();
}

/** Takes up the tool for whatever stands on a tile, facing the way it faces. */
export function pickFrom(x: number, y: number): boolean {
  const b = S.world.cells[at(S.world, x, y)];
  if (!b || b.kind === "depot") return false;
  S.dir = b.dir;
  setTool(b.kind);
  yardSfx.pick();
  return true;
}

/** Builds again something that was taken away. A tunnel goes back as it was, by a run of one tunnel. */
function putBack(s: Stood): void {
  const tunnel = s.kind === "tunnel";
  const no = attempt(
    refusal(S.world, s.kind, s.x, s.y, coins(), s.dir, tunnel ? s.span : undefined),
    tunnel
      ? { do: "lay", legs: [{ kind: "tunnel", x: s.x, y: s.y, dir: s.dir, span: s.span }] }
      : { do: "build", kind: s.kind, x: s.x, y: s.y, dir: s.dir },
  );
  if (no !== null) {
    toolHooks.said(`Cannot undo: ${no.toLowerCase()}.`);
    return;
  }
  if (s.recipe !== null) doNow({ do: "recipe", x: s.x, y: s.y, item: s.recipe });
  if (!s.open) doNow({ do: "crate", x: s.x, y: s.y, open: false });
  puff(s.x * TILE + 8, (s.y + 1) * TILE - 2, 4, DUST, 6);
}

/** Undoes the last thing done to the yard, if it still can be. */
export function undo(): boolean {
  const w = S.world;
  const last = done.pop();
  if (!last) {
    toolHooks.said("Nothing to undo.");
    return false;
  }
  if (last.did === "built") {
    for (const i of last.cells.toReversed()) {
      if (!w.cells[i]) continue;
      const { x, y } = xy(i);
      doNow({ do: "remove", x, y });
      puff(x * TILE + 8, (y + 1) * TILE - 4, 4, DUST, 7);
    }
    for (const t of last.turned) doNow({ do: "turn", ...xy(t.i), dir: t.was });
    if (last.under) putBack(last.under);
  } else if (last.did === "took") last.what.forEach(putBack);
  else doNow({ do: "turn", ...xy(last.i), dir: last.was });
  yardSfx.undo();
  touched();
  if (S.aim) aimAt(S.aim.x, S.aim.y);
  toolHooks.changed();
  return true;
}

// ---------- runs of belt ----------

/** The tiles a drag has passed over, in order. */
let path: { x: number; y: number }[] = [];

const way = (a: { x: number; y: number }, b: { x: number; y: number }): Dir =>
  b.x > a.x ? 0 : b.x < a.x ? 2 : b.y > a.y ? 1 : 3;

/** Works out the run the drag so far would lay: a belt on every clear tile, each pointing at the next. */
function reckon(): void {
  const w = S.world;
  const legs: Leg[] = [];
  const turns: { x: number; y: number; dir: Dir }[] = [];
  let bad: string | null = null;
  path.forEach((t, k) => {
    const next = path[k + 1];
    const prev = path[k - 1];
    let dir = next ? way(t, next) : prev ? way(prev, t) : S.dir;
    // A run that ends beside the depot was meant to go in: its last belt turns to face the wall.
    if (!next && prev && w.cells[at(w, t.x + DX[dir], t.y + DY[dir])]?.kind !== "depot")
      for (const d of [0, 1, 2, 3] as const) if (w.cells[at(w, t.x + DX[d], t.y + DY[d])]?.kind === "depot") dir = d;
    const there = w.cells[at(w, t.x, t.y)];
    if (!there) {
      const why = refusal(w, "belt", t.x, t.y, Infinity, dir);
      if (why !== null) bad ??= why;
      else legs.push({ kind: "belt", x: t.x, y: t.y, dir, span: 0 });
    } else if (there.kind === "belt" && k === 0 && next && there.dir !== dir) turns.push({ x: t.x, y: t.y, dir });
    // Anything else in the way is stepped over: the belt before it points into it.
  });
  const cost = runCost(w, legs);
  const last = path.at(-1);
  if (path.length > 1) {
    S.run = { legs, turns, cost, why: bad ?? (cost > coins() ? "Not enough Coins" : null) };
    if (last) S.aim = { x: last.x, y: last.y, why: S.run.why, cost };
  } else {
    S.run = null;
    if (last) aimAt(last.x, last.y);
  }
  toolHooks.changed();
}

/** A drag with the belt in hand begins on a tile. */
export function runStart(x: number, y: number): void {
  path = [{ x, y }];
  reckon();
}

/** The drag has reached another tile: the run follows it a tile at a time, and shortens if it doubles back. */
export function runOver(x: number, y: number): void {
  const start = path.at(-1);
  if (!start) return;
  let lx = start.x;
  let ly = start.y;
  for (let guard = 0; guard < 120 && (lx !== x || ly !== y); guard++) {
    const sx = Math.abs(x - lx) >= Math.abs(y - ly) ? Math.sign(x - lx) : 0;
    const sy = sx !== 0 ? 0 : Math.sign(y - ly);
    const nx = lx + sx;
    const ny = ly + sy;
    const seen = path.findIndex((p) => p.x === nx && p.y === ny);
    if (seen >= 0) path.length = seen + 1;
    else path.push({ x: nx, y: ny });
    lx = nx;
    ly = ny;
  }
  reckon();
}

/** Whether a drag is laying a run. */
export const running = (): boolean => path.length > 0;

/** The drag is over: a single tile is a single belt; more is a run, laid all at once. */
export function runEnd(): void {
  const only = path.length === 1 ? path[0] : undefined;
  path = [];
  if (only) {
    S.run = null;
    place(only.x, only.y);
    return;
  }
  commitRun();
}

/** Lays the run that is showing. */
export function commitRun(): boolean {
  const w = S.world;
  const run = S.run;
  S.run = null;
  S.from = null;
  path = [];
  if (!run) return false;
  if (run.why !== null || run.legs.length + run.turns.length === 0) {
    yardSfx.no();
    if (run.why) toolHooks.said(`${run.why}.`);
    toolHooks.changed();
    return false;
  }
  // The first belt, already standing, turned to meet the run: all of it or none, with the run.
  const [bend] = run.turns;
  const was = bend ? w.cells[at(w, bend.x, bend.y)]?.dir : undefined;
  const no = attempt(null, bend ? { do: "lay", legs: run.legs, turn: bend } : { do: "lay", legs: run.legs });
  if (no !== null) {
    yardSfx.no();
    toolHooks.said(`${no}.`);
    toolHooks.changed();
    return false;
  }
  const turned = bend && was !== undefined ? [{ i: at(w, bend.x, bend.y), was }] : [];
  const cells: number[] = [];
  run.legs.forEach((leg, n) => {
    cells.push(at(w, leg.x, leg.y));
    const made = w.cells[at(w, leg.x, leg.y)];
    if (leg.kind === "tunnel" && made)
      cells.push(at(w, leg.x + DX[leg.dir] * (made.span + 1), leg.y + DY[leg.dir] * (made.span + 1)));
    // The belts go down one after another along the run, each with its own clack.
    window.setTimeout(
      () => {
        landed(leg.x, leg.y, leg.kind === "belt", n);
      },
      Math.min(n, 14) * 28,
    );
  });
  remember({ did: "built", cells, turned });
  const end = run.legs.at(-1);
  if (end) {
    S.dir = end.dir;
    if (run.cost > 0) float(end.x * TILE + 8, end.y * TILE - 2, `-${run.cost}`, GOLD[0], 0.9);
  }
  touched();
  toolHooks.changed();
  return true;
}

/**
 * A tap with the belt in hand, for fingers: the first tap says where the run starts, the second
 * where it ends, and the shortest clear way between them is shown before it is laid. Tapping a
 * machine to start from begins the run where that machine hands things on.
 */
export function tapBelt(x: number, y: number): void {
  const w = S.world;
  if (!S.from || (S.run === null && S.from.x === x && S.from.y === y)) {
    if (S.from) {
      // The same tile twice: one belt, the way the hand is pointing.
      S.from = null;
      place(x, y);
      return;
    }
    S.from = { x, y };
    S.run = null;
    aimAt(x, y);
    const there = w.cells[at(w, x, y)];
    if (there) S.aim = { x, y, why: null, cost: 0 };
    toolHooks.changed();
    return;
  }
  let sx = S.from.x;
  let sy = S.from.y;
  if (w.cells[at(w, sx, sy)]) {
    const out = ahead(w, at(w, sx, sy));
    if (out >= 0) {
      sx = out % W();
      sy = Math.floor(out / W());
    }
  }
  const legs = sx === x && sy === y && w.cells[at(w, x, y)] ? null : route(w, [sx, sy], [x, y]);
  if (!legs) S.run = { legs: [], turns: [], cost: 0, why: "No free path for a belt from there to here" };
  else {
    const cost = runCost(w, legs);
    S.run = { legs, turns: [], cost, why: cost > coins() ? "Not enough Coins" : null };
  }
  S.aim = { x, y, why: S.run.why, cost: S.run.cost };
  toolHooks.changed();
}

/** The gold button: builds what is aimed, or lays the run that is showing. */
export function confirm(): boolean {
  if (S.run) return commitRun();
  if (S.aim && S.tool !== null) {
    S.from = null;
    return place(S.aim.x, S.aim.y);
  }
  return false;
}

/** Puts away what is being aimed; with nothing aimed, puts the tool away. */
export function cancel(): void {
  if (S.run || S.from || (S.aim && S.finger)) {
    S.run = null;
    S.from = null;
    S.aim = null;
    path = [];
    toolHooks.changed();
    return;
  }
  setTool(null);
}

// ---------- land and plans ----------

/** Buys a plot: the undergrowth comes down from its signpost outwards, before the member's eyes. */
export function buyLand(id: PlotId): boolean {
  const w = S.world;
  const plot = w.land.plots.find((p) => p.id === id);
  const sign = layout(w, S.rev).signs.find((s) => s.plot.id === id);
  const no = plot ? attempt(plotRefusal(w, id, coins()), { do: "buyPlot", plot: id }) : "There is no such plot";
  if (!plot || no !== null) {
    yardSfx.no();
    toolHooks.said(`${no}.`);
    return false;
  }
  const from = sign ?? { x: (plot.x + plot.w / 2) * TILE, y: (plot.y + plot.h / 2) * TILE };
  S.clearing.set(id, { at: S.t, x: from.x, y: from.y });
  yardSfx.clear();
  float(from.x, from.y - 20, plot.name, GOLD[2], 2.4);
  touched();
  return true;
}

/** Each frame: leaves fly where the undergrowth is coming down, and a cleared plot is done with. */
export function stepClearing(): void {
  const w = S.world;
  for (const [id, c] of S.clearing) {
    const plot = w.land.plots.find((p) => p.id === id);
    const r = (S.t - c.at) * 260;
    if (!plot || r > 420) {
      S.clearing.delete(id);
      continue;
    }
    for (let k = 0; k < 3; k++) {
      const a = Math.random() * Math.PI * 2;
      const x = c.x + Math.cos(a) * r;
      const y = c.y + Math.sin(a) * r;
      if (x < plot.x * TILE || y < plot.y * TILE || x > (plot.x + plot.w) * TILE || y > (plot.y + plot.h) * TILE)
        continue;
      flutter(x, y, 2, [GREEN[2], GREEN[3], GREEN[1]], 6, 26);
    }
  }
}

/** Buys a plan. The machines it changes glint as it takes hold. */
export function buyIdea(id: PlanId): boolean {
  const w = S.world;
  const plan = PLANS.find((p) => p.id === id);
  const no = plan ? attempt(planRefusal(w, id, coins()), { do: "buyPlan", plan: id }) : "There is no such plan";
  if (!plan || no !== null) {
    yardSfx.no();
    toolHooks.said(`${no}.`);
    return false;
  }
  yardSfx.plan();
  const e = plan.effect;
  const touches = (kind: Kind): boolean =>
    (e.gather !== undefined && kind === "gatherer") ||
    (e.craft !== undefined && (kind === "mill" || kind === "bench" || kind === "workshop")) ||
    (e.belt !== undefined && (kind === "belt" || kind === "tunnel" || kind === "splitter" || kind === "joiner")) ||
    (e.reach !== undefined && kind === "pylon") ||
    (e.crate !== undefined && kind === "crate") ||
    ((e.depot !== undefined || e.slots !== undefined) && kind === "depot");
  let shown = 0;
  w.cells.forEach((b, i) => {
    if (!b || !touches(b.kind) || shown > 80) return;
    shown++;
    sparkle((i % W()) * TILE + 8, Math.floor(i / W()) * TILE + 4, b.kind === "belt" ? 1 : 5, 5);
  });
  touched();
  toolHooks.changed();
  return true;
}
