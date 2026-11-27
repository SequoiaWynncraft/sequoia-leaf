import { beatAt, drawFigure, drawStanding, drawStars, framesOf, hoverAt } from "@sequoia-leaf/figures/sprites.ts";
/**
 * The table's moving parts, drawn over the painted table every frame: the two halves of the board,
 * the hexes lit for a figure in the hand, whoever is across the table and whoever is watching, the
 * figures waiting on the far half, the party's own on the near half and the bench, and (while one
 * is on) the fight.
 */
import { CREAM, GOLD, INK, SKY, WATER } from "@sequoia-leaf/kit/palette.ts";
import { R } from "@sequoia-leaf/kit/pix.ts";
import { clamp, type Ctx } from "@sequoia-leaf/kit/util.ts";
import { fieldCap, fielded, type ItemId, levelOf, pieceAt, type RunView, type Stars } from "@sequoia-leaf/raid";
import { type FigureId, isBossId, type UnitKind } from "@sequoia-leaf/raid/content/figures.ts";
import { regularOf, ROOMS } from "@sequoia-leaf/raid/content/rooms.ts";
import { HOME_ROWS, seatCell } from "@sequoia-leaf/raid/hex.ts";

import { itemPic, levelPic } from "./art/icons.ts";
import { drawLife } from "./art/place.ts";
import { hexMark, lampsOf, rimTop, stumpOf, warmGlow } from "./art/table.ts";
import { drawClosed } from "./closed.ts";
import { drawFightMarks } from "./fightmarks.ts";
import { drawFight, drawFightAir, fightBump, fightHeldUnder, fightOn } from "./fightview.ts";
import { burst, drawFlyers, drawFxOver, drawFxUnder, wordsFx } from "./fx.ts";
import { cellXY, GAP, HEX_H, HEX_W, ROW, seatXY, slotXY } from "./geometry.ts";
import type { Marks } from "./gesture.ts";
import { handMarks } from "./hand.ts";
import { drawHeld, type HeldAt, heldAt, heldRow, heldTop } from "./held.ts";
import { DIM, shineOf } from "./light.ts";
import { arrivalOf, handing, watchersOf } from "./logic.ts";
import { aloft, FOOT, type Pawn, pawns, spotOfPawn } from "./pawns.ts";
import { drawRisings } from "./rising.ts";
import { drawRoots } from "./roots.ts";
import { facing } from "./screen.ts";
import { snd } from "./sounds.ts";
import { drawSeals } from "./spells.ts";
import { boardHalves, place, type Standing, V } from "./stage.ts";
import { catalogNow, S } from "./state.ts";
import { drawZone } from "./zone.ts";

/** When the board was last found full, for flashing its count. */
export const boardFull = { at: -9 };

let litMark: HTMLCanvasElement | null = null;
let aimMark: HTMLCanvasElement | null = null;
let swapMark: HTMLCanvasElement | null = null;

// ---------- who is waiting on the far half ----------

/** The far party walking in: when it began, and which walk-in it is (`arrivalOf`). */
const arrival = { t0: -99, key: "", boss: false, stomps: 0 };

/** Starts the far party's walk in from the trees. A boss comes first, and slowly. */
export function arrive(run: RunView): void {
  arrival.t0 = V.t;
  arrival.key = arrivalOf(run);
  arrival.boss = run.foe.figures.some((p) => isBossId(p.kind));
  arrival.stomps = 0;
  if (arrival.boss) snd.boss();
}
/** Whether the far party is the one that has already walked in. */
export const arrived = (run: RunView): boolean => arrival.key === arrivalOf(run);
/** Puts the far party in its place without the walk. */
export function settleArrival(run: RunView): void {
  arrival.t0 = -99;
  arrival.key = arrivalOf(run);
  arrival.boss = false;
}

const BOSS_WALK = 1.7;
const BOSS_STEPS = 5;

