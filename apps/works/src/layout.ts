/**
 * What the picture needs that is worked out from what stands where: the shape of every belt, the
 * lines between pylons, where the fence runs and the gate stands, which plots carry a signpost.
 * None of it changes until the yard does, so it is worked out once for each change and kept, in
 * flat lists of numbers like the yard's own: nothing is made for each piece.
 */

import {
  BACK,
  BELT,
  BOILER,
  DEPOT,
  JOINER,
  LEFT,
  litOf,
  nextOf,
  NONE,
  plotState,
  type Plotted,
  PYLON,
  REACH,
  RIGHT,
  SORTER,
  SPLITTER,
  squared,
  takes,
  toward,
  TUNNEL,
  wayOut,
  WHEEL,
  type Yard,
} from "@sequoia-leaf/factory";
import type { Pt } from "@sequoia-leaf/kit/util.ts";

import { armAt, type Arms, TILE, withArm } from "./art/belts.ts";

export interface Sign {
  plot: Plotted;
  /** Where its post stands, in the yard's pixels. */
  x: number;
  y: number;
}

export interface Layout {
  yard: Yard;
  rev: number;
  /** The arms of every tile that carries, by tile (`Arms`); 0 for the rest. */
  arms: Uint8Array;
  /** Tiles that hand straight to the depot. */
  intoDepot: number[];
  /** The lines power is carried on, four numbers each: where each end is made fast, across and down, in the yard's pixels. */
  wires: Int32Array;
  /** The fence, three numbers to a length of it: the corner of the edge it stands on, and 1 for one that runs across. */
  fences: Int32Array;
  /** The middle of the gate's sill. */
  gate: Pt;
  signs: Sign[];
  /** Which plots the yard owns, by the plot's place in the land's list. */
  owned: boolean[];
  /** How many things stand in the yard, the depot left out. */
  built: number;
}

/** Where a pylon's line is made fast: the top of its post. */
export const pylonTop = (x: number, y: number, tall: boolean): Pt => ({
  x: x * TILE + 8,
  y: (y + 1) * TILE - (tall ? 33 : 25),
});

/** The ways a splitter (3) or a sorter (2, ahead and left) sends things. */
const waysOf = (k: number): number => (k === SPLITTER ? 3 : k === SORTER ? 2 : 0);

/** Whether the piece on `from` hands things to the tile `to`, as the belts are drawn. */
function feeds(y: Yard, from: number, to: number): boolean {
  if (from < 0 || to < 0) return false;
  const k = y.kind[from] ?? NONE;
  if (k === NONE || k === DEPOT || k === PYLON || k === WHEEL || k === BOILER) return false;
  // A splitter or sorter feeds whatever on one of its ways out takes things from it.
  const ways = waysOf(k);
  if (ways > 0) {
    for (let w = 0; w < ways; w++) if (wayOut(y, from, w) === to) return takes(y, to, from);
    return false;
  }
  // Two belts facing each other pass nothing, and are not drawn as joined.
  return nextOf(y, from) === to && nextOf(y, to) !== from;
}

