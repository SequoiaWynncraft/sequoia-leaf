/**
 * What the member does to the yard: setting things down, laying runs of belt, turning things,
 * taking them away, colouring lines, picking a tool up off something already built, marking out an
 * area to move, copy, remove or keep as a blueprint, undoing the last thing, and buying land and
 * plans. Each of these lands in the yard with a movement and a sound.
 */

import { CREAM, GOLD, GREEN } from "@sequoia-leaf/kit/palette.ts";
import {
  ahead,
  at,
  blueprintRefusal,
  boxOf,
  type Dir,
  DX,
  DY,
  KIND,
  type Kind,
  LEFT,
  type Leg,
  lineOf,
  type Piece,
  piecesAt,
  placed,
  type PlanId,
  planRefusal,
  PLANS,
  type PlotId,
  plotRefusal,
  priceAt,
  priceOf,
  refusal,
  refusals,
  replaces,
  RIGHT,
  route,
  STAND_MOST,
  standRefusal,
  tilesOf,
  within,
  type WorksAct,
} from "@sequoia-leaf/yard";

import { PAINTS, TILE } from "./art/belts.ts";
import { float, flutter, puff, ring, sparkle } from "./fx.ts";
import { layout } from "./layout.ts";
import { yardSfx } from "./sound.ts";
import { builds, type Group, type Mark, S, type Tool, touched } from "./state.ts";
import { coins, doNow } from "./yard.ts";

const DUST = "#cbb894";

/** Called whenever the tool in hand, or what it is aimed at, changes: the interface listens. */
export const toolHooks: { changed: () => void; said: (text: string) => void } = { changed: () => {}, said: () => {} };

/**
 * Something done that can be undone: things built (`under`: the piece one of them took the place
 * of), things taken away, a thing turned, lines coloured (the tile each was coloured by, and the
 * colour that tile had), pieces moved as one (`tiles`: where they stand now, with the turns and
 * the corner that put them back), a splitter's way shut or opened (`was`: whether it was open).
 */
type Done =
  | { did: "built"; cells: number[]; turned: { i: number; was: Dir }[]; under?: readonly Piece[] }
  | { did: "took"; what: readonly Piece[] }
  | { did: "turned"; i: number; was: Dir }
  | { did: "way"; i: number; way: number; was: boolean }
  | { did: "painted"; lines: { i: number; was: number }[] }
  | { did: "moved"; tiles: number[]; turns: Dir; x: number; y: number };
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
  if (builds(tool) && !w.open.kinds.has(tool)) return;
  S.tool = tool;
  S.aim = null;
  S.run = null;
  S.from = null;
  letGo();
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
  if (tool === "select") {
    aimGroup(x, y);
    return;
  }
  const there = w.cells[at(w, x, y)];
  if (faced !== at(w, x, y)) {
    faced = at(w, x, y);
    if (there && builds(tool) && replaces(tool, there) && S.dir !== there.dir) {
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
  if (tool === "paint") {
    S.aim = { x, y, why: lineOf(w, at(w, x, y)).length > 0 ? null : "Nothing to paint here", cost: 0 };
    return;
  }
  S.aim = { x, y, why: refusal(w, tool, x, y, coins(), S.dir), cost: priceAt(w, tool, x, y) };
}

/** What something just built took from the purse, or gave back, rising from its tile. */
function paid(x: number, y: number, cost: number): void {
  if (cost !== 0) float(x * TILE + 8, y * TILE - 2, cost > 0 ? `-${cost}` : `+${-cost}`, GOLD[cost > 0 ? 0 : 2], 0.9);
}

/** A piece lands: dust, a ring under anything but a belt, and (unless `quiet`) its sound. */
function landed(x: number, y: number, belt: boolean, n = 0, quiet = false): void {
  const px = x * TILE + 8;
  const py = (y + 1) * TILE - 2;
  puff(px, py, belt ? 3 : 7, DUST, belt ? 4 : 7);
  if (!belt) ring(px, py - 4, CREAM, 9);
  if (quiet) return;
  if (belt) yardSfx.belt(n);
  else yardSfx.place();
}

/** Uses the tool in hand on a tile. Says whether anything was done. */
export function place(x: number, y: number): boolean {
  const tool = S.tool;
  if (tool === null) return false;
  if (tool === "remove") return takeAway(x, y);
  if (tool === "paint") return paintAt(x, y);
  if (tool === "select") return setDown();
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
    remember({ did: "built", cells, turned: [], ...(under ? { under: [under] } : {}) });
    landed(x, y, tool === "belt");
    paid(x, y, cost);
  }
  touched();
  aimAt(x, y);
  toolHooks.changed();
  return true;
}