/** How far a waiting figure still is from its hex (in pixels, up the board), and how high it has hopped. */
function approach(order: number, boss: boolean): { away: number; lift: number; here: boolean } {
  const t = V.t - arrival.t0;
  if (boss) {
    const k = clamp((t - 0.5) / BOSS_WALK, 0, 1);
    return { away: (1 - k) * 86, lift: Math.abs(Math.sin(k * Math.PI * BOSS_STEPS)) * 4, here: t > 0.5 };
  }
  const start = (arrival.boss ? 0.5 + BOSS_WALK + 0.15 : 0.1) + order * 0.07;
  const k = clamp((t - start) / 0.36, 0, 1);
  const e = 1 - (1 - k) * (1 - k);
  return { away: (1 - e) * 70, lift: Math.sin(k * Math.PI) * 10, here: t > start };
}

export function stepScene(dt: number): void {
  const goal = fightOn() ? 0 : GAP;
  V.gap += (goal - V.gap) * Math.min(1, dt * 9);
  if (Math.abs(goal - V.gap) < 0.2) V.gap = goal;
  // The boss's footfalls, as its walk passes each one.
  if (arrival.boss && S.run) {
    const k = clamp((V.t - arrival.t0 - 0.5) / BOSS_WALK, 0, 1);
    const steps = Math.floor(k * BOSS_STEPS);
    if (steps > arrival.stomps) {
      arrival.stomps = steps;
      snd.stomp();
      const boss = S.run.foe.figures.find((p) => isBossId(p.kind));
      if (boss) {
        const at = cellXY(seatCell(1, boss.seat), V.gap);
        const away = (1 - k) * 86;
        burst(at.x, at.y + FOOT - away, 8, ["#cbb894", "#966c4a"], {
          speed: 24,
          ttl: 0.4,
          spread: Math.PI,
          toward: -Math.PI / 2,
        });
      }
    }
  }
}

// ---------- drawing ----------

/** One of the party's own figures, where it stands or hops. */
function pawnStanding(g: Ctx, p: Pawn, ox: number, oy: number): Standing {
  const f = framesOf(p.kind);
  const spot = spotOfPawn(p);
  const piece = S.run && spot ? pieceAt(S.run, spot) : null;
  const items = piece?.items ?? [];
  const pop = V.t - p.popAt;
  const cheer = V.t - p.cheerAt;
  const shine = shineOf(catalogNow(), p.kind, items, p.x, V.t);
  let lift = p.lift + shine.hop;
  if (pop >= 0 && pop < 0.4) lift += Math.sin((pop / 0.4) * Math.PI) * 8;
  if (cheer >= 0 && cheer < 0.3) lift += Math.sin((cheer / 0.3) * Math.PI) * 5;
  const sway = V.t < p.wiggleUntil ? Math.round(Math.sin(V.t * 24) * 1.5) : 0;
  const x = ox + p.x + sway;
  const y = oy + p.y - lift;
  const hover = hoverAt(p.kind, V.t, p.phase);
  return {
    x: p.x,
    y: p.y,
    draw: () => {
      if (lift > 1.5) {
        g.fillStyle = "rgba(26,15,30,0.3)";
        g.fillRect(Math.round(ox + p.x) - 6, Math.round(oy + p.y) - 1, 12, 2);
      }
      const alpha = p.alpha * (shine.dim ? DIM : 1);
      if (alpha < 1) g.globalAlpha = alpha;
      drawStanding(g, catalogNow(), p.kind, x, y, S.looks.bases, {
        hover,
        beat: beatAt(V.t, p.phase),
        left: p.facing,
        flash: pop >= 0 && pop < 0.09,
        lit: shine.lit,
      });
      drawHeld(g, heldRow(items, p.x + sway, heldTop(p.y - lift, false)), ox, oy);
      // Its level, at the left of its base.
      const level = S.run ? levelOf(S.run, p.kind) : 0;
      if (level > 0) g.drawImage(levelPic(level), Math.round(x) - 10, Math.round(y) - 6);
      g.globalAlpha = 1;
    },
    top: () => {
      if (p.alpha < 0.6) return;
      const grew = pop >= 0 && pop < 0.7;
      const starsAt = y - 3 - hover - f.tall - (grew ? Math.round(Math.sin((pop / 0.7) * Math.PI) * 3) : 0);
      drawStars(g, p.stars, x, starsAt, grew);
      // A component in the hand: what it would make with the one this figure holds, faint, over its head.
      const forging = handMarks().forging;
      const would = forging && piece ? handing(catalogNow(), piece, forging) : null;
      if (would?.can && would.forged) {
        const pic = itemPic(would.forged);
        g.globalAlpha = 0.55 + 0.15 * Math.sin(V.t * 4 + p.phase * 6);
        g.drawImage(pic, Math.round(x - pic.width / 2), Math.round(starsAt - 6 - pic.height + Math.sin(V.t * 3) * 1.5));
        g.globalAlpha = 1;
      }
    },
  };
}

