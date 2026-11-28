/**
 * A frame of the yard at the two steps the camera goes furthest out to: the plan (`plan.ts`), a
 * screen pixel to each of its own, and not the picture. No gnomes, nothing one by one on the belts,
 * no lantern light: only the plan, a mark on each piece in trouble, and what is being pointed at or
 * is about to be built, so that building and Select work here as they do near.
 *
 * The plan is kept and one picture is laid for it, so a frame here costs the same however much
 * stands in the yard.
 */

import {
  DRAW,
  DX,
  DY,
  FIXED,
  GIVES,
  type Kind,
  litOf,
  NONE,
  pieceOf,
  REACH,
  REACHES,
  tilesOf,
  type Yard,
} from "@sequoia-leaf/factory";
import { CORAL, CREAM, GOLD, INK } from "@sequoia-leaf/kit/palette.ts";
import type { Ctx } from "@sequoia-leaf/kit/util.ts";

import { PAINTS, TILE } from "./art/belts.ts";
import { aimBox, markCovers, pieceBox } from "./big.ts";
import { you } from "./figure/you.ts";
import { heldBox, takenUp } from "./held.ts";
import type { Layout } from "./layout.ts";
import { markedTiles, pinPulse } from "./pinned.ts";
import { alarm, blockColour, layPlan, makePlan, paintPlan, type Plan } from "./plan.ts";
import { builds, type Group, S, seenFrom, standsOn, tileNudge, type Tool } from "./state.ts";
import { troubled } from "./trouble.ts";

/** A plan for each size a step is drawn at, made when first gone out to. */
const plans = new Map<number, Plan>();

/** A line a pixel wide just outside a box of the picture: it is being pointed at. `breathe` draws it a pixel further out half the time. */
function box(g: Ctx, x: number, y: number, w: number, h: number, col: string, breathe = false, out = 0): void {
  const k = (breathe && Math.sin(S.t * 6) > 0 ? 2 : 1) + out;
  g.fillStyle = col;
  g.fillRect(x - k, y - k, w + k * 2, 1);
  g.fillRect(x - k, y + h + k - 1, w + k * 2, 1);
  g.fillRect(x - k, y - k, 1, h + k * 2);
  g.fillRect(x + w + k - 1, y - k, 1, h + k * 2);
}

/** The tiles of the pieces in hand where they are aimed, worked out once for each place they are aimed at. */
let held: { for: Group["at"]; tiles: number[]; of: number[] } | null = null;
function inHand(y: Yard, grp: Group): NonNullable<typeof held> {
  if (held?.for === grp.at) return held;
  const tiles: number[] = [];
  const of: number[] = [];
  grp.at.forEach((p, k) => {
    for (const i of tilesOf(y, [p])) {
      if (i < 0) continue;
      tiles.push(i);
      of.push(k);
    }
  });
  return (held = { for: grp.at, tiles, of });
}

/**
 * The pieces in hand where they would stand: gold where each can go, coral where it cannot; for a
 * plan of the whole yard, a coral box on each piece it would take up, as the spade marks what it
 * takes; and a box round all of it. `P` is a tile's size in the picture.
 */
function handMarks(g: Ctx, y: Yard, grp: Group, dx: number, dy: number, P: number): void {
  const W = y.land.w;
  const X = (i: number): number => dx + (i % W) * P;
  const Y = (i: number): number => dy + Math.floor(i / W) * P;
  const hand = inHand(y, grp);
  for (let n = 0; n < hand.tiles.length; n++) {
    const i = hand.tiles[n] ?? 0;
    g.fillStyle = grp.why[hand.of[n] ?? 0] === null ? GOLD[2] : CORAL;
    g.fillRect(X(i), Y(i), P, P);
  }
  for (const i of takenUp(grp)) box(g, X(i), Y(i), P, P, CORAL);
  const b = heldBox(y, grp);
  const stuck = grp.why.some((r) => r !== null);
  box(g, dx + b.x * P, dy + b.y * P, b.w * P, b.h * P, stuck ? CORAL : CREAM, true);
}

/** Whether a tool is one that the reach of power matters to. */
const wantsPower = (kind: Kind): boolean => (DRAW[kind] ?? 0) > 0 || (GIVES[kind] ?? 0) > 0 || REACHES[kind] === 1;

/**
 * The plan, laid on the picture where the camera is. `cornerX`, `cornerY` is where the picture's
 * corner is in the view, in the yard's pixels (the camera says). Gives the corner of the land on the
 * picture, for the marks.
 */