/** The arms of the piece on a tile that carries: for the yard as it stands, or with pieces in hand set into it. 0 for the rest. */
export function armsAt(y: Yard, i: number): Arms {
  const k = y.kind[i] ?? NONE;
  const d = y.dir[i] ?? 0;
  const back = BACK[d & 3] ?? 2;
  const left = LEFT[d & 3] ?? 3;
  const right = RIGHT[d & 3] ?? 1;
  if (k === BELT || k === JOINER) {
    let a = withArm(0, d, 2);
    let fed = false;
    for (const side of [back, left, right])
      if (feeds(y, toward(y.land, i, side), i)) {
        a = withArm(a, side, 1);
        fed = true;
      }
    // A belt nothing feeds is drawn as a straight piece; a joiner shows all three of its ways in.
    if (!fed) {
      a = withArm(a, back, 1);
      if (k === JOINER) a = withArm(withArm(a, left, 1), right, 1);
    }
    return a;
  }
  if (k === SPLITTER) {
    // A shut way wears its bar. Of the rest, only the ways out that something takes things from;
    // a splitter nothing takes from shows every way that is open.
    let a = withArm(0, back, 1);
    const ways = [d, left, right];
    const shut = y.shut[i] ?? 0;
    ways.forEach((side, n) => {
      if ((shut >> n) & 1) a = withArm(a, side, 3);
    });
    const open = ways.filter((side) => armAt(a, side) === 0);
    const led = open.filter((side) => feeds(y, i, toward(y.land, i, side)));
    for (const side of led.length > 0 ? led : open) a = withArm(a, side, 2);
    return a;
  }
  // A sorter takes in from behind and sends ahead, and the one thing it is set to, to its left.
  if (k === SORTER) return withArm(withArm(withArm(0, back, 1), d, 2), left, 2);
  if (k === TUNNEL) return (y.span[i] ?? 0) > 0 ? withArm(0, back, 1) : withArm(0, d, 2);
  return 0;
}

/** The lines power is carried on: from the depot to each pylon joined to it, each by its nearest joined neighbour. */
function wires(y: Yard): Int32Array {
  const W = y.land.w;
  const tall = y.open.reach > 100;
  const link = squared(REACH.link, y.open.reach);
  const [cx, cy] = y.land.depot;
  const nodes: { x: number; y: number; at: Pt; joined: boolean }[] = [
    { x: cx, y: cy, at: { x: cx * TILE + 8 - 14, y: (cy - 1) * TILE - 8 }, joined: true },
  ];
  const lit = litOf(y);
  for (let i = 0; i < y.kind.length; i++) {
    if (y.kind[i] !== PYLON || lit[i] !== 1) continue;
    const x = i % W;
    const z = (i - x) / W;
    nodes.push({ x, y: z, at: pylonTop(x, z, tall), joined: false });
  }
  const out: number[] = [];
  for (let grew = true; grew;) {
    grew = false;
    // The pylon nearest to anything already joined is joined next, so the lines never double back.
    let best: { from: number; to: number; d: number } | null = null;
    for (const [n, p] of nodes.entries()) {
      if (p.joined) continue;
      for (const [m, q] of nodes.entries()) {
        if (!q.joined) continue;
        const dx = p.x - q.x;
        const dy = p.y - q.y;
        const d = Math.hypot(dx, dy);
        if (dx * dx + dy * dy <= link && (!best || d < best.d)) best = { from: m, to: n, d };
      }
    }
    if (!best) break;
    const from = nodes[best.from];
    const to = nodes[best.to];
    if (!from || !to) break;
    to.joined = true;
    out.push(from.at.x, from.at.y, to.at.x, to.at.y);
    grew = true;
  }
  return Int32Array.from(out);
}

function fences(y: Yard, owned: readonly boolean[], gateX: number, gateY: number): Int32Array {
  const { land } = y;
  const out: number[] = [];
  const mine = (tx: number, ty: number): boolean =>
    tx >= 0 && ty >= 0 && tx < land.w && ty < land.h && (owned[land.plot[ty * land.w + tx] ?? NONE] ?? false);
  const wet = (tx: number, ty: number): boolean =>
    tx >= 0 && ty >= 0 && tx < land.w && ty < land.h && land.water[ty * land.w + tx] === 1;
  for (let ty = 0; ty <= land.h; ty++)
    for (let tx = 0; tx <= land.w; tx++) {
      // The edge above this tile, and the edge to its left.
      if (tx < land.w && mine(tx, ty) !== mine(tx, ty - 1) && !(wet(tx, ty) && wet(tx, ty - 1))) {
        const atGate = ty * TILE === gateY && Math.abs(tx * TILE + 8 - gateX) < 9;
        if (!atGate) out.push(tx * TILE, ty * TILE, 1);
      }
      if (ty < land.h && mine(tx, ty) !== mine(tx - 1, ty) && !(wet(tx, ty) && wet(tx - 1, ty)))
        out.push(tx * TILE, ty * TILE, 0);
    }
  return Int32Array.from(out);
}