/** One of the far party's figures, waiting on its hex while the member plans. */
function foeStanding(
  g: Ctx,
  kind: UnitKind,
  stars: Stars,
  seat: number,
  order: number,
  items: readonly ItemId[],
): Standing | null {
  const at = cellXY(seatCell(1, seat), V.gap);
  const big = isBossId(kind);
  const come = approach(order, big);
  if (!come.here) return null;
  const f = framesOf(kind);
  const shine = shineOf(catalogNow(), kind, items, at.x, V.t);
  const x = V.bx + at.x;
  const y = V.by + at.y + FOOT - come.away - come.lift - shine.hop;
  const phase = (seat * 0.23) % 1;
  const hover = hoverAt(kind, V.t, phase);
  return {
    x: at.x,
    y: at.y + FOOT - come.away,
    draw: () => {
      if (shine.dim) g.globalAlpha = DIM;
      drawStanding(g, catalogNow(), kind, x, y, "plain", {
        hover,
        beat: beatAt(V.t, phase),
        left: true,
        lit: shine.lit,
      });
      drawHeld(g, heldRow(items, at.x, heldTop(at.y + FOOT - come.away - come.lift - shine.hop, false)), V.bx, V.by);
      g.globalAlpha = 1;
    },
    top: () => {
      if (stars > 1) drawStars(g, stars, x, y - 3 - hover - f.tall);
    },
  };
}

function drawMarks(g: Ctx): void {
  litMark ??= hexMark(GOLD[1], GOLD[0]);
  aimMark ??= hexMark("#ffffff", GOLD[1]);
  swapMark ??= hexMark(WATER[3], WATER[2]);
  const pulse = 0.5 + 0.14 * Math.sin(V.t * 5);
  const marks = handMarks();
  const put = (mark: HTMLCanvasElement, seat: number, alpha: number): void => {
    const at = seatXY(seat);
    g.globalAlpha = alpha;
    g.drawImage(mark, V.bx + at.x - HEX_W / 2, V.by + at.y - HEX_H / 2);
  };
  for (const seat of marks.seats) put(litMark, seat, pulse);
  for (const seat of marks.swaps) put(swapMark, seat, pulse * 0.8);
  drawZone(g, marks.zone, V.bx, V.by);
  const t = marks.target;
  if (t?.on === "board" && (marks.seats.includes(t.at) || marks.swaps.includes(t.at))) put(aimMark, t.at, 0.9);
  g.globalAlpha = 1;
  // Hollows of the bench a held figure may go to.
  for (const slot of marks.slots) {
    const at = slotXY(slot);
    const aimed = t?.on === "bench" && t.at === slot;
    g.globalAlpha = aimed ? 0.9 : pulse;
    R(g, V.bx + at.x - 8, V.by + at.y - 12, 16, 1, GOLD[2]);
    R(g, V.bx + at.x - 8, V.by + at.y + 3, 16, 1, GOLD[2]);
    R(g, V.bx + at.x - 9, V.by + at.y - 11, 1, 14, GOLD[2]);
    R(g, V.bx + at.x + 8, V.by + at.y - 11, 1, 14, GOLD[2]);
  }
  g.globalAlpha = 1;
}

