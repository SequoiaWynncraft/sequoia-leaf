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
 *
 * A tunnel takes two clicks (or taps): the first sets where it goes in, the second where it comes up.
 */

import {
  at,
  BELT,
  boxOf,
  DEPOT,
  type Dir,
  DX,
  DY,
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
  placed,
  priceAt,
  priceOf,
  refusal,
  refusals,
  replaces,
  RIGHT,
  route,
  SORTER,
  standRefusal,
  tilesOf,
  TUNNEL,
  tunnelExit,
  upgradePrice,
  within,
  worthAt,
} from "@sequoia-leaf/factory";
import { close as closeCards } from "@sequoia-leaf/kit/card.ts";
import { GOLD, SKY } from "@sequoia-leaf/kit/palette.ts";

import { buildAct, gradeOn, groupAct, layAct, raisedOn } from "./acts.ts";
import { PAINTS, TILE } from "./art/belts.ts";
import { OUT_OF_REACH, reachOf, withReach } from "./figure/reach.ts";
import { float, flutter, puff, sparkle } from "./fx.ts";
import { aimOf, groupOf, markOf, runOf, type Tile } from "./hand.ts";
import { keepsRight, sendsRight } from "./layout.ts";
import { aimed, DUST, landed, paid, refused } from "./outcome.ts";
import { aimYard, isWhole, piecesInHand, pressYard } from "./plans.ts";
import { yardSfx } from "./sound.ts";
import {
  type Aim,
  builds,
  draws,
  gradeInHand,
  type Group,
  type Mark,
  moveHand,
  type Reckoned,
  type Run,
  S,
  type Tool,
  toolHooks,
} from "./state.ts";
import { comesUp, setWayIn, tunnelAim, wayInAim } from "./tunnel.ts";
import { runOut, stepWay } from "./ways.ts";
import { coins, doNow } from "./yard.ts";

const W = (): number => S.world.land.w;

/** Moves what is in hand (`moveHand`). */
const go = moveHand;

/**
 * Whether what was worked out is of the yard and the purse as they are now: the same yard, and Coins
 * that still cover its cost, or that fall short of it by as much as before. The till's whole Coins
 * go up as the yard earns; an aim they covered and still cover is not worked out again for that.
 */
function fresh(r: Reckoned): boolean {
  const now = coins();
  return r.yard === S.world && r.rev === S.world.rev && (r.coins === now || (r.cost <= r.coins && r.cost <= now));
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
  go({ do: "pick", tool });
  // Taking up a tool closes the card pinned open.
  if (tool !== null) closeCards();
  if (S.hover && tool !== null) aimAt(S.hover.x, S.hover.y);
  toolHooks.changed();
}

/** Chooses the grade the kind in hand is built at: kept for that kind. */
export function setGrade(grade: number): void {
  const tool = S.tool;
  if (!builds(tool) || !isGraded(tool) || grade < 1 || grade > highest(S.world.open, tool)) return;
  S.grades[tool] = grade;
  // What is aimed, a finger's run and a drag are all at the grade in hand: each is worked out again,
  // and a piece now raised where it is aimed lends the hand its facing, as one pointed at anew does.
  if (S.hand.is === "build") go({ do: "aim", aim: S.hand.aim, faced: -1 });
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
  const h = S.hand;
  switch (h.is) {
    case "idle":
      return;
    case "select":
      if (h.stage.is === "holding") aimGroup(x, y);
      return;
    case "remove": {
      const there = kindAt(w, x, y);
      const why = there === NONE ? "Nothing to remove here" : there === DEPOT ? "The depot cannot be removed" : null;
      go({ do: "aim", aim: aimed(x, y, reachOf({ do: "remove", x, y }) ?? why, 0) });
      return;
    }
    case "paint":
      go({ do: "aim", aim: aimed(x, y, lineOf(w, at(w, x, y)).length > 0 ? null : "Nothing to paint here", 0) });
      return;
    case "beltDrag":
    case "beltTaps":
      go({ do: "run", run: null, aim: buildAim(BELT, x, y) });
      return;
    case "tunnel":
      go({ do: "aim", aim: tunnelAim(h.from, h.faced, x, y), faced: at(w, x, y) });
      return;
    case "build": {
      const i = at(w, x, y);
      if (h.faced !== i) faceOver(h.kind, i);
      go({ do: "aim", aim: pressAim(h.kind, x, y), faced: i });
    }
  }
}

