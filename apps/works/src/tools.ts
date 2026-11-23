/**
 * What the member does to the yard: setting things down, laying runs of belt, turning things,
 * taking them away, colouring lines, picking a tool up off something already built, marking out an
 * area to move, copy, remove, raise or keep as a blueprint, undoing the last thing, buying land, and
 * taking a project in hand. Each of these lands in the yard with a movement and a sound.
 *
 * Every tool is offered only once the yard may use it (`locked`): Select and the brush wait for
 * their unlocks, as kinds of piece do; the spade never waits.
 *
 * A kind that has grades is built at the grade chosen for it (`gradeInHand`). Set down over a piece
 * of its kind of a lower grade it raises that piece, for the difference; over one of a higher grade
 * it only turns it, and never lowers it. A copy or a blueprint stands its pieces at the grades it
 * holds, and raises or lowers what of the same kind stands under it, as the rules do.
 */

import {
  type Act,
  ahead,
  at,
  BELT,
  blueprintRefusal,
  boxOf,
  DEPOT,
  type Dir,
  DX,
  DY,
  type Goal,
  gradeOf,
  highest,
  isGraded,
  isKind,
  type Kind,
  kindAt,
  LEFT,
  type Leg,
  legPiece,
  lineOf,
  locked,
  NONE,
  otherMouth,
  type Piece,
  piecesAt,
  piecesOf,
  placed,
  type Plot,
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
  TUNNEL,
  tunnelExit,
  upgradePrice,
  within,
  worthAt,
} from "@sequoia-leaf/factory";
import { CREAM, GOLD, GREEN, SKY } from "@sequoia-leaf/kit/palette.ts";

import { PAINTS, TILE } from "./art/belts.ts";
import { float, flutter, puff, ring, sparkle } from "./fx.ts";
import { layout } from "./layout.ts";
import { yardSfx } from "./sound.ts";
import {
  type Aim,
  builds,
  draws,
  gradeInHand,
  type Group,
  type Mark,
  type Reckoned,
  type Run,
  S,
  type Tool,
} from "./state.ts";
import { coins, doNow } from "./yard.ts";

const DUST = "#cbb894";

/** Called whenever the tool in hand, or what it is aimed at, changes: the interface listens. */
export const toolHooks: { changed: () => void; said: (text: string) => void } = { changed: () => {}, said: () => {} };

/**
 * Something done that can be undone: things built (`under`: the piece one of them took the place
 * of; `was`: pieces of the same kind that stood where some were set down, as they stood, which the
 * setting down turned, raised or lowered), pieces raised where they stand (as they stood), things
 * taken away, a thing turned, lines coloured (the tile each was coloured by, and the colour that tile
 * had), pieces moved as one (`tiles`: where they stand now, with the turns and the corner that put
 * them back), a splitter's way shut, opened or put first (its shut ways and the way it put first, as
 * they were).
 */
type Done =
  | {
      did: "built";
      cells: number[];
      turned: { i: number; was: Dir }[];
      under?: readonly Piece[];
      was?: readonly Piece[];
    }
  | { did: "raised"; was: readonly Piece[] }
  | { did: "took"; what: readonly Piece[] }
  | { did: "turned"; i: number; was: Dir }
  | { did: "way"; i: number; shut: number; first: number }
  | { did: "painted"; lines: { i: number; was: number }[] }
  | { did: "moved"; tiles: number[]; turns: Dir; x: number; y: number };
const done: Done[] = [];
const remember = (d: Done): void => {
  done.push(d);
  if (done.length > 60) done.shift();
};

const W = (): number => S.world.land.w;

/**
 * Does something to the yard (on the page's copy at once, and on Leaf). The rules judge it then,
 * with the purse as it is (`doNow`), whatever was worked out when it was aimed. Gives back the rules'
 * reason it was not done, or null.
 */
function does(act: Act): string | null {
  const did = doNow(act);
  return "refused" in did ? did.why : null;
}
/** An aim at a tile: why it cannot be, what it costs, and for a tunnel its far mouth; of the yard and the purse as they are now. */
const aimed = (x: number, y: number, why: string | null, cost: number, far = -1): Aim => ({
  x,
  y,
  why,
  cost,
  far,
  rev: S.rev,
  coins: coins(),
});
/**
 * Whether what was worked out is of the yard and the purse as they are now: the same yard, and Coins
 * that still cover its cost, or that fall short of it by as much as before. The till's whole Coins
 * go up as the yard earns; an aim they covered and still cover is not worked out again for that.
 */
