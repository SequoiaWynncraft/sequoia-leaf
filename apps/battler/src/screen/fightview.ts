import { moveAt } from "@sequoia-leaf/figures/move.ts";
import {
  type BaseLook,
  beatAt,
  drawStanding,
  drawStars,
  framesOf,
  hoverAt,
  isPersonId,
} from "@sequoia-leaf/figures/sprites.ts";
import type { Swing } from "@sequoia-leaf/figures/tools.ts";
/**
 * The fight, played on the table from the rules' own steps (`playback.ts`), with the lead-in the
 * table gives each blow (`fightshow.ts`). The rules decide everything; this plays it on, draws
 * everyone in it as their bodies move (`motion.ts`), what flies, the hexes an ability lights, what
 * is on or wrong with each figure, and the health over their feet.
 *
 * Time here is the fight's own clock, in steps (twenty a second), so that playing it at 2x or 4x
 * or stepping it by hand moves everything together; a hit-stop holds it a moment. Before the first
 * step there is a short run-in: the two halves of the board come together, then traits switch on,
 * late crabs turn up and Sneaks leap, one after another.
 */
import { CREAM, EARTH, GOLD, GREEN, INK, STONE, WATER } from "@sequoia-leaf/kit/palette.ts";
import { R } from "@sequoia-leaf/kit/pix.ts";
import { clamp, type Ctx } from "@sequoia-leaf/kit/util.ts";
import { type Catalog, type FightEvent, type FightSetup, HZ, type Unit } from "@sequoia-leaf/raid";
import { isBossId } from "@sequoia-leaf/raid/content/figures.ts";
import { seatCell } from "@sequoia-leaf/raid/hex.ts";

import { stanceOf } from "./acting.ts";
import { drawAims, drumNow, swingNow, toolNow } from "./aimed.ts";
import { drawShadow, hexSign } from "./art/board.ts";
import { clockNow, feetAt, FV, shownCell } from "./board.ts";
import { drawBubbled, waitsForBubble } from "./bubble.ts";
import { drawCalls } from "./call.ts";
import { drawCanopy, hanging } from "./canopy.ts";
import { begin, show, stepShown } from "./fightshow.ts";
import { burst, pace } from "./fx.ts";
import { cellXY, HEX_H, HEX_W, type Pt } from "./geometry.ts";
import { drawHeld, type HeldAt, heldAt, heldRow, heldTop } from "./held.ts";
import type { Speed } from "./keep.ts";
import { DIM, shineOf } from "./light.ts";
import { leadOf, LOOKS } from "./looks.ts";
import { drawShot } from "./marks.ts";
import { type Actor, actorFor, poseOf } from "./motion.ts";
import { advance, openPlayback, playOut } from "./playback.ts";
import { drawShells, inShell } from "./shell.ts";
import { OWN } from "./sides.ts";
import { snd } from "./sounds.ts";
import { drawSpells } from "./spells.ts";
import { type Standing, V } from "./stage.ts";
import { drawWalls } from "./walls.ts";

/** An ability's flash on a hex: its owner's colour, a cream rim. */
const markOf = (col: string): HTMLCanvasElement => hexSign(col, CREAM);

export const fightOn = (): boolean => FV.pb !== null;
/** Where the fight has got to, for looking from outside. */
export const fightState = (): {
  stage: string;
  tick: number;
  clock: number;
  over: boolean;
  result: string | null;
  /** How much is in the air just now: hexes lit by an ability, and things thrown. */
  lit: number;
  thrown: number;
} => ({
  stage: typeof FV.stage === "string" ? FV.stage : "done",
  tick: FV.pb?.fight.tick ?? 0,
  clock: clockNow(),
  over: FV.pb?.fight.over ?? false,
  result: FV.pb?.fight.result ?? null,
  lit: FV.flashes.length,
  thrown: FV.shots.length,
});
/** Everyone who has been in the fight on the table, for whoever keeps count. */
export const fightUnits = (): readonly Unit[] => FV.pb?.fight.units ?? [];
/** The catalogue of the fight on show: its setup's era. */
export const fightCatalog = (): Catalog | null => FV.pb?.fight.cat ?? null;
/** Everything shown happening in the fight on the table so far, for whoever keeps count. */
export const fightEvents = (): readonly FightEvent[] => FV.seen;
export function setSpeed(s: Speed): void {
  FV.speed = s;
}