/** How many may be fielded, as a column of pips beside the front line: gold for a figure, hollow for room. */
function drawCap(g: Ctx, run: RunView): void {
  const cap = fieldCap(run);
  const on = fielded(run);
  const x = V.bx - 7;
  const y0 = V.by + HOME_ROWS * ROW + 4;
  const flash = V.t - boardFull.at < 0.5 && Math.floor(V.t * 12) % 2 === 0;
  for (let i = 0; i < cap; i++) {
    const y = y0 + i * 6;
    R(g, x, y, 5, 5, INK);
    R(g, x + 1, y + 1, 3, 3, i < on ? (flash ? "#e67967" : GOLD[1]) : "#3d2050");
    if (i < on) R(g, x + 1, y + 1, 2, 1, flash ? "#f4a08c" : GOLD[2]);
  }
}

/**
 * The regular who brought the party across the table, if a regular did: the forest's trouble has
 * nobody sat there, nor has another member's board.
 */
function regularAcross(run: RunView): FigureId | null {
  return ROOMS[run.room]?.kind === "spar" ? (regularOf(run.foe)?.kind ?? null) : null;
}

/** When the watchers last had something to hop about. */
let cheerAt = -9;
export function watchersCheer(): void {
  cheerAt = V.t;
}

/** How large the regular across the table is drawn, against a figure on the board. */
const ACROSS = 2;

/**
 * The regular across the table, drawn large: the upper part of the figure over the stump's far
 * edge, as if sitting just behind it, breathing.
 */
function drawAcross(g: Ctx, kind: FigureId, cx: number, rim: number): void {
  const f = framesOf(kind, true);
  const pic = f.idle[Math.floor(V.t * 1.4) % 2 === 0 ? 0 : 1];
  // As much of it as stands over the edge: most of a small figure, the top of a tall one, and on a
  // window where the far edge is near the top, as much as there is room for.
  const shown = Math.min(f.h, Math.max(6, Math.round(f.tall * 0.72) + 1));
  const top = f.h - (f.tall + 1);
  const rows = Math.min(f.h - top, shown, Math.floor((rim + 3) / ACROSS));
  if (rows < 5) return;
  g.drawImage(
    pic,
    0,
    top,
    f.w,
    rows,
    Math.round(cx) - f.ax * ACROSS,
    rim - rows * ACROSS + 3,
    f.w * ACROSS,
    rows * ACROSS,
  );
}

function drawPeople(g: Ctx, run: RunView): void {
  const p = place();
  const { cx, cy, rx } = stumpOf(p);
  const rim = rimTop(p);
  const up = V.t - cheerAt;
  const bounce = (i: number): number =>
    up >= 0 && up < 0.9 ? Math.abs(Math.sin((up + i * 0.1) * 9)) * 3 * (1 - up / 0.9) : 0;
  const across = regularAcross(run);
  if (across) drawAcross(g, across, cx, rim);
  if (p.w > 330) {
    const [a, b] = watchersOf(S.runs, run.foe);
    drawFigure(g, a, cx - rx - 34, cy + 5 - bounce(0), { beat: Math.floor(V.t * 1.2) % 2 === 0 ? 0 : 1 });
    drawFigure(g, b, cx + rx + 34, cy + 11 - bounce(1), {
      left: true,
      beat: Math.floor(V.t * 1.2 + 0.5) % 2 === 0 ? 0 : 1,
    });
  }
}

/** The lanterns breathing: a little warm light that comes and goes. */
function drawLamps(g: Ctx): void {
  g.globalCompositeOperation = "lighter";
  lampsOf(place()).forEach((l, i) => {
    g.globalAlpha = 0.07 + 0.04 * Math.sin(V.t * 5.3 + i * 2.1) + 0.02 * Math.sin(V.t * 13 + i);
    g.drawImage(warmGlow(), l.x - 22, l.y - 20, 44, 44);
  });
  g.globalAlpha = 1;
  g.globalCompositeOperation = "source-over";
}

export function drawScene(g: Ctx): void {
  // A big moment in a fight bumps the board and everything on it; the stump around it stays put.
  const bump = fightBump();
  g.save();
  g.translate(bump.x, bump.y);
  drawTable(g);
  g.restore();
}