function fresh(r: Reckoned): boolean {
  const now = coins();
  return r.rev === S.rev && (r.coins === now || (r.cost <= r.coins && r.cost <= now));
}
/** What a thing done paid in or took, in all. */
const coinsOf = (did: ReturnType<typeof doNow>): number =>
  "refused" in did ? 0 : (did.coins ?? []).reduce((sum, c) => sum + c.amount, 0);
const xy = (i: number): { x: number; y: number } => ({ x: i % W(), y: Math.floor(i / W()) });
/** The way a piece faces, as a way. */
const dirOf = (i: number): Dir => {
  const d = S.world.dir[i] ?? 0;
  return d === 1 ? 1 : d === 2 ? 2 : d === 3 ? 3 : 0;
};

/**
 * Whether the yard may use a tool yet: a kind of piece this page draws (`DRAWN`), or Select or the
 * brush, once unlocked; the spade always.
 */
export function usable(tool: Tool): boolean {
  const open = S.world.open;
  if (builds(tool)) return draws(tool) && locked(open, { build: tool }) === null;
  if (tool === "select") return locked(open, { use: "select" }) === null;
  if (tool === "paint") return locked(open, { use: "paint" }) === null;
  return true;
}

export function setTool(tool: Tool): void {
  if (!usable(tool)) return;
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
 * The grade a kind in hand would stand at on a tile: the grade chosen for it, and over a piece of
 * its kind never lower than that piece's, which is then only turned.
 */
function gradeOn(tool: Kind, i: number): number {
  const hand = gradeInHand(tool);
  return i >= 0 && S.world.kind[i] === tool ? Math.max(hand, S.world.grade[i] ?? 1) : hand;
}
/** The grade of the piece on a tile that the kind in hand would raise there, or nothing if it would raise none. */
function raisedOn(tool: Kind, i: number): number | undefined {
  const stands = i >= 0 && S.world.kind[i] === tool ? (S.world.grade[i] ?? 0) : 0;
  return stands > 0 && gradeInHand(tool) > stands ? stands : undefined;
}

/** Chooses the grade the kind in hand is built at: kept for that kind. */
export function setGrade(grade: number): void {
  const tool = S.tool;
  if (!builds(tool) || !isGraded(tool) || grade < 1 || grade > highest(S.world.open, tool)) return;
  S.grades[tool] = grade;
  // What is aimed, a finger's run and a drag are all at the grade in hand: each is worked out again,
  // and a piece now raised where it is aimed lends the hand its facing, as one pointed at anew does.
  faced = -1;
  keepAim(true);
  yardSfx.pick();
  toolHooks.changed();
}

/** The next grade the kind in hand may be built at, coming round to the first after the highest. */
export function stepGrade(): void {
  const tool = S.tool;
  if (!builds(tool) || !isGraded(tool)) return;
  const top = highest(S.world.open, tool);
  if (top > 1) setGrade((gradeInHand(tool) % top) + 1);
}

/**
 * Works out what would come of using the tool in hand on a tile. A splitter or a joiner brought
 * over a belt faces the way the belt runs, until it is turned; and so does a piece brought over one
 * of its kind that it would raise, so that raising a line a piece at a time turns none of it.
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
  const i = at(w, x, y);
  const there = kindAt(w, x, y);
  if (faced !== i) {
    faced = i;
    const over = there !== NONE && builds(tool) && (replaces(tool, there) || raisedOn(tool, i) !== undefined);
    if (over && S.dir !== dirOf(i)) {
      S.dir = dirOf(i);
      toolHooks.changed();
    }
  }
  if (tool === "remove") {
    const why = there === NONE ? "Nothing to remove here" : there === DEPOT ? "The depot cannot be removed" : null;
    S.aim = aimed(x, y, why, 0);
    return;
  }
  if (tool === "paint") {
    S.aim = aimed(x, y, lineOf(w, at(w, x, y)).length > 0 ? null : "Nothing to paint here", 0);
    return;
  }
  const exit = tool === TUNNEL ? tunnelExit(w, x, y, S.dir) : null;
  const grade = gradeOn(tool, i);
  const raises = raisedOn(tool, i);
  const why = refusal(w, tool, x, y, coins(), S.dir, { grade });
  S.aim = {
    ...aimed(x, y, why, priceAt(w, tool, x, y, grade), exit ? at(w, exit.x, exit.y) : -1),
    grade,
    ...(raises === undefined ? {} : { raises }),
  };
}

/**
 * The aim, a run shown before it is laid, and the pieces in hand as they would stand are each
 * worked out for a tile, a tool and what is in hand, from the yard and the purse as they were then.
 * They are kept while the pointer stays on that tile; when the yard has changed under them (a card's
 * button, a key, an undo, Leaf's yard taken: `S.rev`) or the Coins to hand have, they are worked out
 * again for the same tile. So what is shown, and what a press sets down, is of the yard as it is.
 * Each frame asks, and so does each press that acts on an aim. With `again`, they are worked out
 * again whatever: a grade chosen (`setGrade`) changes them and neither the yard nor the purse.
 */
export function keepAim(again = false): void {
  const a = S.aim;
  const stale = (r: Reckoned): boolean => again || !fresh(r);
  if (path.length > 1) {
    if (S.run && stale(S.run)) reckon();
  } else if (S.run && S.from) {
    if (a && stale(S.run)) runTo(a.x, a.y);
  } else if (a && stale(a)) {
    if (S.from && S.tool === BELT) startAt(a.x, a.y);
    else aimAt(a.x, a.y);
  }
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
  const there = kindAt(w, x, y);
  const was = there === NONE ? undefined : dirOf(i);
  const under = there !== NONE && replaces(tool, there) ? standing(i) : null;
  const grade = gradeOn(tool, i);
  // Over a piece of its kind of a lower grade: that piece, as it stands, to put back.
  const raised = raisedOn(tool, i) === undefined ? null : standing(i);
  const cost = priceAt(w, tool, x, y, grade);
  const no = does({ do: "build", kind: tool, x, y, dir: S.dir, grade });
  if (no !== null) {
    S.aim = aimed(x, y, no, 0);
    yardSfx.no();
    toolHooks.changed();
    return false;
  }
  if (raised) {
    remember({ did: "raised", was: [raised] });
    lifted(x, y, cost);
  } else if (there !== NONE && !under) {
    if (was !== undefined && was !== S.dir) {
      remember({ did: "turned", i, was });
      yardSfx.turn();
    }
  } else {
    const cells = [i];
    const far = w.kind[i] === TUNNEL ? otherMouth(w, i) : -1;
    if (far >= 0) {
      cells.push(far);
      landed(far % W(), Math.floor(far / W()), false);
    }
    remember({ did: "built", cells, turned: [], ...(under ? { under: [under] } : {}) });
    landed(x, y, tool === BELT);
    paid(x, y, cost);
  }
  aimAt(x, y);
  toolHooks.changed();
  return true;
}

/** What stands on a tile, as it would need to be put back. */
const standing = (i: number): Piece | null => piecesAt(S.world, [i])[0] ?? null;

/** A piece raised where it stands: a glint, what it cost rising from it, and its sound. */
function lifted(x: number, y: number, cost: number): void {
  sparkle(x * TILE + 8, y * TILE + 6, 5, 7);
  paid(x, y, cost);
  yardSfx.place();
}

/**
 * Raises the piece on a tile to the next grade, where it stands, for the difference: what its card
 * offers. Says whether it was raised.
 */
export function raiseAt(x: number, y: number): boolean {
  const w = S.world;
  const i = at(w, x, y);
  const k = i < 0 ? NONE : (w.kind[i] ?? NONE);
  const was = i < 0 ? null : standing(i);
  if (!isKind(k) || !was) return false;
  const grade = (w.grade[i] ?? 0) + 1;
  const cost = priceAt(w, k, x, y, grade);
  const no = does({ do: "build", kind: k, x, y, dir: dirOf(i), grade });
  if (no !== null) {
    yardSfx.no();
    toolHooks.said(`${no}.`);
    return false;
  }
  remember({ did: "raised", was: [was] });
  lifted(x, y, cost);
  toolHooks.changed();
  return true;
}

/** Takes away whatever stands on a tile, and gives back what it cost. */
export function takeAway(x: number, y: number, quiet = false): boolean {
  const w = S.world;
  const i = at(w, x, y);
  const was = i >= 0 ? standing(i) : null;
  const did = doNow({ do: "remove", x, y });
  if ("refused" in did || !was) {
    if (!quiet) {
      S.aim = aimed(x, y, "refused" in did ? did.why : null, 0);
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
  // A piece taken out of a marked area is no longer marked.
  remark();
  if (S.mark?.pieces.length === 0) S.mark = null;
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
  const was = i < 0 ? 0 : (w.tint[i] ?? 0);
  // A line that is that colour already is let be: a drag crosses the same line many times.
  if (line.length > 0 && line.every((j) => w.tint[j] === S.tint)) return false;
  const no = does({ do: "paint", x, y, tint: S.tint });
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
  const k = kindAt(w, x, y);
  if (k === NONE || k === DEPOT || k === TUNNEL) {
    yardSfx.no();
    return false;
  }
  const was = dirOf(i);
  if (does({ do: "turn", x, y, dir: RIGHT[was] }) !== null) return false;
  remember({ did: "turned", i, was });
  yardSfx.turn();
  return true;
}

/**
 * Moves one of the ways out of the splitter on a tile (0 ahead, 1 left, 2 right) on a step: an open
 * way is put first once the yard may put a way first, and shut before then; the way put first is
 * shut; a shut way is opened.
 */
export function wayAt(x: number, y: number, way: number): boolean {
  const w = S.world;
  const i = at(w, x, y);
  const shut = (((w.shut[i] ?? 0) >> way) & 1) === 1;
  const putFirst = !shut && w.first[i] !== way + 1 && locked(w.open, { first: true }) === null;
  const act: Act = putFirst ? { do: "first", x, y, way } : { do: "way", x, y, way, open: shut };
  const was = { shut: w.shut[i] ?? 0, first: w.first[i] ?? 0 };
  if (i < 0 || does(act) !== null) {
    yardSfx.no();
    return false;
  }
  remember({ did: "way", i, ...was });
  // Dust where the bar drops across the way, or lifts off it; plum bits where a flag goes up.
  const dir = dirOf(i);
  const d = [dir, LEFT[dir], RIGHT[dir]][way] ?? dir;
  const ex = x * TILE + 8 + DX[d] * 7;
  const ey = y * TILE + 9 + DY[d] * 7;
  if (putFirst) flutter(ex, ey - 4, 4, [SKY[3], SKY[4]], 4, 14);
  else puff(ex, ey, 3, DUST, 5);
  if (putFirst) yardSfx.plan();
  else if (shut) yardSfx.belt();
  else yardSfx.turn();
  return true;
}

/** Gives the splitter on a tile the ways it had: each opened that was open, the way it put first, then each shut that was shut. */
function asWays(i: number, shut: number, first: number): void {
  const w = S.world;
  const spot = xy(i);
  for (let way = 0; way < 3; way++)
    if (((shut >> way) & 1) === 0 && (((w.shut[i] ?? 0) >> way) & 1) === 1)
      doNow({ do: "way", ...spot, way, open: true });
  if (w.first[i] !== first) doNow({ do: "first", ...spot, way: first === 0 ? null : first - 1 });
  for (let way = 0; way < 3; way++)
    if (((shut >> way) & 1) === 1 && (((w.shut[i] ?? 0) >> way) & 1) === 0)
      doNow({ do: "way", ...spot, way, open: false });
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

/** Takes up the tool for whatever stands on a tile, facing the way it faces, at its grade. */
export function pickFrom(x: number, y: number): boolean {
  const k = kindAt(S.world, x, y);
  if (k === NONE || k === DEPOT || !isKind(k) || !usable(k)) return false;
  const i = at(S.world, x, y);
  S.dir = dirOf(i);
  if (isGraded(k)) S.grades[k] = S.world.grade[i] ?? 1;
  setTool(k);
  yardSfx.pick();
  return true;
}

/**
 * Stands again pieces that were taken away, all of them or none: the only use of `stand`. More than
 * Leaf reads in one command (`STAND_MOST`) goes as several, once the whole is known to go, each all
 * or none. A copy and a blueprint are each one command of their own. Gives back why it was not done,
 * or null.
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

/**
 * Gives pieces that still stand the way and the grade they had, each for the difference: together
 * with Select, and without it one at a time, as building over a piece does. A tunnel is named by the
 * way it goes in, so it is only raised or lowered.
 */
function asTheyWere(was: readonly Piece[]): void {
  const w = S.world;
  const still = was.filter((p) => kindAt(w, p.x, p.y) === p.kind);
  if (still.length === 0) return;
  if (usable("select") || still.length === 1) {
    const no = standNow(still);
    if (no !== null) cannotUndo(no);
    return;
  }
  for (const p of still) {
    const did = doNow({ do: "build", kind: p.kind, x: p.x, y: p.y, dir: p.dir, grade: gradeOf(p.kind, p.grade) });
    if ("refused" in did) {
      cannotUndo(did.why);
      return;
    }
  }
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
    const cells = last.cells.filter((i) => w.kind[i] !== NONE);
    // Many pieces go as one with Select; without it, one at a time, as the spade takes them.
    if (usable("select") && cells.length > 0) doNow({ do: "clear", tiles: cells });
    else for (const p of piecesAt(w, cells)) doNow({ do: "remove", x: p.x, y: p.y });
    for (const i of cells) puff((i % W()) * TILE + 8, (Math.floor(i / W()) + 1) * TILE - 4, 4, DUST, 7);
    for (const t of last.turned) doNow({ do: "turn", ...xy(t.i), dir: t.was });
    if (last.under) putBack(last.under);
    if (last.was) asTheyWere(last.was);
  } else if (last.did === "raised") asTheyWere(last.was);
  else if (last.did === "took") putBack(last.what);
  else if (last.did === "painted")
    for (const l of last.lines.toReversed()) doNow({ do: "paint", ...xy(l.i), tint: l.was });
  else if (last.did === "way") asWays(last.i, last.shut, last.first);
  else if (last.did === "moved") {
    const no = does({ do: "move", tiles: last.tiles, turns: last.turns, x: last.x, y: last.y });
    if (no !== null) cannotUndo(no);
  } else doNow({ do: "turn", ...xy(last.i), dir: last.was });
  yardSfx.undo();
  // What was marked or in hand may be what was undone.
  if (S.tool === "select") {
    letGo();
    S.aim = null;
  }
  keepAim();
  toolHooks.changed();
  return true;
}

// ---------- runs of belt ----------

/** The tiles a drag has passed over, in order. */
let path: { x: number; y: number }[] = [];

const way = (a: { x: number; y: number }, b: { x: number; y: number }): Dir =>
  b.x > a.x ? 0 : b.x < a.x ? 2 : b.y > a.y ? 1 : 3;

/**
 * Works out the run the drag so far would lay: a belt on every clear tile, each pointing at the
 * next, at the grade in hand; and along a belt that already runs that way at a lower grade, that
 * belt raised.
 */
function reckon(): void {
  const w = S.world;
  const grade = gradeInHand(BELT);
  const legs: Leg[] = [];
  const turns: { x: number; y: number; dir: Dir }[] = [];
  let bad: string | null = null;
  path.forEach((t, k) => {
    const next = path[k + 1];
    const prev = path[k - 1];
    let dir = next ? way(t, next) : prev ? way(prev, t) : S.dir;
    // A run that ends beside the depot was meant to go in: its last belt turns to face the wall.
    if (!next && prev && kindAt(w, t.x + DX[dir], t.y + DY[dir]) !== DEPOT)
      for (const d of [0, 1, 2, 3] as const) if (kindAt(w, t.x + DX[d], t.y + DY[d]) === DEPOT) dir = d;
    const there = kindAt(w, t.x, t.y);
    const i = at(w, t.x, t.y);
    if (there === NONE) {
      const why = refusal(w, BELT, t.x, t.y, Infinity, dir, { grade });
      if (why !== null) bad ??= why;
      else legs.push({ tunnel: false, x: t.x, y: t.y, dir, grade });
    } else if (there === BELT && dirOf(i) === dir && (w.grade[i] ?? 1) < grade)
      legs.push({ tunnel: false, x: t.x, y: t.y, dir, grade });
    else if (there === BELT && k === 0 && next && dirOf(i) !== dir) turns.push({ x: t.x, y: t.y, dir });
    // Anything else in the way is stepped over: the belt before it points into it.
  });
  const last = path.at(-1);
  if (path.length > 1) {
    S.run = runOf(legs, turns, bad);
    if (last) S.aim = aimed(last.x, last.y, S.run.why, S.run.cost);
  } else {
    S.run = null;
    if (last) aimAt(last.x, last.y);
  }
  toolHooks.changed();
}

/**
 * A run as it would be laid: its legs, the belt it turns where it starts, what it costs, and why it
 * cannot be (`bad`, a tile it cannot cross, or else what the rules say of the purse now).
 */
function runOf(legs: Leg[], turns: Run["turns"], bad: string | null): Run {
  const pieces = legs.map(legPiece);
  const why = bad ?? standRefusal(S.world, pieces, coins());
  return { legs, turns, cost: priceOf(S.world, pieces), why, rev: S.rev, coins: coins() };
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

/** Lays the run that is showing, worked out again first if the yard or the purse has changed under it. */
export function commitRun(): boolean {
  keepAim();
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
  const was = bend ? dirOf(at(w, bend.x, bend.y)) : undefined;
  // The belts the run is laid along, which it raises: as they stand, to put back.
  const raised = run.legs.flatMap((leg) =>
    kindAt(w, leg.x, leg.y) === BELT ? (standing(at(w, leg.x, leg.y)) ?? []) : [],
  );
  const clear = new Set(run.legs.filter((leg) => kindAt(w, leg.x, leg.y) === NONE));
  const no = does(bend ? { do: "lay", legs: run.legs, turn: bend } : { do: "lay", legs: run.legs });
  if (no !== null) {
    yardSfx.no();
    toolHooks.said(`${no}.`);
    toolHooks.changed();
    return false;
  }
  const turned = bend && was !== undefined ? [{ i: at(w, bend.x, bend.y), was }] : [];
  const cells: number[] = [];
  run.legs.forEach((leg, n) => {
    const i = at(w, leg.x, leg.y);
    if (clear.has(leg)) cells.push(i);
    const far = leg.tunnel ? otherMouth(w, i) : -1;
    if (far >= 0) cells.push(far);
    // The belts go down one after another along the run, each with its own clack.
    window.setTimeout(
      () => {
        landed(leg.x, leg.y, !leg.tunnel, n);
      },
      Math.min(n, 14) * 28,
    );
  });
  remember({ did: "built", cells, turned, ...(raised.length > 0 ? { was: raised } : {}) });
  const end = run.legs.at(-1);
  if (end) {
    S.dir = end.dir;
    paid(end.x, end.y, run.cost);
  }
  toolHooks.changed();
  return true;
}

/**
 * A tap with the belt in hand, for fingers: the first tap says where the run starts, the second
 * where it ends, and the shortest clear way between them is shown before it is laid. Tapping a
 * piece to start from begins the run on the tile ahead of it, the way it faces: where a machine
 * hands things on, or a splitter's way ahead.
 */
export function tapBelt(x: number, y: number): void {
  if (!S.from || (S.run === null && S.from.x === x && S.from.y === y)) {
    if (S.from) {
      // The same tile twice: one belt, the way the hand is pointing.
      S.from = null;
      place(x, y);
      return;
    }
    S.from = { x, y };
    startAt(x, y);
    toolHooks.changed();
    return;
  }
  runTo(x, y);
  toolHooks.changed();
}

/** Where a finger's run starts, aimed: a clear tile as a belt would be, or a piece to start from, which stands as it is. */
function startAt(x: number, y: number): void {
  S.run = null;
  aimAt(x, y);
  if (kindAt(S.world, x, y) !== NONE) S.aim = aimed(x, y, null, 0);
}

/** The run from where a finger's run starts (`S.from`; on a piece, the tile ahead of it) to a tile: the shortest clear way. */
function runTo(x: number, y: number): void {
  const w = S.world;
  if (!S.from) return;
  let sx = S.from.x;
  let sy = S.from.y;
  if (kindAt(w, sx, sy) !== NONE) {
    const out = ahead(w, at(w, sx, sy));
    if (out >= 0) {
      sx = out % W();
      sy = Math.floor(out / W());
    }
  }
  // The router's run, each leg at the grade in hand for its kind.
  const found = sx === x && sy === y && kindAt(w, x, y) !== NONE ? null : route(w, [sx, sy], [x, y]);
  const legs = found?.map((leg): Leg => {
    const { x: lx, y: ly, dir } = leg;
    return leg.tunnel
      ? { tunnel: true, x: lx, y: ly, dir, span: leg.span, grade: gradeInHand(TUNNEL) }
      : { tunnel: false, x: lx, y: ly, dir, grade: gradeInHand(BELT) };
  });
  S.run = runOf(legs ?? [], [], legs ? null : "No free path for a belt from there to here");
  S.aim = aimed(x, y, S.run.why, S.run.cost);
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

/** Marks afresh what stands on the marked tiles now: a piece of it may have been taken away, or changed from its card. */
function remark(): void {
  if (S.mark) markTiles(S.mark, S.mark.tiles);
}

/** Marks what stands on some tiles, within a box: an area just marked, or one a piece has since been taken out of. */
function markTiles(box: Pick<Mark, "x0" | "y0" | "x1" | "y1">, tiles: readonly number[]): void {
  const w = S.world;
  const pieces = piecesAt(w, tiles);
  // What they cost: what taking them away gives back.
  const cost = pieces.reduce((sum, p) => sum + worthAt(w, at(w, p.x, p.y)), 0);
  const stood = tiles.filter((i) => w.kind[i] !== NONE);
  S.mark = { x0: box.x0, y0: box.y0, x1: box.x1, y1: box.y1, tiles: stood, pieces, cost };
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

/**
 * The pieces in hand as they stand now, at no place yet: a blueprint's, or what stands on the tiles
 * taken up (a move or a copy sets down what stands there, as the rules do).
 */
export function piecesInHand(g: Pick<Group, "as" | "tiles">): Piece[] {
  if (typeof g.as !== "number") return piecesAt(S.world, g.tiles);
  const print = S.world.blueprints[g.as];
  return print ? piecesOf(print) : [];
}

/** Takes in hand the marked pieces, to move them or to stand a copy of them, or the blueprint kept in a place. */
export function hold(as: Group["as"]): void {
  remark();
  const tiles = typeof as === "number" ? [] : (S.mark?.tiles ?? []);
  if (piecesInHand({ as, tiles }).length === 0) return;
  if (typeof as === "number") S.mark = null;
  S.group = { as, tiles, turns: 0, at: [], why: [] };
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
  const from = piecesInHand(g);
  const box = boxOf(placed(from, g.turns, 0, 0));
  g.at = placed(from, g.turns, x - ((box.w - 1) >> 1), y - ((box.h - 1) >> 1));
  const moving = g.as === "move";
  g.why = refusals(w, g.at, moving ? tilesOf(w, from) : null);
  const why = moving ? (g.why.find((r) => r !== null) ?? null) : standRefusal(w, g.at, coins(), g.why);
  S.aim = aimed(x, y, why, moving ? 0 : priceOf(w, g.at));
}

/** The quarter turns that undo so many. */
const TURNS_BACK = [0, 3, 2, 1] as const;

/**
 * Sets the pieces in hand down where they are aimed, all of them or none, in one command: a move,
 * a copy or a blueprint, each naming the turns and the corner. What is in hand is worked out again
 * first if the yard or the purse has changed since it was aimed, and the rules judge the command as
 * it is sent. Moved pieces are done with, and stay marked where they now stand; a copy or a
 * blueprint stays in hand for another.
 */
function setDown(): boolean {
  keepAim();
  const w = S.world;
  const g = S.group;
  const aim = S.aim;
  if (!g || !aim) return false;
  const box = boxOf(g.at);
  const tiles = tilesOf(w, g.at);
  // What a copy would stand that is not there now, and the pieces some of it would take the place of.
  const stood = g.at.filter((p) => kindAt(w, p.x, p.y) !== p.kind);
  const under = stood.flatMap((p) => standing(at(w, p.x, p.y)) ?? []);
  // Pieces of the same kind already standing there that the rules would turn, raise or lower: as they stand now.
  const changed = g.at.flatMap((p) => {
    const i = at(w, p.x, p.y);
    if (kindAt(w, p.x, p.y) !== p.kind) return [];
    const turns = p.kind !== TUNNEL && dirOf(i) !== p.dir;
    return turns || gradeOf(p.kind, p.grade) !== (w.grade[i] ?? 0) ? (standing(i) ?? []) : [];
  });
  const moving = g.as === "move";
  // A copy over itself, just set down: nothing the rules would change, so nothing is sent.
  if (!moving && aim.why === null && stood.length === 0 && changed.length === 0) return false;
  const was = boxOf(piecesInHand(g));
  const act: Act =
    typeof g.as === "number"
      ? { do: "placeBlueprint", slot: g.as, turns: g.turns, x: box.x, y: box.y }
      : { do: g.as, tiles: g.tiles, turns: g.turns, x: box.x, y: box.y };
  const no = does(act);
  if (no !== null) {
    yardSfx.no();
    toolHooks.said(`${no}.`);
    return false;
  }
  if (moving) {
    remember({ did: "moved", tiles, turns: TURNS_BACK[g.turns], x: was.x, y: was.y });
    S.group = null;
    S.aim = null;
    const [x1, y1] = [box.x + box.w - 1, box.y + box.h - 1];
    S.mark = { x0: box.x, y0: box.y, x1, y1, tiles, pieces: g.at, cost: S.mark?.cost ?? 0 };
  } else {
    remember({ did: "built", cells: tilesOf(w, stood), turned: [], under, was: changed });
    paid(aim.x, aim.y, aim.cost);
  }
  // The pieces land in a wave out from the pointer, each ring of it with one sound.
  const wave: Piece[][] = [];
  for (const p of g.at) (wave[Math.min(14, Math.round(Math.hypot(p.x - aim.x, p.y - aim.y)))] ??= []).push(p);
  wave.forEach((these, n) => {
    window.setTimeout(() => {
      these.forEach((p, k) => {
        landed(p.x, p.y, p.kind === BELT, n, k > 0);
      });
    }, n * 28);
  });
  // A copy stays in hand: under the mouse where it is, and for a finger until it is aimed again.
  if (S.group && !S.finger) aimAt(aim.x, aim.y);
  else S.aim = null;
  toolHooks.changed();
  return true;
}

/** Takes away everything marked, at once. */
export function clearMark(): boolean {
  remark();
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
  toolHooks.changed();
  return true;
}

/** What raising everything marked to the highest grade the yard may build would cost: 0 where nothing marked can be raised. */
export function upgradeCost(): number {
  return S.mark && !S.group ? upgradePrice(S.world, S.mark.tiles) : 0;
}

/**
 * Raises every piece marked to the highest grade the yard may build of its kind, all of them or
 * none, for the whole price. Says whether it did; the rules' reason is said when it could not.
 */
export function upgradeMark(): boolean {
  remark();
  const w = S.world;
  const m = S.mark;
  if (!m || S.group) return false;
  const was = m.pieces.filter((p) => isGraded(p.kind) && gradeOf(p.kind, p.grade) < highest(w.open, p.kind));
  const cost = upgradePrice(w, m.tiles);
  const no = does({ do: "upgrade", tiles: m.tiles });
  if (no !== null) {
    yardSfx.no();
    toolHooks.said(`${no}.`);
    return false;
  }
  remember({ did: "raised", was });
  for (const p of was.slice(0, 160)) sparkle(p.x * TILE + 8, p.y * TILE + 6, 2, 5);
  if (cost > 0) float(((m.x0 + m.x1 + 1) / 2) * TILE, m.y0 * TILE, `-${cost}`, GOLD[0], 1.2);
  yardSfx.ready();
  remark();
  toolHooks.changed();
  return true;
}

/** Save was pressed: the places are offered, unless the marked pieces cannot be a blueprint. */
export function askSave(): void {
  // Whichever place it goes in, the pieces themselves must be ones a blueprint may hold.
  const no = S.mark ? blueprintRefusal(S.world.open, 0, S.mark.pieces) : null;
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
  if (!m || does({ do: "saveBlueprint", slot, tiles: m.tiles }) !== null) return false;
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

// ---------- land, and the node in hand ----------

/** Buys a plot: the undergrowth comes down from its signpost outwards, before the member's eyes. */
export function buyLand(id: Plot): boolean {
  const w = S.world;
  const plot = w.land.plots.find((p) => p.plot === id);
  const sign = layout(w, S.rev).signs.find((s) => s.plot.plot === id);
  const no = plot ? does({ do: "buyPlot", plot: id }) : "There is no such plot";
  if (!plot || no !== null) {
    yardSfx.no();
    toolHooks.said(`${no}.`);
    return false;
  }
  const from = sign ?? { x: (plot.x + plot.w / 2) * TILE, y: (plot.y + plot.h / 2) * TILE };
  S.clearing.set(id, { at: S.t, x: from.x, y: from.y });
  yardSfx.clear();
  float(from.x, from.y - 20, plot.name, GOLD[2], 2.4);
  return true;
}

/** Each frame: leaves fly where the undergrowth is coming down, and a cleared plot is done with. */
export function stepClearing(): void {
  const w = S.world;
  for (const [id, c] of S.clearing) {
    const plot = w.land.plots.find((p) => p.plot === id);
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

/** Takes a project, or the commission, in hand: what reaches the depot goes to it first. Says why not, or nothing. */
export function takeInHand(g: Goal): string | null {
  const no = does({ do: "take", node: g });
  if (no !== null) {
    yardSfx.no();
    toolHooks.said(`${no}.`);
    return no;
  }
  yardSfx.plan();
  toolHooks.changed();
  return null;
}
