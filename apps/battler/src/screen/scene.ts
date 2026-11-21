/**
 * The table's moving parts, drawn over the painted table every frame: the two halves of the board,
 * the hexes lit for a figure in the hand, whoever is across the table and whoever is watching, the
 * figures waiting on the far half, the party's own on the near half and the bench, and (while one
 * is on) the fight.
 */
import { CREAM, GOLD, INK, WATER } from "@sequoia-leaf/kit/palette.ts";
import { R } from "@sequoia-leaf/kit/pix.ts";
import { FOOT_X, FOOT_Y, SIT } from "@sequoia-leaf/kit/skin.ts";
import { clamp, type Ctx } from "@sequoia-leaf/kit/util.ts";

import { isBossId, type UnitKind } from "../game/content/figures.ts";
import { ROOMS } from "../game/content/rooms.ts";
import { HOME_ROWS, seatCell } from "../game/hex.ts";
import { fieldCap, fielded, type Run, type Spot, type Stars } from "../game/index.ts";
import { bodyOf, MATE_NAMES } from "./art/mates.ts";
import { drawBase, drawFigure, drawStars, framesOf } from "./art/sprites.ts";
import { hexMark, lampsOf, rimTop, stumpOf, warmGlow } from "./art/table.ts";
import { drawFight, drawFightAir, fightOn } from "./fightview.ts";
import { burst, drawFlyers, drawFxOver, drawFxUnder, wordsFx } from "./fx.ts";
import { cellXY, GAP, HEX_H, HEX_W, type Pt, ROW, seatXY, slotXY } from "./geometry.ts";
import { DIM, shineOf } from "./light.ts";
import { FOOT, type Pawn, pawns } from "./pawns.ts";
import { snd } from "./sounds.ts";
import { boardHalves, place, type Standing, V } from "./stage.ts";
import { S } from "./state.ts";

/** What the member's hand is doing, for the table to show: filled in by `hand.ts`. */
export const marks: {
  /** Free seats a held figure may go to, and seats whose figure it would change places with. */
  seats: number[];
  swaps: number[];
  /** Hollows of the bench it may go to. */
  slots: number[];
  /** The place under the hand. */
  target: Spot | null;
  /** The pawn tapped and waiting to be told where to go, and the pawn in the hand; -1 for none. */
  picked: number;
  held: number;
  /** Pawns that would take the item in the hand, and the one it is over. */
  takers: number[];
  taker: number;
  /** Where the hand is, from the board's corner. */
  at: Pt;
  /** Something carried in the hand that is not a pawn yet: an offer from the stall, an item. */
  ghost: { kind: UnitKind | null; pic: HTMLCanvasElement | null } | null;
  /** When the board was last found full, for flashing its count. */
  fullAt: number;
} = {
  seats: [],
  swaps: [],
  slots: [],
  target: null,
  picked: -1,
  held: -1,
  takers: [],
  taker: -1,
  at: { x: 0, y: 0 },
  ghost: null,
  fullAt: -9,
};

let litMark: HTMLCanvasElement | null = null;
let aimMark: HTMLCanvasElement | null = null;
let swapMark: HTMLCanvasElement | null = null;

// ---------- who is waiting on the far half ----------

/** The far party walking in: when it began, and for which room. */
const arrival = { t0: -99, room: -1, seed: -1, boss: false, stomps: 0 };

