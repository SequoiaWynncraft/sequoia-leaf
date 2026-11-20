/**
 * The cone opening's timings, shared by the glade's reveal and the Campfire's: real giant sequoia
 * cones open only in a fire's heat, and 🔥 is the guild's own reaction, so this is how a spirit
 * arrives. The drawing is in the welcome's vocabulary over the bundle (`../glade/reveal.ts`); the
 * card is in the HUD (`card.ts`).
 *
 * Every rank has its own beat (`BEATS`), so the reveal grows with the rarity and the common ones
 * stay small and funny ("don't flood"):
 *   Leafkin    a hop into the fire, a wiggle, pop! A puff, and the spirit bounces out. Under 2 s.
 *   Sapling    a little longer, a soft spotlight, a ring.
 *   Sprite     the beam, rays and a knock.
 *   Dryad up   an aurora in the rank's colour fills more of the sky at each rank as the cone bursts.
 *   Yggdrasil  stops the world: everything but the cone holds still and goes dark, the cone beats
 *              like a heart, the light gathers in, and it bursts under a sky-wide golden aurora.
 *
 * Each beat's timeline, from the tap: the cone hops to the fire (0.4 s), warms through ember
 * tones and shakes, cracks show the rarity's light (burst - 0.6 s), the scales part (- 0.3 s), it
 * bursts, the spirit leaps out and lands, and the tooltip card opens until you tap.
 */

import type { CastFrame } from "../../bundle/cast.ts";
import type { Point } from "../../engine/view.ts";
import { type RankName, RANKS } from "../../game/rules.ts";
import { spirit } from "../../game/spirits.ts";
import { type Canvas, hex } from "../../ui/hud.ts";
import { drawConeCardAt } from "./card.ts";

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
  /** The aurora's strength, 0 to 1. */
  aurora: number;
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
    worldT: t - frozen,
    cardOpen: tau > b.burst + b.card + 0.1,
    done: closing >= 1,
  };
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