function drawTable(g: Ctx): void {
  const marks = handMarks();
  const { far, near } = boardHalves();
  g.drawImage(far, V.bx - 1, V.by - Math.round(V.gap) - 1);
  g.drawImage(near, V.bx - 1, V.by + HOME_ROWS * ROW - 1);
  drawLamps(g);
  drawLife(g, place(), V.t, S.looks.place);
  const run = S.run;
  if (!run || S.screen.at === "front" || S.screen.at === "over") return;
  drawClosed(g, run);
  drawPeople(g, facing(S.screen, run));
  const fighting = fightOn();
  if (!fighting) {
    drawCap(g, run);
    drawMarks(g);
  }
  drawFxUnder(g);
  drawFightMarks(g);
  drawRoots(g);
  drawRisings(g);
  drawSeals(g);
  const list: Standing[] = [];
  if (fighting) drawFight(g, list);
  else {
    const waiting = run.foe.figures.toSorted(
      (a, b) => Number(isBossId(b.kind)) - Number(isBossId(a.kind)) || a.seat - b.seat,
    );
    waiting.forEach((foe, i) => {
      const s = foeStanding(g, foe.kind, foe.stars, foe.seat, i, foe.items);
      if (s) list.push(s);
    });
  }
  for (const p of pawns.values()) {
    if (aloft(p) || p.id === marks.held) continue;
    if (fighting && spotOfPawn(p)?.on === "board") continue;
    list.push(pawnStanding(g, p, V.bx, V.by));
  }
  list.sort((a, b) => a.y - b.y || a.x - b.x);
  for (const s of list) s.draw();
  // A ring under the figure that has been tapped and is waiting to be told where to go.
  const picked = pawns.get(marks.picked);
  if (picked && !fighting) {
    const bob = Math.round(Math.sin(V.t * 6));
    const f = framesOf(picked.kind);
    const x = Math.round(V.bx + picked.x);
    const y = Math.round(V.by + picked.y) - f.tall - 12 + bob;
    R(g, x - 2, y, 5, 2, INK);
    R(g, x - 1, y + 2, 3, 1, INK);
    R(g, x, y + 3, 1, 1, INK);
    R(g, x - 1, y, 3, 2, GOLD[2]);
    R(g, x, y + 2, 1, 1, GOLD[2]);
  }
  for (const s of list) s.top();
  if (!fighting) drawItemMarks(g, marks);
  if (fighting) drawFightAir(g);
  drawFxOver(g);
}

/** The outline round the small heart, then the heart: where to draw its shape, and in what. */
const HEART = [
  [-1, 0, INK],
  [1, 0, INK],
  [0, -1, INK],
  [0, 1, INK],
  [0, 0, SKY[5]],
] as const;
/** A small heart, its top left at a point, outlined: one of the fielded wants the item in the hand, or pointed at. */
function drawHeart(g: Ctx, x: number, y: number): void {
  for (const [dx, dy, c] of HEART) {
    R(g, x + dx + 1, y + dy, 1, 1, c);
    R(g, x + dx + 3, y + dy, 1, 1, c);
    R(g, x + dx, y + dy + 1, 5, 1, c);
    R(g, x + dx + 1, y + dy + 2, 3, 1, c);
    R(g, x + dx + 2, y + dy + 3, 1, 1, c);
  }
}

/**
 * The marks of an item in the hand or pointed at: brackets at the feet of the figures that would
 * take it (bright on the one it is aimed at, the rest pulsing), and a heart beside the stars of
 * each fielded figure that wants it, which stays still while the brackets pulse.
 */