/** A kind in hand brought to a tile anew: over a piece it would replace or raise, it faces as that piece does, and a sorter sends to its side. */
function faceOver(k: Kind, i: number): void {
  const there = S.world.kind[i] ?? NONE;
  const over = there !== NONE && (replaces(k, there) || raisedOn(k, i) !== undefined);
  if (over && S.dir !== dirOf(i)) {
    S.dir = dirOf(i);
    toolHooks.changed();
  }
  sideOver(k, i);
}

/** What a press with a kind in hand does on a tile, aimed: with the tunnel and no way in set, sets it there where it can (`wayInAim`); else builds. */
const pressAim = (kind: Kind, x: number, y: number): Aim =>
  (kind === TUNNEL ? wayInAim(x, y) : null) ?? buildAim(kind, x, y);

/** What would come of building a kind on a tile, facing the way the hand faces: why not, the price, the grade, what it raises, a tunnel's far mouth. */
function buildAim(kind: Kind, x: number, y: number): Aim {
  const w = S.world;
  const i = at(w, x, y);
  // Over a tunnel it is raised where it stands, by the mouths that stand; else it comes up where the rules dig it.
  const exit = kind === TUNNEL && w.kind[i] !== TUNNEL ? tunnelExit(w, x, y, S.dir) : null;
  const far = exit ? at(w, exit.x, exit.y) : kind === TUNNEL ? otherMouth(w, i) : -1;
  const grade = gradeOn(kind, i);
  const raises = raisedOn(kind, i);
  const why = reachOf(buildAct(kind, x, y)) ?? refusal(w, kind, x, y, coins(), S.dir, { grade });
  return {
    ...aimed(x, y, why, priceAt(w, kind, x, y, grade), far),
    grade,
    ...(raises === undefined ? {} : { raises }),
  };
}

/**
 * The aim, a run shown before it is laid, and the pieces in hand as they would stand are each
 * worked out for a tile, a tool and what is in hand, from the yard and the purse as they were then.
 * They are kept while the pointer stays on that tile; when the yard has changed under them (a card's
 * button, a key, an undo, Leaf's yard taken: `y.rev`) or the Coins to hand have, they are worked out
 * again for the same tile. So what is shown, and what a press sets down, is of the yard as it is.
 * Each frame asks, and so does each press that acts on an aim. With `again`, they are worked out
 * again whatever: a grade chosen (`setGrade`) changes them and neither the yard nor the purse.
 */
export function keepAim(again = false): void {
  const h = S.hand;
  const stale = (r: Reckoned | null): boolean => r !== null && (again || !fresh(r));
  if (h.is === "beltDrag") {
    if (stale(h.run ?? h.aim)) reckon(h.path);
  } else if (h.is === "beltTaps") {
    if (h.run && h.aim && stale(h.run)) runTo(h.aim.x, h.aim.y);
    else if (!h.run && h.aim && stale(h.aim)) startAt(h.aim.x, h.aim.y);
  } else {
    const a = aimOf(h);
    if (a && stale(a)) aimAt(a.x, a.y);
  }
}

/** Uses the tool in hand on a tile. Says whether anything was done. */
export function place(x: number, y: number): boolean {
  const h = S.hand;
  if (h.is === "idle") return false;
  if (h.is === "remove") return takeAway(x, y);
  if (h.is === "paint") return paintAt(x, y);
  if (h.is === "select") return setDown();
  if (h.is === "tunnel") return comesUp(h.from, x, y);
  const tool = h.is === "build" ? h.kind : BELT;
  const w = S.world;
  const i = at(w, x, y);
  const there = kindAt(w, x, y);
  const was = there === NONE ? undefined : dirOf(i);
  const wasRight = sendsRight(w, i);
  const under = there !== NONE && replaces(tool, there);
  const grade = gradeOn(tool, i);
  // Over a piece of its kind of a lower grade: that piece is raised.
  const raised = raisedOn(tool, i) !== undefined;
  const cost = priceAt(w, tool, x, y, grade);
  const did = doNow(buildAct(tool, x, y));
  if ("refused" in did) {
    go({ do: "aim", aim: aimed(x, y, did.why, 0) });
    yardSfx.no();
    toolHooks.changed();
    return false;
  }
  if (raised) lifted(x, y, cost);
  else if (there !== NONE && !under) {
    // Over a piece of its kind: turned, or a sorter flipped.
    if (was !== dirOf(i) || sendsRight(w, i) !== wasRight) yardSfx.turn();
  } else {
    const far = w.kind[i] === TUNNEL ? otherMouth(w, i) : -1;
    if (far >= 0) landed(far % W(), Math.floor(far / W()), false);
    landed(x, y, tool === BELT);
    paid(x, y, cost);
  }
  aimAt(x, y);
  toolHooks.changed();
  return true;
}

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
  if (!isKind(k) || k === DEPOT) return false;
  const grade = (w.grade[i] ?? 0) + 1;
  const cost = priceAt(w, k, x, y, grade);
  const did = doNow({ do: "build", kind: k, x, y, dir: dirOf(i), grade });
  if (refused(did)) return false;
  lifted(x, y, cost);
  toolHooks.changed();
  return true;
}

