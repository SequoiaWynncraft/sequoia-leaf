/**
 * What the picture needs that is worked out from what stands where: the shape of every belt, the
 * lines between pylons, where the fence runs and the gate stands, which plots carry a signpost.
 * None of it changes until what stands, the plots owned or what is open does, so it is worked out
 * once for each such change and kept by exactly those (`layout`), in flat lists of numbers like the
 * yard's own: nothing is made for each piece. And the yard as it would
 * be with the pieces in hand set down (`asIf`), for drawing them.
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
  piecesAt,
  plotState,
  type Plotted,
  PYLON,
  REACH,
  RIGHT,
  SORTER,
  SPLITTER,
  squared,
  takes,
  tilesOf,
  toward,
  TUNNEL,
  wayOut,
  WHEEL,
  type Yard,
} from "@sequoia-leaf/factory";
import type { Pt } from "@sequoia-leaf/kit/util.ts";

import { armAt, type Arms, TILE, withArm } from "./art/belts.ts";
import { draws, type Group } from "./state.ts";

export interface Sign {
  plot: Plotted;
  /** Where its post stands, in the yard's pixels. */
  x: number;
  y: number;
}

export interface Layout {
  /** The yard it was last found to stand for, and the yard's count of changes then. */
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

/**
 * The lines last worked out, and what they were worked out from: the tiles of the pylons power
 * reached, the depot, and how far a pylon reaches. A layout worked out again for a belt keeps them.
 */
let strung: { pylons: number[]; depot: string; reach: number; wires: Int32Array } | null = null;

/** The lines power is carried on: from the depot to each pylon joined to it, each by its nearest joined neighbour. */
function wires(y: Yard): Int32Array {
  const W = y.land.w;
  const lit = litOf(y);
  const pylons: number[] = [];
  for (let i = 0; i < y.kind.length; i++) if (y.kind[i] === PYLON && lit[i] === 1) pylons.push(i);
  const depot = y.land.depot.join();
  const s = strung;
  if (
    s &&
    s.reach === y.open.reach &&
    s.depot === depot &&
    s.pylons.length === pylons.length &&
    s.pylons.every((i, n) => pylons[n] === i)
  )
    return s.wires;
  const tall = y.open.reach > 100;
  const link = squared(REACH.link, y.open.reach);
  const [cx, cy] = y.land.depot;
  const nodes: { x: number; y: number; at: Pt }[] = [
    { x: cx, y: cy, at: { x: cx * TILE + 8 - 14, y: (cy - 1) * TILE - 8 } },
  ];
  for (const i of pylons) {
    const x = i % W;
    const z = (i - x) / W;
    nodes.push({ x, y: z, at: pylonTop(x, z, tall) });
  }
  // The pylon nearest to anything already joined is joined next, so the lines never double back:
  // for each pylon not yet joined, its nearest joined one within a link (the first of those as near),
  // brought up to date as each is joined. Of two as near, the one listed first goes first.
  const n = nodes.length;
  const near = new Float64Array(n).fill(Infinity);
  const by = new Int32Array(n).fill(-1);
  const joined = new Uint8Array(n);
  const out: number[] = [];
  for (let j = 0; j >= 0;) {
    joined[j] = 1;
    const q = nodes[j];
    if (!q) break;
    for (let k = 0; k < n; k++) {
      const p = nodes[k];
      if (!p || joined[k] === 1) continue;
      const dx = p.x - q.x;
      const dy = p.y - q.y;
      const d = Math.hypot(dx, dy);
      if (dx * dx + dy * dy <= link && (d < (near[k] ?? Infinity) || (d === near[k] && j < (by[k] ?? -1)))) {
        near[k] = d;
        by[k] = j;
      }
    }
    j = -1;
    for (let k = 0; k < n; k++)
      if (joined[k] === 0 && (by[k] ?? -1) >= 0 && (j < 0 || (near[k] ?? 0) < (near[j] ?? 0))) j = k;
    const from = nodes[by[j] ?? -1];
    const to = nodes[j];
    if (from && to) out.push(from.at.x, from.at.y, to.at.x, to.at.y);
  }
  strung = { pylons, depot, reach: y.open.reach, wires: Int32Array.from(out) };
  return strung.wires;
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

/**
 * What the kept layout was worked out from, and so all it is kept by: the land; what stands on each
 * tile (its kind, its way, a tunnel's span, a splitter's shut ways, a line's colour, which the belts'
 * picture is made by); the plots owned; and the goals done, from which the rules work out what is
 * open (what is for sale, how far power reaches). Copies of the arrays read, kept and refilled.
 */
let basis: {
  land: Yard["land"];
  kind: Uint8Array;
  dir: Uint8Array;
  span: Int8Array;
  shut: Uint8Array;
  tint: Uint8Array;
  plots: string;
  done: string;
} | null = null;

function alike(a: Uint8Array | Int8Array, b: Uint8Array | Int8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Whether the yard stands as the kept layout was worked out from, with the same plots and the same goals done. */
function stands(y: Yard): boolean {
  const b = basis;
  return (
    b !== null &&
    b.land === y.land &&
    alike(b.kind, y.kind) &&
    alike(b.dir, y.dir) &&
    alike(b.span, y.span) &&
    alike(b.shut, y.shut) &&
    alike(b.tint, y.tint) &&
    b.plots === y.plots.join() &&
    b.done === y.done.join()
  );
}

/** Keeps what a layout was worked out from (`basis`), in the arrays kept before where they fit. */
function keepBasis(y: Yard): void {
  const n = y.kind.length;
  const b =
    basis?.kind.length === n
      ? basis
      : {
          land: y.land,
          kind: new Uint8Array(n),
          dir: new Uint8Array(n),
          span: new Int8Array(n),
          shut: new Uint8Array(n),
          tint: new Uint8Array(n),
          plots: "",
          done: "",
        };
  b.land = y.land;
  b.kind.set(y.kind);
  b.dir.set(y.dir);
  b.span.set(y.span);
  b.shut.set(y.shut);
  b.tint.set(y.tint);
  b.plots = y.plots.join();
  b.done = y.done.join();
  basis = b;
}

/**
 * The layout for the yard as it stands. It is kept by what it is worked out from (`basis`), not by
 * every command: when the yard's count of changes (`rev`, `S.rev`) has moved, the yard is compared
 * with that, and the layout is worked out afresh only if something there differs. So the till
 * collected, an order handed over or a node taken costs no layout; a piece built, turned, coloured or
 * taken away, a plot bought or a goal done does. Leaf's yard taken in place of the copy keeps the
 * layout too, when it stands the same.
 */
export function layout(y: Yard, rev: number): Layout {
  if (kept && kept.yard === y && kept.rev === rev) return kept;
  if (kept && stands(y)) {
    kept.yard = y;
    kept.rev = rev;
    return kept;
  }
  keepBasis(y);
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
    // A kind this page does not draw is a plain post: no belt's arms, nothing riding it.
    arms[i] = draws(k) ? armsAt(y, i) : 0;
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

/** The arrays a drawing of pieces in hand changes, kept for the next and filled afresh each time. */
let own: {
  kind: Uint8Array;
  dir: Uint8Array;
  span: Int8Array;
  shut: Uint8Array;
  tint: Uint8Array;
  row: Int32Array;
} | null = null;

/**
 * The yard as it would be with the pieces in hand set down where they are aimed, and for a move
 * gone from where they stand: for drawing them as they would stand, belts joined to each other and
 * to the lines already there. It shares everything with the real yard but the arrays a drawing
 * changes (what stands where, which way, a tunnel's span, a splitter's shut ways, a colour, and the
 * rows, none for a piece in hand), which are its own, kept and reused. Nothing is written to the
 * real yard. It is made once for each place the pieces are aimed, not each frame.
 */
export function asIf(y: Yard, grp: Pick<Group, "as" | "tiles" | "at">): Yard {
  const n = y.kind.length;
  if (own?.kind.length !== n)
    own = {
      kind: new Uint8Array(n),
      dir: new Uint8Array(n),
      span: new Int8Array(n),
      shut: new Uint8Array(n),
      tint: new Uint8Array(n),
      row: new Int32Array(n),
    };
  const o = own;
  o.kind.set(y.kind);
  o.dir.set(y.dir);
  o.span.set(y.span);
  o.shut.set(y.shut);
  o.tint.set(y.tint);
  o.row.set(y.row);
  const empty = (i: number): void => {
    o.kind[i] = NONE;
    o.dir[i] = 0;
    o.span[i] = 0;
    o.shut[i] = 0;
    o.tint[i] = 0;
    o.row[i] = -1;
  };
  if (grp.as === "move") for (const i of tilesOf(y, piecesAt(y, grp.tiles))) if (i >= 0) empty(i);
  for (const p of grp.at) {
    const [near = -1, far = -1] = tilesOf(y, [p]);
    for (const [i, span] of [
      [near, p.span],
      [far, -p.span],
    ] as const) {
      if (i < 0) continue;
      empty(i);
      o.kind[i] = p.kind;
      o.dir[i] = p.dir;
      o.span[i] = span;
      o.shut[i] = i === near ? (p.shut ?? 0) : 0;
      o.tint[i] = p.tint ?? 0;
    }
  }
  // Where power reaches is the real yard's, worked out by the rules first; nothing works it out again here.
  return { ...y, ...o, lit: litOf(y), powered: true, wire: null };
}
