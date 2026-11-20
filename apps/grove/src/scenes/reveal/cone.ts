/**
 * The cone opening: the reveal, the glade's reward moment. Real giant sequoia cones open only in a
 * fire's heat, and 🔥 is the guild's own reaction, so this is how a spirit arrives.
 *
 * Every rank has its own beat (`BEATS`), so the reveal grows with the rarity and the common ones
 * stay small and funny ("don't flood"):
 *   Leafkin    a hop into the fire, a wiggle, pop! A puff, and the spirit bounces out. Under 2 s.
 *   Sapling    a little longer, a soft spotlight, a ring.
 *   Sprite     the beam, rays and a knock.
 *   Dryad up   an aurora in the rank's colour fills more of the sky at each rank as the cone bursts.
 *   Yggdrasil  stops the world: everything but the cone holds still and goes dark, the cone beats
 *              like a heart, the light gathers in, and the Great Sequoia on the ridge answers the
 *              burst with a beam of its own under a sky-wide golden aurora.
 *
 * Each beat's timeline, from the tap: the cone hops to the fire (0.4 s), warms through ember
 * tones and shakes, cracks show the rarity's light (burst - 0.6 s), the scales part (- 0.3 s), it
 * bursts, the spirit leaps out and lands, and the tooltip card opens until you tap.
 */

import type { CastFrame } from "../../bundle/cast.ts";
import { spirit } from "../../game/spirits.ts";
import { type Canvas, hex } from "../../ui/hud.ts";
import { blitFrame, spiritFrame } from "../glade/actors.ts";
import type { Layout, Point } from "../glade/layout.ts";
import { drawConeCardAt } from "./card.ts";

/** Where a reveal plays: the fire, the cone's stone, and the far Great Sequoia that answers Yggdrasil. */
export type Stage = Pick<Layout, "W" | "H" | "narrow" | "horizon" | "fire" | "cone" | "great">;
import { CONE } from "../../art/sprites.ts";
import { identityMap, ix, R, type RankName, RANKS } from "../../engine/palette.ts";
import { bayer, type Indices, type Light, type Sprite, type Surface } from "../../engine/raster.ts";
import { hash3 } from "../../engine/rng.ts";

export interface ConeEvent {
  t0: number;
  rank: RankName;
  /** The spirit inside, by its cast id. */
  spirit: string;
  verdant: boolean;
  /** When the player tapped to keep the spirit; the moment winds down from here. */
  closedAt: number | null;
  /** Hearts of bond after this cone (duplicates deepen it). */
  bond?: number;
}

export const rankColour = (rank: RankName): string => RANKS.find((r) => r.name === rank)?.colour ?? "#ffffff";

const ease = (u: number): number => 1 - Math.pow(1 - Math.max(0, Math.min(1, u)), 3);
/** 0 for Leafkin to 6 for Yggdrasil: rarer spirits arrive with more light. */
export const tier = (rank: RankName): number =>
  Math.max(
    0,
    RANKS.findIndex((r) => r.name === rank),
  );

/** How a rank's reveal plays. */
interface Beat {
  /** Seconds from the tap to the burst. */
  burst: number;
  /** How dark the world goes round the fire's spotlight, 0 to 1. */
  dim: number;
  /** Pixels the frame is knocked at the burst. */
  shake: number;
  beam: boolean;
  /** Rings of light thrown out at the burst. */
  rings: number;
  /** Aurora curtains, 0 for none. */
  aurora: number;
  /** Stop the world while the cone opens. */
  freeze: boolean;
  /** Seconds after the burst that the card opens. */
  card: number;
}

const BEATS: Record<RankName, Beat> = {
  Leafkin: { burst: 1.0, dim: 0, shake: 0, beam: false, rings: 0, aurora: 0, freeze: false, card: 0.75 },
  Sapling: { burst: 1.45, dim: 0.25, shake: 0, beam: false, rings: 1, aurora: 0, freeze: false, card: 0.9 },
  Sprite: { burst: 1.85, dim: 0.5, shake: 1, beam: true, rings: 1, aurora: 0, freeze: false, card: 1.0 },
  Dryad: { burst: 2.2, dim: 0.75, shake: 1, beam: true, rings: 2, aurora: 1, freeze: false, card: 1.0 },
  Druid: { burst: 2.4, dim: 0.75, shake: 1, beam: true, rings: 2, aurora: 2, freeze: false, card: 1.1 },
  Treant: { burst: 2.7, dim: 1, shake: 2, beam: true, rings: 3, aurora: 3, freeze: false, card: 1.2 },
  Yggdrasil: { burst: 4.2, dim: 1, shake: 2, beam: true, rings: 3, aurora: 3, freeze: true, card: 1.6 },
};

