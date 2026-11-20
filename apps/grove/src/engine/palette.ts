/**
 * The palette: named ramps of up to eight colours, dark to light.
 *
 * The art is drawn in palette indices, `ramp * 8 + level`, never in colours. Each time of day and
 * season maps those indices to colours, so dusk, day, night and winter are one drawing in four
 * lights, as the welcome scenes' night palette is. Dusk is the signature and its colours are the
 * welcome forest's own (assets/welcome/authoring/forest/*.svg and design.json).
 *
 * There are 64 ramps in two halves, as 16-bit consoles kept a background palette and a sprite
 * palette, but here in one table under one light:
 *
 * - **World ramps** (`R`, 0 to 31): the glade, the forest and everything painted into them.
 * - **Character ramps** (`C`, 32 to 63): the guild's cast. Each world ramp the cast draws with has
 *   a character twin 32 ramps up, with the same dusk colours but lit as a character: graded to read
 *   in every light (a red crab still reads on the night grass), and tinted by firelight rather than
 *   stepped. Emitters (fire, glow, stars, fairy lights, rarity) are the world's own colours. The
 *   twins of the sky ramps, which no character draws with, hold the cast's own colours instead:
 *   glorp sage, the guild's teal, Sequoia purple, pearl white, metal gold and leaf green.
 */

export const R = {
  NONE: 0,
  /**
   * Teal mist for the far valley, after the members' favourite painting, "Fogbound Sequoias". It
   * shares ramp 0 with NONE: index 0 is transparency, so MIST has seven colours, levels 1 to 7.
   * Draw it with `mist(level)`.
   */
  MIST: 0,
  SKY0: 1,
  SKY1: 2,
  SKY2: 3,
  HAZE: 4,
  FAR: 5,
  MID: 6,
  BARK: 7,
  OLIVE: 8,
  FOLI: 9,
  MOSS: 10,
  SOIL: 11,
  STONE: 12,
  SHROOM: 13,
  FIRE: 14,
  SMOKE: 15,
  WOOD: 16,
  GLOW: 17,
  CONE: 18,
  FUR: 19,
  CRAB: 20,
  SNOW: 21,
  WATER: 22,
  INK: 23,
  STAR: 24,
  CREAM: 25,
  RARITY: 26,
  LIGHTS: 27,
  METAL: 28,
  ROSE: 29,
  FERN: 30,
  CANOPY: 31,
} as const;

export type Ramp = (typeof R)[keyof typeof R];

/** How many world ramps there are; a character ramp is its world twin plus this. */
export const WORLD_RAMPS = 32;
/** Every index there is: 64 ramps of 8. Index maps (`BlitOptions.map`) have this many entries. */
export const PALETTE_SIZE = 64 * 8;

/** The cast's ramps: twins of the world's ramps lit as characters, and the cast's own colours. */
export const C = {
  /** Glorp green: muted sage, blue-green in shadow, cream-lime at the top (the SEQ logo's #77836F to #C9D7A5). */
  SAGE: WORLD_RAMPS + R.SKY0,
  /** The guild's teal (#4EAAA2, deep #496E66) and Fogbound Sequoias mist. */
  TEAL: WORLD_RAMPS + R.SKY1,
  /** Sequoia purple, the mod's accent (#a082dc, dark #3c1e78). */
  VIOLET: WORLD_RAMPS + R.SKY2,
  /** A cool white with lilac shadows: the white fox, the fog owl, puffs of smoke and mist. */
  PEARL: WORLD_RAMPS + R.HAZE,
  /** Metal gold: the SEQ gold (#C1A66E) and the banner gold (#E2B54C) as brass, antler and coin. */
  GOLD: WORLD_RAMPS + R.FAR,
  /** Leaf and moss, the welcome scenes' yellow-greens, a little muted. */
  LEAF: WORLD_RAMPS + R.MID,
  BARK: WORLD_RAMPS + R.BARK,
  OLIVE: WORLD_RAMPS + R.OLIVE,
  FOLI: WORLD_RAMPS + R.FOLI,
  MOSS: WORLD_RAMPS + R.MOSS,
  SOIL: WORLD_RAMPS + R.SOIL,
  STONE: WORLD_RAMPS + R.STONE,
  SHROOM: WORLD_RAMPS + R.SHROOM,
  FIRE: WORLD_RAMPS + R.FIRE,
  SMOKE: WORLD_RAMPS + R.SMOKE,
  WOOD: WORLD_RAMPS + R.WOOD,
  GLOW: WORLD_RAMPS + R.GLOW,
  CONE: WORLD_RAMPS + R.CONE,
  FUR: WORLD_RAMPS + R.FUR,
  CRAB: WORLD_RAMPS + R.CRAB,
  SNOW: WORLD_RAMPS + R.SNOW,
  WATER: WORLD_RAMPS + R.WATER,
  INK: WORLD_RAMPS + R.INK,
  STAR: WORLD_RAMPS + R.STAR,
  CREAM: WORLD_RAMPS + R.CREAM,
  RARITY: WORLD_RAMPS + R.RARITY,
  LIGHTS: WORLD_RAMPS + R.LIGHTS,
  METAL: WORLD_RAMPS + R.METAL,
  ROSE: WORLD_RAMPS + R.ROSE,
  FERN: WORLD_RAMPS + R.FERN,
  CANOPY: WORLD_RAMPS + R.CANOPY,
} as const;