/** Starts the far party's walk in from the trees. A boss comes first, and slowly. */
export function arrive(run: Run): void {
  arrival.t0 = V.t;
  arrival.room = run.room;
  arrival.seed = run.seed;
  arrival.boss = run.foe.figures.some((p) => isBossId(p.kind));
  arrival.stomps = 0;
  if (arrival.boss) snd.boss();
}
/** Whether the far party is the one that has already walked in. */
export const arrived = (run: Run): boolean => arrival.room === run.room && arrival.seed === run.seed;
/** Puts the far party in its place without the walk. */
export function settleArrival(run: Run): void {
  arrival.t0 = -99;
  arrival.room = run.room;
  arrival.seed = run.seed;
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

function beatOf(phase: number): 0 | 1 {
  return Math.floor(V.t * 1.7 + phase * 2) % 2 === 0 ? 0 : 1;
}

/** One of the party's own figures, where it stands or hops. */
function pawnStanding(g: Ctx, p: Pawn, ox: number, oy: number): Standing {
  const f = framesOf(p.kind);
  const pop = V.t - p.popAt;
  const cheer = V.t - p.cheerAt;
  const shine = shineOf(p.kind, p.x, V.t);
  let lift = p.lift + shine.hop;
  if (pop >= 0 && pop < 0.4) lift += Math.sin((pop / 0.4) * Math.PI) * 8;
  if (cheer >= 0 && cheer < 0.3) lift += Math.sin((cheer / 0.3) * Math.PI) * 5;
  const sway = V.t < p.wiggleUntil ? Math.round(Math.sin(V.t * 24) * 1.5) : 0;
  const x = ox + p.x + sway;
  const y = oy + p.y - lift;
  const hover = f.flies ? 2 + Math.round(Math.sin(V.t * 4 + p.phase * 6)) : 0;
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
      drawBase(g, p.kind, x, y, S.prefs.bases);
      drawFigure(g, p.kind, x, y - 2 - hover, {
        beat: beatOf(p.phase),
        left: p.facing,
        flash: pop >= 0 && pop < 0.09,
        lit: shine.lit,
      });
      g.globalAlpha = 1;
    },
    top: () => {
      if (p.alpha < 0.6) return;
      const grew = pop >= 0 && pop < 0.7;
      drawStars(
        g,
        p.stars,
        x,
        y - 3 - hover - f.tall - (grew ? Math.round(Math.sin((pop / 0.7) * Math.PI) * 3) : 0),
        grew,
      );
    },
  };
}