/** Yggdrasil's world stops here, once the cone is in the fire. */
const FREEZE_FROM = 0.9;

export const beatOf = (rank: RankName): Beat => BEATS[rank];

export interface ConeLook {
  flare: number;
  /** World dimming outside the spotlight, 0 to 1. */
  dim: number;
  /** Whole-frame flash toward the rarity's light, 0 to 1. */
  flash: number;
  embers: number;
  /** Pixel offset of the whole frame at the burst's impact. */
  shake: { x: number; y: number };
  /** The aurora's strength, 0 to 1, and how many curtains. */
  aurora: number;
  curtains: number;
  /** The clock the rest of the world runs on: held still while Yggdrasil opens. */
  worldT: number;
  /** The card is up, so a tap keeps the spirit. */
  cardOpen: boolean;
  done: boolean;
}

export function coneLook(ev: ConeEvent, t: number): ConeLook {
  const b = BEATS[ev.rank];
  const tau = t - ev.t0;
  const closing = ev.closedAt === null ? 0 : Math.min(1, (t - ev.closedAt) / 0.6);
  const flare =
    tau < 0.3
      ? 0
      : tau < b.burst
        ? 0.25 + 0.15 * ((tau - 0.3) / (b.burst - 0.3))
        : tau < b.burst + 0.5
          ? 0.6
          : Math.max(0, 0.6 - (tau - b.burst - 0.5) * 0.6);
  const dimIn = Math.min(1, Math.max(0, (tau - 0.15) / 0.4)) * b.dim;
  // Yggdrasil: the dark deepens while the world holds its breath, and lifts after the burst.
  const hush = b.freeze && tau > FREEZE_FROM && tau < b.burst + 0.4 ? 1 : 0;
  const steps = b.freeze ? [0.9, 0.75, 0.55, 0.38, 0.22, 0.1, 0] : [0.6, 0.4, 0.22, 0.1, 0];
  const since = tau - b.burst;
  const flash = since < 0 ? 0 : (steps[Math.floor(since / 0.08)] ?? 0);
  const knock = [
    { x: 1, y: 0 },
    { x: -1, y: 1 },
    { x: 0, y: -1 },
    { x: 1, y: 1 },
    { x: -1, y: 0 },
  ];
  const shaking = b.shake > 0 && since >= 0 && since < 0.08 * (b.shake + 2);
  const k = knock[Math.floor(since / 0.08)] ?? { x: 0, y: 0 };
  const auroraIn = b.aurora > 0 ? Math.min(1, Math.max(0, (since + 0.2) / 0.7)) : 0;
  const frozen = b.freeze ? Math.max(0, Math.min(tau, b.burst + 0.3) - FREEZE_FROM) : 0;
  return {
    flare: flare * (1 - closing),
    dim: Math.round(Math.min(1, dimIn + hush * 0.35) * (1 - closing) * 4) / 4,
    flash,
    embers: tau > 0.5 && tau < b.burst + 0.6 ? 1 : 0,
    shake: shaking ? { x: k.x * b.shake, y: k.y * b.shake } : { x: 0, y: 0 },
    aurora: auroraIn * (1 - closing),
    curtains: b.aurora,
    worldT: t - frozen,
    cardOpen: tau > b.burst + b.card + 0.1,
    done: closing >= 1,
  };
}

