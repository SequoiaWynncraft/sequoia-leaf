/**
 * Where a yard's tiles are, as it keeps them: measured from the north-west corner of the yard plot
 * (`Land.origin`), so that the land may grow by rings of plots round it and nothing kept moves. A kept
 * yard says the land it was kept on (`KeptLand`: its size and the yard plot's corner there), and
 * every tile it keeps (its pieces, the redwoods it felled, a plan of the whole yard) is a tile of that
 * land; read on another, each is taken to the tile as far from the yard plot's corner there, or off
 * the map if that land has none. A yard that says no land was kept on the guild's first land, three
 * plots by three with the yard in the middle (`FIRST_LAND`): every version before the land could grow.
 *
 * The check (`check.ts`) mixes in each tile the same way (`fromCorner`), so the same yard has the same
 * check on a land of any size.
 */
import type { KeptPiece } from "./cells.ts";
import { type Land, tileAt } from "./land.ts";

/** The land a yard was kept on, as far as its tiles need: its size, and the yard plot's corner on it. */
export interface KeptLand {
  readonly w: number;
  readonly h: number;
  readonly x: number;
  readonly y: number;
}

/** The guild's first land: 48 tiles by 36, the yard plot's corner at (16, 12). */
export const FIRST_LAND: KeptLand = { w: 48, h: 36, x: 16, y: 12 };

/** The most tiles a land may be across or down, as a kept yard says it. */
const SIDE_MOST = 4096;

/** A land as a yard keeps it. */
export const keptLandOf = (land: Land): KeptLand => ({ w: land.w, h: land.h, x: land.origin[0], y: land.origin[1] });

/** A whole number below `most`, or null. */
const below = (n: unknown, most: number): number | null =>
  typeof n === "number" && Number.isInteger(n) && n >= 0 && n < most ? n : null;

/** The land a kept yard says it was kept on: none said is the first land; null for one that is no land. */
export function readKeptLand(v: unknown): KeptLand | null {
  if (v === undefined) return FIRST_LAND;
  if (typeof v !== "object" || v === null) return null;
  const w = below(Reflect.get(v, "w"), SIDE_MOST + 1);
  const h = below(Reflect.get(v, "h"), SIDE_MOST + 1);
  if (w === null || h === null || w === 0 || h === 0) return null;
  const x = below(Reflect.get(v, "x"), w);
  const y = below(Reflect.get(v, "y"), h);
  return x === null || y === null ? null : { w, h, x, y };
}

/** The tile of a land as far from its yard plot's corner as a tile (`i`) of the land a yard was kept on; -1 off either. */
export function tileOn(from: KeptLand, land: Land, i: number): number {
  if (!Number.isInteger(i) || i < 0 || i >= from.w * from.h) return -1;
  const x = i % from.w;
  return tileAt(land, x - from.x + land.origin[0], (i - x) / from.w - from.y + land.origin[1]);
}

/** Kept pieces, each on the tile of a land as far from the yard plot's corner as it was kept (`tileOn`): off the map, -1. */
export const piecesOn = (from: KeptLand, land: Land, pieces: readonly KeptPiece[]): KeptPiece[] =>
  pieces.map((o) => ({ ...o, tile: tileOn(from, land, o.tile) }));

/**
 * A tile, by its column and row, as the check mixes it in: how far it is east and south of the yard
 * plot's corner, sixteen bits each (west and north below nothing), so that it is the same on a land
 * of any size.
 */
export const fromCorner = (land: Land, x: number, y: number): number =>
  (((y - land.origin[1]) & 0xffff) << 16) | ((x - land.origin[0]) & 0xffff);

/** A tile, by its number, as the check mixes it in (`fromCorner`). */
export const tileFromCorner = (land: Land, i: number): number => fromCorner(land, i % land.w, Math.floor(i / land.w));
