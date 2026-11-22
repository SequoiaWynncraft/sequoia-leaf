/**
 * The fight, played on the table from the rules' own steps. The rules decide everything; this
 * turns each thing that happened into something seen on the board: figures walk, turn, lunge,
 * recoil, strike a pose of their own to use an ability, and tip over; what is thrown flies; rings
 * spread across the hexes an ability covers; shields settle, burns lick, the stunned see stars.
 *
 * Time here is the fight's own clock, in steps (twenty a second), so that playing it at 2x or 4x
 * or stepping it by hand moves everything together. Before the first step there is a short
 * run-in: the two halves of the board come together, then traits switch on, late crabs turn up
 * and Sneaks leap, one after another.
 */
import { CREAM, EARTH, GOLD, GREEN, INK, STONE, WATER } from "@sequoia-leaf/kit/palette.ts";
import { R } from "@sequoia-leaf/kit/pix.ts";
import { clamp, type Ctx, lerp } from "@sequoia-leaf/kit/util.ts";
import {
  type Fight,
  type FightEvent,
  type FightSetup,
  HZ,
  openFight,
  stepFight,
  type TraitId,
  type Unit,
} from "@sequoia-leaf/raid";
import { FIGURES, isBossId, isFigureId, type UnitKind } from "@sequoia-leaf/raid/content/figures.ts";
import { TRAITS } from "@sequoia-leaf/raid/content/traits.ts";
import { distance, seatCell } from "@sequoia-leaf/raid/hex.ts";

import { itemPic, traitPic } from "./art/icons.ts";
import { TRAIT_COLOUR } from "./art/pal.ts";
import { drawBase, drawFigure, drawStars, framesOf } from "./art/sprites.ts";
import { hexMark } from "./art/table.ts";
import { burst, motes, ring, say } from "./fx.ts";
import { cellXY, HEX_H, HEX_W, type Pt } from "./geometry.ts";
import { drawHeld, type HeldAt, heldAt, heldRow, heldTop } from "./held.ts";
import type { Speed } from "./keep.ts";
import { DIM, shineOf } from "./light.ts";
import { snd } from "./sounds.ts";
import { type Standing, V } from "./stage.ts";

/** How far below the middle of its hex a figure's feet are (the same as while planning). */
const FOOT = 3;

interface Actor {
  unit: Unit;
  /** Feet, from the board's corner, with the halves together. */
  x: number;
  y: number;
  fx: number;
  fy: number;
  tx: number;
  ty: number;
  m0: number;
  mDur: number;
  arc: number;
  /** Goes under the board for the middle of the move. */
  under: boolean;
  left: boolean;
  /** Not yet on the board: one that turns up later. */
  bornAt: number;
  lungeAt: number;
  lx: number;
  ly: number;
  hurtAt: number;
  hx: number;
  hy: number;
  flashAt: number;
  castUntil: number;
  /** Tipped over, and when. */
  down: boolean;
  fallAt: number;
  hopAt: number;
  shieldAt: number;
  hpShown: number;
  phase: number;
}

type ShotLook =
  "seed" | "pebble" | "cone" | "beam" | "cushion" | "tea" | "plaster" | "drop" | "dust" | "gust" | "pellet";
interface Shot {
  from: Pt;
  to: Pt;
  t0: number;
  dur: number;
  arc: number;
  look: ShotLook;
  col: string;
}
interface Flash {
  cell: number;
  t0: number;
  col: string;
}
interface Pop {
  pic: HTMLCanvasElement;
  id: number;
  t0: number;
}
interface Cue {
  at: number;
  ev: FightEvent;
}

type Stage = "off" | "run-in" | "run" | "done";

const FV: {
  fight: Fight | null;
  actors: Actor[];
  /** The fight's clock as it is shown, in steps: negative during the run-in. */
  clock: number;
  speed: Speed;
  stage: Stage;
  cues: Cue[];
  shots: Shot[];
  flashes: Flash[];
  pops: Pop[];
  dusk: number;
  clacked: boolean;
  doneAt: number;
  done: (() => void) | null;
  told: boolean;
  /** Everything that has been shown happening so far, the opening first: what the tally is counted from. */
  seen: FightEvent[];
} = {
  fight: null,
  actors: [],
  clock: 0,
  speed: 1,
  stage: "off",
  cues: [],
  shots: [],
  flashes: [],
  pops: [],
  dusk: 0,
  clacked: false,
  doneAt: 0,
  done: null,
  told: false,
  seen: [],
};

const marksByColour = new Map<string, HTMLCanvasElement>();
function markOf(col: string): HTMLCanvasElement {
  let m = marksByColour.get(col);
  if (!m) {
    m = hexMark(col, CREAM);
    marksByColour.set(col, m);
  }
  return m;
}