/** Where the cone sits, and how it moves, at `tau`. */
function conePose(L: Stage, tau: number, b: Beat): { x: number; y: number; frame: Sprite; map: Indices | null } {
  const rest = { x: L.cone.x, y: L.cone.y };
  const edge = { x: L.fire.x + Math.sign(L.cone.x - L.fire.x) * 9, y: L.fire.y - 1 };
  const burst = b.burst;
  let x = edge.x;
  let y = edge.y;
  if (tau < 0.4) {
    const u = tau / 0.4;
    x = rest.x + (edge.x - rest.x) * u;
    y = rest.y + (edge.y - rest.y) * u - Math.sin(u * Math.PI) * 6;
  }
  if (tau > 0.45 && tau < burst) {
    if (b.freeze && tau > FREEZE_FROM) {
      // A heartbeat: two knocks a second, then stillness as the light gathers.
      const beat = (tau - FREEZE_FROM) % 0.55;
      if (tau < burst - 0.7 && (beat < 0.06 || (beat > 0.14 && beat < 0.2))) y -= 1;
    } else {
      const amp = Math.min(1.4, 0.3 + (tau - 0.5) * (2 / burst));
      x += Math.round(Math.sin(tau * 46) * amp);
      const hop = (tau / burst) % 0.25;
      if (tau > burst * 0.45 && hop < 0.03) y -= 1;
    }
  }
  const frame =
    tau < burst - 0.6 ? CONE.shut : tau < burst - 0.3 ? CONE.cracked : tau < burst ? CONE.parting : CONE.open;
  const heat = tau < 0.4 ? 0 : tau < burst * 0.4 ? 1 : tau < burst ? 2 : 3;
  return { x: Math.round(x), y: Math.round(y), frame, map: heat > 0 ? (HEAT[heat - 1] ?? null) : null };
}

/** The cone heating: browns stepping up into ember oranges. */
const HEAT = [1, 2, 3].map((k) => {
  const m = identityMap();
  for (let l = 0; l < 8; l++) {
    const src = ix(R.CONE, l);
    m[src] =
      k === 1
        ? ix(R.CONE, Math.min(7, l + 1))
        : k === 2
          ? ix(R.FIRE, Math.min(7, Math.max(1, l - 1)))
          : ix(R.FIRE, Math.min(7, l));
  }
  return m;
});

export function spiritLanding(L: Stage): Point {
  // On the trodden earth beside the fire, in clear view: left of it, or in front on a phone.
  return L.narrow ? { x: L.fire.x - 2, y: L.fire.y + 15 } : { x: L.fire.x - 25, y: L.fire.y + 5 };
}

/**
 * The world side of the reveal: the cone, its light, rays, ring, sparks, seeds and the spirit, who
 * draws in the palette's character ramps.
 */