/** A palette index: ramp and level packed together. Level 0 is the ramp's darkest. */
export const ix = (ramp: number, level: number): number => ramp * 8 + Math.max(0, Math.min(7, Math.round(level)));
export const rampOf = (index: number): number => index >> 3;
export const levelOf = (index: number): number => index & 7;
/** A MIST index. Its level 0 would be transparency, so levels start at 1. */
export const mist = (level: number): number => ix(R.MIST, Math.max(1, level));

export type Time = "dusk" | "day" | "night";
export type Season = "normal" | "winter";

type Ramps = Partial<Record<number, readonly string[]>>;

/** The sky is one 24-step gradient over three ramps, top of the sky to the horizon. */
const DUSK: Ramps = {
  [R.MIST]: ["#000000", "#2a2c46", "#2f3a52", "#35485a", "#3e5862", "#4a6a6c", "#5c7e78", "#749386"],
  [R.SKY0]: ["#22122f", "#28153a", "#2e1842", "#331b48", "#3a1f52", "#3d2050", "#42215c", "#472365"],
  [R.SKY1]: ["#4c256a", "#54286a", "#5a296e", "#612b79", "#692e80", "#723086", "#7a348a", "#86388e"],
  [R.SKY2]: ["#973d8f", "#a24768", "#b84d84", "#d06170", "#e67967", "#ee965f", "#f5b95e", "#ffd98a"],
  [R.HAZE]: ["#3d1f55", "#46245f", "#502968", "#5a2e70", "#663478", "#743a80", "#843f86", "#9a4c8c"],
  [R.FAR]: ["#22132c", "#2a1735", "#321b3c", "#391e4a", "#452149", "#4c275a", "#583061", "#63314f"],
  [R.MID]: ["#170d1e", "#1d1026", "#24142f", "#2b1838", "#331c42", "#3c214b", "#472755", "#552e5e"],
  [R.BARK]: ["#1a0a09", "#230e0c", "#34150d", "#471d10", "#602714", "#763332", "#8a3b3c", "#a24f4c"],
  [R.OLIVE]: ["#241f0c", "#2d290e", "#363210", "#453814", "#524915", "#825e2a", "#9b7724", "#d49045"],
  [R.FOLI]: ["#0d0f0a", "#13160d", "#1a1e10", "#222713", "#2c3016", "#393b1a", "#504c20", "#716527"],
  [R.MOSS]: ["#15120a", "#1c180b", "#24200d", "#2e2910", "#3a3313", "#4a4118", "#5e521d", "#7a6824"],
  [R.SOIL]: ["#170e0c", "#1f1210", "#241612", "#2b1d17", "#3d1d12", "#4f2a19", "#644529", "#7d5534"],
  [R.STONE]: ["#1c1720", "#272029", "#342b36", "#433946", "#544959", "#6a5d6c", "#867684", "#a3919c"],
  [R.SHROOM]: ["#3a2418", "#5c3a24", "#8a5a34", "#b07a44", "#d49045", "#e8b070", "#f6dfb2", "#fff1d6"],
  [R.FIRE]: ["#3a0f0a", "#6e1a10", "#a8301a", "#d9542a", "#f08a36", "#f7b84a", "#ffe07a", "#fff6d2"],
  [R.SMOKE]: ["#2e2234", "#3b2c42", "#4a3a52", "#5a4862", "#6c5a72", "#7e6c82", "#908096", "#a495a8"],
  [R.WOOD]: ["#24120c", "#3a2016", "#5a2f1b", "#7d4526", "#9a5a31", "#bd7b45", "#dba068", "#f0c890"],
  [R.GLOW]: ["#6a3a1c", "#a8692c", "#c9a23c", "#e6a236", "#ffc96e", "#ffd772", "#ffe58a", "#fffbe6"],
  [R.CONE]: ["#1e0d08", "#33160b", "#4e2210", "#6a3018", "#874222", "#a5582e", "#c2763e", "#dc9a5c"],
  [R.FUR]: ["#1e100b", "#3c251a", "#573726", "#744a34", "#94633f", "#c4652a", "#e48e3e", "#f8cc94"],
  [R.CRAB]: ["#2a0b0a", "#5e1714", "#8e271e", "#b83826", "#d9542e", "#ee7a44", "#f7a66a", "#fcd6aa"],
  [R.SNOW]: ["#4f4870", "#706890", "#9b90bb", "#b7b2dc", "#d3c8dc", "#e7dde6", "#f1eef8", "#fbf9ff"],
  [R.WATER]: ["#1c2f52", "#2a4a7a", "#3d6ea6", "#5b97cc", "#7fbde6", "#a9dcf4", "#d4f0fb", "#f4fdff"],
  [R.INK]: ["#0c0709", "#140a0c", "#1a0b07", "#26110a", "#2b1145", "#3a1a5c", "#4a2a18", "#2b211c"],
  [R.STAR]: ["#4e3a78", "#6a54a0", "#9a86d0", "#b9a4ee", "#d7b8ff", "#ebdcff", "#f8f2ff", "#ffffff"],
  [R.CREAM]: ["#7a6650", "#a08868", "#c4a882", "#dcc49c", "#efdcb8", "#f6e8cc", "#fff4e2", "#ffffff"],
  [R.LIGHTS]: ["#2b211c", "#a8692c", "#ffc65a", "#fff3cc", "#9c3b34", "#ff6f5e", "#4f6f9c", "#a8d8ff"],
  [R.METAL]: ["#120c0c", "#2b1d17", "#3e2c22", "#5a4232", "#7a5a3a", "#9a7a54", "#5d6176", "#9aa0b4"],
  [R.ROSE]: ["#4a1a2a", "#7a2a40", "#a83c58", "#d45a74", "#ee8aa0", "#f8b4c4", "#ffd8e2", "#fff0f4"],
  [R.FERN]: ["#1f1a0a", "#2a240f", "#363210", "#453814", "#524915", "#6e5c20", "#9b7724", "#d49045"],
  [R.CANOPY]: ["#211d0b", "#2d290e", "#363210", "#453814", "#524915", "#825e2a", "#9b7724", "#d49045"],
};