/** Takes away whatever stands on a tile, and gives back what it cost. */
export function takeAway(x: number, y: number, quiet = false): boolean {
  const w = S.world;
  const i = at(w, x, y);
  const did = doNow({ do: "remove", x, y });
  if ("refused" in did) {
    if (!quiet) go({ do: "aim", aim: aimed(x, y, did.why, 0) });
    // Said where the player is looking, a card's Remove too; a sweep of the right button says only reach.
    if (!quiet || did.why === OUT_OF_REACH) refused(did);
    return false;
  }
  const px = x * TILE + 8;
  const py = (y + 1) * TILE - 4;
  puff(px, py, 6, DUST, 9);
  const refund = coinsOf(did);
  if (refund > 0) float(px, py - 10, `+${refund}`, GOLD[2], 1);
  yardSfx.take();
  // The card of what was taken away has nothing to be about.
  if (S.picked === i) closeCards();
  // A piece taken out of a marked area is no longer marked.
  const m = remarked();
  if (m) go({ do: "marked", mark: m.pieces.length > 0 ? m : null });
  toolHooks.changed();
  return true;
}

/**
 * Colours the line through a tile with the colour on the brush. `more` is a drag going on (a stroke
 * the hand still holds): its lines are undone together, each command after the first saying the
 * entry it adds to (`onto`, the newest, which the stroke keeps), and passing over what cannot be
 * coloured says nothing. Without it, a tap or a press begins a stroke of its own (`pointer`), whether
 * or not it colours anything where it lands. Nothing is coloured with the brush out of hand.
 */
export function paintAt(x: number, y: number, more = false, pointer = -1): boolean {
  if (S.hand.is !== "paint" || (more && S.hand.stroke === null)) return false;
  if (!more) go({ do: "stroke", pointer, id: null });
  const stroke = S.hand.is === "paint" ? S.hand.stroke : null;
  const w = S.world;
  const i = at(w, x, y);
  const line = lineOf(w, i);
  // A line that is that colour already is let be: a drag crosses the same line many times.
  if (line.length > 0 && line.every((j) => w.tint[j] === S.tint)) return false;
  const onto = stroke?.id ?? null;
  const did = doNow({ do: "paint", x, y, tint: S.tint, ...(onto === null ? {} : { onto }) });
  if ("refused" in did) {
    if (!more) {
      yardSfx.no();
      toolHooks.said(`${did.why}.`);
    }
    return false;
  }
  // The stroke's lines are one entry, the newest: the next line it colours adds to it.
  if (stroke) go({ do: "stroke", pointer: stroke.pointer, id: S.world.history.at(-1)?.id ?? null });
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
  const did = doNow({ do: "turn", x, y, dir: RIGHT[dirOf(i)] });
  if ("refused" in did) return false;
  yardSfx.turn();
  return true;
}