export function drawConeWorld(s: Surface, light: Light, rare: Light, L: Stage, ev: ConeEvent, t: number): void {
  const b = BEATS[ev.rank];
  const BURST = b.burst;
  const tau = t - ev.t0;
  const pose = conePose(L, tau, b);
  const cx = pose.x;
  const cy = pose.y - 4;
  if (ev.closedAt === null || t - ev.closedAt < 0.6) {
    const fx = cx - Math.floor(pose.frame.w / 2);
    const fy = pose.y - pose.frame.h + 1;
    // Heat: a glowing edge round the cone that pulses faster as it nears opening.
    if (tau > 0.6 && tau < BURST) {
      const pulse = b.freeze
        ? (tau - FREEZE_FROM) % 0.55 < 0.24 || tau > BURST - 0.7
        : Math.sin(tau * (8 + tau * (12 / BURST))) > -0.2;
      if (pulse) {
        const hot = ix(tau > BURST - 0.6 ? R.RARITY : R.FIRE, tau > BURST - 0.6 ? 6 : 5);
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ] as const)
          s.blit(pose.frame, fx + dx, fy + dy, { solid: hot });
      }
    }
    s.blit(pose.frame, fx, fy, pose.map ? { map: pose.map } : {});
  }

  // Warm glow on the cone as it heats; then the rarity's own light.
  if (tau > 0.4 && tau < BURST) light.pool(cx, cy, 10 + (tau - 0.4) * 4, 2.4, 1);
  if (tau > BURST - 0.7) {
    const k = tau < BURST ? (tau - (BURST - 0.7)) / 0.7 : Math.max(0.35, 1 - (tau - BURST) * 0.5);
    rare.pool(cx, cy, (b.dim > 0 ? 12 : 6) + (b.dim > 0 ? 30 : 10) * k, 2.6 * Math.min(1, k + 0.2), 1.3);
  }
  // Yggdrasil: light gathers in from all round toward the cone before it bursts.
  if (b.freeze && tau > BURST - 1.0 && tau < BURST) {
    const u = (tau - (BURST - 1.0)) / 1.0;
    for (let i = 0; i < 40; i++) {
      const a = hash3(i, 1, 21) * Math.PI * 2;
      const r = (1 - ((u + hash3(i, 2, 21)) % 1)) * 70 + 4;
      s.set(cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.7, ix(R.RARITY, r < 20 ? 7 : 5));
    }
  }
  if (b.freeze && tau > BURST - 0.05) greatAnswers(s, light, rare, L, tau - BURST);

  // Leafkin: no fuss. A puff and a few leaves, pop!
  if (!b.beam && b.rings === 0) {
    puff(s, cx, cy, tau - BURST);
    drawSpirit(s, rare, L, ev, t, cx, cy);
    return;
  }

  // The beam: a column of light rising as the scales part.
  if (b.beam && tau > BURST - 0.3 && tau < BURST + 0.45) {
    const u = (tau - (BURST - 0.3)) / 0.75;
    const h = 120 * ease(u * 2);
    const fade = tau > BURST ? 1 - (tau - BURST) / 0.45 : 1;
    const wide = 1 + Math.round(ease(u * 3) * 2);
    for (let y = 0; y < h; y++) {
      const v = (1 - (y / h) * 0.8) * fade;
      for (let dx = -wide - 1; dx <= wide + 1; dx++) {
        const ad = Math.abs(dx);
        const edge = ad > wide;
        if (bayer(cx + dx, cy - y) > v * (edge ? 0.4 : 1.1)) continue;
        s.set(cx + dx, cy - y - 3, ad === 0 ? ix(R.STAR, 7) : edge ? ix(R.RARITY, 4) : ix(R.RARITY, ad === 1 ? 7 : 6));
      }
    }
  }

  const since = tau - BURST;
  if (since >= 0) {
    // A star of light at the cone's heart, then chunky rays turning slowly as they reach out and thin.
    const rk = tier(ev.rank);
    const life = Math.max(0, 1 - since / 1.5);
    const star = Math.round(3 + 4 * life);
    for (let k = -star; k <= star; k++) {
      const v = ix(R.STAR, Math.abs(k) < star * 0.5 ? 7 : 5);
      s.set(cx + k, cy, v);
      s.set(cx, cy + k, v);
      if (Math.abs(k) < star * 0.45) {
        s.set(cx + k, cy + k, ix(R.RARITY, 7));
        s.set(cx + k, cy - k, ix(R.RARITY, 7));
      }
    }
    const rays = 8 + rk * 2;
    const reach = 26 + (60 + rk * 6) * ease(since / 0.45);
    for (let i = 0; i < rays; i++) {
      const a = (i / rays) * Math.PI * 2 + since * 0.3 + 0.2;
      const long = i % 2 === 0 ? 1 : 0.58;
      const len = reach * long;
      for (let r = 7; r < len; r += 1) {
        const v = (1 - r / len) * life;
        if (v <= 0.04) continue;
        const x = Math.round(cx + Math.cos(a) * r);
        const y = Math.round(cy + Math.sin(a) * r * 0.82);
        const thick = r < len * 0.45 && long === 1;
        const level = v > 0.55 ? 7 : v > 0.3 ? 6 : 5;
        if (v < 0.25 && (x + y) % 2 === 0) continue;
        s.set(x, y, ix(R.RARITY, level));
        if (thick)
          s.set(
            x + (Math.abs(Math.sin(a)) > 0.7 ? 1 : 0),
            y + (Math.abs(Math.sin(a)) > 0.7 ? 0 : 1),
            ix(R.RARITY, level - 1),
          );
      }
    }
    // Rings, more for the rarer spirits.
    for (const delay of [0, 0.14, 0.3].slice(0, b.rings)) {
      const u = (since - delay) / 0.55;
      if (u < 0 || u > 1) continue;
      const rr = 6 + u * (50 + rk * 4);
      const n = Math.round(rr * 6);
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2;
        if (hash3(k, Math.floor(u * 8), 3) < u * 0.7) continue;
        s.set(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * 0.55, ix(R.RARITY, delay ? 5 : 7));
      }
    }
    // Sparks thrown out and falling, and seeds fluttering down.
    for (let i = 0; i < 20 + tier(ev.rank) * 6; i++) {
      const a = -Math.PI * (0.05 + 0.9 * hash3(i, 1, 9));
      const v = 40 + hash3(i, 2, 9) * 70;
      const x = cx + Math.cos(a) * v * since;
      const y = cy + Math.sin(a) * v * since + 70 * since * since;
      const age = since / (0.9 + hash3(i, 3, 9) * 0.8);
      if (age > 1) continue;
      s.set(x, y, i % 4 === 0 ? ix(R.GLOW, 7) : ix(R.RARITY, age < 0.4 ? 7 : age < 0.7 ? 6 : 4));
    }
    for (let i = 0; i < 7; i++) {
      const u = since / 3.2;
      if (u > 1) continue;
      const x = cx + (hash3(i, 4, 9) - 0.5) * 50 * ease(since * 2) + Math.sin(since * 4 + i) * 3;
      const y = cy - 26 * ease(since * 3) + since * 14 * (0.8 + hash3(i, 5, 9) * 0.6);
      s.set(x, y, ix(R.CONE, 6));
      s.set(x + (Math.floor(since * 6 + i) % 2 ? 1 : -1), y, ix(R.CREAM, 4));
    }
  }

  drawSpirit(s, rare, L, ev, t, cx, cy);
}

