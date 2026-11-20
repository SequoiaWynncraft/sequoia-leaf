/**
 * The art bundle's manifest (`manifest.json`, written by the welcome authoring package's
 * `grove/bundle.py`), read and checked once, and the choice of a glade loop for a member's tree.
 *
 * Only the sections the client draws from are read strictly; the rest (`campfire`, `forest` and
 * anything newer) are kept as they came, for the scenes that move onto bundles next.
 */

import { hashString } from "../engine/rng.ts";
import type { Ambiance } from "./palette.ts";

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface GladeManifest {
  /** Where every tree meets the ground. */
  foot: { x: number; y: number };
  /** The member's hearth, the small fire beside the tree where cones open. */
  hearth: { x: number; y: number };
  levels: number[];
  variants: number;
  seasons: string[];
  ambiances: string[];
  /** Path templates with `{level}`, `{variant}`, `{season}` and `{ambiance}`. */
  loop: string;
  near: string;
  tree: string;
  /** The front path's row, where characters stand. */
  ground: number;
  /** Each tree's bounding box, by `L<level>-v<variant>-<season>`. */
  treeBoxes: Map<string, Box>;
}

export interface EffectsManifest {
  /** The welcome's aurora, `frames` frames stacked down one image, by `{season}`. */
  aurora: string;
  /** The open sky the aurora may light, the same size, by `{season}`. */
  sky: string;
  frames: number;
}

export interface Manifest {
  version: number;
  width: number;
  height: number;
  frameMs: number;
  frames: number;
  glade: GladeManifest;
  effects: EffectsManifest | null;
  /** Sections this client does not read yet, as they came. */
  other: Map<string, unknown>;
}

// ---------------------------------------------------------------------------------------------
// Reading it.

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function field(o: Record<string, unknown>, key: string, path: string): unknown {
  if (!(key in o)) throw new Error(`manifest: ${path}.${key} is missing`);
  return o[key];
}

function num(v: unknown, path: string): number {
  if (typeof v !== "number" || !Number.isFinite(v)) throw new Error(`manifest: ${path} is not a number`);
  return v;
}

function str(v: unknown, path: string): string {
  if (typeof v !== "string") throw new Error(`manifest: ${path} is not a string`);
  return v;
}

function list<T>(v: unknown, path: string, item: (x: unknown, p: string) => T): T[] {
  if (!Array.isArray(v)) throw new Error(`manifest: ${path} is not a list`);
  return v.map((x, i) => item(x, `${path}[${i}]`));
}

function rec(v: unknown, path: string): Record<string, unknown> {
  if (!isRecord(v)) throw new Error(`manifest: ${path} is not an object`);
  return v;
}

function pair(v: unknown, path: string): { x: number; y: number } {
  const [x, y] = list(v, path, num);
  if (x === undefined || y === undefined) throw new Error(`manifest: ${path} is not a point`);
  return { x, y };
}

function box(v: unknown, path: string): Box {
  const [x, y, w, h] = list(v, path, num);
  if (x === undefined || y === undefined || w === undefined || h === undefined)
    throw new Error(`manifest: ${path} is not a box`);
  return { x, y, w, h };
}

