/**
 * What commands carry, as the wire has it: the fields many share, read off it with every one
 * checked, and the pieces and legs of a run read off it and written back onto it by name.
 */
import { isDir } from "./build.ts";
import type { ActOf } from "./commands.ts";
import { LAND } from "./land.ts";
import { keptOf, type Piece } from "./pieces.ts";
import { type Leg, legKind, legSpan } from "./route.ts";
import {
  BELT,
  BLUEPRINTS_MOST,
  FIXED,
  goalNamed,
  type Item,
  itemName,
  itemNamed,
  kindName,
  kindNamed,
  SPAN_MOST,
  TOP,
  TUNNEL,
} from "./tables.ts";

/** A tile a command names. */
export interface At {
  readonly x: number;
  readonly y: number;
}

export const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
export const whole = (v: unknown, most: number): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= most;
/** The most tiles a command may name: every tile of the guild's land. */
export const TILES = LAND.w * LAND.h;
/** A grade off the wire: 1 when it is not said. */
export const gradeOf = (v: unknown): number | null => (v === undefined ? 1 : whole(v, TOP) && v >= 1 ? v : null);

/** A piece read off the wire (or out of a kept record), every field checked, on a tile up to (`mx`, `my`); or nothing. */
export function readPiece(v: unknown, mx = 255, my = 255): Piece | null {
  if (!isRecord(v)) return null;
  const k = kindNamed(v.kind);
  if (k === null || FIXED[k] === 1 || !isDir(v.dir)) return null;
  if (!whole(v.x, mx) || !whole(v.y, my) || !whole(v.span, SPAN_MOST)) return null;
  const recipe = itemNamed(v.recipe);
  return { kind: k, x: v.x, y: v.y, dir: v.dir, span: v.span, ...keptOf({ ...v, recipe: recipe ?? undefined }, k) };
}

/**
 * A leg of a run read off the wire: a belt, or a tunnel; where it goes, which way, for a tunnel how
 * far under, and at what grade. A belt that passes under is no leg; whatever else is on one is let be.
 */
export function readLeg(v: unknown): Leg | null {
  if (!isRecord(v)) return null;
  const k = kindNamed(v.kind);
  if ((k !== BELT && k !== TUNNEL) || !isDir(v.dir) || !whole(v.x, 255) || !whole(v.y, 255)) return null;
  if (!whole(v.span, k === TUNNEL ? SPAN_MOST : 0)) return null;
  const grade = gradeOf(v.grade);
  if (grade === null) return null;
  const laid = { x: v.x, y: v.y, dir: v.dir, grade };
  return k === TUNNEL ? { tunnel: true, ...laid, span: v.span } : { tunnel: false, ...laid };
}

export function listOf<T>(v: unknown, most: number, read: (v: unknown) => T | null): T[] | null {
  if (!Array.isArray(v) || v.length > most) return null;
  const pieces = v.map(read).filter((p) => p !== null);
  return pieces.length === v.length ? pieces : null;
}

/** The fields many commands share, read once off the wire: a tile, a thing (or null for none), tiles, and a blueprint's place. */
export interface Fields {
  readonly spot: At | null;
  readonly item: Item | null | undefined;
  readonly tiles: readonly number[] | null;
  readonly slot: number | null;
  /** A grade the command may say or leave out: as said, nothing when left out, or null for one that is no grade. */
  readonly grade: { readonly grade?: number } | null;
}
export function fieldsOf(v: Record<string, unknown>): Fields {
  return {
    spot: whole(v.x, 255) && whole(v.y, 255) ? { x: v.x, y: v.y } : null,
    item: v.item === null ? null : (itemNamed(v.item) ?? undefined),
    tiles:
      Array.isArray(v.tiles) && v.tiles.length <= TILES && v.tiles.every((t): t is number => whole(t, TILES - 1))
        ? v.tiles
        : null,
    slot: whole(v.slot, BLUEPRINTS_MOST - 1) ? v.slot : null,
    grade: v.grade === undefined ? {} : graded(gradeOf(v.grade)),
  };
}
const graded = (grade: number | null): { readonly grade: number } | null => (grade === null ? null : { grade });

/** A piece as the wire names it: its kind, and what it is set to make. */
export const named = (p: Piece): Record<string, unknown> => ({
  ...p,
  kind: kindName(p.kind),
  ...(p.recipe === undefined ? {} : { recipe: itemName(p.recipe) }),
});

/** A leg of a run as the wire names it: its kind, and nothing but what a leg holds; a belt's span, as a piece's, is 0. */
export const legOnWire = (l: Leg): Record<string, unknown> => ({
  kind: kindName(legKind(l)),
  x: l.x,
  y: l.y,
  dir: l.dir,
  span: legSpan(l),
  ...(l.grade === 1 ? {} : { grade: l.grade }),
});

/** A command that names a node, read off the wire by the node's id. */
export function nodeOf<D extends "take" | "queue" | "unqueue">(v: Record<string, unknown>, name: D): ActOf<D> | null {
  const g = goalNamed(v.node);
  return g === null ? null : { do: name, node: g };
}
/** A command that names a piece of research, read off the wire by its id. */
export function researchOf<D extends "study" | "unstudy">(v: Record<string, unknown>, name: D): ActOf<D> | null {
  const g = goalNamed(v.research);
  return g === null ? null : { do: name, research: g };
}
/** A command that names a standing order, read off the wire by its number. */
export function orderOf<D extends "swap" | "handOver">(v: Record<string, unknown>, name: D): ActOf<D> | null {
  return whole(v.order, 1e9) ? { do: name, order: v.order } : null;
}