/** Day: the same glade under a soft high sun. Hand-picked, not computed, so greens stay muted. */
const DAY: Ramps = {
  [R.MIST]: ["#000000", "#2f4a52", "#36585d", "#3f6768", "#4a7773", "#58897f", "#6f9e8f", "#93b6a3"],
  [R.SKY0]: ["#4a74b8", "#4f7abd", "#5682c2", "#5d89c6", "#6591ca", "#6d99ce", "#76a1d2", "#7fa9d6"],
  [R.SKY1]: ["#88b0d9", "#91b7dc", "#99bddf", "#a2c3e1", "#abc9e3", "#b4cee4", "#bdd3e5", "#c6d8e5"],
  [R.SKY2]: ["#cfdce4", "#d8e0e2", "#e1e3de", "#e9e5d6", "#efe5cc", "#f3e4c0", "#f6e2b4", "#fbf0d6"],
  [R.HAZE]: ["#6f87ad", "#7890b3", "#8199b9", "#8aa2bf", "#93abc4", "#9db4c9", "#a7bcce", "#b2c5d3"],
  [R.FAR]: ["#34505a", "#3b5962", "#43626a", "#4b6b72", "#54757b", "#5e7f84", "#69898d", "#759497"],
  [R.MID]: ["#1c2e2a", "#213530", "#273c35", "#2d443b", "#344c41", "#3c5548", "#455e4f", "#4f6857"],
  [R.BARK]: ["#2a110c", "#38160e", "#4c1e12", "#642918", "#7c3720", "#93472a", "#a95a36", "#c07648"],
  [R.OLIVE]: ["#1f2a10", "#283614", "#334418", "#40541c", "#4f6622", "#66782a", "#869036", "#b0aa48"],
  [R.FOLI]: ["#101b15", "#15241a", "#1b2e1f", "#233a26", "#2e482d", "#3d5835", "#536c3e", "#76874c"],
  [R.MOSS]: ["#1e2a12", "#253416", "#2d3f1a", "#374c1e", "#435a23", "#516a28", "#647c2f", "#7e9138"],
  [R.SOIL]: ["#22160f", "#2c1c13", "#362317", "#432b1b", "#523520", "#644228", "#7a5432", "#93683e"],
  [R.STONE]: ["#2a2a30", "#36353c", "#44424a", "#545159", "#66626a", "#7a757c", "#908a90", "#a8a2a6"],
  [R.SMOKE]: ["#6a6670", "#7a7680", "#8a8690", "#9a96a0", "#aaa6b0", "#bab6c0", "#cac6ce", "#dad6dc"],
  [R.FERN]: ["#1c2610", "#243214", "#2e3f17", "#394d1b", "#455c20", "#577028", "#748a34", "#a2a646"],
  [R.CANOPY]: ["#1c2610", "#243214", "#2e3f17", "#394d1b", "#455c20", "#617a2a", "#829436", "#b0b04a"],
  [R.STAR]: ["#8a96c0", "#a0aad0", "#b6bede", "#ccd2ea", "#e0e4f4", "#eef0fa", "#f8f8ff", "#ffffff"],
};