/** One of the far party's figures, waiting on its hex while the member plans. */
function foeStanding(g: Ctx, kind: UnitKind, stars: Stars, seat: number, order: number): Standing | null {
  const at = cellXY(seatCell(1, seat), V.gap);
  const big = isBossId(kind);
  const come = approach(order, big);
  if (!come.here) return null;
  const f = framesOf(kind);
  const shine = shineOf(kind, at.x, V.t);
  const x = V.bx + at.x;
  const y = V.by + at.y + FOOT - come.away - come.lift - shine.hop;
  const phase = (seat * 0.23) % 1;
  const hover = f.flies ? 2 + Math.round(Math.sin(V.t * 4 + phase * 6)) : 0;
  return {
    x: at.x,
    y: at.y + FOOT - come.away,
    draw: () => {
      if (shine.dim) g.globalAlpha = DIM;
      drawBase(g, kind, x, y);
      drawFigure(g, kind, x, y - 2 - hover, { beat: beatOf(phase), left: true, lit: shine.lit });
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
  const put = (mark: HTMLCanvasElement, seat: number, alpha: number): void => {
    const at = seatXY(seat);
    g.globalAlpha = alpha;
    g.drawImage(mark, V.bx + at.x - HEX_W / 2, V.by + at.y - HEX_H / 2);
  };
  for (const seat of marks.seats) put(litMark, seat, pulse);
  for (const seat of marks.swaps) put(swapMark, seat, pulse * 0.8);
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
function drawCap(g: Ctx, run: Run): void {
  const cap = fieldCap(run);
  const on = fielded(run);
  const x = V.bx - 7;
  const y0 = V.by + HOME_ROWS * ROW + 4;
  const flash = V.t - marks.fullAt < 0.5 && Math.floor(V.t * 12) % 2 === 0;
  for (let i = 0; i < cap; i++) {
    const y = y0 + i * 6;
    R(g, x, y, 5, 5, INK);
    R(g, x + 1, y + 1, 3, 3, i < on ? (flash ? "#e67967" : GOLD[1]) : "#3d2050");
    if (i < on) R(g, x + 1, y + 1, 2, 1, flash ? "#f4a08c" : GOLD[2]);
  }
}

/** Somebody sitting on a log, facing a way. */
function drawSitter(g: Ctx, name: string, x: number, y: number, dir: 0 | 1 | 2, bounce: number): void {
  const frame = bodyOf(name).frames[dir]?.[SIT];
  if (frame) g.drawImage(frame, Math.round(x) - FOOT_X, Math.round(y - bounce) - FOOT_Y);
}

/** The two who watch from the side logs, picked by the run so they stay the same all raid. */
function watchers(run: Run): [string, string] {
  const others = MATE_NAMES.filter((n) => n !== run.foe.who);
  const a = others[run.seed % others.length] ?? "Mossback";
  const rest = others.filter((n) => n !== a);
  const b = rest[(run.seed >>> 8) % rest.length] ?? "Wrenly";
  return [a, b];
}

/** When the watchers last had something to hop about. */
let cheerAt = -9;
export function watchersCheer(): void {
  cheerAt = V.t;
}

function drawPeople(g: Ctx, run: Run): void {
  const p = place();
  const { cx, cy, rx } = stumpOf(p);
  const rim = rimTop(p);
  const up = V.t - cheerAt;
  const bounce = (i: number): number =>
    up >= 0 && up < 0.9 ? Math.abs(Math.sin((up + i * 0.1) * 9)) * 3 * (1 - up / 0.9) : 0;
  if (ROOMS[run.room]?.kind === "spar") {
    // Whoever brought the party sits across the table: head and shoulders over its far edge.
    const frame = bodyOf(run.foe.who).frames[0]?.[SIT];
    if (frame && rim >= 14)
      g.drawImage(frame, 0, 0, frame.width, 17, Math.round(cx) - FOOT_X, rim - 16, frame.width, 17);
  }
  if (p.w > 330) {
    const [a, b] = watchers(run);
    drawSitter(g, a, cx - rx - 34, cy + 5, 2, bounce(0));
    drawSitter(g, b, cx + rx + 34, cy + 11, 1, bounce(1));
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
  const { far, near } = boardHalves();
  g.drawImage(far, V.bx - 1, V.by - Math.round(V.gap) - 1);
  g.drawImage(near, V.bx - 1, V.by + HOME_ROWS * ROW - 1);
  drawLamps(g);
  const run = S.run;
  if (!run || S.mode === "front" || S.mode === "over") return;
  drawPeople(g, run);
  const fighting = fightOn();
  if (!fighting) {
    drawCap(g, run);
    drawMarks(g);
  }
  drawFxUnder(g);
  const list: Standing[] = [];
  if (fighting) drawFight(g, list);
  else {
    const waiting = run.foe.figures.toSorted(
      (a, b) => Number(isBossId(b.kind)) - Number(isBossId(a.kind)) || a.seat - b.seat,
    );
    waiting.forEach((foe, i) => {
      const s = foeStanding(g, foe.kind, foe.stars, foe.seat, i);
      if (s) list.push(s);
    });
  }
  for (const p of pawns.values()) {
    if (p.air || p.id === marks.held) continue;
    if (fighting && p.spot?.on === "board") continue;
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
  // Figures an item in the hand could be given to.
  for (const id of marks.takers) {
    const p = pawns.get(id);
    if (!p) continue;
    const on = id === marks.taker;
    g.globalAlpha = on ? 1 : 0.5 + 0.3 * Math.sin(V.t * 6);
    const x = Math.round(V.bx + p.x);
    const y = Math.round(V.by + p.y);
    R(g, x - 8, y + 2, 4, 1, on ? CREAM : GOLD[2]);
    R(g, x + 5, y + 2, 4, 1, on ? CREAM : GOLD[2]);
    R(g, x - 9, y, 1, 2, on ? CREAM : GOLD[2]);
    R(g, x + 9, y, 1, 2, on ? CREAM : GOLD[2]);
    g.globalAlpha = 1;
  }
  if (fighting) drawFightAir(g);
  drawFxOver(g);
}

export function wordsScene(ctx: Ctx, px: number): void {
  wordsFx(ctx, px);
}

/** What flies over the interface: a figure in the hand, one crossing from the stall, acorns. */
export function drawOver(g: Ctx): boolean {
  let any = false;
  for (const p of pawns.values()) {
    if (!p.air && p.id !== marks.held) continue;
    any = true;
    if (p.id === marks.held) {
      const sway = Math.round(Math.sin(V.t * 9) * 1);
      const x = V.bx + marks.at.x + sway;
      const y = V.by + marks.at.y + 6;
      g.fillStyle = "rgba(26,15,30,0.25)";
      g.fillRect(Math.round(x) - 6, Math.round(y) + 3, 12, 2);
      drawBase(g, p.kind, x, y - 4, S.prefs.bases);
      drawFigure(g, p.kind, x, y - 6, { beat: 1 });
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
    if (ghost.kind) {
      drawBase(g, ghost.kind, x, y + 2);
      drawFigure(g, ghost.kind, x, y, { beat: 1 });
    } else if (ghost.pic)
      g.drawImage(ghost.pic, Math.round(x - ghost.pic.width / 2), Math.round(y - ghost.pic.height / 2) - 4);
  }
  return drawFlyers(g) || any;
}

/** The far party's figure under a point measured from the board's corner, while planning. */
export function foeAt(run: Run, x: number, y: number): { kind: UnitKind; stars: Stars; seat: number } | null {
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