/**
 * Begins playing a fight. `done` is called once, when it has been played to its end (or skipped
 * to it); the figures then stay as they ended until `endFight`.
 */
export function startFight(setup: FightSetup, speed: Speed, bases: BaseLook, done: () => void): void {
  const pb = openPlayback(setup, leadOf);
  FV.pb = pb;
  FV.speed = speed;
  FV.bases = bases;
  FV.stage = "run-in";
  FV.shots = [];
  FV.flashes = [];
  FV.signs = [];
  FV.dusk = 0;
  FV.wane = 0;
  FV.clacked = false;
  FV.bump = { at: -99, px: 0 };
  FV.done = done;
  FV.seen = [];
  FV.ours = OWN.side(setup);
  // Everyone starts where they were seated; what the opening did to them is acted out in the run-in.
  FV.actors = pb.fight.units.map((u) =>
    actorFor(u, u.summoned ? feetAt(u.cell) : feetAt(seatCell(u.side, u.seat)), u.summoned ? Infinity : -Infinity),
  );
}

/** Stops showing the fight: the party's own figures stand on their seats again. */
export function endFight(): void {
  FV.pb = null;
  FV.stage = "off";
  FV.actors = [];
  FV.shots = [];
  FV.flashes = [];
  FV.signs = [];
  FV.dusk = 0;
  FV.wane = 0;
  FV.done = null;
  FV.seen = [];
  pace.k = 1;
}

/** Goes straight to the end: the fight comes out the same, it is only not watched. */
export function skipFight(): void {
  const pb = FV.pb;
  if (!pb || typeof FV.stage !== "string") return;
  // What was still to be shown counts all the same.
  FV.seen.push(...playOut(pb));
  FV.shots = [];
  FV.flashes = [];
  // Anyone who turned up late is on the board now; everyone is where they ended, and the fallen are gone.
  pb.fight.units.forEach((u, i) => {
    const a = FV.actors[i] ?? actorFor(u, feetAt(u.cell), -Infinity);
    FV.actors[i] = a;
    const at = feetAt(u.cell);
    a.x = at.x;
    a.y = at.y;
    a.move = null;
    a.blow = null;
    a.wind = null;
    a.bornAt = -Infinity;
    a.hpShown = u.hp;
    a.fallAt = u.alive ? Infinity : -999;
    a.gone = !u.alive;
    a.rising = false;
    a.form = u.form;
    a.castUntil = -99;
  });
  finish();
}

function finish(): void {
  const pb = FV.pb;
  if (typeof FV.stage !== "string" || !pb) return;
  FV.stage = { done: V.t };
  pace.k = 1;
  // Whoever is left standing on the side that won hops about it.
  const winner = pb.fight.result === "win" ? 0 : pb.fight.result === "loss" ? 1 : -1;
  let n = 0;
  for (const a of FV.actors) {
    if (a?.unit.alive && a.unit.side === winner) a.hopAt = pb.clock + (n++ % 4) * 2;
  }
}

/** Plays the fight on: lead-ins begin and things happen as the clock reaches them. */
function play(dt: number): void {
  const pb = FV.pb;
  if (!pb) return;
  const moved = advance(pb, dt, FV.speed);
  pace.k = pb.held > 0 ? 0 : FV.speed;
  // The halves meet with a clack a few steps into the run-in.
  if (!FV.clacked && V.gap < 0.5) {
    FV.clacked = true;
    snd.clack();
    for (let x = 6; x < 150; x += 12)
      burst(x, 60, 2, ["#cbb894", CREAM], { speed: 16, ttl: 0.35, toward: -Math.PI / 2, spread: 2 });
  }
  for (const lead of moved.begun) begin(lead, pb.fight.cat);
  for (const cue of moved.happened) show(cue, pb.fight.cat);
  if (pb.clock >= 0) FV.stage = "run";
  if (pb.fight.over) {
    pb.clock = Math.max(pb.clock, pb.fight.tick);
    finish();
  }
}