/** Leafkin's pop: a ring of smoke, gone in a blink, and three leaves tossed up. */
function puff(s: Surface, cx: number, cy: number, since: number): void {
  if (since < 0 || since > 0.9) return;
  const r = 3 + since * 14;
  const n = Math.round(r * 5);
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2;
    if (hash3(k, Math.floor(since * 10), 7) < since * 1.1) continue;
    s.set(cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.6, ix(R.SMOKE, since < 0.3 ? 7 : 5));
  }
  for (let i = 0; i < 3; i++) {
    const x = cx + (i - 1) * 6 * ease(since * 2) + Math.sin(since * 9 + i) * 1.5;
    const y = cy - 12 * Math.sin(Math.min(1, since * 1.6) * Math.PI) + since * 8;
    s.set(x, y, ix(R.FOLI, 6));
    s.set(x + 1, y, ix(R.OLIVE, 6));
  }
  if (since < 0.12) {
    for (const [dx, dy] of [
      [0, -3],
      [3, 0],
      [-3, 0],
      [0, 2],
    ] as const)
      s.set(cx + dx, cy + dy, ix(R.STAR, 7));
  }
}

/** Yggdrasil: the Great Sequoia on the ridge answers with a beam, its lanterns all alight. */
function greatAnswers(s: Surface, light: Light, rare: Light, L: Stage, since: number): void {
  const life = Math.max(0, 1 - since / 3.5);
  if (life <= 0) return;
  const gx = L.great.x;
  const top = Math.round(L.H * 0.12);
  const h = Math.round((L.horizon + 4 - top) * Math.min(1, since * 3 + 0.05));
  for (let y = 0; y < top + h * 0.2; y++) {
    const v = (1 - y / (top + 10)) * life;
    for (let dx = -2; dx <= 2; dx++) {
      if (bayer(gx + dx, y) > v * (Math.abs(dx) === 2 ? 0.5 : 1.2)) continue;
      s.set(gx + dx, y, ix(R.RARITY, Math.abs(dx) === 0 ? 7 : 6));
    }
  }
  rare.pool(gx, top + 4, 16 * life + 6, 2.2 * life, 1);
  light.pool(gx, top + 10, 8, 1.4, 1);
}

function drawSpirit(s: Surface, rare: Light, L: Stage, ev: ConeEvent, t: number, cx: number, cy: number): void {
  const b = BEATS[ev.rank];
  const tau = t - ev.t0;
  const quick = b.rings === 0;
  const start = b.burst + (quick ? 0.05 : 0.15);
  if (tau < start) return;
  const land = quick ? { x: cx - (L.narrow ? 4 : 16), y: cy + 6 } : spiritLanding(L);
  const flight = quick ? 0.4 : 0.75;
  let x: number;
  let y: number;
  const u = (tau - start) / flight;
  if (u < 1) {
    x = cx + (land.x - cx) * u;
    y = cy + (land.y - cy) * u - Math.sin(u * Math.PI) * (quick ? 14 : 26);
  } else {
    x = land.x;
    y = land.y;
    // A happy bounce, every so often.
    const hop = ((tau - start - flight) % 1.3) / 1.3;
    if (hop < 0.12) y += 1;
    else if (hop < 0.32) y -= Math.round(Math.sin(((hop - 0.12) / 0.2) * Math.PI) * 4);
  }
  if (ev.closedAt !== null) {
    const c = (t - ev.closedAt) / 0.6;
    if (c >= 1) return;
    // Off to the tree with a hop, fading to a sparkle.
    x += c * -30;
    y -= Math.sin(c * Math.PI) * 10;
    if (c > 0.6) {
      s.set(x, y - 8, ix(R.RARITY, 7));
      return;
    }
  }
  const f = spiritFrame(ev.spirit, (tau - start) * 1000);
  const sx = Math.round(x) - f.ax;
  const sy = Math.round(y) - f.ay;
  const glowing = u < (quick ? 0.25 : 0.55);
  if (glowing) {
    s.blit(f.sprite, sx, sy, { solid: ix(R.RARITY, 7) });
  } else {
    // An aura one pixel round the spirit in its rarity's light, then the spirit itself.
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const)
      s.blit(f.sprite, sx + dx, sy + dy, { solid: ix(R.RARITY, 5) });
    blitFrame(s, f, x, y);
    // Its sparkles, round it, twinkling in turn.
    for (let i = 0; i < 5; i++) {
      const a = i * 1.26 + tau * 0.6;
      const glint = 0.5 + 0.5 * Math.sin(tau * 3 + i * 2);
      if (glint < 0.45) continue;
      const px = Math.round(x + Math.cos(a) * 13);
      const py = Math.round(y - 8 + Math.sin(a) * 9);
      s.set(px, py, ix(R.RARITY, 7));
      if (glint > 0.8) {
        s.set(px + 1, py, ix(R.RARITY, 5));
        s.set(px - 1, py, ix(R.RARITY, 5));
        s.set(px, py + 1, ix(R.RARITY, 5));
        s.set(px, py - 1, ix(R.RARITY, 5));
      }
    }
  }
  rare.pool(x, y - 7, 14, 1.6, 1);
}