/** Moves one of the ways out of the splitter on a tile (0 ahead, 1 left, 2 right) on a step (`stepWay`). */
export function wayAt(x: number, y: number, way: number): boolean {
  const w = S.world;
  const i = at(w, x, y);
  const act = stepWay(w, i, x, y, way);
  const did = i < 0 ? null : doNow(act);
  if (!did || "refused" in did) {
    yardSfx.no();
    return false;
  }
  const putFirst = act.do === "first";
  // Dust where the bar drops across the way, or lifts off it; plum bits where a flag goes up.
  const dir = dirOf(i);
  const d = [dir, LEFT[dir], RIGHT[dir]][way] ?? dir;
  const ex = x * TILE + 8 + DX[d] * 7;
  const ey = y * TILE + 9 + DY[d] * 7;
  if (putFirst) flutter(ex, ey - 4, 4, [SKY[3], SKY[4]], 4, 14);
  else puff(ex, ey, 3, DUST, 5);
  if (putFirst) yardSfx.plan();
  else if (act.do === "way" && act.open) yardSfx.belt();
  else yardSfx.turn();
  return true;
}

/** R: turns the thing in hand, or with nothing in hand the thing pointed at. */
export function rotate(): void {
  const h = S.hand;
  if (h.is === "idle") {
    const on = S.picked >= 0 ? xy(S.picked) : S.hover;
    if (on) turnAt(on.x, on.y);
    return;
  }
  if (h.is === "select") {
    if (h.stage.is !== "holding") return;
    const g = h.stage.group;
    go({ do: "group", group: { ...g, turns: RIGHT[g.turns] }, aim: h.stage.aim });
  } else if (h.is === "build" || h.is === "beltDrag" || h.is === "beltTaps" || h.is === "tunnel") S.dir = RIGHT[S.dir];
  else return;
  yardSfx.turn();
  keepAim(true);
  toolHooks.changed();
}

/** A sorter in hand, brought over a sorter, sends to that one's side, as it faces its way, until it is flipped. */
function sideOver(tool: Kind, i: number): void {
  if (tool !== SORTER || S.world.kind[i] !== SORTER || S.right === sendsRight(S.world, i)) return;
  S.right = !S.right;
  toolHooks.changed();
}

/** X: flips the sorter in hand to send to its other side, or with nothing in hand the sorter pointed at. */
export function flip(): void {
  const h = S.hand;
  if (h.is === "idle") {
    const on = S.picked >= 0 ? xy(S.picked) : S.hover;
    if (on) flipAt(on.x, on.y);
    return;
  }
  if (h.is !== "build" || h.kind !== SORTER) return;
  S.right = !S.right;
  yardSfx.turn();
  keepAim(true);
  toolHooks.changed();
}

/** Flips the sorter on a tile to send the thing it is set to to its other side. Says whether it did. */
export function flipAt(x: number, y: number): boolean {
  const i = at(S.world, x, y);
  if (kindAt(S.world, x, y) !== SORTER) {
    yardSfx.no();
    return false;
  }
  const did = doNow({ do: "side", x, y, right: !sendsRight(S.world, i) });
  if ("refused" in did) return false;
  yardSfx.turn();
  return true;
}

/** Takes up the tool for whatever stands on a tile, facing the way it faces (a sorter to its side too), at its grade. */
export function pickFrom(x: number, y: number): boolean {
  const k = kindAt(S.world, x, y);
  if (k === NONE || k === DEPOT || !isKind(k) || !usable(k)) return false;
  const i = at(S.world, x, y);
  S.dir = dirOf(i);
  if (k === SORTER) S.right = sendsRight(S.world, i);
  if (isGraded(k)) S.grades[k] = S.world.grade[i] ?? 1;
  setTool(k);
  yardSfx.pick();
  return true;
}

/**
 * Undo pressed: the yard's newest entry undone by the rules, all of it or none, as one command done
 * on the copy at once and sent to Leaf (`doNow`), naming the entry so that another tab's Undo cannot
 * undo it twice. The rules' reason is said when it is not done. Gives back whether it was.
 */
export function undo(): boolean {
  const did = doNow({ do: "undo", entry: S.world.history.at(-1)?.id ?? "" });
  if (refused(did)) return false;
  yardSfx.undo();
  // What was marked or in hand may be what was undone.
  if (S.hand.is === "select") go({ do: "pick", tool: "select" });
  keepAim();
  toolHooks.changed();
  return true;
}

// ---------- runs of belt ----------

const way = (a: Tile, b: Tile): Dir => (b.x > a.x ? 0 : b.x < a.x ? 2 : b.y > a.y ? 1 : 3);

/**
 * Works out the run a drag over these tiles would lay: a belt on every clear tile, each pointing at
 * the next, at the grade in hand; and along a belt that already runs that way at a lower grade, that
 * belt raised. A drag over one tile is aimed as a single belt.
 */