/** Moves the fight on with the stage's clock. */
export function stepFightView(dt: number): void {
  const pb = FV.pb;
  if (!pb) return;
  if (FV.stage === "run-in" || FV.stage === "run") play(dt);
  else if (typeof FV.stage !== "string") {
    pb.clock += dt * HZ;
    const tell = V.t - FV.stage.done > 0.7 ? FV.done : null;
    if (tell) {
      FV.done = null;
      tell();
    }
  }
  const c = pb.clock;
  for (const a of FV.actors) {
    if (!a) continue;
    if (a.move) {
      const now = moveAt(a.move, c);
      a.x = now.x;
      a.y = now.y;
      if (now.k >= 1) a.move = null;
    }
    a.hpShown += (a.unit.hp - a.hpShown) * Math.min(1, dt * 10 * FV.speed);
  }
  stepShown(c, pb.fight.cat);
  FV.flashes = FV.flashes.filter((fl) => c < fl.t0 + 10);
  FV.signs = FV.signs.filter((p) => c < p.t0 + 16);
}

/** How far the board is bumped just now by a big moment: down, up, and settling, in whole pixels. */
export function fightBump(): Pt {
  const d = clockNow() - FV.bump.at;
  if (!FV.pb || FV.bump.px === 0 || d < 0 || d >= 6) return { x: 0, y: 0 };
  const k = Math.round(FV.bump.px * (1 - d / 6));
  return { x: 0, y: Math.floor(d) % 2 === 0 ? k : -Math.ceil(k / 2) };
}

/** What is on, or wrong with, a figure, drawn round it. */
function drawStatus(g: Ctx, a: Actor, x: number, y: number, tall: number, tick: number): void {
  const u = a.unit;
  const c = clockNow();
  /** Just clear of its sides. */
  const half = Math.max(8, Math.round(framesOf(u.kind).wide / 2) + 2);
  if (u.shield > 0) {
    // A shield settles over it: a pale arc that drops into place.
    const drop = clamp(3 - (c - a.shieldAt), 0, 3);
    const top = y - tall - 4 - drop * 2;
    g.globalAlpha = 0.85;
    R(g, x - half + 2, top, half * 2 - 4, 1, WATER[3]);
    R(g, x - half + 1, top + 1, 1, 1, WATER[3]);
    R(g, x + half - 2, top + 1, 1, 1, WATER[3]);
    R(g, x - half, top + 2, 1, tall, WATER[3]);
    R(g, x + half - 1, top + 2, 1, tall, WATER[3]);
    R(g, x - half + 3, top + 1, 3, 1, CREAM);
    g.globalAlpha = 1;
  }
  if (u.burnUntil > tick) {
    for (let i = 0; i < 3; i++) {
      const h = 1 + ((Math.floor(c * 0.8) + i * 2) % 3);
      const fx = x - 5 + i * 5;
      R(g, fx, y - h, 1, h, "#e67967");
      R(g, fx, y - h, 1, 1, GOLD[1]);
    }
  }
  if (u.stunUntil > tick) {
    for (let i = 0; i < 3; i++) {
      const ang = c * 0.35 + (i * Math.PI * 2) / 3;
      const sx = x + Math.round(Math.cos(ang) * 6);
      const sy = y - tall - 4 + Math.round(Math.sin(ang) * 2);
      R(g, sx - 1, sy, 3, 1, GOLD[2]);
      R(g, sx, sy - 1, 1, 3, GOLD[2]);
    }
  }
  if (u.slowUntil > tick) {
    const d = Math.floor(c * 0.4) % 3;
    R(g, x - half + 2, y + 1 + d, 1, 2, WATER[3]);
    R(g, x + half - 3, y + 1 + ((d + 1) % 3), 1, 2, WATER[2]);
  }
  if (u.tauntUntil > tick) {
    R(g, x - 1, y - tall - 10, 2, 4, "#e67967");
    R(g, x - 1, y - tall - 5, 2, 1, "#e67967");
  }
  if (u.hasteUntil > tick) {
    const d = Math.floor(c * 0.9) % 3;
    const back = a.left ? half : -half - 1;
    R(g, x + back, y - 5 - d * 3, 2, 1, CREAM);
    R(g, x + back + (a.left ? 2 : -2), y - 9 + d * 2, 2, 1, GOLD[2]);
  }
  if (u.bracedUntil > tick) {
    for (const [dx, dy] of [
      [-half, -tall - 2],
      [half - 1, -tall - 2],
      [-half, 1],
      [half - 1, 1],
    ] as const)
      R(g, x + dx, y + dy, 2, 2, STONE[3]);
  }
}