export const fightOn = (): boolean => FV.fight !== null;
/** Where the fight has got to, for looking from outside. */
export const fightState = (): {
  stage: Stage;
  tick: number;
  clock: number;
  over: boolean;
  result: string | null;
  /** How much is in the air just now: hexes lit by an ability, and things thrown. */
  lit: number;
  thrown: number;
} => ({
  stage: FV.stage,
  tick: FV.fight?.tick ?? 0,
  clock: FV.clock,
  over: FV.fight?.over ?? false,
  result: FV.fight?.result ?? null,
  lit: FV.flashes.length,
  thrown: FV.shots.length,
});
/** Everyone who has been in the fight on the table, for whoever keeps count. */
export const fightUnits = (): readonly Unit[] => FV.fight?.units ?? [];
/** Everything shown happening in the fight on the table so far, for whoever keeps count. */
export const fightEvents = (): readonly FightEvent[] => FV.seen;
export function setSpeed(s: Speed): void {
  FV.speed = s;
}

const feetAt = (cell: number): Pt => {
  const p = cellXY(cell);
  return { x: p.x, y: p.y + FOOT };
};
const colourOf = (kind: UnitKind): string => (isFigureId(kind) ? TRAIT_COLOUR[FIGURES[kind].kin] : GREEN[3]);

function actorFor(unit: Unit, at: Pt, bornAt: number): Actor {
  return {
    unit,
    x: at.x,
    y: at.y,
    fx: at.x,
    fy: at.y,
    tx: at.x,
    ty: at.y,
    m0: -99,
    mDur: 1,
    arc: 0,
    under: false,
    left: unit.side === 1,
    bornAt,
    lungeAt: -99,
    lx: 0,
    ly: 0,
    hurtAt: -99,
    hx: 0,
    hy: 0,
    flashAt: -99,
    castUntil: -99,
    down: false,
    fallAt: 0,
    hopAt: -99,
    shieldAt: -99,
    hpShown: unit.hp,
    phase: (unit.id * 0.37) % 1,
  };
}

/**
 * Begins playing a fight. `done` is called once, when it has been played to its end (or skipped
 * to it); the figures then stay as they ended until `endFight`.
 */
export function startFight(setup: FightSetup, speed: Speed, done: () => void): void {
  const fight = openFight(setup);
  FV.fight = fight;
  FV.speed = speed;
  FV.stage = "run-in";
  FV.shots = [];
  FV.flashes = [];
  FV.pops = [];
  FV.dusk = 0;
  FV.clacked = false;
  FV.done = done;
  FV.told = false;
  FV.seen = [];
  // Everyone starts where they were seated; what the opening did to them is acted out in the run-in.
  FV.actors = fight.units.map((u) =>
    actorFor(u, u.summoned ? feetAt(u.cell) : feetAt(seatCell(u.side, u.seat)), u.summoned ? Infinity : -Infinity),
  );
  const cues: Cue[] = [];
  let at = 14;
  let lastKind = "";
  for (const ev of fight.opening) {
    if (ev.t === "trait") at += 7;
    else if (ev.t === "summon") at += 8;
    else if (ev.t === "leap") at += lastKind === "leap" ? 2 : 8;
    else if (ev.t === "end") at += 4;
    cues.push({ at, ev });
    lastKind = ev.t;
  }
  const total = at + 12;
  for (const c of cues) c.at -= total;
  FV.cues = cues;
  FV.clock = -total;
}

/** Stops showing the fight: the party's own figures stand on their seats again. */
export function endFight(): void {
  FV.fight = null;
  FV.stage = "off";
  FV.actors = [];
  FV.shots = [];
  FV.flashes = [];
  FV.pops = [];
  FV.cues = [];
  FV.dusk = 0;
  FV.done = null;
  FV.seen = [];
}

/** Goes straight to the end: the fight comes out the same, it is only not watched. */
export function skipFight(): void {
  const f = FV.fight;
  if (!f || FV.stage === "done") return;
  // What was still to be shown counts all the same.
  for (const cue of FV.cues) FV.seen.push(cue.ev);
  while (!f.over) FV.seen.push(...stepFight(f));
  FV.cues = [];
  FV.shots = [];
  FV.flashes = [];
  // Anyone who turned up late is on the board now; everyone is where they ended.
  f.units.forEach((u, i) => {
    let a = FV.actors[i];
    if (!a) {
      a = actorFor(u, feetAt(u.cell), -Infinity);
      FV.actors[i] = a;
    }
    const at = feetAt(u.cell);
    a.x = at.x;
    a.y = at.y;
    a.m0 = -99;
    a.bornAt = -Infinity;
    a.hpShown = u.hp;
    a.down = !u.alive;
    a.fallAt = -999;
    a.castUntil = -99;
  });
  FV.clock = f.tick;
  finish();
}