/** What stands on a tile, as it would need to be put back. */
const standing = (i: number): Piece | null => piecesAt(S.world, [i])[0] ?? null;

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
  // A piece taken out of a marked area is no longer marked: what is moved or copied next is what stands there.
  if (S.mark) markTiles(S.mark, S.mark.tiles);
  if (S.mark?.pieces.length === 0) S.mark = null;
  touched();
  toolHooks.changed();
  return true;
}

/** The lines the drag going on has coloured so far: they are undone together, and no other drag's with them. */
let stroke: { i: number; was: number }[] | null = null;

/**
 * Colours the line through a tile with the colour on the brush. `more` is a drag going on: its
 * lines are undone together, and passing over what cannot be coloured says nothing.
 */
export function paintAt(x: number, y: number, more = false): boolean {
  // A new press starts a stroke of its own, whether or not it colours anything where it lands.
  if (!more) stroke = null;
  const w = S.world;
  const i = at(w, x, y);
  const line = lineOf(w, i);
  const was = w.cells[i]?.tint ?? 0;
  // A line that is that colour already is let be: a drag crosses the same line many times.
  if (line.length > 0 && line.every((j) => w.cells[j]?.tint === S.tint)) return false;
  const no = attempt(null, { do: "paint", x, y, tint: S.tint });
  if (no !== null) {
    if (!more) {
      yardSfx.no();
      toolHooks.said(`${no}.`);
    }
    return false;
  }
  if (stroke) stroke.push({ i, was });
  else {
    stroke = [{ i, was }];
    remember({ did: "painted", lines: stroke });
  }
  const col = PAINTS[S.tint - 1]?.lit ?? DUST;
  for (const j of line.slice(0, 80)) puff((j % W()) * TILE + 8, Math.floor(j / W()) * TILE + 9, 1, col, 5);
  yardSfx.paint();
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

/** Shuts one of the ways out of the splitter on a tile (0 ahead, 1 left, 2 right), or opens it if it was shut. */
export function wayAt(x: number, y: number, way: number): boolean {
  const i = at(S.world, x, y);
  const b = S.world.cells[i];
  const was = (((b?.shut ?? 0) >> way) & 1) === 0;
  if (!b || attempt(null, { do: "way", x, y, way, open: !was }) !== null) {
    yardSfx.no();
    return false;
  }
  remember({ did: "way", i, way, was });
  // Dust where the bar drops across the way, or lifts off it.
  const d = [b.dir, LEFT[b.dir], RIGHT[b.dir]][way] ?? b.dir;
  puff(x * TILE + 8 + DX[d] * 7, y * TILE + 9 + DY[d] * 7, 3, DUST, 5);
  if (was) yardSfx.belt();
  else yardSfx.turn();
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
  if (!builds(S.tool) && !S.group) return;
  if (S.group) S.group.turns = RIGHT[S.group.turns];
  else S.dir = RIGHT[S.dir];
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

/**
 * Stands a set of pieces, all of it or none. A large set goes to Leaf as several commands, each
 * small enough for Leaf to read, once the whole of it is known to go. Gives back why it was not
 * done, or null.
 */
function standNow(pieces: readonly Piece[]): string | null {
  const no = standRefusal(S.world, pieces, coins());
  if (no !== null) return no;
  for (let k = 0; k < pieces.length; k += STAND_MOST) {
    const did = doNow({ do: "stand", pieces: pieces.slice(k, k + STAND_MOST) });
    if ("refused" in did) return did.why;
  }
  return null;
}

/** What could not be undone, said on the line over the dock. */
const cannotUndo = (why: string): void => {
  toolHooks.said(`Cannot undo: ${why.toLowerCase()}.`);
};

/** Stands again pieces that were taken away, as a copy is stood: new, and holding nothing. */
function putBack(what: readonly Piece[]): void {
  const no = standNow(what);
  if (no !== null) cannotUndo(no);
  else for (const s of what) puff(s.x * TILE + 8, (s.y + 1) * TILE - 2, 4, DUST, 6);
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
    const cells = last.cells.filter((i) => w.cells[i]);
    if (cells.length > 0) doNow({ do: "clear", tiles: cells });
    for (const i of cells) puff((i % W()) * TILE + 8, (Math.floor(i / W()) + 1) * TILE - 4, 4, DUST, 7);
    for (const t of last.turned) doNow({ do: "turn", ...xy(t.i), dir: t.was });
    if (last.under) putBack(last.under);
  } else if (last.did === "took") putBack(last.what);
  else if (last.did === "painted")
    for (const l of last.lines.toReversed()) doNow({ do: "paint", ...xy(l.i), tint: l.was });
  else if (last.did === "way") doNow({ do: "way", ...xy(last.i), way: last.way, open: last.was });
  else if (last.did === "moved") {
    const no = attempt(null, { do: "move", tiles: last.tiles, turns: last.turns, x: last.x, y: last.y });
    if (no !== null) cannotUndo(no);
  } else doNow({ do: "turn", ...xy(last.i), dir: last.was });
  yardSfx.undo();
  // What was marked or in hand may be what was undone.
  if (S.tool === "select") {
    letGo();
    S.aim = null;
  }
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
  const cost = priceOf(w, legs);
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
    paid(end.x, end.y, run.cost);
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
    const cost = priceOf(w, legs);
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

/**
 * Puts away what is being aimed; with nothing aimed, puts the tool away. With Select: the pieces
 * in hand, then the area marked, then the tool.
 */
export function cancel(): void {
  if (S.group || S.saving || S.corner || S.mark) {
    if (S.group) S.group = null;
    else if (S.saving) S.saving = false;
    else letGo();
    S.aim = null;
    toolHooks.changed();
    return;
  }
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

// ---------- many pieces at once ----------

/** Lets go of everything Select holds: the area marked, the pieces in hand. */
function letGo(): void {
  S.mark = null;
  S.corner = null;
  S.group = null;
  S.saving = false;
}

/** Marks the pieces in the rectangle of tiles between two corners. */
function markArea(a: { x: number; y: number }, b: { x: number; y: number }): void {
  const w = S.world;
  const [x0, x1] = [Math.min(a.x, b.x), Math.max(a.x, b.x)];
  const [y0, y1] = [Math.min(a.y, b.y), Math.max(a.y, b.y)];
  markTiles({ x0, y0, x1, y1 }, within(w, x0, y0, x1, y1));
  S.saving = false;
  toolHooks.changed();
}

/** Marks what stands on some tiles, within a box: an area just marked, or one a piece has since been taken out of. */
function markTiles(box: Pick<Mark, "x0" | "y0" | "x1" | "y1">, tiles: readonly number[]): void {
  const w = S.world;
  const pieces = piecesAt(w, tiles);
  // What they cost: what taking them away gives back.
  const cost = pieces.reduce((sum, p) => sum + (w.cells[at(w, p.x, p.y)]?.free ? 0 : KIND[p.kind].cost), 0);
  S.mark = { x0: box.x0, y0: box.y0, x1: box.x1, y1: box.y1, tiles: tiles.filter((i) => w.cells[i]), pieces, cost };
}

/** One corner of an area: where a mouse's drag begins, or a finger's first tap. Whatever was marked is let go. */
export function markStart(x: number, y: number): void {
  S.mark = null;
  S.saving = false;
  S.corner = { x, y };
  toolHooks.changed();
}

/** The opposite corner, as far as the drag has come: the pieces between the two are marked. */
export function markOver(x: number, y: number): void {
  if (S.corner) markArea(S.corner, { x, y });
}

/** The area is marked: an area with no piece in it marks nothing. */
export function markEnd(): void {
  S.corner = null;
  if (S.mark?.pieces.length === 0) S.mark = null;
  if (S.mark) yardSfx.pick();
  toolHooks.changed();
}

/** Takes in hand the marked pieces, to move them or to stand a copy of them, or the blueprint kept in a place. */
export function hold(as: Group["as"]): void {
  const pieces = typeof as === "number" ? S.world.blueprints[as] : S.mark?.pieces;
  if (!pieces || pieces.length === 0) return;
  if (typeof as === "number") S.mark = null;
  S.group = { as, pieces, turns: 0, at: [], why: [] };
  S.saving = false;
  S.aim = null;
  if (S.hover) aimAt(S.hover.x, S.hover.y);
  yardSfx.pick();
  toolHooks.changed();
}

/** Works out where the pieces in hand would stand with the middle of their box on a tile, and whether each can. */
function aimGroup(x: number, y: number): void {
  const w = S.world;
  const g = S.group;
  if (!g) {
    S.aim = null;
    return;
  }
  const box = boxOf(placed(g.pieces, g.turns, 0, 0));
  g.at = placed(g.pieces, g.turns, x - ((box.w - 1) >> 1), y - ((box.h - 1) >> 1));
  const moving = g.as === "move";
  g.why = refusals(w, g.at, moving ? tilesOf(w, g.pieces) : null);
  const why = moving ? (g.why.find((r) => r !== null) ?? null) : standRefusal(w, g.at, coins(), g.why);
  S.aim = { x, y, why, cost: moving ? 0 : priceOf(w, g.at) };
}

/** The quarter turns that undo so many. */
const TURNS_BACK = [0, 3, 2, 1] as const;

/**
 * Sets the pieces in hand down where they are aimed, all of them or none. Moved pieces are done
 * with, and stay marked where they now stand; a copy or a blueprint stays in hand for another.
 */
function setDown(): boolean {
  const w = S.world;
  const g = S.group;
  const aim = S.aim;
  if (!g || !aim) return false;
  const box = boxOf(g.at);
  const tiles = tilesOf(w, g.at);
  // What a copy would stand that is not there now, and the pieces some of it would take the place of.
  const stood = g.at.filter((p) => w.cells[at(w, p.x, p.y)]?.kind !== p.kind);
  const under = stood.flatMap((p) => standing(at(w, p.x, p.y)) ?? []);
  // Pieces already standing that a copy would only turn, and which way they face now.
  const turned = g.at.flatMap((p) => {
    const i = at(w, p.x, p.y);
    const b = w.cells[i];
    return b && b.kind === p.kind && b.dir !== p.dir ? [{ i, was: b.dir }] : [];
  });
  const moving = g.as === "move";
  // A copy over itself, just set down: nothing to stand.
  if (!moving && aim.why === null && stood.length === 0 && turned.length === 0) return false;
  const no =
    aim.why ??
    (moving
      ? attempt(null, { do: "move", tiles: tilesOf(w, g.pieces), turns: g.turns, x: box.x, y: box.y })
      : standNow(g.at));
  if (no !== null) {
    yardSfx.no();
    toolHooks.said(`${no}.`);
    return false;
  }
  if (moving) {
    const was = boxOf(g.pieces);
    remember({ did: "moved", tiles, turns: TURNS_BACK[g.turns], x: was.x, y: was.y });
    S.group = null;
    S.aim = null;
    const [x1, y1] = [box.x + box.w - 1, box.y + box.h - 1];
    S.mark = { x0: box.x, y0: box.y, x1, y1, tiles, pieces: g.at, cost: S.mark?.cost ?? 0 };
  } else {
    remember({ did: "built", cells: tilesOf(w, stood), turned, under });
    paid(aim.x, aim.y, aim.cost);
  }
  // The pieces land in a wave out from the pointer, each ring of it with one sound.
  const wave: Piece[][] = [];
  for (const p of g.at) (wave[Math.min(14, Math.round(Math.hypot(p.x - aim.x, p.y - aim.y)))] ??= []).push(p);
  wave.forEach((these, n) => {
    window.setTimeout(() => {
      these.forEach((p, k) => {
        landed(p.x, p.y, p.kind === "belt", n, k > 0);
      });
    }, n * 28);
  });
  touched();
  // A copy stays in hand: under the mouse where it is, and for a finger until it is aimed again.
  if (S.group && !S.finger) aimAt(aim.x, aim.y);
  else S.aim = null;
  toolHooks.changed();
  return true;
}

/** Takes away everything marked, at once. */
export function clearMark(): boolean {
  const m = S.mark;
  if (!m || S.group) return false;
  const did = doNow({ do: "clear", tiles: m.tiles });
  if ("refused" in did) {
    yardSfx.no();
    toolHooks.said(`${did.why}.`);
    return false;
  }
  remember({ did: "took", what: m.pieces });
  for (const p of m.pieces) puff(p.x * TILE + 8, (p.y + 1) * TILE - 4, 3, DUST, 9);
  const refund = coinsOf(did);
  if (refund > 0) float(((m.x0 + m.x1 + 1) / 2) * TILE, m.y0 * TILE, `+${refund}`, GOLD[2], 1.2);
  yardSfx.take();
  letGo();
  S.picked = -1;
  touched();
  toolHooks.changed();
  return true;
}

/** Save was pressed: the places are offered, unless the marked pieces cannot be a blueprint. */
export function askSave(): void {
  const no = S.mark ? blueprintRefusal(S.mark.pieces) : null;
  if (no !== null) {
    yardSfx.no();
    toolHooks.said(`${no}.`);
    return;
  }
  S.saving = !S.saving;
  toolHooks.changed();
}

/** Keeps the marked pieces as the blueprint in a place. They glint as it is taken down. */
export function saveMark(slot: number): boolean {
  const m = S.mark;
  if (!m || attempt(blueprintRefusal(m.pieces), { do: "saveBlueprint", slot, tiles: m.tiles }) !== null) return false;
  S.saving = false;
  for (const p of m.pieces.slice(0, 120)) sparkle(p.x * TILE + 8, p.y * TILE + 6, 2, 5);
  float(((m.x0 + m.x1 + 1) / 2) * TILE, m.y0 * TILE, "Blueprint saved", GOLD[2], 1.6);
  yardSfx.ready();
  toolHooks.changed();
  return true;
}

/** Throws away the blueprint in a place, and lets go of it if it was in hand. */
export function dropBlueprint(slot: number): void {
  if ("refused" in doNow({ do: "deleteBlueprint", slot })) return;
  if (S.group?.as === slot) S.group = null;
  S.aim = null;
  yardSfx.take();
  toolHooks.changed();
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
