/**
 * The welcome's colours, for what the client draws over a bundle loop: the keys and values of the
 * welcome authoring package's `welcome/design.json` palette that the glade's effects use, and the
 * welcome's night mapping (`welcome/night.py`, `night_colour`), so an effect drawn over a night
 * loop takes the same moonlit colours as the forest under it. Colours that give light (stars,
 * fireflies, lanterns, magic) keep their colour at night, as the welcome's emitters do.
 *
 * Colours are packed as `ImageData` words (`0xAABBGGRR`); see `gif.ts`.
 */

import { rgba } from "./gif.ts";

/** design.json's palette, the part the client draws with. */
export const WELCOME = {
  star: "#ffffff",
  star_arm: "#d7b8ff",
  firefly_dim: "#c9a23c",
  firefly: "#ffe58a",
  firefly_core: "#fffbe6",
  falling_leaf: "#d9b443",
  falling_leaf_dark: "#9a7a26",
  leaf_dark: "#4b6a1e",
  leaf: "#7fa62e",
  leaf_light: "#b8d24a",
  ring_gold: "#e0a83e",
  ring_gold_light: "#ffd97a",
  subtitle: "#ffd36e",
  lantern_glass: "#e6a236",
  lantern_glass_bright: "#ffd772",
  lantern_core: "#fff6d2",
  lantern_light: "#ffc96e",
  glow_0: "#3d2a26",
  glow_1: "#6a4232",
  glow_2: "#a0673e",
  glow_3: "#d89a5a",
  glow_4: "#f6d6a2",
  snow_light: "#f1eef8",
  snow_soft: "#e7dde6",
  snow: "#d3c8dc",
  snow_shadow: "#9b90bb",
  snow_deep: "#706890",
  frost: "#b7b2dc",
  snowflake: "#f6f4fb",
  snowflake_dim: "#a9a3cc",
  ice_hi: "#eef7ff",
  ice_body: "#b2cfe9",
  ice_shadow: "#7896bf",
  puff: "#e3dff0",
  puff_shadow: "#a9a2c8",
  magic_core: "#fffaf0",
  magic: "#d9b6ff",
  magic_dim: "#9670e6",
  magic_light: "#b28cff",
  acorn: "#9a5a2a",
  acorn_cap: "#5e3a1c",
  acorn_light: "#c98a4a",
  dirt_dark: "#3e2716",
  panda_outline: "#26110a",
  panda_tail_red_shadow: "#8e2e1d",
  panda_tail_red: "#c4432a",
  evergreen_3: "#2b3a3d",
  evergreen_4: "#354641",
  // The grove tree's own colours (grove/tree.py): a young crown's olive and an old one's gold.
  olive: "#825e2a",
  olive_dark: "#453814",
} as const;

export type Key = keyof typeof WELCOME;

/** The welcome's emitters: colours that give light and keep it at night (night.py, EMITTER_KEYS). */
const EMITTER = /^(lantern_|fairy_|glow_|firefly|star|magic|snow_lit_|subtitle|ice_hi|lake_glint)/;

const parse = (hex: string): [number, number, number] => [
  Number.parseInt(hex.slice(1, 3), 16),
  Number.parseInt(hex.slice(3, 5), 16),
  Number.parseInt(hex.slice(5, 7), 16),
];

export const packHex = (hex: string): number => {
  const [r, g, b] = parse(hex);
  return rgba(r, g, b);
};

export const red = (c: number): number => c & 255;
export const green = (c: number): number => (c >>> 8) & 255;
export const blue = (c: number): number => (c >>> 16) & 255;

/** `a` moved `t` of the way toward `b` (both opaque). */
export function mixColour(a: number, b: number, t: number): number {
  const k = Math.max(0, Math.min(1, t));
  return rgba(
    Math.round(red(a) + (red(b) - red(a)) * k),
    Math.round(green(a) + (green(b) - green(a)) * k),
    Math.round(blue(a) + (blue(b) - blue(a)) * k),
  );
}

// ---------------------------------------------------------------------------------------------
// Moonlight: welcome/night.py's `night_colour`, in Python's colorsys HLS.

function toHls(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, l, 0];
  const d = max - min;
  const s = l <= 0.5 ? d / (max + min) : d / (2 - max - min);
  const rc = (max - r) / d;
  const gc = (max - g) / d;
  const bc = (max - b) / d;
  const h = r === max ? bc - gc : g === max ? 2 + rc - bc : 4 + gc - rc;
  return [(((h / 6) % 1) + 1) % 1, l, s];
}

function fromHls(h: number, l: number, s: number): [number, number, number] {
  if (s === 0) return [l, l, l];
  const m2 = l <= 0.5 ? l * (1 + s) : l + s - l * s;
  const m1 = 2 * l - m2;
  const v = (hue: number): number => {
    const x = ((hue % 1) + 1) % 1;
    if (x < 1 / 6) return m1 + (m2 - m1) * x * 6;
    if (x < 0.5) return m2;
    if (x < 2 / 3) return m1 + (m2 - m1) * (2 / 3 - x) * 6;
    return m1;
  };
  return [v(h + 1 / 3), v(h), v(h - 1 / 3)];
}

const clip = (v: number): number => Math.max(0, Math.min(1, v));

/**
 * A colour by moonlight: darker and cooler, its hue kept and its saturation eased; bright warm
 * colours keep a little of their warmth.
 */
export function moonlit(c: number): number {
  const r = red(c) / 255;
  const g = green(c) / 255;
  const b = blue(c) / 255;
  const [h, l, s] = toHls(r, g, b);
  const l2 = 0.62 * l ** 1.1 + 0.2 * l ** 3 + 0.05;
  const [r2, g2, b2] = fromHls(h, l2, s * 0.55);
  let out = [clip(r2 * 0.8), clip(g2 * 0.9 + 0.005), clip(b2 * 1.16 + 0.035)];
  const gentle = h >= 0.02 && h <= 0.16 && s > 0.45 && l > 0.42 ? 0.35 : 0;
  const day = [r, g, b];
  out = out.map((v, i) => v * (1 - gentle) + (day[i] ?? 0) * gentle * 0.8);
  return rgba(Math.round((out[0] ?? 0) * 255), Math.round((out[1] ?? 0) * 255), Math.round((out[2] ?? 0) * 255));
}

export type Ambiance = "dusk" | "night";

/** The palette in one light: `ink.c("star")`. At night every colour that is not a light is moonlit. */
export class Ink {
  readonly ambiance: Ambiance;
  private readonly table = new Map<string, number>();

  constructor(ambiance: Ambiance) {
    this.ambiance = ambiance;
    for (const [key, hex] of Object.entries(WELCOME)) {
      const day = packHex(hex);
      this.table.set(key, ambiance === "night" && !EMITTER.test(key) ? moonlit(day) : day);
    }
  }

  c(key: Key): number {
    return this.table.get(key) ?? 0;
  }

  /** Any colour (a rank's, say) in this light: moonlit at night unless it gives light. */
  any(hex: string, light = false): number {
    const day = packHex(hex);
    return this.ambiance === "night" && !light ? moonlit(day) : day;
  }
}