/** What its Huddle group's one shield holds, as a share of the group's health added together; 0 for none. */
function pooledShare(a: Actor): number {
  const f = FV.pb?.fight;
  const pool = f?.pools[a.unit.pool];
  if (!f || !pool || pool.left <= 0) return 0;
  const whole = pool.ids.reduce((sum, id) => sum + (f.units[id]?.maxHp ?? 0), 0);
  return whole > 0 ? clamp(pool.left / whole, 0, 1) : 0;
}

/**
 * Health under a figure's feet, with its shield over it and its mana beneath, which ticks bright as
 * a friend gives it mana; and its group's one shield (Huddle) as a pale-blue band, the same on each.
 */
function drawBars(g: Ctx, a: Actor, x: number, y: number, c: number, pool: number): void {
  const u = a.unit;
  const w = isBossId(u.kind) ? 26 : 14;
  const left = x - w / 2;
  const top = y + 3;
  R(g, left - 1, top - 1, w + 2, u.manaFull > 0 ? 5 : 4, INK);
  R(g, left, top, w, 2, "#3d2050");
  const hp = Math.round(clamp(a.hpShown / u.maxHp, 0, 1) * w);
  R(g, left, top, hp, 2, u.side === FV.ours ? GREEN[4] : "#e67967");
  R(g, left, top, hp, 1, u.side === FV.ours ? "#c9ef9a" : "#f4a08c");
  if (u.shield > 0) R(g, left, top, Math.max(1, Math.round(clamp(u.shield / u.maxHp, 0, 1) * w)), 1, CREAM);
  if (pool > 0) R(g, left, top + 1, Math.max(1, Math.round(pool * w)), 1, WATER[3]);
  if (u.manaFull > 0) {
    R(g, left, top + 3, w, 1, "#211228");
    R(g, left, top + 3, Math.round(clamp(u.mana / u.manaFull, 0, 1) * w), 1, WATER[3]);
    if (c - a.giftAt < GIFT) R(g, left, top + 3, Math.round(clamp(u.mana / u.manaFull, 0, 1) * w), 1, CREAM);
  }
}

/** Steps a mana bar shows bright after a friend gives it mana. */
const GIFT = 6;

/** Gone to ground: a mound of earth where it went under. */
function drawMound(g: Ctx, x: number, y: number): void {
  R(g, x - 6, y - 1, 12, 3, INK);
  R(g, x - 5, y - 2, 10, 3, EARTH[1]);
  R(g, x - 3, y - 3, 6, 1, EARTH[2]);
  R(g, x - 4, y - 1, 2, 1, EARTH[0]);
}

/** The beat of a swing it is at, held in its picture; nothing for one not swinging. */
function swingOf(a: Actor, c: number): { swing: Swing } | null {
  const swing = swingNow(a, c);
  return swing ? { swing } : null;
}

/**
 * One hidden where it is: up the tree it is on its branch (`canopy.ts`, which draws it); Crab #8 is a
 * shut shell, and Flop lies playing dead; anyone else has gone to ground.
 */