function finish(): void {
  if (FV.stage === "done") return;
  FV.stage = "done";
  FV.doneAt = V.t;
  const f = FV.fight;
  if (!f) return;
  // Whoever is left standing on the side that won hops about it.
  const winner = f.result === "win" ? 0 : f.result === "loss" ? 1 : -1;
  let n = 0;
  for (const a of FV.actors) {
    if (a.unit.alive && a.unit.side === winner) a.hopAt = FV.clock + (n++ % 4) * 2;
  }
}

function travel(a: Actor, to: Pt, ticks: number, arc: number, under = false): void {
  a.fx = a.x;
  a.fy = a.y;
  a.tx = to.x;
  a.ty = to.y;
  a.m0 = FV.clock;
  a.mDur = Math.max(1, ticks);
  a.arc = arc;
  a.under = under;
  if (Math.abs(to.x - a.x) > 1) a.left = to.x < a.x;
}

function face(a: Actor, toward: Actor | undefined): void {
  if (toward && Math.abs(toward.x - a.x) > 1) a.left = toward.x < a.x;
}

const SHOT_LOOKS: Partial<Record<UnitKind, ShotLook>> = {
  finch: "seed",
  crab12: "pebble",
  chickaree: "cone",
  lanterngnome: "beam",
  mossmote: "cushion",
  kettle: "tea",
  crab23: "plaster",
  drizzlefrog: "drop",
  moth: "dust",
  gust: "gust",
};

/** The kinds of damage, coloured as the cards colour their words: coral, rose, cream. */
const DAMAGE_COL = { physical: "#e67967", magic: "#d88ad0", true: CREAM } as const;

