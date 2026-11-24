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
  boxOf,
  DEPOT,
  DRAW,
  DX,
  DY,
  GIVES,
  type Kind,
  litOf,
  NONE,
  PYLON,
  REACH,
  tilesOf,
  type Yard,
} from "@sequoia-leaf/factory";
import { CORAL, CREAM, GOLD, INK } from "@sequoia-leaf/kit/palette.ts";
import type { Ctx } from "@sequoia-leaf/kit/util.ts";

import { PAINTS, TILE } from "./art/belts.ts";
import type { Layout } from "./layout.ts";
import { alarm, blockColour, layPlan, makePlan, paintPlan, type Plan } from "./plan.ts";
import { builds, type Group, S, seenFrom, tileNudge } from "./state.ts";
import { troubled } from "./trouble.ts";

/** A plan for each size a step is drawn at, made when first gone out to. */
const plans = new Map<number, Plan>();

/** A line a pixel wide just outside a box of the picture: it is being pointed at. `breathe` draws it a pixel further out half the time. */
function box(g: Ctx, x: number, y: number, w: number, h: number, col: string, breathe = false): void {
  const k = breathe && Math.sin(S.t * 6) > 0 ? 2 : 1;
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

/** Whether a tool is one that the reach of power matters to. */
const wantsPower = (kind: Kind): boolean => (DRAW[kind] ?? 0) > 0 || (GIVES[kind] ?? 0) > 0 || kind === PYLON;

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
  const depot = land.depot[1] * W + land.depot[0];
  /** The box of the piece on a tile: its tile, or for the depot its nine. */
  const around = (i: number, col: string, breathe: boolean): void => {
    if (y.kind[i] === DEPOT) box(g, X(depot) - P, Y(depot) - P, P * 3, P * 3, col, breathe);
    else box(g, X(i), Y(i), P, P, col, breathe);
  };
  const tileOf = (x: number, yy: number): number => yy * W + x;
  if (S.picked >= 0) around(S.picked, GOLD[2], false);
  if (S.hover && tool === null) {
    const { x, y: hy } = S.hover;
    if (x >= 0 && hy >= 0 && x < W && hy < land.h && y.kind[tileOf(x, hy)] !== NONE)
      around(tileOf(x, hy), GOLD[2], true);
  }
  if (S.mark) {
    // The pieces marked, lit gold on their tiles; the area itself a line of dashes that march.
    const m = S.mark;
    const leaving = S.group?.as === "move";
    g.fillStyle = leaving ? "rgba(26,15,30,0.55)" : "rgba(255,196,84,0.5)";
    for (const i of m.tiles) if (y.kind[i] !== NONE) g.fillRect(X(i), Y(i), P, P);
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
    const x = dx + S.aim.x * P;
    const top = dy + S.aim.y * P;
    const bad = S.aim.why !== null;
    if (tool === "remove") box(g, x, top, P, P, CORAL, true);
    else if (tool === "paint") {
      if (!bad) box(g, x, top, P, P, PAINTS[S.tint - 1]?.lit ?? CREAM, true);
    } else if (tool === "select") {
      if (S.group) {
        // The pieces in hand where they would stand: gold where each can go, coral where it cannot.
        const grp = S.group;
        const hand = inHand(y, grp);
        for (let n = 0; n < hand.tiles.length; n++) {
          const i = hand.tiles[n] ?? 0;
          g.fillStyle = grp.why[hand.of[n] ?? 0] === null ? GOLD[2] : CORAL;
          g.fillRect(X(i), Y(i), P, P);
        }
        const b = boxOf(grp.at);
        const stuck = grp.why.some((r) => r !== null);
        box(g, dx + b.x * P, dy + b.y * P, b.w * P, b.h * P, stuck ? CORAL : CREAM, true);
      }
    } else if (!S.run) {
      // One piece about to be built: its block, and for a tunnel the mouth it would come up at.
      g.fillStyle = bad ? CORAL : blockColour(tool);
      g.fillRect(x, top, P, P);
      const far = S.aim.far ?? -1;
      if (far >= 0) g.fillRect(X(far), Y(far), P, P);
      if (tool === PYLON) {
        // How far its light would reach.
        const r = ((REACH.pylon * y.open.reach) / 10_000) * P;
        const n = Math.max(12, Math.round(r * 3));
        g.fillStyle = bad ? CORAL : GOLD[2];
        for (let k = 0; k < n; k += 2) {
          const a = (k / n) * Math.PI * 2;
          g.fillRect(Math.round(x + P / 2 + Math.cos(a) * r), Math.round(top + P / 2 + Math.sin(a) * r), 1, 1);
        }
      }
      box(g, x, top, P, P, bad ? CORAL : CREAM, true);
    }
  }
  const nudged = tileNudge();
  if (nudged) {
    // The place a nudge is about.
    box(g, dx + nudged.x * P, dy + nudged.y * P, P, P, INK, false);
    box(g, dx + nudged.x * P - 1, dy + nudged.y * P - 1, P + 2, P + 2, GOLD[2], true);
  }
}
