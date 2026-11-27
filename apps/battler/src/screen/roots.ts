/**
 * Seqwawa's No GG Left Behind on the table, in five beats over the lead-in the table gives it
 * (`LOOKS.seqwawa.wind` steps before the rules say it goes off):
 *
 * 1. Wind-up: its sprout shakes (the `rustle` body, `motion.ts`).
 * 2. The catch: roots run out from its hex along the hex lines to every friend at once.
 * 3. Dread: they reach the fallen one's hex and wait there, coiled, the table dark round it.
 * 4. Release (the step it goes off): the roots flash, green numbers rise on everyone, and the
 *    fallen one is stood back up by the root (`rootsUp`).
 * 5. Aftermath: the roots stay, faint, under those hexes for the rest of the fight.
 *
 * Everything is counted from the step it goes off, on the fight's clock, as `hung.ts` counts gaz's.
 */
import { CREAM, EARTH, GREEN, INK, LEAF } from "@sequoia-leaf/kit/palette.ts";
import { R } from "@sequoia-leaf/kit/pix.ts";
import { clamp, type Ctx } from "@sequoia-leaf/kit/util.ts";
import type { Fight, FightEvent } from "@sequoia-leaf/raid";
import { distance, neighbours } from "@sequoia-leaf/raid/hex.ts";

import { clockNow, feetAt, fightNow, FOOT, FV, shownCell } from "./board.ts";
import { burst, motes, say } from "./fx.ts";
import { cellXY, HEX_CORNERS, type Pt } from "./geometry.ts";
import type { Lead } from "./playback.ts";
import { snd } from "./sounds.ts";
import { dimRound } from "./spells.ts";
import { V } from "./stage.ts";

/** Steps before it goes off that the roots set out, and that they reach where they are going. */
const SHOOT = 12;
const WAIT = 7;
/** Steps the roots stay bright after it goes off, before they sink to faint. */
const FADE = 10;

interface Reach {
  readonly fight: Fight;
  readonly by: number;
  /** Whoever it is for, and the hexes they stand on, in the same order. */
  readonly to: readonly number[];
  readonly cells: readonly number[];
  /** The step it goes off. */
  readonly at: number;
  /** Each root's way, hex by hex, from Seqwawa's hex to one of the cells. */
  readonly ways: readonly (readonly number[])[];
}
const reaches: Reach[] = [];
/** The hexes roots lie under for the rest of a fight. */
const stays: { fight: Fight; cell: number }[] = [];

/** The hexes from one to another, a neighbour at a time, each nearer than the last. */
function wayTo(from: number, to: number): number[] {
  const way = [from];
  let here = from;
  for (let guard = 0; here !== to && guard < 20; guard++) {
    const next = neighbours(here).toSorted((a, b) => distance(a, to) - distance(b, to) || a - b)[0];
    if (next === undefined) break;
    way.push(next);
    here = next;
  }
  return way;
}

/** The roots set out: begun by the lead-in to the cast, from Seqwawa's hex to every hex it is for. */
export function reachOut(l: Lead, ev: Extract<FightEvent, { t: "cast" }>): void {
  const fight = fightNow();
  const by = FV.actors[ev.id];
  if (!fight || !by) return;
  const home = by.unit.cell;
  reaches.push({
    fight,
    by: ev.id,
    to: ev.targets,
    cells: ev.cells,
    at: l.at,
    ways: ev.cells.map((c) => wayTo(home, c)),
  });
}

/** The one it is for who is down at the clock `c`: the fallen one the roots wait for. */
function fallenOf(r: Reach, c: number): number {
  return r.to.findIndex((id) => {
    const a = FV.actors[id];
    return a !== undefined && (a.gone || c >= a.fallAt);
  });
}

/** The corners of a hex as it is drawn, from the board's corner, clockwise from the top point. */
function cornersOf(cell: number): Pt[] {
  const c = cellXY(shownCell(cell));
  return HEX_CORNERS.map(([dx, dy]) => ({ x: c.x + dx, y: c.y + dy }));
}
const same = (p: Pt, q: Pt): boolean => Math.abs(p.x - q.x) < 1 && Math.abs(p.y - q.y) < 1;

/** Round a hex's edge from one of its corners to another, the shorter way, as corners after the first. */
function round(corners: readonly Pt[], from: number, to: number): Pt[] {
  const n = corners.length;
  const step = (to - from + n) % n <= n / 2 ? 1 : -1;
  const out: Pt[] = [];
  for (let i = from; i !== to;) {
    i = (i + step + n) % n;
    out.push(corners[i] ?? { x: 0, y: 0 });
  }
  return out;
}

/**
 * A root's way along the hex lines: out of Seqwawa's hex where it touches the next, round each hex on
 * the way to where it touches the one after, and once all the way round the hex it is for.
 */
function linesOf(way: readonly number[]): Pt[] {
  const first = way[0];
  if (first === undefined) return [];
  let at = 0;
  const pts: Pt[] = [];
  for (let i = 0; i < way.length; i++) {
    const here = cornersOf(way[i] ?? first);
    const next = way[i + 1];
    if (next === undefined) {
      // All the way round the hex it is for.
      for (let j = 1; j <= 6; j++) pts.push(here[(at + j) % 6] ?? { x: 0, y: 0 });
      break;
    }
    const there = cornersOf(next);
    const touching = here.flatMap((p, k) => (there.some((q) => same(p, q)) ? [k] : []));
    const apart = (k: number): number => Math.min((k - at + 6) % 6, (at - k + 6) % 6);
    const exit = touching.reduce((best, k) => (apart(k) < apart(best) ? k : best), touching[0] ?? 0);
    if (i === 0) pts.push(here[exit] ?? here[0] ?? { x: 0, y: 0 });
    else pts.push(...round(here, at, exit));
    at = there.findIndex((q) => same(q, here[exit] ?? q));
  }
  return pts;
}