/** Makes one thing the rules said happened into something seen and heard. */
function show(ev: FightEvent): void {
  const f = FV.fight;
  if (!f) return;
  FV.seen.push(ev);
  const now = FV.clock;
  switch (ev.t) {
    case "move": {
      const a = FV.actors[ev.id];
      if (a) travel(a, feetAt(ev.to), ev.ticks, 2);
      break;
    }
    case "leap": {
      const a = FV.actors[ev.id];
      if (!a) break;
      const to = feetAt(ev.to);
      if (ev.why === "knocked") {
        travel(a, to, 4, 4);
        a.left = !a.left;
        burst(a.x, a.y - 4, 6, [CREAM, STONE[3]], { speed: 30, ttl: 0.3 });
      } else if (a.unit.kind === "worm") {
        burst(a.x, a.y, 10, [EARTH[1], EARTH[2], EARTH[0]], { speed: 30, ttl: 0.45, toward: -Math.PI / 2, spread: 2 });
        travel(a, to, 5, 0, true);
        snd.dig();
      } else {
        travel(a, to, ev.why === "sneak" ? 8 : 5, ev.why === "sneak" ? 18 : 12);
        snd.leap();
      }
      break;
    }
    case "swing": {
      const a = FV.actors[ev.id];
      const t = FV.actors[ev.target];
      if (!a || !t) break;
      face(a, t);
      const d = Math.hypot(t.x - a.x, t.y - a.y) || 1;
      a.lungeAt = now;
      a.lx = ((t.x - a.x) / d) * 5;
      a.ly = ((t.y - a.y) / d) * 4;
      snd.swing();
      break;
    }
    case "shot": {
      const a = FV.actors[ev.id];
      const t = FV.actors[ev.target];
      if (!a) break;
      face(a, t);
      const from = feetAt(ev.from);
      const to = t ? { x: t.x, y: t.y } : feetAt(ev.to);
      const look: ShotLook = SHOT_LOOKS[a.unit.kind] ?? "pellet";
      const lobbed = look === "cone" || look === "cushion" || look === "tea" || look === "plaster" || look === "pebble";
      FV.shots.push({
        from: { x: from.x, y: from.y - 11 },
        to: { x: to.x, y: to.y - 10 },
        t0: now,
        dur: Math.max(1, ev.ticks),
        arc: lobbed ? 8 + distance(ev.from, ev.to) * 2.5 : look === "beam" ? 0 : 3,
        look,
        col: colourOf(a.unit.kind),
      });
      a.lungeAt = now;
      a.lx = 0;
      a.ly = -2;
      snd.shot();
      break;
    }
    case "hit": {
      const a = FV.actors[ev.id];
      if (!a) break;
      const by = FV.actors[ev.by];
      const direct = ev.source === "attack" || ev.source === "ability" || ev.source === "item";
      if (direct) {
        const dx = by ? a.x - by.x : 0;
        const dy = by ? a.y - by.y : -1;
        const d = Math.hypot(dx, dy) || 1;
        a.hurtAt = now;
        a.flashAt = now;
        a.hx = (dx / d) * (ev.hard ? 4 : 2.5);
        a.hy = (dy / d) * (ev.hard ? 3 : 2);
        const col = ev.soaked >= ev.amount ? WATER[3] : DAMAGE_COL[ev.kind];
        burst(a.x, a.y - 11, ev.hard ? 9 : 4, [col, "#ffffff"], { speed: ev.hard ? 46 : 30, ttl: 0.3 });
        say(
          a.x + (Math.random() - 0.5) * 8,
          a.y - framesOf(a.unit.kind).tall - 2,
          ev.hard ? `${ev.amount}!` : String(ev.amount),
          ev.hard ? GOLD[2] : col,
          { big: ev.hard, ttl: 0.7 },
        );
        snd.hit(ev.kind, ev.hard);
      } else if (ev.source === "burn") {
        burst(a.x, a.y - 6, 3, ["#e67967", GOLD[1], GOLD[2]], { speed: 14, grav: -40, ttl: 0.4, scatter: 8 });
        say(a.x + 6, a.y - 10, String(ev.amount), "#e67967", { ttl: 0.5, rise: 7 });
        snd.burn();
      } else if (ev.source === "thorns") {
        a.flashAt = now;
        say(a.x - 6, a.y - 12, String(ev.amount), GREEN[4], { ttl: 0.5, rise: 7 });
      } else {
        say(a.x, a.y - 12, String(ev.amount), "#cdb6d8", { ttl: 0.5, rise: 6 });
      }
      break;
    }
    case "slip": {
      const a = FV.actors[ev.id];
      if (!a) break;
      a.hurtAt = now;
      a.hx = a.left ? 4 : -4;
      a.hy = 0;
      say(a.x, a.y - framesOf(a.unit.kind).tall - 2, "dodge", WATER[3], { ttl: 0.6 });
      burst(a.x, a.y - 8, 4, [WATER[3], "#ffffff"], { speed: 20, ttl: 0.3, grav: 0 });
      snd.slip();
      break;
    }
    case "cast": {
      const a = FV.actors[ev.id];
      if (!a) break;
      const col = colourOf(ev.kind);
      a.castUntil = now + 9;
      face(a, FV.actors[ev.targets[0] ?? -1]);
      // The hexes it covers light one after another, nearest first: a ring, a cone or a line spreading.
      for (const cell of ev.cells) FV.flashes.push({ cell, t0: now + distance(a.unit.cell, cell) * 1.5, col });
      if (ev.name) say(a.x, a.y - framesOf(ev.kind).tall - 8, ev.name, col, { ttl: 1.1, rise: 8 });
      if (ev.shape === "ring") ring(a.x, a.y, ev.cells.length > 7 ? 46 : 24, col, 0.5);
      else if (ev.shape === "self") ring(a.x, a.y, 12, col, 0.4);
      else if (ev.shape === "cone" || ev.shape === "line") {
        const t = FV.actors[ev.targets[0] ?? -1];
        const toward = t ? Math.atan2(t.y - a.y, t.x - a.x) : a.left ? Math.PI : 0;
        burst(a.x, a.y - 8, 18, [col, GOLD[2], "#ffffff"], {
          toward,
          spread: ev.shape === "cone" ? 0.9 : 0.25,
          speed: 90,
          ttl: 0.35,
          grav: 0,
        });
      } else burst(a.x, a.y - 12, 6, [col, "#ffffff"], { speed: 22, ttl: 0.4, grav: -20 });
      snd.cast(isFigureId(ev.kind) ? FIGURES[ev.kind].tier - 1 : isBossId(ev.kind) ? 4 : 1);
      break;
    }
    case "heal": {
      const a = FV.actors[ev.id];
      if (!a) break;
      const quiet = ev.source === "regrow";
      motes(a.x, a.y - 6, quiet ? 2 : 7, [GREEN[4], "#c9ef9a", "#ffffff"]);
      if (!quiet) {
        say(a.x, a.y - framesOf(a.unit.kind).tall - 2, `+${ev.amount}`, "#c9ef9a", { ttl: 0.7 });
        snd.heal();
      }
      break;
    }
    case "shield": {
      const a = FV.actors[ev.id];
      if (!a) break;
      a.shieldAt = now;
      snd.shield();
      break;
    }
    case "status": {
      const a = FV.actors[ev.id];
      if (!a) break;
      if (!ev.on) {
        if (ev.status === "shield") burst(a.x, a.y - 9, 8, [WATER[3], CREAM], { speed: 34, ttl: 0.35 });
        else if (ev.status === "hidden") {
          burst(a.x, a.y, 10, [EARTH[1], EARTH[2], EARTH[0]], {
            speed: 34,
            ttl: 0.45,
            toward: -Math.PI / 2,
            spread: 2,
          });
          a.hopAt = now;
          snd.dig();
        }
        break;
      }
      if (ev.status === "stun") snd.stun();
      else if (ev.status === "burn") burst(a.x, a.y - 4, 6, ["#e67967", GOLD[1]], { speed: 20, grav: -30, ttl: 0.4 });
      else if (ev.status === "slow") burst(a.x, a.y - 2, 5, [WATER[2], WATER[3]], { speed: 14, ttl: 0.5 });
      else if (ev.status === "taunt")
        say(a.x, a.y - framesOf(a.unit.kind).tall - 2, "!", "#e67967", { big: true, ttl: 0.6 });
      else if (ev.status === "hidden") {
        burst(a.x, a.y, 10, [EARTH[1], EARTH[2], EARTH[0]], { speed: 30, ttl: 0.45, toward: -Math.PI / 2, spread: 2 });
        snd.dig();
      } else if (ev.status === "haste")
        burst(a.x, a.y - 6, 6, [CREAM, GOLD[2]], { speed: 26, grav: -50, ttl: 0.4, toward: -Math.PI / 2, spread: 0.6 });
      else if (ev.status === "braced") ring(a.x, a.y, 11, STONE[3], 0.35);
      break;
    }
    case "boost": {
      const a = FV.actors[ev.id];
      if (!a) break;
      say(a.x, a.y - framesOf(a.unit.kind).tall - 2, `+${ev.amount} attack`, "#f4a08c", { ttl: 0.9 });
      burst(a.x, a.y - 10, 5, ["#f4a08c", GOLD[2]], {
        speed: 20,
        grav: -40,
        ttl: 0.5,
        toward: -Math.PI / 2,
        spread: 0.7,
      });
      break;
    }
    case "fall": {
      const a = FV.actors[ev.id];
      if (!a) break;
      a.down = true;
      a.fallAt = now;
      a.castUntil = -99;
      burst(a.x, a.y, 7, ["#cbb894", CREAM], { speed: 22, ttl: 0.35, toward: -Math.PI / 2, spread: 2.6 });
      snd.fall(isBossId(a.unit.kind));
      break;
    }
    case "rise": {
      const a = FV.actors[ev.id];
      if (!a) break;
      a.down = false;
      a.hopAt = now;
      say(a.x, a.y - framesOf(a.unit.kind).tall - 6, "Second Wind!", GOLD[2], { ttl: 1.4 });
      motes(a.x, a.y - 6, 10, [GOLD[2], CREAM]);
      snd.rise();
      break;
    }
    case "summon": {
      const u = f.units[ev.id];
      if (!u) break;
      const from = FV.actors[ev.by];
      const at = feetAt(ev.cell);
      let a = FV.actors[ev.id];
      if (!a) {
        a = actorFor(u, from ? { x: from.x, y: from.y } : at, now);
        FV.actors[ev.id] = a;
      }
      a.bornAt = now;
      // A bit of somebody comes off them; anyone else just turns up.
      if (from && ev.kind === "glorplet") {
        a.x = from.x;
        a.y = from.y;
        travel(a, at, 5, 8);
      } else {
        a.x = at.x;
        a.y = at.y;
        a.m0 = -99;
      }
      burst(at.x, at.y - 4, 10, [colourOf(ev.kind), CREAM, "#ffffff"], { speed: 28, ttl: 0.4 });
      if (ev.kind === "uncounted" || ev.kind === "biguncounted")
        say(at.x, at.y - 16, "Nobody counted this one.", CREAM, { ttl: 1.3 });
      snd.summon();
      break;
    }
    case "trait": {
      const col = TRAIT_COLOUR[ev.trait];
      ev.ids.forEach((id, i) => {
        const a = FV.actors[id];
        if (!a) return;
        a.hopAt = now + i * 0.8;
        burst(a.x, a.y - 10, 4, [col, GOLD[2]], { speed: 18, ttl: 0.45, grav: -10 });
      });
      const first = FV.actors[ev.ids[0] ?? -1];
      if (first) {
        FV.pops.push({ pic: traitPic(ev.trait), id: first.unit.id, t0: now });
        say(
          first.x,
          first.y - framesOf(first.unit.kind).tall - 14,
          `${TRAITS[ev.trait].name}${ev.step > 1 ? ` ${ev.step}` : ""}`,
          col,
          { ttl: 1 },
        );
      }
      if (ev.side === 0) {
        traitWoke?.(ev.trait);
        snd.trait(ev.step);
      }
      break;
    }
    case "item": {
      const a = FV.actors[ev.id];
      if (a) FV.pops.push({ pic: itemPic(ev.item), id: a.unit.id, t0: now });
      break;
    }
    case "dusk": {
      if (FV.dusk === 0) {
        say(75, 40, "Dusk falls.", "#cdb6d8", { big: true, ttl: 1.6 });
        snd.dusk();
      }
      FV.dusk = ev.n;
      break;
    }
    case "end":
      break;
  }
}