/** Night: moonlight on everything that does not glow. Emitters keep their warmth. */
const NIGHT: Ramps = {
  [R.MIST]: ["#000000", "#0d1220", "#101828", "#131f2f", "#172736", "#1c303e", "#243b47", "#304953"],
  [R.SKY0]: ["#080a18", "#0a0c1c", "#0c0f20", "#0e1124", "#101428", "#12162c", "#141930", "#161b34"],
  [R.SKY1]: ["#181e38", "#1a203c", "#1c2240", "#1f2444", "#222648", "#25284c", "#292a50", "#2d2c52"],
  [R.SKY2]: ["#322e54", "#382f54", "#3f3052", "#48314e", "#55344a", "#6a3c46", "#8a5044", "#a86a4c"],
  [R.HAZE]: ["#1c1c38", "#20203e", "#242444", "#28284a", "#2d2c50", "#323056", "#38355c", "#403b62"],
  [R.FAR]: ["#0e1020", "#111326", "#14162b", "#171930", "#1b1c36", "#1f203c", "#232442", "#282848"],
  [R.MID]: ["#080910", "#0b0c15", "#0e0f1a", "#11121f", "#141524", "#171829", "#1b1c2e", "#1f2034"],
  [R.BARK]: ["#0c070b", "#120a0f", "#190d14", "#22121a", "#2c1820", "#381e27", "#46262e", "#563037"],
  [R.OLIVE]: ["#0b0e0e", "#0f1312", "#141a17", "#19211c", "#1f2a22", "#2a3a2e", "#3c4c3a", "#56624a"],
  [R.FOLI]: ["#070b0c", "#0a1011", "#0d1516", "#111b1b", "#152221", "#1b2c29", "#253834", "#344840"],
  [R.MOSS]: ["#0a0c0c", "#0d1010", "#111514", "#151a18", "#1a201d", "#202823", "#28322b", "#323e34"],
  [R.SOIL]: ["#08070b", "#0b0a0f", "#0e0d13", "#121017", "#16131c", "#1b1722", "#211c28", "#28222f"],
  [R.STONE]: ["#0d0e16", "#12131d", "#181a25", "#1f212e", "#272a38", "#313444", "#3d4152", "#4b5062"],
  [R.SMOKE]: ["#141626", "#1a1c2e", "#202336", "#272a3e", "#2e3248", "#363a52", "#3f445c", "#494e66"],
  [R.FERN]: ["#090b0b", "#0d100f", "#121614", "#171d19", "#1c241f", "#253028", "#334034", "#4a5644"],
  [R.CANOPY]: ["#090b0b", "#0d100f", "#121614", "#171d19", "#1c241f", "#253028", "#334034", "#4a5644"],
  [R.SNOW]: ["#1c1e34", "#262a46", "#323858", "#424a6c", "#55607e", "#6a7692", "#8290aa", "#9eacc4"],
};

/**
 * Winter: the welcome's winterise. Dark olive foliage and moss become a cold slate evergreen of
 * matching lightness, and the lit gold tips keep their warmth.
 */