/** A line of root through points, `k` of its length grown: Moss green, two pixels wide, edged dark. */
function drawLine(g: Ctx, pts: readonly Pt[], k: number, bright: boolean): void {
  const lens = pts.slice(1).map((p, i) => Math.hypot(p.x - (pts[i]?.x ?? p.x), p.y - (pts[i]?.y ?? p.y)));
  let left = k * lens.reduce((a, b) => a + b, 0);
  const dots: Pt[] = [];
  for (let i = 0; i < lens.length && left > 0; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const len = lens[i] ?? 0;
    if (!a || !b) break;
    for (let d = 0; d <= Math.min(len, left); d++)
      dots.push({
        x: Math.round(V.bx + a.x + ((b.x - a.x) * d) / len),
        y: Math.round(V.by + a.y + ((b.y - a.y) * d) / len),
      });
    left -= len;
  }
  for (const p of dots) R(g, p.x - 1, p.y - 1, 4, 4, INK);
  for (const p of dots) R(g, p.x, p.y, 2, 2, bright ? LEAF : GREEN[3]);
  dots.forEach((p, i) => i % 7 === 3 && R(g, p.x, p.y, 1, 1, GREEN[4]));
}

/** The root round the fallen one's hex, waiting there: lit a corner at a time, going round. */
function drawCoil(g: Ctx, cell: number, c: number): void {
  const corners = cornersOf(cell);
  const lit = Math.floor(c) % 6;
  drawLine(g, [...corners, corners[0] ?? { x: 0, y: 0 }], 1, false);
  const p = corners[lit];
  if (p) R(g, Math.round(V.bx + p.x) - 1, Math.round(V.by + p.y) - 1, 3, 3, LEAF);
}

/** The faint root left round a hex it reached, for the rest of the fight. */
function drawStay(g: Ctx, cell: number): void {
  const corners = cornersOf(cell);
  g.globalAlpha = 0.4;
  drawLine(g, [...corners, corners[0] ?? { x: 0, y: 0 }], 1, false);
  g.globalAlpha = 1;
}

/** Through the dread, the table dark but round the fallen one's hex (or Seqwawa's, with nobody down). */
function dread(g: Ctx, r: Reach, fallen: number, c: number): void {
  const pool = r.cells[fallen] ?? FV.actors[r.by]?.unit.cell ?? -1;
  if (c < r.at - WAIT || c >= r.at || pool < 0) return;
  const p = feetAt(pool);
  dimRound(g, Math.round(V.bx + p.x), Math.round(V.by + p.y) - FOOT, 15, 10, (c - (r.at - WAIT)) / 2);
}

/** One reach of roots at the clock `c`: running out, waiting coiled at the fallen one's hex, flashing as it goes off, then going. */
function drawReach(g: Ctx, r: Reach, c: number): void {
  const fallen = fallenOf(r, c);
  dread(g, r, fallen, c);
  const after = c - r.at;
  if (after >= FADE) return;
  const k = clamp((c - (r.at - SHOOT)) / (SHOOT - WAIT), 0, 1);
  g.globalAlpha = clamp(1 - after / FADE, 0, 1);
  for (const way of r.ways) drawLine(g, linesOf(way), k, after >= 0 && after < 3);
  g.globalAlpha = 1;
  const wait = r.cells[fallen];
  if (wait !== undefined && c >= r.at - WAIT && c < r.at) drawCoil(g, wait, c);
}

/** The roots on the table at the clock `c`, under everyone: those of each cast, and those that stay. */
export function drawRoots(g: Ctx): void {
  const c = clockNow();
  const fight = fightNow();
  for (const s of stays) if (s.fight === fight) drawStay(g, s.cell);
  for (const r of reaches) if (r.fight === fight && c >= r.at - SHOOT) drawReach(g, r, c);
}

/** It goes off: the roots under every hex it reached stay there, faint, for the rest of the fight. */
export function stepRoots(c: number): void {
  const fight = fightNow();
  for (let i = reaches.length - 1; i >= 0; i--) {
    const r = reaches[i];
    if (!r) continue;
    if (r.fight !== fight) {
      reaches.splice(i, 1);
      continue;
    }
    if (c < r.at + FADE) continue;
    for (const cell of r.cells)
      if (!stays.some((s) => s.fight === fight && s.cell === cell)) stays.push({ fight, cell });
    reaches.splice(i, 1);
  }
  for (let i = stays.length - 1; i >= 0; i--) if (stays[i]?.fight !== fight) stays.splice(i, 1);
}

/** The fallen one stood back up by the root: up out of the ground on its hex, with its health in green. */
export function rootsUp(ev: Extract<FightEvent, { t: "rise" }>, at: number): void {
  const a = FV.actors[ev.id];
  if (!a) return;
  const to = feetAt(ev.cell);
  a.x = to.x;
  a.y = to.y;
  a.move = null;
  a.bornAt = Math.min(a.bornAt, at);
  a.hopAt = at;
  burst(to.x, to.y, 12, [EARTH[1], EARTH[2], GREEN[3]], { speed: 34, toward: -Math.PI / 2, spread: 1.6, ttl: 0.5 });
  motes(to.x, to.y - 6, 10, [GREEN[4], LEAF, CREAM]);
  say(to.x, to.y - 26, `+${ev.hp}`, LEAF, { ttl: 0.9 });
  snd.rise();
}
