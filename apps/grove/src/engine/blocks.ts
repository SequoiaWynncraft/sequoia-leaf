/**
 * The block registry. A block is data: which tiles it wears, what shape it is, what light it
 * gives. Adding one is a line here and, if it needs a new look, a tile in art/tiles.ts.
 */
import { tileIndex, tileNames } from "../art/tiles.ts";

/** Faces in the order +x, -x, +y, -y, +z, -z. */
export type FaceTiles = readonly [number, number, number, number, number, number];

export interface Box {
  readonly from: readonly [number, number, number];
  readonly to: readonly [number, number, number];
  readonly tiles: FaceTiles;
  readonly emit?: boolean;
}

export interface BlockDef {
  readonly name: string;
  /** A full cube that hides what is behind it and stops light. */
  readonly opaque: boolean;
  /** Foliage: a full cube with holes, which thins light instead of stopping it. */
  readonly foliage?: boolean;
  /** The cube's faces, for opaque and foliage blocks. */
  readonly tiles?: FaceTiles;
  /** Other drawings of the same block; each block in the world wears one, chosen by where it stands. */
  readonly alts?: readonly FaceTiles[];
  /** Faces whose texture is turned a quarter, for logs lying down. */
  readonly turned?: readonly boolean[];
  /** Boxes in sixteenths of a block, for everything that is not a full cube. */
  readonly boxes?: readonly Box[];
  /** Two crossed sheets, for plants and flames; each plant wears one of the tiles. */
  readonly cross?: { readonly tiles: readonly number[]; readonly emit?: boolean };
  /** Joins to its neighbours with rails, as a fence does. */
  readonly fence?: boolean;
  /** The top face is turned a different way on each block, so a lawn does not show a grid. */
  readonly scatter?: boolean;
  /** Light given off, 0 to 15. */
  readonly light?: number;
}

const t = tileIndex;
const all = (name: string): FaceTiles => [t(name), t(name), t(name), t(name), t(name), t(name)];
const column = (side: string, top: string, bottom = top): FaceTiles => [
  t(side),
  t(side),
  t(top),
  t(bottom),
  t(side),
  t(side),
];
/** The pack's numbered variants of a tile: `planks`, `planks1`, ... */
const variants = (name: string): string[] => {
  const names = new Set(tileNames());
  const out = [name];
  for (let k = 1; names.has(`${name}${k}`); k++) out.push(`${name}${k}`);
  return out;
};
/** A cube of one material, in every variant the pack draws. */
const solid = (name: string, tile: string, more: Partial<BlockDef> = {}): BlockDef => {
  const [first, ...rest] = variants(tile);
  return { name, opaque: true, tiles: all(first!), alts: rest.map(all), ...more };
};
const box = (from: Box["from"], to: Box["to"], tile: string, emit = false): Box => ({
  from,
  to,
  tiles: all(tile),
  emit,
});
const plant = (name: string, tile: string, more: Partial<BlockDef> = {}): BlockDef => ({
  name,
  opaque: false,
  cross: { tiles: variants(tile).map(t) },
  ...more,
});

