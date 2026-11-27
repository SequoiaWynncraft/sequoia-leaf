/**
 * A tunnel takes two clicks (or taps): the first sets where it goes in (`setWayIn`), and builds
 * nothing; the second, where it comes up (`comesUp`), builds both ends at once, that far apart.
 * Between them the tunnel is aimed at the tile pointed at (`tunnelAim`): it comes up there when it
 * can, and otherwise the far mouth shown is the nearest tile it can come up at, and the aim says why
 * the tile pointed at will not do. A second click where it goes in comes up at that nearest tile, as
 * one click did before.
 */

import { at, type Dir, DX, DY, kindAt, NONE, priceAt, refusal, TUNNEL, tunnelExit } from "@sequoia-leaf/factory";
import { num } from "@sequoia-leaf/kit/say.ts";

import { tunnelAct } from "./acts.ts";
import { reaches, reachOf } from "./figure/reach.ts";
import type { Tile } from "./hand.ts";
import { aimed, landed, paid, refused } from "./outcome.ts";
import { yardSfx } from "./sound.ts";
import { type Aim, gradeInHand, moveHand, S, toolHooks } from "./state.ts";
import { coins, doNow } from "./yard.ts";

/** How many tiles straight ahead of `from`, going way `d`, a tile is: 0 for one that is not ahead. */
function ahead(from: Tile, x: number, y: number, d: Dir): number {
  if (DX[d] !== 0) return y === from.y ? Math.max(0, (x - from.x) * DX[d]) : 0;
  return x === from.x ? Math.max(0, (y - from.y) * DY[d]) : 0;
}

/** Brought to a tile in line with where it goes in, the tunnel faces that tile. */
function facing(from: Tile, x: number, y: number): void {
  const here = x === from.x && y === from.y;
  if (here || (x !== from.x && y !== from.y)) return;
  const d: Dir = x > from.x ? 0 : x < from.x ? 2 : y > from.y ? 1 : 3;
  if (S.dir === d) return;
  S.dir = d;
  toolHooks.changed();
}

/** Why a tunnel going in at `from` the way it faces cannot come up on a tile other than `from`, or nothing if it can. */
function whyNot(from: Tile, x: number, y: number, grade: number): string | null {
  const w = S.world;
  const n = ahead(from, x, y, S.dir);
  const most = w.open.span;
  if (n < 1) return "A tunnel comes up straight ahead of where it goes in";
  if (n < 2 || n > most + 1) return `A tunnel passes under ${most === 1 ? "1 tile" : `1 to ${num(most)} tiles`}`;
  if (kindAt(w, x, y) !== NONE) return "Something is here already";
  return refusal(w, TUNNEL, from.x, from.y, coins(), S.dir, { grade, span: n - 1 });
}

/**
 * The tunnel whose way in is set (`from`), aimed at a tile. Brought to a tile in line with the way in
 * anew (not the tile it last took its facing from, `faced`), it faces that way, until R turns it, as a
 * piece brought over a belt faces the belt. It comes up on the tile if the tile is straight ahead,
 * within its reach and free; aimed at the way in itself, at the nearest tile it can. Aimed anywhere
 * else, the far mouth shown is that nearest tile, and the aim says why this one will not do.
 */
export function tunnelAim(from: Tile, faced: number, x: number, y: number): Aim {
  const w = S.world;
  const here = x === from.x && y === from.y;
  if (faced !== at(w, x, y)) facing(from, x, y);
  const grade = gradeInHand(TUNNEL);
  const rules = here ? refusal(w, TUNNEL, from.x, from.y, coins(), S.dir, { grade }) : whyNot(from, x, y, grade);
  const exit = here || rules !== null ? tunnelExit(w, from.x, from.y, S.dir) : { x, y };
  // Out of reach is judged on the very command `comesUp` would send for the far mouth shown.
  const why = (exit && reachOf(tunnelAct(from, here, exit, grade))) ?? rules;
  const cost = priceAt(w, TUNNEL, from.x, from.y, grade);
  return { ...aimed(x, y, why, cost, exit ? at(w, exit.x, exit.y) : -1), grade };
}

/**
 * A click or tap with the tunnel in hand and no way in set, on a clear tile in reach it could go in
 * at, some way: its way in is set there, and nothing is built yet. Says whether it was set.
 */
export function setWayIn(x: number, y: number): boolean {
  const w = S.world;
  const h = S.hand;
  const grade = gradeInHand(TUNNEL);
  const may = (d: Dir): boolean => refusal(w, TUNNEL, x, y, Infinity, d, { grade }) === null;
  // Out of reach it is not set: the press builds there instead, which reach refuses, and says so.
  const free = kindAt(w, x, y) === NONE && reaches(x, y);
  if (h.is !== "build" || h.kind !== TUNNEL || !free || !([0, 1, 2, 3] as const).some(may)) return false;
  moveHand({ do: "from", from: { x, y } });
  moveHand({ do: "aim", aim: tunnelAim({ x, y }, -1, x, y), faced: at(w, x, y) });
  yardSfx.pick();
  toolHooks.changed();
  return true;
}

/**
 * The second click with the way in set (`from`), on a tile: the tunnel comes up there, both ends laid
 * at once, that many tiles apart; or on the way in itself, at the nearest tile it can, built as one
 * click built it. Where it cannot come up, nothing is built. Says whether it was built: then the
 * tunnel is in hand again, with no way in set.
 */
export function comesUp(from: Tile, x: number, y: number): boolean {
  const w = S.world;
  const h = S.hand;
  const a = tunnelAim(from, h.is === "tunnel" ? h.faced : -1, x, y);
  moveHand({ do: "aim", aim: a, faced: at(w, x, y) });
  const far = a.far ?? -1;
  if (a.why !== null || far < 0) {
    yardSfx.no();
    toolHooks.changed();
    return false;
  }
  const out = { x: far % w.land.w, y: Math.floor(far / w.land.w) };
  const did = doNow(tunnelAct(from, x === from.x && y === from.y, out, a.grade ?? 1));
  if (refused(did)) return false;
  landed(from.x, from.y, false);
  landed(out.x, out.y, false, 0, true);
  paid(from.x, from.y, a.cost);
  moveHand({ do: "from", from: null });
  toolHooks.changed();
  return true;
}
