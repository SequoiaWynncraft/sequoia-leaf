/** Colour ramps, darkest first. Built from the welcome scenes' palette (design.json, forest SVGs) plus sequoia ramps of our own. */

export type Rgb = readonly [number, number, number];

export function hex(value: string): Rgb {
  const v = value.replace("#", "");
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
}

const ramp = (...values: string[]): Rgb[] => values.map(hex);

/** Cinnamon to red-brown sequoia bark; the darks lean violet like the welcome trunks. */
export const BARK = ramp("#2a1210", "#45190f", "#62261a", "#7a3420", "#924226", "#aa5530", "#c06d3d", "#d68a52");
/** Muted blue-green sequoia foliage with a yellow-green sun tip that echoes the welcome canopy. */
export const FOLIAGE = ramp("#122426", "#183230", "#20443a", "#2b5744", "#3a6c4e", "#4f8257", "#6e9a5e", "#94b266");
/** Winter: a cooler slate evergreen of matching lightness. */
export const FOLIAGE_WINTER = ramp("#141e2a", "#1a2832", "#22363d", "#2c4547", "#3b5653", "#4f6b62", "#6d8670", "#8fa27d");
/** Olive meadow grass, from the welcome moss. */
export const GRASS = ramp("#283618", "#33451c", "#405522", "#4d6628", "#5c752e", "#6f8536", "#8a9a40");
export const MOSS = ramp("#283014", "#3a451b", "#4f5c22", "#677528", "#838f36", "#a3aa40");
export const DIRT = ramp("#2a1a12", "#3b2517", "#4c301d", "#5d3c23", "#704b2d", "#866044");
/** Fallen sequoia needles, the cinnamon duff under the tree. */
export const LITTER = ramp("#22160f", "#2f1f15", "#3d2a1b", "#4d3522", "#5e432b", "#735437", "#8a6644");
/** Warm stone with violet shadows. */
export const STONE = ramp("#2c2430", "#40353b", "#544746", "#6a5a54", "#807063", "#968574", "#ad9c87");
export const SNOW = ramp("#6a6288", "#9188b2", "#b6abc8", "#cbc1d8", "#dbd3e4", "#e8e2ef", "#f6f2fa");
export const CHAR = ramp("#110b0e", "#1b1316", "#281c1d", "#382723", "#523225", "#7e4429");
export const CONE = ramp("#2e150c", "#4a2412", "#66341a", "#824522", "#9c592c", "#b8713a", "#d08f52");
export const WOOD = ramp("#2a170e", "#43271a", "#5c3823", "#764a2e", "#8f5e3a", "#a87449");
export const FERN = ramp("#1c2812", "#273818", "#344c1e", "#426024", "#52752a", "#678a32", "#82a23c");
export const MUSHROOM = ramp("#6e543c", "#8f7154", "#b39673", "#d2b894", "#e8d6b6", "#f6ead2");
export const FIRE = ramp("#7a1f14", "#b8321e", "#e2562a", "#ff8a33", "#ffb847", "#ffdc75", "#fff4c8");
export const IRON = ramp("#1a1210", "#2b1d17", "#4a3426", "#6e5038", "#8e6c4a");
export const GLASS = ramp("#a8651e", "#e6a236", "#ffc65a", "#ffd772", "#ffe9a6", "#fff6d2");
export const ASH = ramp("#2a2228", "#3d3339", "#55494c", "#6d6062");
export const FLOWER = ramp("#b8708a", "#e090a8", "#f6b3c8", "#ffd9e4");

/** Rank colours as rarity, low to high. Dryad is bronze, Yggdrasil the guild gold. */
export const RANKS = [
  { name: "Leafkin", color: "#9fb59a" },
  { name: "Sapling", color: "#7cc46a" },
  { name: "Sprite", color: "#5fd2c4" },
  { name: "Dryad", color: "#c8813c" },
  { name: "Druid", color: "#c4ccd8" },
  { name: "Treant", color: "#a882e6" },
  { name: "Yggdrasil", color: "#fdd36f" },
] as const;

export const UI = {
  popup: "rgba(40,40,55,0.94)",
  body: "#14141e",
  purple: "#a082dc",
  purpleHover: "#bea0fa",
  purpleDark: "#3c1e78",
  leaf: "#58c47a",
  gold: "#f2c044",
  text: "#ffffff",
  muted: "#a0a0b4",
  lore: "#b49ad6",
} as const;