function drawHidden(g: Ctx, cat: Catalog, a: Actor, at: { x: number; y: number; ground: number; left: boolean }): void {
  const kind = a.unit.kind;
  if (hanging(a)) return;
  if (inShell(kind) || LOOKS[kind]?.hides === "pose")
    return drawStanding(g, cat, kind, at.x, at.y, "plain", { pose: "cast", left: at.left });
  drawMound(g, at.x, at.ground);
}

/** One figure in the fight as it stands on the table now, if it is on it. */
function standing(g: Ctx, cat: Catalog, a: Actor, c: number, tick: number): Standing | null {
  const u = a.unit;
  if (c < a.bornAt || a.gone) return null;
  const p = poseOf(a, c);
  const down = c >= a.fallAt;
  // A friend of Yule's whose own bubble has not closed yet stands as itself, never as a mound or a shell.
  const hidden = u.alive && u.hiddenUntil > tick && !waitsForBubble(u.id);
  const sunk = a.move?.under === true && Math.abs(moveAt(a.move, c).k - 0.5) < 0.35;
  // While the halves are still apart, the far party stands back with its half.
  const back = u.side === FV.ours ? 0 : Math.round(V.gap);
  const shine = shineOf(cat, u.kind, u.items, a.x, V.t);
  const x = Math.round(V.bx + a.x + p.dx);
  const ground = Math.round(V.by + a.y + p.dy - back);
  const y = Math.round(ground - p.lift - shine.hop);
  const hover = down ? 0 : hoverAt(u.kind, V.t, a.phase, a.form);
  const left = p.flip ? !a.left : a.left;
  // A person on a rig acts with their body; anyone else is their picture, bent.
  const act = stanceOf(a, c, tick);
  return {
    x: a.x,
    y: a.y - back,
    draw: () => {
      // A friend of Yule's is in a bubble; anyone else hidden is drawn where it hides (`drawHidden`).
      if (hidden && drawBubbled(g, a, x, ground)) return;
      if (hidden) return drawHidden(g, cat, a, { x, y, ground, left });
      if (sunk) return drawMound(g, x, ground);
      // Off the ground, its shadow stays on it; standing, it throws one; fallen, none.
      if (p.lift > 2) {
        g.fillStyle = "rgba(26,15,30,0.3)";
        g.fillRect(x - 6, ground - 1, 12, 2);
      } else if (!down) drawShadow(g, x, ground, isBossId(u.kind));
      g.globalAlpha = p.alpha * (shine.dim ? DIM : 1);
      // The member's figures stand on the bases they chose; the forest's, and what is summoned, on plain ones.
      drawStanding(g, cat, u.kind, x, y, u.side === FV.ours ? FV.bases : "plain", {
        form: a.form,
        hover: hover + p.rise,
        pose: p.cast ? "cast" : "idle",
        beat: beatAt(V.t, a.phase),
        left,
        flash: p.tint === "flash",
        hurt: p.tint === "hurt",
        lit: shine.lit,
        ...carried(a, c),
        holds: toolNow(a, c),
        ...swingOf(a, c),
        ...drumNow(a, c),
        ...(act ? { act } : { bend: { sx: p.sx, sy: p.sy, lean: left ? -p.lean : p.lean, turn: p.turn } }),
      });
      // What it holds follows it about, under its health bar, and falls with it.
      if (u.alive && !down) drawHeld(g, heldRow(u.items, x - V.bx, heldTop(y - V.by, true)), V.bx, V.by);
      g.globalAlpha = 1;
    },
    top: () => {
      if (down || !u.alive || hidden || sunk) return;
      // Over the figure's head as it is drawn now: casting, some rear up taller than they stand.
      const f = framesOf(u.kind, false, a.form);
      const tall = (p.cast ? Math.max(f.tall, f.castTall) : f.tall) + Math.max(0, p.sy);
      drawStatus(g, a, x, y - hover, tall, tick);
      // A grooter called is a person, on a summon's base, with no stars.
      if (u.stars > 1 && !(u.summoned && isPersonId(u.kind))) drawStars(g, u.stars, x, y - 3 - hover - tall);
      drawBars(g, a, x, y, c, pooledShare(a));
    },
  };
}

