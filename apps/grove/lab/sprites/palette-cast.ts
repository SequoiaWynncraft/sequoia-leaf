/**
 * The cast's palette: a sprite palette beside the glade's, as 16-bit consoles kept one palette for
 * the background and another for the sprites.
 *
 * The glade's 256 indices (`ramp * 8 + level`, one byte) are all taken: every one of its 32 ramps is
 * drawn with. The spirits need colours it lacks (a glorp green, the guild's teal, Sequoia purple, a
 * cool white, a metal gold, leaf green), so they draw into their own surface whose indices read
 * through this palette. Three rules keep the two in step:
 *
 * - **Same format.** Cast sprites are ordinary engine sprites: `fromRows`, a legend, `ix(ramp, level)`.
 * - **Same characters.** Every ramp keeps its engine number and its dusk colours, graded for the light
 *   exactly as `palette.ts` grades the Chickaree and the crab, so their sprites draw the same in either
 *   surface. Emitters (fire, glow, stars, fairy lights, rarity) are copied from the glade's own table.
 * - **New ramps only where the cast never draws.** The sky, haze and far-forest ramps (`C` below) are
 *   reused for the cast's own colours. A cast sprite must never be blitted into the glade's surface:
 *   draw it into a cast surface and lay it over with `composeCast`.
 */

import {
  buildLut,
  hexToRgb,
  type Lut,
  mixRgb,
  packRgb,
  R,
  type Rgb,
  type Season,
  type Time,
} from "../pixel/palette.ts";
import { compose, type Light, type Surface } from "../pixel/raster.ts";

/** The cast's own ramps, on ramp numbers the cast never draws with. */
export const C = {
  /** Glorp green: muted sage, blue-green in shadow, cream-lime at the top (the SEQ logo's #77836F to #C9D7A5). */
  SAGE: R.SKY0,
  /** The guild's teal (#4EAAA2, deep #496E66) and Fogbound Sequoias mist. */
  TEAL: R.SKY1,
  /** Sequoia purple, the mod's accent (#a082dc, dark #3c1e78). */
  VIOLET: R.SKY2,
  /** A cool white with lilac shadows: the white fox, the fog owl, puffs of smoke and mist. */
  PEARL: R.HAZE,
  /** Metal gold: the SEQ gold (#C1A66E) and the banner gold (#E2B54C) as brass, antler and coin. */
  GOLD: R.FAR,
  /** Leaf and moss, the welcome scenes' yellow-greens, a little muted. */
  LEAF: R.MID,
} as const;

/** Dusk colours of the cast's ramps, dark to light. Light and season grade them as characters. */
const CAST_DUSK: Readonly<Record<number, readonly string[]>> = {
  [C.SAGE]: ["#121a18", "#1b2a22", "#273d2c", "#365436", "#4a6e42", "#64894f", "#86a862", "#b9cf8a"],
  [C.TEAL]: ["#0f1a1f", "#16282c", "#1f3b3c", "#2b5250", "#386b65", "#4a8a80", "#67aa9c", "#a2d2c0"],
  [C.VIOLET]: ["#170c26", "#23123a", "#331a52", "#46246e", "#5e348c", "#7b4fae", "#9d74cf", "#c9adec"],
  [C.PEARL]: ["#28223a", "#433b5a", "#625a7e", "#8680a2", "#aba6c4", "#cdc9de", "#e9e6f0", "#fdfbf6"],
  [C.GOLD]: ["#2a1a0a", "#4a2f10", "#6e4816", "#94661e", "#bb8a2c", "#e0b14c", "#f2d27e", "#fff2c4"],
  [C.LEAF]: ["#161a0c", "#232a10", "#323e16", "#46561c", "#5f7224", "#7d8f2e", "#a2ad40", "#cdd078"],
};

/** Ramps that give light rather than take it: copied from the glade's own table in every light. */
const EMITTERS: ReadonlySet<number> = new Set([R.FIRE, R.GLOW, R.STAR, R.LIGHTS, R.RARITY]);
const emitter = (i: number): boolean => EMITTERS.has(i >> 3);

/**
 * As `palette.ts` grades its characters: dusk as drawn, day a touch brighter, night moonlit. One
 * deliberate difference: the night is a step lighter than the engine's (0.72 rather than 0.62), so
 * a red crab or a pink glarp away from the fire still reads against the night ground, as the
 * engine's own note asks of characters ("so they read the same in every light").
 */
function grade(time: Time, c: Rgb): Rgb {
  if (time === "night") {
    const dim = mixRgb(c, [70, 80, 130], 0.34);
    return [dim[0] * 0.72, dim[1] * 0.74, dim[2] * 0.86];
  }
  if (time === "day") return [Math.min(255, c[0] * 1.06), Math.min(255, c[1] * 1.04), Math.min(255, c[2] * 1.02)];
  return c;
}

/**
 * The cast's colour table for a light and season, in the engine's `Lut` shape: `levels[k]` under warm
 * light step `k`. Warm light tints every non-emitter as `palette.ts` tints its characters, and at night
 * firelight shows them in their dusk colours.
 */
export function buildCastLut(time: Time, season: Season, rarity = "#fdd36f"): Lut {
  const glade = buildLut(time, season, rarity);
  const dusk = buildLut("dusk", "normal", rarity);
  const duskColour = (i: number): Rgb => {
    const own = CAST_DUSK[i >> 3]?.[i & 7];
    return own ? hexToRgb(own) : dusk.rgb(i);
  };
  const base = Array.from({ length: 256 }, (_, i): Rgb => (emitter(i) ? glade.rgb(i) : grade(time, duskColour(i))));
  const warm: Rgb = time === "day" ? [255, 226, 170] : [255, 168, 84];
  const levels: Uint32Array[] = [];
  for (let k = 0; k < 4; k++) {
    const table = new Uint32Array(256);
    const gladeTable = glade.levels[k];
    for (let i = 1; i < 256; i++) {
      if (emitter(i)) {
        table[i] = gladeTable?.[i] ?? 0;
        continue;
      }
      let c = base[i] ?? [0, 0, 0];
      if (k > 0) {
        if (time === "night") {
          const reveal = [0, 0.3, 0.58, 0.8][k] ?? 0.8;
          c = mixRgb(mixRgb(c, duskColour(i), reveal), warm, 0.09 * k);
        } else {
          c = mixRgb(c, mixRgb(c, warm, 0.55), 0.14 * k);
          c = [c[0] * (1 + 0.05 * k), c[1] * (1 + 0.04 * k), c[2]];
        }
      }
      table[i] = packRgb(c);
    }
    levels.push(table);
  }
  return { levels, rgb: (i) => base[i] ?? [0, 0, 0] };
}

/** The glade through its own table, then the cast's surface over it through the cast's. */
export function composeCast(
  glade: Surface,
  cast: Surface,
  light: Light,
  gladeLut: Lut,
  castLut: Lut,
  out: Uint32Array,
): void {
  compose(glade, light, gladeLut, out);
  const tables = castLut.levels;
  const { data } = cast;
  for (let i = 0; i < data.length; i++) {
    const v = data[i] ?? 0;
    if (!v) continue;
    out[i] = tables[light.data[i] ?? 0]?.[v] ?? 0;
  }
}

/** Clears cast pixels under whatever `front` draws, for glade layers that pass in front of a spirit. */
export function occlude(cast: Surface, front: Surface): void {
  const a = cast.data;
  const b = front.data;
  for (let i = 0; i < b.length; i++) if (b[i]) a[i] = 0;
}