export function drawPlan(g: Ctx, y: Yard, L: Layout, cornerX: number, cornerY: number): readonly [number, number] {
  const z = S.view.z;
  const P = Math.round(TILE * z);
  let plan = plans.get(P);
  if (!plan) plans.set(P, (plan = makePlan(P)));
  const dx = -Math.round((seenFrom(S.cam.x) + cornerX) * z);
  const dy = -Math.round((seenFrom(S.cam.y) + cornerY) * z);
  g.clearRect(0, 0, g.canvas.width, g.canvas.height);
  paintPlan(plan, y, L);
  layPlan(g, plan, y, dx, dy);
  return [dx, dy];
}

/** The plan as the marks over it are drawn: where to draw, the yard, a tile's size, and where a tile is. */
interface Over {
  readonly g: Ctx;
  readonly y: Yard;
  readonly P: number;
  readonly X: (i: number) => number;
  readonly Y: (i: number) => number;
}

/** Where the member stands in their own yard, over the plan (`k` of its pixels to one of the yard's): a cream dot, edged dark. */
function planYou(g: Ctx, dx: number, dy: number, k: number): void {
  const c = you();
  if (!c) return;
  const [x, y] = [Math.round(dx + c.x * k), Math.round(dy + c.y * k)];
  g.fillStyle = INK;
  g.fillRect(x - 2, y - 2, 4, 4);
  g.fillStyle = CREAM;
  g.fillRect(x - 1, y - 1, 2, 2);
}

/** The box of the piece on a tile, over the plan: every tile it covers, or for the depot its nine; `out` pixels further out. */
function around(o: Over, i: number, col: string, breathe: boolean, out = 0): void {
  const { land } = o.y;
  const depot = land.depot[1] * land.w + land.depot[0];
  if (FIXED[o.y.kind[i] ?? NONE] === 1) {
    box(o.g, o.X(depot) - o.P, o.Y(depot) - o.P, o.P * 3, o.P * 3, col, breathe, out);
    return;
  }
  const b = pieceBox(o.y, i);
  const corner = b.y * land.w + b.x;
  box(o.g, o.X(corner), o.Y(corner), o.P * b.w, o.P * b.h, col, breathe, out);
}

/**
 * Over the plan, what is pointed at: the piece marked (`markedTiles`), every tile of it, gold between
 * two lines of ink, standing out for a moment after the view is brought to it; and with nothing in
 * hand, the piece under the mouse.
 */
function pointed(o: Over, tool: Tool): void {
  const out = pinPulse();
  // A piece of more than one tile is marked once, round all of it.
  const marked = new Set(markedTiles().map((i) => pieceOf(o.y, i)));
  for (const i of marked) {
    around(o, i, INK, false, out + 1);
    around(o, i, INK, false, out - 1);
    around(o, i, GOLD[2], false, out);
  }
  const { land } = o.y;
  const t = S.hover;
  if (!t || tool !== null || t.x < 0 || t.y < 0 || t.x >= land.w || t.y >= land.h) return;
  const i = t.y * land.w + t.x;
  if (o.y.kind[i] !== NONE) around(o, i, GOLD[2], true);
}

/**
 * Over the plan: a mark on each piece in trouble, and what is being pointed at or is about to be
 * built, as the picture near shows them, each as a box of its tiles.
 */