const WINTER: Partial<Record<Time, Ramps>> = {
  dusk: {
    [R.FOLI]: ["#121a1e", "#182126", "#1d282d", "#233036", "#2b3a3d", "#354641", "#4e5a46", "#9a7e3e"],
    [R.OLIVE]: ["#141c20", "#182126", "#1d282d", "#233036", "#2b3a3d", "#354641", "#6e6640", "#c48a42"],
    [R.FERN]: ["#141c20", "#182126", "#1d282d", "#233036", "#2b3a3d", "#354641", "#5e6040", "#b0843e"],
    [R.CANOPY]: ["#141c20", "#182126", "#1d282d", "#233036", "#2b3a3d", "#354641", "#9b7724", "#d49045"],
    [R.MOSS]: ["#1a1824", "#22202e", "#2a2838", "#333144", "#3d3a50", "#4a465e", "#5a556e", "#6c6680"],
  },
  day: {
    [R.FOLI]: ["#122026", "#17292f", "#1d3238", "#243c41", "#2d484b", "#385654", "#4a6a62", "#6c8670"],
    [R.OLIVE]: ["#16242a", "#1b2c32", "#22363b", "#2a4144", "#344d4e", "#425c58", "#6a7660", "#9a9a68"],
    [R.FERN]: ["#16242a", "#1b2c32", "#22363b", "#2a4144", "#344d4e", "#425c58", "#5e7060", "#8a9068"],
    [R.CANOPY]: ["#16242a", "#1b2c32", "#22363b", "#2a4144", "#344d4e", "#425c58", "#6a7660", "#9a9a68"],
  },
  night: {},
};

// ---------------------------------------------------------------------------------------------
// The canopy turns gold as the tree grows: muted summer green at level 1, through autumn, to the
// guild's gold (#C1A66E, the logo's canopy) at the top. Three hand-picked ramps per light, summer,
// autumn and gold, blended level by level, so a crown is recoloured through its ramp, never
// tinted. Level 7 of each is the sunlit tip.

type CanopyKeys = readonly [readonly string[], readonly string[], readonly string[]];

const CANOPY: Record<Time, CanopyKeys> = {
  dusk: [
    ["#0c100b", "#121810", "#182014", "#1f2918", "#29351d", "#384727", "#566a30", "#9aa246"],
    ["#140f09", "#1e160b", "#2b1f0f", "#3a2b13", "#4d3a18", "#66501f", "#856a2a", "#b88c3c"],
    ["#1a130b", "#2a1d0f", "#3c2a14", "#523c1e", "#6e532a", "#8e6e34", "#b8975a", "#e2ca8c"],
  ],
  day: [
    ["#101b15", "#15241a", "#1b2e1f", "#233a26", "#2e482d", "#3d5835", "#587440", "#8ea056"],
    ["#1e1b10", "#2b2614", "#3a3218", "#4b401d", "#5f5024", "#78642e", "#94793a", "#b89a56"],
    ["#2c2312", "#3d3018", "#52411f", "#6a5528", "#856b33", "#a28542", "#c1a66e", "#e2d0a0"],
  ],
  night: [
    ["#070b0c", "#0a1011", "#0d1516", "#111b1b", "#152221", "#1b2c29", "#253834", "#3e4a3c"],
    ["#0b0b0a", "#100f0d", "#151411", "#1b1a15", "#22201a", "#2b2920", "#38342a", "#514832"],
    ["#0d0b09", "#14110c", "#1c1810", "#252016", "#30291c", "#3d3424", "#51452f", "#73633f"],
  ],
};

/** Winter: the slate evergreen for young trees, a frosted gold for old ones. */
const CANOPY_WINTER: Record<Time, CanopyKeys> = {
  dusk: [
    ["#121a1e", "#182126", "#1d282d", "#233036", "#2b3a3d", "#354641", "#4e5a46", "#9a7e3e"],
    ["#151719", "#1c1d1f", "#252526", "#302f2e", "#3e3b37", "#504a40", "#6a6048", "#b09050"],
    ["#1a1619", "#231e20", "#2f2826", "#3d342e", "#504338", "#685644", "#8a7454", "#d0b278"],
  ],
  day: [
    ["#122026", "#17292f", "#1d3238", "#243c41", "#2d484b", "#385654", "#4a6a62", "#6c8670"],
    ["#1c2326", "#242b2d", "#2e3535", "#3a403e", "#484d48", "#5a5c52", "#74725e", "#9c9670"],
    ["#2a262a", "#353032", "#423b38", "#524940", "#655a4c", "#7d6e5a", "#9c8868", "#c8b282"],
  ],
  night: [
    ["#080c10", "#0b1014", "#0e1418", "#11191d", "#151e22", "#1a2528", "#262e2c", "#4a4436"],
    ["#0a0c0e", "#0e1012", "#121416", "#171a1b", "#1c1f1f", "#232524", "#302f2a", "#4e4636"],
    ["#0c0b0d", "#100f11", "#151315", "#1b181a", "#221e1f", "#2a2524", "#3a322c", "#5a4a36"],
  ],
};

