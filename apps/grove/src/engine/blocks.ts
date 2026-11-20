/**
 * The block registry. A block is data: which tiles it wears, what shape it is, what light it
 * gives. Adding one is a line here and, if it needs a new look, a tile in art/tiles.ts.
 */
import { tileIndex } from "../art/tiles.ts";

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
  /** Faces whose texture is turned a quarter, for logs lying down. */
  readonly turned?: readonly boolean[];
  /** Boxes in sixteenths of a block, for everything that is not a full cube. */
  readonly boxes?: readonly Box[];
  /** Two crossed sheets, for plants and flames. */
  readonly cross?: { readonly tile: number; readonly emit?: boolean };
  /** Joins to its neighbours with rails, as a fence does. */
  readonly fence?: boolean;
  /** Each block turns its texture a different way, so a field of it does not show a grid. */
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
const box = (from: Box["from"], to: Box["to"], tile: string, emit = false): Box => ({
  from,
  to,
  tiles: all(tile),
  emit,
});

const DEFS: BlockDef[] = [
  { name: "air", opaque: false },
  { name: "bark", opaque: true, tiles: all("bark") },
  { name: "bark_char", opaque: true, tiles: all("bark_char") },
  { name: "log", opaque: true, tiles: column("bark", "log_top") },
  {
    name: "log_x",
    opaque: true,
    tiles: [t("log_top"), t("log_top"), t("bark"), t("bark"), t("bark"), t("bark")],
    turned: [false, false, true, true, true, true],
  },
  {
    name: "log_z",
    opaque: true,
    tiles: [t("bark"), t("bark"), t("bark"), t("bark"), t("log_top"), t("log_top")],
    turned: [true, true, false, false, false, false],
  },
  { name: "leaves", opaque: false, foliage: true, scatter: true, tiles: all("leaves") },
  { name: "leaves_lit", opaque: false, foliage: true, scatter: true, tiles: all("leaves_lit") },
  { name: "leaves_dark", opaque: false, foliage: true, scatter: true, tiles: all("leaves_dark") },
  { name: "moss", opaque: true, scatter: true, tiles: column("moss_side", "moss", "dirt") },
  { name: "duff", opaque: true, scatter: true, tiles: column("dirt", "duff", "dirt") },
  { name: "moss_full", opaque: true, tiles: all("moss") },
  { name: "dirt", opaque: true, tiles: all("dirt") },
  { name: "path", opaque: true, tiles: column("dirt", "path", "dirt") },
  { name: "stone", opaque: true, tiles: all("stone") },
  { name: "stone_mossy", opaque: true, tiles: column("stone_mossy", "moss", "stone") },
  { name: "planks", opaque: true, tiles: all("planks") },
  { name: "slate", opaque: true, tiles: all("slate") },
  { name: "window", opaque: true, tiles: all("window"), light: 12 },
  { name: "planks_slab", opaque: false, boxes: [box([0, 0, 0], [16, 8, 16], "planks")] },
  { name: "planks_slab_top", opaque: false, boxes: [box([0, 8, 0], [16, 16, 16], "planks")] },
  { name: "slate_slab", opaque: false, boxes: [box([0, 0, 0], [16, 8, 16], "slate")] },
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
  { name: "fern", opaque: false, cross: { tile: t("fern") } },
  { name: "grass", opaque: false, cross: { tile: t("grass") } },
  { name: "sprout", opaque: false, cross: { tile: t("sprout") } },
  { name: "shroom", opaque: false, cross: { tile: t("shroom"), emit: true }, light: 5 },
  {
    name: "campfire",
    opaque: false,
    light: 15,
    cross: { tile: t("flame"), emit: true },
    boxes: [
      { from: [1, 0, 5], to: [15, 3, 8], tiles: all("bark") },
      { from: [1, 0, 9], to: [15, 3, 12], tiles: all("bark") },
      { from: [5, 2, 1], to: [8, 5, 15], tiles: all("bark") },
      { from: [9, 2, 1], to: [12, 5, 15], tiles: all("bark") },
    ],
  },
];

export const BLOCKS: readonly BlockDef[] = DEFS;
export const B: Record<string, number> = Object.fromEntries(DEFS.map((d, i) => [d.name, i]));

/** 2 stops light and sight, 1 is foliage, 0 lets both through. */
export const OCC = new Uint8Array(DEFS.map((d) => (d.opaque ? 2 : d.foliage ? 1 : 0)));
export const GLOW = new Uint8Array(DEFS.map((d) => d.light ?? 0));