function reckon(path: readonly Tile[]): void {
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
  if (path.length > 1 && last) {
    const run = runFrom(legs, turns, bad);
    go({ do: "run", run, aim: aimed(last.x, last.y, run.why, run.cost) });
  } else if (last) go({ do: "run", run: null, aim: buildAim(BELT, last.x, last.y) });
  toolHooks.changed();
}

/**
 * A run as it would be laid: its legs, the belt it turns where it starts, what it costs, and why it
 * cannot be (`bad`, a tile it cannot cross, or else what the rules say of the purse now).
 */
function runFrom(legs: Leg[], turns: Run["turns"], bad: string | null): Run {
  const pieces = legs.map(legPiece);
  const why = reachOf(layAct(legs, turns)) ?? bad ?? standRefusal(S.world, pieces, coins());
  return { legs, turns, cost: priceOf(S.world, pieces), why, yard: S.world, rev: S.world.rev, coins: coins() };
}

/** A drag with the belt in hand begins on a tile, with a press (`pointer`). */
export function runStart(x: number, y: number, pointer = 0): void {
  go({ do: "drag", pointer, path: [{ x, y }] });
  if (S.hand.is === "beltDrag") reckon(S.hand.path);
}

/** The drag has reached another tile: the run follows it a tile at a time, and shortens if it doubles back. */
export function runOver(x: number, y: number, pointer = 0): void {
  const h = S.hand;
  const start = h.is === "beltDrag" && h.pointer === pointer ? h.path.at(-1) : undefined;
  if (h.is !== "beltDrag" || !start) return;
  const path = [...h.path];
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
  go({ do: "drag", pointer, path });
  reckon(path);
}

/** Whether a drag is laying a run. */
export const running = (): boolean => S.hand.is === "beltDrag";

/** The drag is over: a single tile is a single belt; more is a run, laid all at once. */
export function runEnd(pointer = 0): void {
  const h = S.hand;
  if (h.is !== "beltDrag" || h.pointer !== pointer) return;
  const only = h.path.length === 1 ? h.path[0] : undefined;
  if (only) {
    go({ do: "laid" });
    place(only.x, only.y);
    return;
  }
  commitRun();
}