/**
 * How much of what it carries a figure has now: Clutch's eggs, one fewer for each of its Hatchlings
 * standing, rocking one after another; nothing to say for anyone who carries nothing.
 */
function carried(a: Actor, c: number): { carries: { n: number; rock: number } } | null {
  if (!framesOf(a.unit.kind).carries) return null;
  const up = FV.actors.filter((o) => o?.unit.owner === a.unit.id && o.unit.alive && c >= o.bornAt).length;
  const n = Math.max(0, framesOf(a.unit.kind).carries - up);
  const turn = Math.floor((V.t * 2 + a.phase * 3) % (n + 2));
  return { carries: { n, rock: turn < n ? turn : -1 } };
}

/** Adds everyone in the fight to the list of things standing on the table. */
export function drawFight(g: Ctx, list: Standing[]): void {
  const pb = FV.pb;
  if (!pb) return;
  const c = pb.clock;
  // Dusk falling over the table itself; the figures stay lit. A step of it from when healing and shields wane.
  if (FV.dusk > 0 || FV.wane > 0) {
    g.fillStyle = `rgba(32,14,50,${FV.dusk > 0 ? Math.min(0.5, 0.14 + FV.dusk * 0.03) : 0.07})`;
    g.fillRect(0, 0, V.w, V.h);
  }
  for (const fl of FV.flashes) {
    const k = (c - fl.t0) / 10;
    if (k < 0) continue;
    const at = cellXY(shownCell(fl.cell));
    g.globalAlpha = clamp(1 - k, 0, 1) * 0.75;
    g.drawImage(markOf(fl.col), V.bx + at.x - HEX_W / 2, V.by + at.y - HEX_H / 2);
  }
  g.globalAlpha = 1;
  for (const a of FV.actors) {
    const s = a ? standing(g, pb.fight.cat, a, c, pb.fight.tick) : null;
    if (s) list.push(s);
  }
}

/** What flies over the board, and the small signs that pop over a figure. Drawn after everyone standing. */
export function drawFightAir(g: Ctx): void {
  const c = clockNow();
  for (const s of FV.shots) drawShot(g, s, c);
  for (const p of FV.signs) {
    const a = FV.actors[p.id];
    if (!a) continue;
    const k = (c - p.t0) / 16;
    const rise = Math.round((1 - (1 - k) * (1 - k)) * 6);
    g.globalAlpha = clamp((1 - k) * 3, 0, 1);
    g.drawImage(
      p.pic,
      Math.round(V.bx + a.x - p.pic.width / 2),
      Math.round(V.by + a.y - framesOf(a.unit.kind).tall - 14 - rise),
    );
  }
  g.globalAlpha = 1;
  drawSpells(g);
  drawCalls(g);
  drawShells(g);
  drawAims(g);
  drawWalls(g);
  drawCanopy(g);
}

/** The item a figure in the fight holds under a point measured from the board's corner. */
export function fightHeldUnder(x: number, y: number): HeldAt | null {
  const f = FV.pb?.fight;
  if (!f) return null;
  for (const a of FV.actors) {
    const u = a?.unit;
    if (!a || !u?.alive || clockNow() < a.bornAt || u.hiddenUntil > f.tick) continue;
    const back = u.side === FV.ours ? 0 : Math.round(V.gap);
    const hit = heldAt(heldRow(u.items, a.x, heldTop(a.y - back, true)), x, y);
    if (hit) return hit;
  }
  return null;
}

/** The figure in the fight under a point measured from the board's corner. */
export function unitUnder(x: number, y: number): { unit: Unit; x: number; y: number } | null {
  let best: Actor | null = null;
  for (const a of FV.actors) {
    if (!a?.unit.alive || clockNow() < a.bornAt) continue;
    const f = framesOf(a.unit.kind);
    const half = Math.max(7, f.wide / 2);
    if (x < a.x - half || x > a.x + half || y > a.y + 4 || y < a.y - f.tall - 2) continue;
    if (!best || a.y > best.y) best = a;
  }
  return best ? { unit: best.unit, x: best.x, y: best.y } : null;
}