/** The frame-wide part: the dimmed world round the fire's spotlight, and the burst's flash. */
export function coneScreen(out: Uint32Array, W: number, H: number, L: Stage, look: ConeLook, colour: string): void {
  if (look.dim <= 0 && look.flash <= 0) return;
  const rc = hex(colour);
  const fx = L.fire.x + 2;
  const fy = L.fire.y - 10;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      let v = out[i] ?? 0;
      let r = v & 255;
      let g = (v >> 8) & 255;
      let b = (v >> 16) & 255;
      if (look.dim > 0) {
        const d = Math.hypot((x - fx) / 70, (y - fy) / 52);
        const k = Math.min(1, Math.max(0, (d - 0.55) * 2.2));
        const level = Math.floor(k * 3 + bayer(x, y) * 0.99) / 3;
        const m = 1 - 0.55 * look.dim * level;
        r *= m;
        g *= m;
        b *= m * 1.02;
      }
      if (look.flash > 0) {
        const f = look.flash * Math.max(0.25, 1 - Math.hypot(x - fx, (y - fy) * 1.3) / 160);
        r += (Math.min(255, rc[0] + 80) - r) * f;
        g += (Math.min(255, rc[1] + 80) - g) * f;
        b += (Math.min(255, rc[2] + 80) - b) * f;
      }
      v =
        (0xff000000 |
          (Math.min(255, Math.round(b)) << 16) |
          (Math.min(255, Math.round(g)) << 8) |
          Math.min(255, Math.round(r))) >>>
        0;
      out[i] = v;
    }
  }
}

/** The burst's impact: the whole frame knocked a pixel for a few frames. */
export function shakeFrame(out: Uint32Array, W: number, H: number, dx: number, dy: number): void {
  if (!dx && !dy) return;
  const copy = out.slice();
  for (let y = 0; y < H; y++) {
    const sy = Math.min(H - 1, Math.max(0, y - dy));
    for (let x = 0; x < W; x++) {
      const sx = Math.min(W - 1, Math.max(0, x - dx));
      out[y * W + x] = copy[sy * W + sx] ?? 0;
    }
  }
}

// ---------------------------------------------------------------------------------------------

/** The tooltip card, in the HUD's grid, beside the fire (`fire` is the fire's place in that grid). */
export function drawConeCard(c: Canvas, fire: Point, ev: ConeEvent, t: number, portrait: CastFrame | null): void {
  const b = BEATS[ev.rank];
  const tau = t - ev.t0;
  const at = b.burst + b.card;
  if (tau < at) return;
  const closing = ev.closedAt === null ? 0 : (t - ev.closedAt) / 0.25;
  if (closing >= 1) return;
  const open = Math.min(1, (tau - at) / 0.15);
  const found = spirit(ev.spirit);
  drawConeCardAt(
    c,
    fire,
    {
      rank: ev.rank,
      verdant: ev.verdant,
      colour: hex(rankColour(ev.rank)),
      name: found.name,
      lore: found.note,
      number: found.number,
      bond: ev.bond ?? 1,
    },
    open,
    closing,
    portrait,
  );
}