const DEFS: BlockDef[] = [
  { name: "air", opaque: false },
  solid("bark", "log"),
  solid("bark_char", "log_dark"),
  { name: "log", opaque: true, tiles: column("log_seat", "log_seat_top") },
  {
    name: "log_x",
    opaque: true,
    tiles: [t("log_seat_top"), t("log_seat_top"), t("log_seat"), t("log_seat"), t("log_seat"), t("log_seat")],
    turned: [false, false, true, true, true, true],
  },
  {
    name: "log_z",
    opaque: true,
    tiles: [t("log_seat"), t("log_seat"), t("log_seat"), t("log_seat"), t("log_seat_top"), t("log_seat_top")],
    turned: [true, true, false, false, false, false],
  },
  ...(["leaves", "leaves_lit", "leaves_dark"] as const).map((name): BlockDef => ({
    ...solid(name, name),
    opaque: false,
    foliage: true,
  })),
  {
    name: "moss",
    opaque: true,
    scatter: true,
    tiles: column("grass_side", "grass_top", "dirt"),
    alts: variants("grass_top")
      .slice(1)
      .map((top) => column("grass_side", top, "dirt")),
  },
  { name: "duff", opaque: true, scatter: true, tiles: column("podzol_side", "podzol_top", "dirt") },
  solid("moss_full", "moss", { scatter: true }),
  solid("dirt", "dirt", { scatter: true }),
  solid("path", "path", { scatter: true }),
  {
    name: "cone",
    opaque: false,
    boxes: [box([6, 0, 4], [10, 3, 11], "cone"), box([7, 0, 11], [9, 2, 13], "cone")],
  },
  solid("stone", "cobble"),
  solid("stone_mossy", "cobble_mossy"),
  solid("stone_bricks", "stone_bricks"),
  solid("planks", "planks"),
  solid("planks_dark", "planks_dark"),
  solid("slate", "roof"),
  solid("bricks", "bricks"),
  { name: "window", opaque: true, tiles: all("window"), light: 12 },
  { name: "planks_slab", opaque: false, boxes: [box([0, 0, 0], [16, 8, 16], "planks")] },
  { name: "planks_slab_top", opaque: false, boxes: [box([0, 8, 0], [16, 16, 16], "planks")] },
  { name: "slate_slab", opaque: false, boxes: [box([0, 0, 0], [16, 8, 16], "roof")] },
  { name: "fence", opaque: false, fence: true, boxes: [box([6, 0, 6], [10, 16, 10], "planks")] },
  {
    name: "lantern",
    opaque: false,
    light: 14,
    boxes: [box([5, 0, 5], [11, 8, 11], "lantern", true), box([6, 8, 6], [10, 10, 10], "lantern")],
  },
  {
    name: "lantern_hang",
    opaque: false,
    light: 14,
    boxes: [
      box([5, 2, 5], [11, 10, 11], "lantern", true),
      box([6, 10, 6], [10, 12, 10], "lantern"),
      box([7, 12, 7], [9, 16, 9], "lantern"),
    ],
  },
  { name: "ladder_s", opaque: false, boxes: [box([0, 0, 0], [16, 16, 1], "ladder")] },
  plant("fern", "fern"),
  plant("grass", "grass"),
  plant("sprout", "sapling"),
  plant("shroom", "mushroom_brown"),
  plant("shroom_red", "mushroom_red"),
  plant("dandelion", "dandelion"),
  plant("poppy", "poppy"),
  plant("cornflower", "cornflower"),
  plant("daisy", "daisy"),
  plant("berry_bush", "berry_bush"),
  {
    name: "campfire",
    opaque: false,
    light: 15,
    cross: { tiles: [t("flame")], emit: true },
    boxes: [
      { from: [1, 0, 5], to: [15, 3, 8], tiles: all("log") },
      { from: [1, 0, 9], to: [15, 3, 12], tiles: all("log") },
      { from: [5, 2, 1], to: [8, 5, 15], tiles: all("log") },
      { from: [9, 2, 1], to: [12, 5, 15], tiles: all("log") },
    ],
  },
  { name: "rug", opaque: false, boxes: [box([0, 0, 0], [16, 1, 16], "wool_red")] },
  { name: "crate", opaque: true, tiles: column("barrel_side", "barrel_top", "barrel_bottom") },
  /** Nothing to see: a point of light, for strings of bulbs. */
  { name: "light", opaque: false, light: 10 },
  {
    name: "firepit",
    opaque: false,
    light: 15,
    boxes: [
      box([3, 0, 3], [13, 2, 13], "embers", true),
      ...(
        [
          [0, 4],
          [1, 10],
          [5, 13],
          [11, 12],
          [13, 6],
          [12, 1],
          [6, 0],
          [1, 0],
        ] as const
      ).map(([x, z], i) => box([x, 0, z], [x + 3, 2 + (i % 2), z + 3], "cobble")),
      { from: [2, 2, 6], to: [14, 5, 9], tiles: all("log") },
      { from: [7, 3, 2], to: [10, 6, 14], tiles: all("log") },
    ],
  },
  ...(
    [
      ["slate", "roof"],
      ["planks", "planks"],
    ] as const
  ).flatMap(([m, tile]) =>
    (
      [
        ["e", [8, 8, 0], [16, 16, 16]],
        ["w", [0, 8, 0], [8, 16, 16]],
        ["s", [0, 8, 8], [16, 16, 16]],
        ["n", [0, 8, 0], [16, 16, 8]],
      ] as const
    ).map(([dir, from, to]): BlockDef => ({
      name: `${m}_stairs_${dir}`,
      opaque: false,
      boxes: [box([0, 0, 0], [16, 8, 16], tile), box(from, to, tile)],
    })),
  ),
];

export const BLOCKS: readonly BlockDef[] = DEFS;
export const B: Record<string, number> = Object.fromEntries(DEFS.map((d, i) => [d.name, i]));

/** 2 stops light and sight, 1 is foliage, 0 lets both through. */
export const OCC = new Uint8Array(DEFS.map((d) => (d.opaque ? 2 : d.foliage ? 1 : 0)));
export const GLOW = new Uint8Array(DEFS.map((d) => d.light ?? 0));