/** How gold the canopy is at each level, 0 summer to 1 the guild's gold. */
const GOLD_OF_LEVEL = [0, 0.04, 0.1, 0.17, 0.25, 0.34, 0.44, 0.54, 0.64, 0.74, 0.83, 0.92, 1];

export const canopyGold = (level: number): number =>
  GOLD_OF_LEVEL[Math.max(0, Math.min(12, Math.round(level) - 1))] ?? 0;

/** The tree's foliage ramp at `gold` (0 to 1): the two nearest hand-picked ramps, blended. */
export function canopyRamp(gold: number, time: Time, season: Season): string[] {
  const keys = (season === "winter" ? CANOPY_WINTER : CANOPY)[time];
  const g = Math.max(0, Math.min(1, gold)) * 2;
  const lo = Math.min(1, Math.floor(g));
  const from = keys[lo === 0 ? 0 : 1];
  const to = keys[lo === 0 ? 1 : 2];
  return from.map((hex, i) => toHex(mixRgb(hexToRgb(hex), hexToRgb(to[i] ?? hex), g - lo)));
}

/** How warm light reaches each ramp: stepped (a level brighter per light step), tinted, or not at all. */
type LightMode = "step" | "tint" | "none";
const LIGHT_MODE: Partial<Record<number, LightMode>> = {
  [R.MIST]: "none",
  [R.SKY0]: "none",
  [R.SKY1]: "none",
  [R.SKY2]: "none",
  [R.HAZE]: "none",
  [R.FAR]: "none",
  [R.FIRE]: "none",
  [R.GLOW]: "none",
  [R.STAR]: "none",
  [R.LIGHTS]: "none",
  [R.RARITY]: "none",
  [R.FUR]: "tint",
  [R.CRAB]: "tint",
  [R.CONE]: "tint",
  [R.INK]: "tint",
  [R.CREAM]: "tint",
  [R.METAL]: "tint",
  [R.WATER]: "tint",
  [R.ROSE]: "tint",
  [R.SHROOM]: "tint",
};

export type Rgb = readonly [number, number, number];