export function drawPlanMarks(g: Ctx, y: Yard, dx: number, dy: number): void {
  const z = S.view.z;
  const P = Math.round(TILE * z);
  const { land } = y;
  const W = land.w;
  const X = (i: number): number => dx + (i % W) * P;
  const Y = (i: number): number => dy + Math.floor(i / W) * P;

  const wrong = troubled(y);
  for (let c = 0; c < wrong.count; c++) {
    const i = wrong.tiles[c] ?? 0;
    alarm(g, P, i % W, Math.floor(i / W), dx, dy, S.t);
  }

  const tool = S.tool;
  if (builds(tool) && wantsPower(tool)) {
    // Where power reaches, edged in gold, while placing something that it matters to.
    const lit = litOf(y);
    g.fillStyle = GOLD[1];
    for (let i = 0; i < lit.length; i++) {
      const here = lit[i] === 1;
      const x = i % W;
      if (here !== (i >= W && lit[i - W] === 1)) g.fillRect(X(i), Y(i), P, 1);
      if (here !== (x > 0 && lit[i - 1] === 1)) g.fillRect(X(i), Y(i), 1, P);
    }
  }
  pointed({ g, y, P, X, Y }, tool);
  if (S.mark) {
    // The pieces marked, lit gold on their tiles; the area itself a line of dashes that march.
    const m = S.mark;
    const leaving = S.group?.as === "move";
    g.fillStyle = leaving ? "rgba(26,15,30,0.55)" : "rgba(255,196,84,0.5)";
    for (const i of markCovers(y, m.tiles).all) if (y.kind[i] !== NONE) g.fillRect(X(i), Y(i), P, P);
    g.strokeStyle = CREAM;
    g.lineWidth = 1;
    g.setLineDash([3, 3]);
    g.lineDashOffset = -Math.floor(S.t * 10);
    g.strokeRect(dx + m.x0 * P - 1.5, dy + m.y0 * P - 1.5, (m.x1 - m.x0 + 1) * P + 3, (m.y1 - m.y0 + 1) * P + 3);
    g.setLineDash([]);
  } else if (S.corner) box(g, dx + S.corner.x * P, dy + S.corner.y * P, P, P, GOLD[2], true);
  if (S.run) {
    // A run of belt, shown before it is laid: each tile of it, and a tunnel's far mouth.
    const bad = S.run.why !== null;
    g.fillStyle = bad ? CORAL : GOLD[2];
    for (const leg of S.run.legs) {
      g.fillRect(dx + leg.x * P, dy + leg.y * P, P, P);
      if (leg.tunnel && leg.span > 0) {
        const far = leg.span + 1;
        g.fillRect(dx + (leg.x + DX[leg.dir] * far) * P, dy + (leg.y + DY[leg.dir] * far) * P, P, P);
      }
    }
    for (const turn of S.run.turns) g.fillRect(dx + turn.x * P, dy + turn.y * P, P, P);
    const last = S.run.legs.at(-1) ?? S.run.turns.at(-1);
    if (last) box(g, dx + last.x * P, dy + last.y * P, P, P, bad ? CORAL : CREAM, true);
  }
  if (S.from && !S.run) box(g, dx + S.from.x * P, dy + S.from.y * P, P, P, GOLD[2], true);
  if (S.aim && tool !== null) {
    const on = standsOn(S.aim);
    const x = dx + on.x * P;
    const top = dy + on.y * P;
    const bad = S.aim.why !== null;
    if (tool === "remove") {
      // The whole piece the spade would take up, whichever of its tiles is aimed at.
      const b = aimBox(y, "remove", 0, on.x, on.y);
      box(g, dx + b.x * P, dy + b.y * P, b.w * P, b.h * P, CORAL, true);
    } else if (tool === "paint") {
      if (!bad) box(g, x, top, P, P, PAINTS[S.tint - 1]?.lit ?? CREAM, true);
    } else if (tool === "select") {
      if (S.group) handMarks(g, y, S.group, dx, dy, P);
    } else if (!S.run) {
      // One piece about to be built: its block over every tile it would cover, and for a tunnel the mouth it would come up at.
      g.fillStyle = bad ? CORAL : blockColour(tool);
      const b = aimBox(y, tool, S.dir, on.x, on.y);
      g.fillRect(dx + b.x * P, dy + b.y * P, b.w * P, b.h * P);
      const far = S.aim.far ?? -1;
      if (far >= 0) g.fillRect(X(far), Y(far), P, P);
      if (REACHES[tool] === 1) {
        // How far its light would reach.
        const r = ((REACH.pylon * y.open.reach) / 10_000) * P;
        const n = Math.max(12, Math.round(r * 3));
        g.fillStyle = bad ? CORAL : GOLD[2];
        for (let k = 0; k < n; k += 2) {
          const a = (k / n) * Math.PI * 2;
          g.fillRect(Math.round(x + P / 2 + Math.cos(a) * r), Math.round(top + P / 2 + Math.sin(a) * r), 1, 1);
        }
      }
      const col = bad ? CORAL : CREAM;
      box(g, x, top, P, P, col, true);
      // And the tile aimed at, which for a tunnel whose way in is set is where it would come up, or cannot.
      box(g, dx + S.aim.x * P, dy + S.aim.y * P, P, P, col, true);
    }
  }
  planYou(g, dx, dy, P / TILE);
  const nudged = tileNudge();
  if (nudged) {
    // The place a nudge is about.
    box(g, dx + nudged.x * P, dy + nudged.y * P, P, P, INK, false);
    box(g, dx + nudged.x * P - 1, dy + nudged.y * P - 1, P + 2, P + 2, GOLD[2], true);
  }
}
