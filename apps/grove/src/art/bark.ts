/**
 * Giant sequoia bark, as the welcome's trunks: cinnamon reds in long vertical runs, deep furrows
 * that spiral a little as they climb, a lit ridge beside each furrow, a moss-gold rim where the
 * edge catches the sky, and moss patches low on the shaded side.
 */

import { ix, R } from "../engine/palette.ts";
import type { Surface } from "../engine/raster.ts";
import { hash3, noise1 } from "../engine/rng.ts";

export interface TrunkSpec {
  top: number;
  foot: number;
  /** Centre line and half-width at each row. */
  cx: (y: number) => number;
  hw: (y: number) => number;
  /** Where the trunk's highlight sits across it, -1 (left edge) to 1 (right edge). */
  light: number;
  rimLeft: boolean;
  rimRight: boolean;
  seed: number;
  /** Furrow spacing in pixels round the trunk. */
  furrow?: number;
  /** 0 to 1: how much moss climbs the trunk. */
  moss?: number;
  /** Shift every level: frame trunks in the foreground are a step darker than the lit hero. */
  bias?: number;
  /** Rows where the trunk is hidden (behind foliage); skipped for speed. */
  skip?: (y: number) => boolean;
}

/** Moss and gold: a value of 100 plus an OLIVE level, so the drawer knows to use that ramp. */
const MOSS = 100;

/**
 * The bark at a point of the trunk's surface: a BARK level (0 to 7), `MOSS + level` for moss and
 * gold, or -1 outside the trunk.
 *
 * Bark is broad plates between dark grooves. Each plate has its own brightness and is lit across
 * its width from the side the light comes from, so plates read rounded. Grooves sometimes break,
 * so neighbouring plates merge, as old bark does. The lit edge carries a band of moss in vertical
 * streaks, gold where it catches the sky, as the welcome's trunks do.
 */
export function barkAt(spec: TrunkSpec, x: number, y: number): number {
  const cx = spec.cx(y);
  const hw = spec.hw(y);
  const u = (x + 0.5 - cx) / hw;
  if (u < -1 || u > 1) return -1;
  const a = Math.asin(Math.max(-1, Math.min(1, u)));
  const an = a / (Math.PI / 2);
  // Round the trunk: a broad lit face at `light`, falling off to dark edges.
  const lit = Math.cos((an - spec.light) * 1.3);
  let level = 2.1 + Math.max(0, lit) * 3.2 + (spec.bias ?? 0);
  // Plates: a surface coordinate that spirals slowly and wanders as the trunk climbs.
  const climb = spec.foot - y;
  const plateW = spec.furrow ?? 3.4;
  const s = a * hw + climb * 0.04 + (noise1(climb / 30, spec.seed) - 0.5) * plateW * 0.9;
  const p = s / plateW + (noise1(climb / 26 + Math.floor(s / plateW) * 3.1, spec.seed + 4) - 0.5) * 0.24;
  const cell = Math.floor(p);
  const f = p - cell;
  const plate = (hash3(cell, spec.seed, 7) - 0.5) * 1.2;
  const lightDir = spec.light >= an ? 1 : -1;
  const across = lightDir > 0 ? f : 1 - f;
  const grooveW = 0.16 + (plateW > 5 ? 0.02 : 0.05);
  const merged = noise1(climb / 9 + cell * 2.7, spec.seed + 6) > 0.84;
  if (!merged && (f < grooveW * 0.5 || f > 1 - grooveW * 0.5)) {
    level = Math.min(level - 2.2, 1.6);
  } else {
    level += plate + (across > 0.62 ? 1.1 : across < 0.25 ? -0.6 : 0.2);
  }
  // Moss: a band down the lit edge in vertical streaks, gold at the very edge; patches low down.
  const moss = spec.moss ?? 0;
  const edge = spec.rimRight ? u : spec.rimLeft ? -u : -2;
  const band = Math.min(0.34, (0.1 + moss * 0.2) * Math.max(1, 26 / hw));
  if (edge > 1 - band) {
    // Solid gold at the very edge, olive streaks inward, the odd streak further in.
    const streak = noise1(x * 0.9 + Math.floor(climb / 9) * 0.31, spec.seed + 8);
    const depth = (edge - (1 - band)) / band;
    if (depth > 0.7) return MOSS + (streak > 0.5 ? 7 : 6);
    if (depth > 0.38 && streak > 0.22) return MOSS + (streak > 0.62 ? 6 : 5);
    if (streak > 0.5) return MOSS + (streak > 0.75 ? 4 : 3);
  }
  if (moss > 0) {
    const m = noise1(s / 5 + Math.floor(climb / 4) * 0.37, spec.seed + 5) * (1 - Math.min(1, climb / (40 + moss * 60)));
    if (m > 0.6 - moss * 0.2 && an < spec.light - 0.3) return MOSS + Math.round(2 + (m - 0.5) * 5);
  }
  return Math.max(0, Math.min(7, Math.round(level)));
}

export function drawTrunk(s: Surface, spec: TrunkSpec): void {
  for (let y = Math.max(0, Math.floor(spec.top)); y <= Math.min(s.h - 1, spec.foot); y++) {
    if (spec.skip?.(y)) continue;
    const cx = spec.cx(y);
    const hw = spec.hw(y);
    const x0 = Math.round(cx - hw);
    const x1 = Math.round(cx + hw) - 1;
    for (let x = x0; x <= x1; x++) {
      if (x < 0 || x >= s.w) continue;
      const v = barkAt(spec, x, y);
      if (v < 0) continue;
      s.set(x, y, v >= MOSS ? ix(R.OLIVE, Math.min(7, v - MOSS)) : ix(R.BARK, v));
    }
    // The outermost pixel: gold where the edge catches the sky, a dark line on the shaded side.
    const climb = spec.foot - y;
    const glint = noise1(climb / 6, spec.seed + 9);
    if (spec.rimLeft) s.set(x0, y, ix(R.OLIVE, glint > 0.45 ? 7 : 6));
    else s.set(x0, y, ix(R.BARK, 1));
    if (spec.rimRight) s.set(x1, y, ix(R.OLIVE, glint > 0.45 ? 7 : 6));
    else s.set(x1, y, ix(R.BARK, 1));
  }
}