function drawItemMarks(g: Ctx, marks: Marks): void {
  for (const id of marks.takers) {
    const p = pawns.get(id);
    if (!p) continue;
    const on = id === marks.taker || marks.wanters.includes(id);
    g.globalAlpha = on ? 1 : 0.5 + 0.3 * Math.sin(V.t * 6);
    const x = Math.round(V.bx + p.x);
    const y = Math.round(V.by + p.y);
    const c = id === marks.taker ? CREAM : GOLD[2];
    R(g, x - 8, y + 2, 4, 1, c);
    R(g, x + 5, y + 2, 4, 1, c);
    R(g, x - 9, y, 1, 2, c);
    R(g, x + 9, y, 1, 2, c);
  }
  g.globalAlpha = 1;
  for (const id of marks.wanters) {
    const p = pawns.get(id);
    if (!p || p.id === marks.held) continue;
    // Its bottom level with the bottom of the stars, clear of three of them.
    drawHeart(g, Math.round(V.bx + p.x + 11), Math.round(V.by + p.y - framesOf(p.kind).tall - 7));
  }
}

export function wordsScene(ctx: Ctx, px: number): void {
  wordsFx(ctx, px);
}

/** What flies over the interface: a figure in the hand, one crossing from the stall, acorns. */
export function drawOver(g: Ctx): boolean {
  let any = false;
  const marks = handMarks();
  for (const p of pawns.values()) {
    if (!aloft(p) && p.id !== marks.held) continue;
    any = true;
    if (p.id === marks.held) {
      const sway = Math.round(Math.sin(V.t * 9) * 1);
      const x = V.bx + marks.at.x + sway;
      const y = V.by + marks.at.y + 6;
      g.fillStyle = "rgba(26,15,30,0.25)";
      g.fillRect(Math.round(x) - 6, Math.round(y) + 3, 12, 2);
      drawStanding(g, catalogNow(), p.kind, x, y - 4, S.looks.bases, { beat: 1 });
      drawStars(g, p.stars, x, y - 7 - framesOf(p.kind).tall);
    } else {
      const s = pawnStanding(g, p, V.bx, V.by);
      s.draw();
      s.top();
    }
  }
  const ghost = marks.ghost;
  if (ghost) {
    any = true;
    const x = V.bx + marks.at.x;
    const y = V.by + marks.at.y;
    if ("kind" in ghost) {
      drawStanding(g, catalogNow(), ghost.kind, x, y + 2, S.looks.bases, { beat: 1 });
    } else {
      const pic = itemPic(ghost.item);
      g.drawImage(pic, Math.round(x - pic.width / 2), Math.round(y - pic.height / 2) - 4);
    }
  }
  return drawFlyers(g) || any;
}

/** The far party's figure under a point measured from the board's corner, while planning. */
export function foeAt(run: RunView, x: number, y: number): { kind: UnitKind; stars: Stars; seat: number } | null {
  let best: { kind: UnitKind; stars: Stars; seat: number } | null = null;
  let bestY = -1e9;
  for (const foe of run.foe.figures) {
    const at = cellXY(seatCell(1, foe.seat), V.gap);
    const f = framesOf(foe.kind);
    const half = Math.max(7, f.wide / 2);
    const fy = at.y + FOOT;
    if (x < at.x - half || x > at.x + half || y > fy + 3 || y < fy - f.tall - 2) continue;
    if (fy > bestY) {
      best = { kind: foe.kind, stars: foe.stars, seat: foe.seat };
      bestY = fy;
    }
  }
  return best;
}

/** The item a figure holds under a point measured from the board's corner: in its row under the base. */
export function heldUnder(run: RunView, x: number, y: number): HeldAt | null {
  if (S.screen.at === "fight" || S.screen.at === "after") return fightHeldUnder(x, y);
  if (S.screen.at !== "plan") return null;
  for (const p of pawns.values()) {
    const spot = spotOfPawn(p);
    if (!spot || p.id === handMarks().held) continue;
    const piece = pieceAt(run, spot);
    const hit = piece ? heldAt(heldRow(piece.items, p.x, heldTop(p.y, false)), x, y) : null;
    if (hit) return hit;
  }
  for (const foe of run.foe.figures) {
    const at = cellXY(seatCell(1, foe.seat), V.gap);
    const hit = heldAt(heldRow(foe.items, at.x, heldTop(at.y + FOOT, false)), x, y);
    if (hit) return hit;
  }
  return null;
}