/** Told when one of the member's traits switches on as a fight starts, to light its chip. */
let traitWoke: ((trait: TraitId) => void) | null = null;
export function onTraitWoke(fn: (trait: TraitId) => void): void {
  traitWoke = fn;
}

/** Moves the fight on with the stage's clock. */
export function stepFightView(dt: number): void {
  const f = FV.fight;
  if (!f) return;
  if (FV.stage === "run-in" || FV.stage === "run") {
    FV.clock += dt * HZ * FV.speed;
    // The halves meet with a clack a few steps into the run-in.
    if (!FV.clacked && V.gap < 0.5) {
      FV.clacked = true;
      snd.clack();
      for (let x = 6; x < 150; x += 12)
        burst(x, 60, 2, ["#cbb894", CREAM], { speed: 16, ttl: 0.35, toward: -Math.PI / 2, spread: 2 });
    }
    while (FV.cues.length > 0 && (FV.cues[0]?.at ?? 0) <= FV.clock) {
      const cue = FV.cues.shift();
      if (cue) show(cue.ev);
    }
    if (FV.clock >= 0) FV.stage = "run";
    if (FV.stage === "run") {
      let guard = 0;
      while (!f.over && f.tick < Math.floor(FV.clock) && guard++ < 200) {
        for (const ev of stepFight(f)) show(ev);
      }
      if (f.over) {
        FV.clock = Math.max(FV.clock, f.tick);
        finish();
      }
    }
  } else if (FV.stage === "done") {
    FV.clock += dt * HZ;
    if (!FV.told && V.t - FV.doneAt > 0.7) {
      FV.told = true;
      FV.done?.();
    }
  }
  for (const a of FV.actors) {
    if (a.m0 > -90) {
      const k = clamp((FV.clock - a.m0) / a.mDur, 0, 1);
      a.x = lerp(a.fx, a.tx, k);
      a.y = lerp(a.fy, a.ty, k);
      if (k >= 1) a.m0 = -99;
    }
    a.hpShown += (a.unit.hp - a.hpShown) * Math.min(1, dt * 10 * FV.speed);
  }
  FV.shots = FV.shots.filter((s) => {
    if (FV.clock < s.t0 + s.dur) return true;
    burst(s.to.x, s.to.y, 3, [s.col, "#ffffff"], { speed: 22, ttl: 0.25 });
    return false;
  });
  FV.flashes = FV.flashes.filter((fl) => FV.clock < fl.t0 + 10);
  FV.pops = FV.pops.filter((p) => FV.clock < p.t0 + 16);
}