export function hexToRgb(hex: string): Rgb {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

const toHex = (c: Rgb): string =>
  "#" +
  c
    .map((v) =>
      Math.round(Math.max(0, Math.min(255, v)))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("");

export const mixRgb = (a: Rgb, b: Rgb, t: number): Rgb => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

const pack = (c: Rgb, a = 255): number =>
  ((a << 24) |
    (Math.round(Math.max(0, Math.min(255, c[2]))) << 16) |
    (Math.round(Math.max(0, Math.min(255, c[1]))) << 8) |
    Math.round(Math.max(0, Math.min(255, c[0])))) >>>
  0;

/** The rank colours, as the website colours ranks (frontend/src/lib/site/rankColors.ts), lifted to read on a dark tooltip. */
export const RANKS = [
  { name: "Leafkin", colour: "#c9bba4" },
  { name: "Sapling", colour: "#92c46a" },
  { name: "Sprite", colour: "#78a8e2" },
  { name: "Dryad", colour: "#a2dcec" },
  { name: "Druid", colour: "#cfe070" },
  { name: "Treant", colour: "#f08c62" },
  { name: "Yggdrasil", colour: "#fdd36f" },
] as const;

export type RankName = (typeof RANKS)[number]["name"];

/** A rarity's light as eight steps, deep to white-hot, so bursts and halos draw in its colour. */
export function rarityRamp(hex: string): string[] {
  const c = hexToRgb(hex);
  const dark: Rgb = [24, 12, 36];
  const white: Rgb = [255, 255, 250];
  const steps = [0.25, 0.42, 0.6, 0.78, 1, 1.18, 1.4, 1.7];
  return steps.map((s) => toHex(s <= 1 ? mixRgb(dark, c, s) : mixRgb(c, white, s - 1)));
}

export interface Lut {
  /** `levels[k][index]` is the packed RGBA colour of `index` under warm light step `k` (0 to 3). */
  levels: Uint32Array[];
  rgb: (index: number) => Rgb;
}

function rampsFor(time: Time, season: Season, rarity: string, gold: number | undefined): Ramps {
  const ramps: Ramps = { ...DUSK };
  if (time === "day") Object.assign(ramps, DAY);
  if (time === "night") Object.assign(ramps, NIGHT);
  if (season === "winter") {
    Object.assign(ramps, WINTER[time] ?? {});
    if (time === "night") {
      const evergreen = ["#080c10", "#0b1014", "#0e1418", "#11191d", "#151e22", "#1a2528", "#262e2c", "#4a4436"];
      ramps[R.FOLI] = evergreen;
      ramps[R.FERN] = evergreen;
      ramps[R.OLIVE] = evergreen;
      ramps[R.CANOPY] = ["#080c10", "#0b1014", "#0e1418", "#11191d", "#151e22", "#1a2528", "#5a4a2a", "#806030"];
    }
  }
  if (gold !== undefined) ramps[R.FOLI] = canopyRamp(gold, time, season);
  ramps[R.RARITY] = rarityRamp(rarity);
  return ramps;
}

function resolve(time: Time, ramps: Ramps): Rgb[] {
  const base = Array.from({ length: WORLD_RAMPS * 8 }, (): Rgb => [0, 0, 0]);
  for (let r = 0; r < WORLD_RAMPS; r++) {
    const colours = ramps[r];
    if (!colours) continue;
    for (let l = 0; l < 8; l++) {
      const hex = colours[Math.min(l, colours.length - 1)];
      if (hex) base[r * 8 + l] = gradeEmitter(time, r, hexToRgb(hex));
    }
  }
  return base;
}

/**
 * The colour tables for one light and season. `rarity` colours the RARITY ramp (a cone's light).
 * `gold` (0 to 1, see `canopyGold(level)`) recolours FOLI, the player's tree, from summer
 * green to the guild's gold; leave it out for the spike's original foliage.
 */
export function buildLut(time: Time, season: Season, rarity: string, gold?: number): Lut {
  const ramps = rampsFor(time, season, rarity, gold);
  const base = resolve(time, ramps);
  // Firelight at night shows things in their own warm colours: lit pixels lean toward dusk's.
  const warmBase = time === "night" ? resolve("dusk", rampsFor("dusk", season, rarity, gold)) : base;
  const warm: Rgb = time === "day" ? [255, 226, 170] : [255, 168, 84];
  const levels: Uint32Array[] = [];
  for (let k = 0; k < 4; k++) {
    const lut = new Uint32Array(PALETTE_SIZE);
    for (let i = 0; i < WORLD_RAMPS * 8; i++) {
      const r = i >> 3;
      const l = i & 7;
      const mode = LIGHT_MODE[r] ?? "step";
      let c = base[i] ?? [0, 0, 0];
      if (k > 0 && mode !== "none") {
        if (time === "night") {
          const reveal = [0, 0.3, 0.58, 0.8][k] ?? 0.8;
          const from = mode === "step" ? (base[r * 8 + Math.min(7, l + k - 1)] ?? c) : c;
          const to = mode === "step" ? (warmBase[r * 8 + Math.min(7, l + k - 1)] ?? c) : (warmBase[i] ?? c);
          c = mixRgb(mixRgb(from, to, reveal), warm, 0.09 * k);
        } else if (mode === "step") {
          const stepped = base[r * 8 + Math.min(7, l + k)] ?? c;
          c = mixRgb(stepped, warm, (time === "day" ? 0.1 : 0.07) * k);
        } else {
          c = mixRgb(c, mixRgb(c, warm, 0.55), 0.14 * k);
          c = [c[0] * (1 + 0.05 * k), c[1] * (1 + 0.04 * k), c[2]];
        }
      }
      lut[i] = i === 0 ? 0 : pack(c);
    }
    levels.push(lut);
  }
  const cast = castColours(time, rarity, base, levels, warm);
  return { levels, rgb: (i) => (i < WORLD_RAMPS * 8 ? base[i] : cast[i - WORLD_RAMPS * 8]) ?? [0, 0, 0] };
}

/** The cast's own colours at dusk, dark to light, on the twins of the sky ramps. */
const CAST_DUSK: Readonly<Record<number, readonly string[]>> = {
  [C.SAGE]: ["#121a18", "#1b2a22", "#273d2c", "#365436", "#4a6e42", "#64894f", "#86a862", "#b9cf8a"],
  [C.TEAL]: ["#0f1a1f", "#16282c", "#1f3b3c", "#2b5250", "#386b65", "#4a8a80", "#67aa9c", "#a2d2c0"],
  [C.VIOLET]: ["#170c26", "#23123a", "#331a52", "#46246e", "#5e348c", "#7b4fae", "#9d74cf", "#c9adec"],
  [C.PEARL]: ["#28223a", "#433b5a", "#625a7e", "#8680a2", "#aba6c4", "#cdc9de", "#e9e6f0", "#fdfbf6"],
  [C.GOLD]: ["#2a1a0a", "#4a2f10", "#6e4816", "#94661e", "#bb8a2c", "#e0b14c", "#f2d27e", "#fff2c4"],
  [C.LEAF]: ["#161a0c", "#232a10", "#323e16", "#46561c", "#5f7224", "#7d8f2e", "#a2ad40", "#cdd078"],
};

/** Ramps that give light rather than take it: characters show them in the world's own colours. */
const EMITTERS: ReadonlySet<number> = new Set([R.FIRE, R.GLOW, R.STAR, R.LIGHTS, R.RARITY]);

/**
 * Characters are graded as the world grades its own critters (dusk as drawn, day a touch brighter,
 * night moonlit), but a step lighter at night (0.72 rather than 0.62), so a red crab or a pink
 * glarp away from the fire still reads against the night ground.
 */
function gradeCharacter(time: Time, c: Rgb): Rgb {
  if (time === "night") {
    const dim = mixRgb(c, [70, 80, 130], 0.34);
    return [dim[0] * 0.72, dim[1] * 0.74, dim[2] * 0.86];
  }
  if (time === "day") return [Math.min(255, c[0] * 1.06), Math.min(255, c[1] * 1.04), Math.min(255, c[2] * 1.02)];
  return c;
}

/**
 * Fills the character half of `levels` (indices 256 to 511) and returns its base colours. Warm light
 * tints every character colour, and at night firelight shows it in its dusk colours.
 */
function castColours(time: Time, rarity: string, world: Rgb[], levels: Uint32Array[], warm: Rgb): Rgb[] {
  const dusk = resolve("dusk", rampsFor("dusk", "normal", rarity, undefined));
  const half = WORLD_RAMPS * 8;
  const duskColour = (j: number): Rgb => {
    const own = CAST_DUSK[(j >> 3) + WORLD_RAMPS]?.[j & 7];
    return own ? hexToRgb(own) : (dusk[j] ?? [0, 0, 0]);
  };
  const base = Array.from({ length: half }, (_, j): Rgb =>
    EMITTERS.has(j >> 3) ? (world[j] ?? [0, 0, 0]) : gradeCharacter(time, duskColour(j)),
  );
  for (let k = 0; k < 4; k++) {
    const table = levels[k];
    if (!table) continue;
    for (let j = 1; j < half; j++) {
      if (EMITTERS.has(j >> 3)) {
        table[half + j] = table[j] ?? 0;
        continue;
      }
      let c = base[j] ?? [0, 0, 0];
      if (k > 0) {
        if (time === "night") {
          const reveal = [0, 0.3, 0.58, 0.8][k] ?? 0.8;
          c = mixRgb(mixRgb(c, duskColour(j), reveal), warm, 0.09 * k);
        } else {
          c = mixRgb(c, mixRgb(c, warm, 0.55), 0.14 * k);
          c = [c[0] * (1 + 0.05 * k), c[1] * (1 + 0.04 * k), c[2]];
        }
      }
      table[half + j] = pack(c);
    }
  }
  return base;
}

/** A table that maps every index to itself, to edit a few entries of. */
export function identityMap(): Uint16Array {
  const m = new Uint16Array(PALETTE_SIZE);
  for (let i = 0; i < PALETTE_SIZE; i++) m[i] = i;
  return m;
}

/** Characters and emitters keep their dusk colours with a light grade, so they read the same in every light. */
function gradeEmitter(time: Time, ramp: number, c: Rgb): Rgb {
  const characters: readonly number[] = [
    R.FUR,
    R.CRAB,
    R.CONE,
    R.WOOD,
    R.METAL,
    R.SHROOM,
    R.CREAM,
    R.INK,
    R.ROSE,
    R.WATER,
  ];
  if (!characters.includes(ramp)) return c;
  if (time === "night") {
    const moon: Rgb = [70, 80, 130];
    const dim = mixRgb(c, moon, 0.38);
    return [dim[0] * 0.62, dim[1] * 0.64, dim[2] * 0.78];
  }
  if (time === "day") return [Math.min(255, c[0] * 1.06), Math.min(255, c[1] * 1.04), Math.min(255, c[2] * 1.02)];
  return c;
}

export const rgba = (hex: string, a = 255): number => pack(hexToRgb(hex), a);
export const packRgb = pack;
