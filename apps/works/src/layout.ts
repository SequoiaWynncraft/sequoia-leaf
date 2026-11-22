/**
 * What the picture needs that is worked out from what stands where: the shape of every belt, the
 * lines between pylons, where the fence runs and the gate stands, which plots carry a signpost.
 * None of it changes until the yard does, so it is worked out once for each change and kept.
 */

import type { Pt } from "@sequoia-leaf/kit/util.ts";
import {
  BACK,
  type Dir,
  DX,
  DY,
  LEFT,
  type Plot,
  plotState,
  REACH,
  rewire,
  RIGHT,
  takes,
  type World,
} from "@sequoia-leaf/yard";

import { type Arm, type Arms, TILE } from "./art/belts.ts";

export interface Wire {
  a: Pt;
  b: Pt;
}

export interface Fence {
  x: number;
  y: number;
  across: boolean;
}

export interface Sign {
  plot: Plot;
  /** Where its post stands, in the yard's pixels. */
  x: number;
  y: number;
}

export interface Layout {
  world: World;
  rev: number;
  /** The arms of every tile that carries, by tile; nothing for the rest. */
  arms: (Arms | null)[];
  /** Tiles that hand straight to the depot. */
  intoDepot: number[];
  wires: Wire[];
  fences: Fence[];
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

function arms(w: World, i: number, feeds: (from: number, to: number) => boolean): Arms | null {
  const b = w.cells[i];
  if (!b) return null;
  const W = w.land.w;
  const x = i % W;
  const y = (i - x) / W;
  const side = (d: Dir): number => {
    const nx = x + DX[d];
    const ny = y + DY[d];
    return nx < 0 || ny < 0 || nx >= W || ny >= w.land.h ? -1 : ny * W + nx;
  };
  const out: [Arm, Arm, Arm, Arm] = [0, 0, 0, 0];
  const back = BACK[b.dir];
  switch (b.kind) {
    case "belt":
    case "joiner": {
      out[b.dir] = 2;
      let fed = false;
      for (const d of [back, LEFT[b.dir], RIGHT[b.dir]] as const)
        if (feeds(side(d), i)) {
          out[d] = 1;
          fed = true;
        }
      // A belt nothing feeds is drawn as a straight piece; a joiner shows all three of its ways in.
      if (!fed) {
        out[back] = 1;
        if (b.kind === "joiner") out[LEFT[b.dir]] = out[RIGHT[b.dir]] = 1;
      }
      return out;
    }
    case "splitter": {
      out[back] = 1;
      // Only the ways out that something takes things from. A splitter nothing takes from shows all three.
      const ways = [b.dir, LEFT[b.dir], RIGHT[b.dir]] as const;
      const led = ways.filter((d) => feeds(i, side(d)));
      for (const d of led.length > 0 ? led : ways) out[d] = 2;
      return out;
    }
    case "tunnel":
      if (b.span > 0) out[back] = 1;
      else out[b.dir] = 2;
      return out;
    case "gatherer":
    case "mill":
    case "bench":
    case "workshop":
    case "crate":
    case "pylon":
    case "wheel":
    case "boiler":
    case "depot":
      return null;
  }
}

/** The lines power is carried on: from the depot to each pylon joined to it, each by its nearest joined neighbour. */
function wires(w: World): Wire[] {
  const W = w.land.w;
  const tall = w.rates.reach > 1;
  const link = REACH.link * w.rates.reach;
  const [cx, cy] = w.land.depot;
  const nodes: { x: number; y: number; at: Pt; joined: boolean }[] = [
    { x: cx, y: cy, at: { x: cx * TILE + 8 - 14, y: (cy - 1) * TILE - 8 }, joined: true },
  ];
  w.cells.forEach((b, i) => {
    if (b?.kind !== "pylon" || w.power[i] !== 1) return;
    const x = i % W;
    const y = (i - x) / W;
    nodes.push({ x, y, at: pylonTop(x, y, tall), joined: false });
  });
  const out: Wire[] = [];
  for (let grew = true; grew;) {
    grew = false;
    // The pylon nearest to anything already joined is joined next, so the lines never double back.
    let best: { from: number; to: number; d: number } | null = null;
    for (const [n, p] of nodes.entries()) {
      if (p.joined) continue;
      for (const [m, q] of nodes.entries()) {
        if (!q.joined) continue;
        const d = Math.hypot(p.x - q.x, p.y - q.y);
        if (d <= link && (!best || d < best.d)) best = { from: m, to: n, d };
      }
    }
    if (!best) break;
    const from = nodes[best.from];
    const to = nodes[best.to];
    if (!from || !to) break;
    to.joined = true;
    out.push({ a: from.at, b: to.at });
    grew = true;
  }
  return out;
}

function fences(w: World, owned: readonly boolean[], gateX: number, gateY: number): Fence[] {
  const { land } = w;
  const out: Fence[] = [];
  const mine = (tx: number, ty: number): boolean =>
    tx >= 0 && ty >= 0 && tx < land.w && ty < land.h && (owned[land.plot[ty * land.w + tx] ?? -1] ?? false);
  const wet = (tx: number, ty: number): boolean =>
    tx >= 0 && ty >= 0 && tx < land.w && ty < land.h && land.water[ty * land.w + tx] === 1;
  for (let ty = 0; ty <= land.h; ty++)
    for (let tx = 0; tx <= land.w; tx++) {
      // The edge above this tile, and the edge to its left.
      if (tx < land.w && mine(tx, ty) !== mine(tx, ty - 1) && !(wet(tx, ty) && wet(tx, ty - 1))) {
        const atGate = ty * TILE === gateY && Math.abs(tx * TILE + 8 - gateX) < 9;
        if (!atGate) out.push({ x: tx * TILE, y: ty * TILE, across: true });
      }
      if (ty < land.h && mine(tx, ty) !== mine(tx - 1, ty) && !(wet(tx, ty) && wet(tx - 1, ty)))
        out.push({ x: tx * TILE, y: ty * TILE, across: false });
    }
  return out;
}

/** A signpost for every plot that is for sale: just inside it, at the middle of the edge it shares with the yard. */
function signs(w: World, owned: readonly boolean[]): Sign[] {
  const { land } = w;
  const out: Sign[] = [];
  const on = (tx: number, ty: number): boolean => tx >= 0 && ty >= 0 && tx < land.w && ty < land.h;
  // Off water, and clear of the redwoods: one stands 40 by 70 pixels over its roots, so none 2 tiles across or 4 below.
  const clear = (tx: number, ty: number): boolean => {
    if (!on(tx, ty) || land.water[ty * land.w + tx] === 1) return false;
    for (let y = ty - 1; y <= ty + 4; y++)
      for (let x = tx - 2; x <= tx + 2; x++) if (on(x, y) && land.trunk[y * land.w + x] === 1) return false;
    return true;
  };
  land.plots.forEach((plot, n) => {
    if (owned[n] || plotState(w, plot.id).state !== "for sale") return;
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

/** The arms of every tile of a yard that carries: for the yard as it stands, and for one made up to show pieces not yet built. */
export function armsOf(w: World): (Arms | null)[] {
  const wire = w.wire ?? rewire(w);
  const feeds = (from: number, to: number): boolean => {
    if (from < 0) return false;
    const b = w.cells[from];
    if (!b || b.kind === "depot" || b.kind === "pylon" || b.kind === "wheel" || b.kind === "boiler") return false;
    // A splitter feeds whatever on one of its three ways out takes things from it.
    if (b.kind === "splitter")
      return (
        (wire.ways[from * 3] === to || wire.ways[from * 3 + 1] === to || wire.ways[from * 3 + 2] === to) &&
        takes(w, wire, to, from)
      );
    // Two belts facing each other pass nothing, and are not drawn as joined.
    return wire.next[from] === to && wire.next[to] !== from;
  };
  return w.cells.map((_, i) => arms(w, i, feeds));
}

let kept: Layout | null = null;

/** The layout for the yard as it stands, worked out afresh only when the yard has changed. */
export function layout(w: World, rev: number): Layout {
  if (kept && kept.world === w && kept.rev === rev) return kept;
  const wire = w.wire ?? rewire(w);
  const owned = w.land.plots.map((p) => w.plots.includes(p.id));
  // The gate stands where the path from the depot's door meets the yard's southern fence.
  const [cx, cy] = w.land.depot;
  let gy = cy + 2;
  while (gy < w.land.h && (owned[w.land.plot[gy * w.land.w + cx] ?? -1] ?? false)) gy++;
  const gate = { x: cx * TILE + 8, y: gy * TILE };
  const intoDepot: number[] = [];
  let built = 0;
  w.cells.forEach((b, i) => {
    if (!b || b.kind === "depot") return;
    built++;
    const to = wire.next[i] ?? -1;
    if (to >= 0 && w.cells[to]?.kind === "depot") intoDepot.push(i);
    if (b.kind === "splitter")
      for (let k = 0; k < 3; k++) {
        const way = wire.ways[i * 3 + k] ?? -1;
        if (way >= 0 && w.cells[way]?.kind === "depot" && !intoDepot.includes(i)) intoDepot.push(i);
      }
  });
  kept = {
    world: w,
    rev,
    arms: armsOf(w),
    intoDepot,
    wires: wires(w),
    fences: fences(w, owned, gate.x, gate.y),
    gate,
    signs: signs(w, owned),
    owned,
    built,
  };
  return kept;
}