function drawShot(g: Ctx, s: Shot): void {
  const k = clamp((FV.clock - s.t0) / s.dur, 0, 1);
  const x = Math.round(V.bx + lerp(s.from.x, s.to.x, k));
  const y = Math.round(V.by + lerp(s.from.y, s.to.y, k) - Math.sin(k * Math.PI) * s.arc);
  switch (s.look) {
    case "seed":
      R(g, x - 1, y, 3, 2, INK);
      R(g, x, y, 1, 1, EARTH[2]);
      break;
    case "pebble":
      R(g, x - 1, y - 1, 4, 4, INK);
      R(g, x, y, 2, 2, STONE[2]);
      R(g, x, y, 1, 1, STONE[3]);
      break;
    case "cone":
      R(g, x - 2, y - 2, 5, 6, INK);
      R(g, x - 1, y - 1, 3, 4, "#6f3826");
      R(g, x - 1, y - 1, 1, 1, "#a35d3b");
      R(g, x + 1, y + 1, 1, 1, "#542a1f");
      break;
    case "beam": {
      for (let i = 0; i < 5; i++) {
        const j = clamp(k - i * 0.07, 0, 1);
        const bx = Math.round(V.bx + lerp(s.from.x, s.to.x, j));
        const by = Math.round(V.by + lerp(s.from.y, s.to.y, j));
        g.globalAlpha = 1 - i * 0.18;
        R(g, bx - 1, by - 1, 2, 2, i === 0 ? "#ffffff" : GOLD[2]);
      }
      g.globalAlpha = 1;
      break;
    }
    case "cushion":
      R(g, x - 3, y - 2, 7, 5, INK);
      R(g, x - 2, y - 1, 5, 3, CREAM);
      R(g, x, y, 1, 1, "#cbb894");
      break;
    case "tea":
      R(g, x - 2, y - 1, 6, 5, INK);
      R(g, x - 1, y, 3, 3, CREAM);
      R(g, x + 2, y + 1, 1, 1, CREAM);
      R(g, x, y - 3, 1, 1, "#ffffff");
      break;
    case "plaster":
      R(g, x - 3, y - 1, 7, 3, INK);
      R(g, x - 2, y, 5, 1, "#e9d8b8");
      R(g, x, y, 1, 1, "#cbb894");
      break;
    case "drop":
      R(g, x - 2, y - 3, 5, 7, INK);
      R(g, x - 1, y - 1, 3, 4, WATER[2]);
      R(g, x, y - 2, 1, 1, WATER[2]);
      R(g, x - 1, y - 1, 1, 2, WATER[3]);
      break;
    case "dust":
      for (let i = 0; i < 5; i++) {
        R(
          g,
          x + Math.round(Math.sin(FV.clock * 2 + i * 2) * 3),
          y + Math.round(Math.cos(FV.clock * 1.7 + i) * 2),
          1,
          1,
          i % 2 ? CREAM : WATER[3],
        );
      }
      break;
    case "gust":
      for (let i = 0; i < 6; i++) {
        const a = FV.clock * 0.9 + i;
        R(g, x + Math.round(Math.cos(a) * 3), y + Math.round(Math.sin(a) * 2), 1, 1, i % 2 ? "#ffffff" : WATER[3]);
      }
      break;
    case "pellet":
      R(g, x - 1, y - 1, 3, 3, INK);
      R(g, x, y, 1, 1, s.col);
      break;
  }
}