export function readManifest(json: unknown): Manifest {
  const m = rec(json, "manifest");
  const canvas = rec(field(m, "canvas", "manifest"), "canvas");
  const g = rec(field(m, "glade", "manifest"), "glade");
  const boxes = rec(field(g, "tree_boxes", "glade"), "glade.tree_boxes");
  const foot = pair(field(g, "foot", "glade"), "glade.foot");
  const glade: GladeManifest = {
    foot,
    // Bundles before the hearth: where it stands in the ones after.
    hearth: "hearth" in g ? pair(g["hearth"], "glade.hearth") : { x: foot.x + 44, y: foot.y + 8 },
    levels: list(field(g, "levels", "glade"), "glade.levels", num),
    variants: num(field(g, "variants", "glade"), "glade.variants"),
    seasons: list(field(g, "seasons", "glade"), "glade.seasons", str),
    ambiances: list(field(g, "ambiances", "glade"), "glade.ambiances", str),
    loop: str(field(g, "loop", "glade"), "glade.loop"),
    near: str(field(g, "near", "glade"), "glade.near"),
    tree: str(field(g, "tree", "glade"), "glade.tree"),
    ground: num(field(g, "ground", "glade"), "glade.ground"),
    treeBoxes: new Map(Object.entries(boxes).map(([k, v]) => [k, box(v, `glade.tree_boxes.${k}`)])),
  };
  if (glade.levels.length === 0 || glade.variants < 1 || glade.seasons.length === 0)
    throw new Error("manifest: the glade has no loops");
  const e = m["effects"];
  const effects = isRecord(e)
    ? {
        aurora: str(field(e, "aurora", "effects"), "effects.aurora"),
        sky: str(field(e, "sky", "effects"), "effects.sky"),
        frames: num(field(e, "frames", "effects"), "effects.frames"),
      }
    : null;
  const known = new Set(["version", "canvas", "frame_ms", "frames", "glade", "effects"]);
  return {
    version: num(field(m, "version", "manifest"), "manifest.version"),
    width: num(field(canvas, "width", "canvas"), "canvas.width"),
    height: num(field(canvas, "height", "canvas"), "canvas.height"),
    frameMs: num(field(m, "frame_ms", "manifest"), "manifest.frame_ms"),
    frames: num(field(m, "frames", "manifest"), "manifest.frames"),
    glade,
    effects,
    other: new Map(Object.entries(m).filter(([k]) => !known.has(k))),
  };
}

/** Fills a path template; a level is always two digits, as the bundle names its files. */
export function fill(template: string, values: Readonly<Record<string, string | number>>): string {
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const v = values[name];
    if (v === undefined) return whole;
    return name === "level" && typeof v === "number" ? String(v).padStart(2, "0") : String(v);
  });
}

// ---------------------------------------------------------------------------------------------
// Which loop.

/** The light by the member's own clock: night from 20:00 to 06:00, dusk otherwise. */
export const ambianceAt = (hour: number): Ambiance => (hour >= 20 || hour < 6 ? "night" : "dusk");

/** A member's tree variant: a stable hash of who they are (their UUID; the `seed` here). */
export const variantOf = (seed: string, variants: number): number => hashString(seed) % Math.max(1, variants);

export interface GladeWant {
  level: number;
  seed: string;
  season: string;
  ambiance: Ambiance;
}

/** One glade loop: its files and its tree's box. */
export interface GladePick {
  level: number;
  variant: number;
  season: string;
  ambiance: Ambiance;
  /** `L<level>-v<variant>-<season>`, the tree's own name (the same at dusk and night). */
  tree: string;
  loopPath: string;
  treePath: string;
  nearPath: string;
  box: Box;
}

/** The loop for a member's tree: the nearest level the bundle has, their variant, the season and light. */
export function pickGlade(g: GladeManifest, want: GladeWant): GladePick {
  const level = g.levels.reduce(
    (best, l) => (Math.abs(l - want.level) < Math.abs(best - want.level) ? l : best),
    g.levels[0] ?? 1,
  );
  const variant = variantOf(want.seed, g.variants);
  const season = g.seasons.includes(want.season) ? want.season : (g.seasons[0] ?? "normal");
  const ambiance: Ambiance = g.ambiances.includes(want.ambiance) ? want.ambiance : "dusk";
  const values = { level, variant, season, ambiance };
  const tree = fill("L{level}-v{variant}-{season}", values);
  return {
    level,
    variant,
    season,
    ambiance,
    tree,
    loopPath: fill(g.loop, values),
    treePath: fill(g.tree, values),
    nearPath: fill(g.near, values),
    box: g.treeBoxes.get(tree) ?? { x: g.foot.x - 4, y: g.foot.y - 10, w: 9, h: 11 },
  };
}