/** A signpost for every plot that is for sale: just inside it, at the middle of the edge it shares with the yard. */
function signs(y: Yard, owned: readonly boolean[]): Sign[] {
  const { land } = y;
  const out: Sign[] = [];
  const on = (tx: number, ty: number): boolean => tx >= 0 && ty >= 0 && tx < land.w && ty < land.h;
  // Off water, and clear of the redwoods: one stands 40 by 70 pixels over its roots, so none 2 tiles across or 4 below.
  const clear = (tx: number, ty: number): boolean => {
    if (!on(tx, ty) || land.water[ty * land.w + tx] === 1) return false;
    for (let z = ty - 1; z <= ty + 4; z++)
      for (let x = tx - 2; x <= tx + 2; x++) if (on(x, z) && land.trunk[z * land.w + x] === 1) return false;
    return true;
  };
  land.plots.forEach((plot, n) => {
    if (owned[n] || plotState(y, plot.plot).state !== "for sale") return;
    const next = land.plots.find(
      (p, m) =>
        owned[m] &&
        ((p.x < plot.x + plot.w && plot.x < p.x + p.w && (p.y + p.h === plot.y || plot.y + plot.h === p.y)) ||
          (p.y < plot.y + plot.h && plot.y < p.y + p.h && (p.x + p.w === plot.x || plot.x + plot.w === p.x))),
    );
    if (!next) return;
    // The tile of this plot nearest the middle of the shared edge, stepped along it off water and roots.
    const beside = next.x + next.w === plot.x || plot.x + plot.w === next.x;
    // Three tiles along from the middle, to stand clear of the path and the gate.
    const tx0 = beside ? (next.x < plot.x ? plot.x + 1 : plot.x + plot.w - 2) : plot.x + Math.floor(plot.w / 2) + 3;
    const ty0 = beside ? plot.y + Math.floor(plot.h / 2) : next.y < plot.y ? plot.y + 1 : plot.y + plot.h - 2;
    for (let k = 0; k < 8; k++) {
      const step = k % 2 ? -Math.ceil(k / 2) : Math.ceil(k / 2);
      const tx = beside ? tx0 : tx0 + step;
      const ty = beside ? ty0 + step : ty0;
      if (!clear(tx, ty)) continue;
      out.push({ plot, x: tx * TILE + 8, y: ty * TILE + 14 });
      return;
    }
  });
  return out;
}

let kept: Layout | null = null;

/** The layout for the yard as it stands, worked out afresh only when the yard has changed. */
export function layout(y: Yard, rev: number): Layout {
  if (kept && kept.yard === y && kept.rev === rev) return kept;
  const owned = y.land.plots.map((p) => y.plots.includes(p.plot));
  // The gate stands where the path from the depot's door meets the yard's southern fence.
  const [cx, cy] = y.land.depot;
  let gy = cy + 2;
  while (gy < y.land.h && (owned[y.land.plot[gy * y.land.w + cx] ?? NONE] ?? false)) gy++;
  const gate = { x: cx * TILE + 8, y: gy * TILE };
  const intoDepot: number[] = [];
  const arms = new Uint8Array(y.kind.length);
  let built = 0;
  for (let i = 0; i < y.kind.length; i++) {
    const k = y.kind[i] ?? NONE;
    if (k === NONE || k === DEPOT) continue;
    built++;
    arms[i] = armsAt(y, i);
    const ways = waysOf(k);
    let into = y.kind[nextOf(y, i)] === DEPOT;
    for (let w = 0; w < ways; w++) if (y.kind[wayOut(y, i, w)] === DEPOT) into = true;
    if (into) intoDepot.push(i);
  }
  kept = {
    yard: y,
    rev,
    arms,
    intoDepot,
    wires: wires(y),
    fences: fences(y, owned, gate.x, gate.y),
    gate,
    signs: signs(y, owned),
    owned,
    built,
  };
  return kept;
}