/** What is on, or wrong with, a figure, drawn round it. */
function drawStatus(g: Ctx, a: Actor, x: number, y: number, tall: number, tick: number): void {
  const u = a.unit;
  const c = FV.clock;
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
    R(g, x - half + 3, top + 1, 3, 1, "#ffffff");
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

/** Health under a figure's feet, with its shield over it and its mana beneath. */
function drawBars(g: Ctx, a: Actor, x: number, y: number): void {
  const u = a.unit;
  const w = isBossId(u.kind) ? 26 : 14;
  const left = x - w / 2;
  const top = y + 3;
  R(g, left - 1, top - 1, w + 2, u.manaFull > 0 ? 5 : 4, INK);
  R(g, left, top, w, 2, "#3d2050");
  const hp = Math.round(clamp(a.hpShown / u.maxHp, 0, 1) * w);
  R(g, left, top, hp, 2, u.side === 0 ? GREEN[4] : "#e67967");
  R(g, left, top, hp, 1, u.side === 0 ? "#c9ef9a" : "#f4a08c");
  if (u.shield > 0) R(g, left, top, Math.max(1, Math.round(clamp(u.shield / u.maxHp, 0, 1) * w)), 1, "#ffffff");
  if (u.manaFull > 0) {
    R(g, left, top + 3, w, 1, "#211228");
    R(g, left, top + 3, Math.round(clamp(u.mana / u.manaFull, 0, 1) * w), 1, WATER[3]);
  }
}

/** Adds everyone in the fight to the list of things standing on the table. */
export function drawFight(g: Ctx, list: Standing[]): void {
  const f = FV.fight;
  if (!f) return;
  const c = FV.clock;
  // Dusk falling over the table itself; the figures stay lit.
  if (FV.dusk > 0) {
    g.fillStyle = `rgba(32,14,50,${Math.min(0.5, 0.14 + FV.dusk * 0.03)})`;
    g.fillRect(0, 0, V.w, V.h);
  }
  for (const fl of FV.flashes) {
    const k = (c - fl.t0) / 10;
    if (k < 0) continue;
    const at = cellXY(fl.cell);
    g.globalAlpha = clamp(1 - k, 0, 1) * 0.75;
    g.drawImage(markOf(fl.col), V.bx + at.x - HEX_W / 2, V.by + at.y - HEX_H / 2);
  }
  g.globalAlpha = 1;
  for (const a of FV.actors) {
    const u = a.unit;
    if (c < a.bornAt) continue;
    const fallen = a.down ? c - a.fallAt : -1;
    if (fallen > 22) continue;
    const frames = framesOf(u.kind);
    const hidden = u.alive && u.hiddenUntil > f.tick;
    // While the halves are still apart, the far party stands back with its half.
    const back = u.side === 1 ? Math.round(V.gap) : 0;
    let lift = 0;
    let sunk = false;
    if (a.m0 > -90) {
      const k = clamp((c - a.m0) / a.mDur, 0, 1);
      lift = Math.sin(k * Math.PI) * a.arc;
      sunk = a.under && k > 0.15 && k < 0.85;
    }
    const born = c - a.bornAt;
    if (born >= 0 && born < 4) lift += (4 - born) * 2;
    const hopped = c - a.hopAt;
    if (hopped >= 0 && hopped < 6) lift += Math.sin((hopped / 6) * Math.PI) * 5;
    let dx = 0;
    let dy = 0;
    const lunged = c - a.lungeAt;
    if (lunged >= 0 && lunged < 5) {
      const k = lunged < 2 ? lunged / 2 : 1 - (lunged - 2) / 3;
      dx += a.lx * k;
      dy += a.ly * k;
    }
    const hurt = c - a.hurtAt;
    if (hurt >= 0 && hurt < 4) {
      const k = 1 - hurt / 4;
      dx += a.hx * k;
      dy += a.hy * k;
    }
    const shine = shineOf(u.kind, a.x, V.t);
    const x = Math.round(V.bx + a.x + dx);
    const y = Math.round(V.by + a.y + dy - back - lift - shine.hop);
    const hover = frames.flies && fallen < 0 ? 2 + Math.round(Math.sin(V.t * 4 + a.phase * 6)) : 0;
    const beat: 0 | 1 = Math.floor(V.t * 1.7 + a.phase * 2) % 2 === 0 ? 0 : 1;
    list.push({
      x: a.x,
      y: a.y - back + (fallen >= 0 ? -6 : 0),
      draw: () => {
        if (hidden || sunk) {
          // Gone to ground: a mound of earth where it went under.
          R(g, x - 6, y - 1, 12, 3, INK);
          R(g, x - 5, y - 2, 10, 3, EARTH[1]);
          R(g, x - 3, y - 3, 6, 1, EARTH[2]);
          R(g, x - 4, y - 1, 2, 1, EARTH[0]);
          return;
        }
        if (fallen >= 0) {
          g.globalAlpha = clamp(1 - (fallen - 10) / 12, 0, 1);
          drawFigure(g, u.kind, x, y, { pose: "fallen", left: a.left });
          g.globalAlpha = 1;
          return;
        }
        if (shine.dim) g.globalAlpha = DIM;
        drawBase(g, u.kind, x, y);
        drawFigure(g, u.kind, x, y - 2 - hover, {
          pose: c < a.castUntil ? "cast" : "idle",
          beat,
          left: a.left,
          flash: c - a.flashAt >= 0 && c - a.flashAt < 1.5,
          lit: shine.lit,
        });
        // What it holds follows it about, under its health bar, and falls with it.
        if (u.alive) drawHeld(g, heldRow(u.items, x - V.bx, heldTop(y - V.by, true)), V.bx, V.by);
        g.globalAlpha = 1;
      },
      top: () => {
        if (fallen >= 0 || !u.alive) return;
        if (hidden || sunk) return;
        // Over the figure's head as it is drawn now: casting, some rear up taller than they stand.
        const tall = c < a.castUntil ? Math.max(frames.tall, frames.castTall) : frames.tall;
        drawStatus(g, a, x, y - hover, tall, f.tick);
        if (u.stars > 1) drawStars(g, u.stars, x, y - 3 - hover - tall);
        drawBars(g, a, x, y);
      },
    });
  }
}

/** What flies over the board, and the small signs that pop over a figure. Drawn after everyone standing. */
export function drawFightAir(g: Ctx): void {
  for (const s of FV.shots) drawShot(g, s);
  for (const p of FV.pops) {
    const a = FV.actors[p.id];
    if (!a) continue;
    const k = (FV.clock - p.t0) / 16;
    const rise = Math.round((1 - (1 - k) * (1 - k)) * 6);
    g.globalAlpha = clamp((1 - k) * 3, 0, 1);
    g.drawImage(
      p.pic,
      Math.round(V.bx + a.x - p.pic.width / 2),
      Math.round(V.by + a.y - framesOf(a.unit.kind).tall - 14 - rise),
    );
  }
  g.globalAlpha = 1;
}

/** The item a figure in the fight holds under a point measured from the board's corner. */
export function fightHeldUnder(x: number, y: number): HeldAt | null {
  const f = FV.fight;
  if (!f) return null;
  for (const a of FV.actors) {
    const u = a.unit;
    if (!u.alive || FV.clock < a.bornAt || u.hiddenUntil > f.tick) continue;
    const back = u.side === 1 ? Math.round(V.gap) : 0;
    const hit = heldAt(heldRow(u.items, a.x, heldTop(a.y - back, true)), x, y);
    if (hit) return hit;
  }
  return null;
}

/** The figure in the fight under a point measured from the board's corner. */
export function unitUnder(x: number, y: number): { unit: Unit; x: number; y: number } | null {
  let best: Actor | null = null;
  for (const a of FV.actors) {
    if (!a.unit.alive || FV.clock < a.bornAt) continue;
    const f = framesOf(a.unit.kind);
    const half = Math.max(7, f.wide / 2);
    if (x < a.x - half || x > a.x + half || y > a.y + 4 || y < a.y - f.tall - 2) continue;
    if (!best || a.y > best.y) best = a;
  }
  return best ? { unit: best.unit, x: best.x, y: best.y } : null;
}