/** Lays the run that is showing, worked out again first if the yard or the purse has changed under it. */
export function commitRun(): boolean {
  keepAim();
  const run = runOf(S.hand);
  go({ do: "laid" });
  if (!run) return false;
  if (run.why !== null || run.legs.length + run.turns.length === 0) {
    yardSfx.no();
    if (run.why) toolHooks.said(`${run.why}.`);
    toolHooks.changed();
    return false;
  }
  // The first belt, already standing, turned to meet the run: all of it or none, with the run.
  const did = doNow(layAct(run.legs, run.turns));
  if ("refused" in did) {
    yardSfx.no();
    toolHooks.said(`${did.why}.`);
    toolHooks.changed();
    return false;
  }
  run.legs.forEach((leg, n) => {
    // The belts go down one after another along the run, each with its own clack.
    window.setTimeout(
      () => {
        landed(leg.x, leg.y, !leg.tunnel, n);
      },
      Math.min(n, 14) * 28,
    );
  });
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
 * piece to start from begins the run where it hands things on (`runOut`): the tile ahead of a
 * machine, a splitter's first way out that sends.
 */
export function tapBelt(x: number, y: number): void {
  const h = S.hand;
  if (h.is === "beltTaps" && h.run === null && h.from.x === x && h.from.y === y) {
    // The same tile twice: one belt, the way the hand is pointing.
    go({ do: "from", from: null });
    place(x, y);
    return;
  }
  if (h.is !== "beltTaps") {
    go({ do: "from", from: { x, y } });
    startAt(x, y);
    toolHooks.changed();
    return;
  }
  runTo(x, y);
  toolHooks.changed();
}

/**
 * Where a finger's run starts, aimed as the one belt Build (or a second tap there) would lay on that
 * tile: so on a machine it shows why a belt cannot go there, though the run tapped out next still
 * starts where the machine hands things on (`runTo`).
 */
function startAt(x: number, y: number): void {
  go({ do: "run", run: null, aim: buildAim(BELT, x, y) });
}

/** The run from where a finger's run starts (on a piece, the tile ahead of it) to a tile: the shortest clear way. */
function runTo(x: number, y: number): void {
  const w = S.world;
  const h = S.hand;
  if (h.is !== "beltTaps") return;
  let sx = h.from.x;
  let sy = h.from.y;
  if (kindAt(w, sx, sy) !== NONE) {
    const out = runOut(w, at(w, sx, sy));
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
  const run = runFrom(legs ?? [], [], legs ? null : "No free path for a belt from there to here");
  go({ do: "run", run, aim: aimed(x, y, run.why, run.cost) });
}

/** The gold button: builds what is aimed, or lays the run that is showing. */
export function confirm(): boolean {
  const h = S.hand;
  if (runOf(h)) return commitRun();
  const a = aimOf(h);
  if (!a || h.is === "idle") return false;
  // A finger's run with nowhere to go yet: one belt where it starts.
  if (h.is === "beltTaps") go({ do: "from", from: null });
  return place(a.x, a.y);
}

/** The mouse has left the yard: what it aimed at is let go; but a plan of the whole yard, which is aimed wherever the pointer is. */
export function unaim(): void {
  if (!isWhole(S.group?.as)) go({ do: "aim", aim: null });
}

/** Escape: what is in hand steps back one stage (`hand.ts`); a tunnel's way in let go, the tunnel is aimed where the mouse is. */
export function cancel(): void {
  const wayIn = S.hand.is === "tunnel";
  go({ do: "back", finger: S.finger });
  if (wayIn && S.hover) aimAt(S.hover.x, S.hover.y);
  toolHooks.changed();
}

// ---------- a drag, as the hand has it ----------

/**
 * A press with something in hand, on a tile, by a pointer: the brush begins a stroke, the belt a
 * run, Select an area (but with pieces held, which it sets down), the tunnel where it goes in,
 * and anything else is used there.
 */
export function press(x: number, y: number, pointer: number): void {
  const h = S.hand;
  if (h.is === "paint") paintAt(x, y, false, pointer);
  else if (h.is === "build" && h.kind === BELT) runStart(x, y, pointer);
  else if (h.is === "select" && h.stage.is !== "holding") {
    markStart(x, y, pointer);
    markOver(x, y, pointer);
  } else if (!setWayIn(x, y)) place(x, y);
}

/** The press has reached another tile: whatever drag the hand holds for it goes on; any other does nothing. */
export function dragOver(x: number, y: number, pointer: number): void {
  const h = S.hand;
  if (h.is === "beltDrag") runOver(x, y, pointer);
  else if (h.is === "select" && h.stage.is === "marking" && h.stage.pointer === pointer) markOver(x, y, pointer);
  else if (h.is === "paint" && h.stroke?.pointer === pointer) paintAt(x, y, true);
}

/** The press is let go: a run is laid, an area is marked, a stroke ends. */
export function dragEnd(pointer: number): void {
  const h = S.hand;
  if (h.is === "beltDrag") runEnd(pointer);
  else if (h.is === "select" && h.stage.is === "marking" && h.stage.pointer === pointer) markEnd();
  else if (h.is === "paint" && h.stroke?.pointer === pointer) go({ do: "stroked" });
}

/** The press is lost (the window lost focus, the browser cancelled it): whatever drag the hand holds ends, and does nothing more. */
export function dragLost(): void {
  go({ do: "drop" });
  toolHooks.changed();
}

// ---------- many pieces at once ----------

/** Marks the pieces in the rectangle of tiles between two corners. */
function markArea(a: Tile, b: Tile): Mark {
  const [x0, x1] = [Math.min(a.x, b.x), Math.max(a.x, b.x)];
  const [y0, y1] = [Math.min(a.y, b.y), Math.max(a.y, b.y)];
  return markTiles({ x0, y0, x1, y1 }, within(S.world, x0, y0, x1, y1));
}

/** The area marked, marked afresh with what stands on its tiles now: a piece of it may have been taken away, or changed from its card. */
function remarked(): Mark | null {
  const m = markOf(S.hand);
  return m ? markTiles(m, m.tiles) : null;
}

/** Marks what stands on some tiles, within a box: an area just marked, or one a piece has since been taken out of. */
function markTiles(box: Pick<Mark, "x0" | "y0" | "x1" | "y1">, tiles: readonly number[]): Mark {
  const w = S.world;
  const pieces = piecesAt(w, tiles);
  // What they cost: what taking them away gives back.
  const cost = pieces.reduce((sum, p) => sum + worthAt(w, at(w, p.x, p.y)), 0);
  const stood = tiles.filter((i) => w.kind[i] !== NONE);
  return { x0: box.x0, y0: box.y0, x1: box.x1, y1: box.y1, tiles: stood, pieces, cost };
}

/** One corner of an area: where a mouse's drag begins (`pointer`), or a finger's first tap. Whatever was marked is let go. */
export function markStart(x: number, y: number, pointer: number | null = null): void {
  go({ do: "corner", corner: { x, y }, pointer });
  toolHooks.changed();
}

/** The opposite corner, as far as the drag has come: the pieces between the two are marked. */
export function markOver(x: number, y: number, _pointer: number | null = null): void {
  const h = S.hand;
  if (h.is !== "select" || h.stage.is !== "marking") return;
  go({ do: "marking", mark: markArea(h.stage.corner, { x, y }) });
  toolHooks.changed();
}

/** The area is marked: an area with no piece in it marks nothing. */
export function markEnd(): void {
  const m = markOf(S.hand);
  const mark = m && m.pieces.length > 0 ? m : null;
  go({ do: "marked", mark });
  if (mark) yardSfx.pick();
  toolHooks.changed();
}

/**
 * Takes in hand the marked pieces, to move them or to stand a copy of them, or the blueprint kept in
 * a place. Given `only`, it takes the pieces on those tiles alone, with nothing marked: a card's
 * Move, which takes a tunnel's two mouths and not what crosses over between them.
 */
export function hold(as: Group["as"], only?: readonly number[]): void {
  if (S.hand.is !== "select") return;
  const mark = only ? null : remarked();
  const tiles = typeof as === "number" ? [] : (only ?? mark?.tiles ?? []);
  if (piecesInHand({ as, tiles }).length === 0) return;
  go({ do: "hold", group: { as, tiles, turns: 0, at: [], why: [] }, mark: typeof as === "number" ? null : mark });
  // A plan of the whole yard is aimed at once: it goes back where it was, wherever the pointer is.
  if (S.hover || isWhole(as)) aimAt(S.hover?.x ?? 0, S.hover?.y ?? 0);
  yardSfx.pick();
  toolHooks.changed();
}

/** Works out where the pieces in hand would stand with the middle of their box on a tile, and whether each can. */
function aimGroup(x: number, y: number): void {
  const w = S.world;
  const g = groupOf(S.hand);
  if (!g) return;
  if (isWhole(g.as)) return go(aimYard(g));
  const from = piecesInHand(g);
  const box = boxOf(placed(from, g.turns, 0, 0));
  const placedAt = placed(from, g.turns, x - ((box.w - 1) >> 1), y - ((box.h - 1) >> 1));
  const moving = g.as === "move";
  const whys = withReach(groupAct(g, placedAt), refusals(w, placedAt, moving ? tilesOf(w, from) : null));
  const why = moving ? (whys.find((r) => r !== null) ?? null) : standRefusal(w, placedAt, coins(), whys);
  go({
    do: "group",
    group: { ...g, at: placedAt, why: whys },
    aim: aimed(x, y, why, moving ? 0 : priceOf(w, placedAt)),
  });
}

/**
 * Sets the pieces in hand down where they are aimed, all of them or none, in one command: a move,
 * a copy or a blueprint, each naming the turns and the corner. What is in hand is worked out again
 * first if the yard or the purse has changed since it was aimed, and the rules judge the command as
 * it is sent. Moved pieces are done with, and stay marked where they now stand; a copy or a
 * blueprint stays in hand for another.
 */
function setDown(): boolean {
  keepAim();
  if (isWhole(S.group?.as)) return pressYard();
  const w = S.world;
  const h = S.hand;
  if (h.is !== "select" || h.stage.is !== "holding" || !h.stage.aim) return false;
  const g = h.stage.group;
  const aim = h.stage.aim;
  const box = boxOf(g.at);
  const tiles = tilesOf(w, g.at);
  // What a copy would stand that is not there now.
  const stood = g.at.filter((p) => kindAt(w, p.x, p.y) !== p.kind);
  // Pieces of the same kind already standing there that the rules would turn (a sorter to another
  // side too), raise or lower.
  const changes = g.at.some((p) => {
    const i = at(w, p.x, p.y);
    if (kindAt(w, p.x, p.y) !== p.kind) return false;
    const turns = (p.kind !== TUNNEL && dirOf(i) !== p.dir) || sendsRight(w, i) !== keepsRight(p);
    return turns || gradeOf(p.kind, p.grade) !== (w.grade[i] ?? 0);
  });
  const moving = g.as === "move";
  // A copy over itself, just set down: nothing the rules would change, so nothing is sent.
  if (!moving && aim.why === null && stood.length === 0 && !changes) return false;
  const did = doNow(groupAct(g, g.at));
  if (refused(did)) return false;
  if (moving) {
    const [x1, y1] = [box.x + box.w - 1, box.y + box.h - 1];
    go({ do: "unhold" });
    go({ do: "marked", mark: { x0: box.x, y0: box.y, x1, y1, tiles, pieces: g.at, cost: h.stage.mark?.cost ?? 0 } });
  } else paid(aim.x, aim.y, aim.cost);
  landWave(g.at, aim);
  // A copy stays in hand: under the mouse where it is, and for a finger until it is aimed again.
  if (groupOf(S.hand) && !S.finger) aimAt(aim.x, aim.y);
  else go({ do: "aim", aim: null });
  toolHooks.changed();
  return true;
}

/** Pieces set down land in a wave out from where they were aimed, each ring of it with one sound. */
function landWave(pieces: readonly Piece[], aim: Tile): void {
  const wave: Piece[][] = [];
  for (const p of pieces) (wave[Math.min(14, Math.round(Math.hypot(p.x - aim.x, p.y - aim.y)))] ??= []).push(p);
  wave.forEach((these, n) => {
    window.setTimeout(() => {
      these.forEach((p, k) => {
        landed(p.x, p.y, p.kind === BELT, n, k > 0);
      });
    }, n * 28);
  });
}

/** Takes away everything marked, at once. */
export function clearMark(): boolean {
  const m = remarked();
  if (!m || groupOf(S.hand)) return false;
  const did = doNow({ do: "clear", tiles: m.tiles });
  if (refused(did)) return false;
  for (const p of m.pieces) puff(p.x * TILE + 8, (p.y + 1) * TILE - 4, 3, DUST, 9);
  const refund = coinsOf(did);
  if (refund > 0) float(((m.x0 + m.x1 + 1) / 2) * TILE, m.y0 * TILE, `+${refund}`, GOLD[2], 1.2);
  yardSfx.take();
  go({ do: "marked", mark: null });
  if (m.tiles.includes(S.picked)) closeCards();
  toolHooks.changed();
  return true;
}

/** What Upgrade raises: the area marked, or with `all` the whole yard; nothing while pieces are in hand. */
function raising(all: boolean): Mark | null {
  const { w, h } = S.world.land;
  if (groupOf(S.hand)) return null;
  return all ? markArea({ x: 0, y: 0 }, { x: w - 1, y: h - 1 }) : remarked();
}

/** What raising everything marked (with `all`, everything in the yard) to the highest grade the yard may build would cost: 0 where nothing can be raised. */
export function upgradeCost(all = false): number {
  const m = raising(all);
  return m ? upgradePrice(S.world, m.tiles) : 0;
}

/**
 * Raises every piece marked (with `all`, every piece in the yard) to the highest grade the yard may
 * build of its kind, all of them or none, for the whole price. Says whether it did; the rules'
 * reason is said when it could not. Leaf is sent the tiles of the pieces it raises.
 */
export function upgradeMark(all = false): boolean {
  const w = S.world;
  const m = raising(all);
  if (!m) return false;
  const was = m.pieces.filter((p) => isGraded(p.kind) && gradeOf(p.kind, p.grade) < highest(w.open, p.kind));
  const cost = upgradePrice(w, m.tiles);
  const did = doNow({ do: "upgrade", tiles: tilesOf(w, was) });
  if (refused(did)) return false;
  for (const p of was.slice(0, 160)) sparkle(p.x * TILE + 8, p.y * TILE + 6, 2, 5);
  if (cost > 0) float(((m.x0 + m.x1 + 1) / 2) * TILE, m.y0 * TILE, `-${cost}`, GOLD[0], 1.2);
  yardSfx.ready();
  go({ do: "marked", mark: remarked() });
  toolHooks.changed();
  return true;
}
