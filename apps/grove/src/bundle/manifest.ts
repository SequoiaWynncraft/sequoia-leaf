/**
 * The art bundle's manifest (`manifest.json`, written by the welcome authoring package's
 * `grove/bundle.py`), read and checked once, and the choice of a glade loop for a member's tree.
 *
 * The glade, the effects, the Campfire and the Forest are read strictly; anything newer is kept as
 * it came (`other`). A bundle from before the Campfire or the Forest had sections reads with them
 * null, and those scenes wait for one that has them.
 */

import { hashString } from "../engine/rng.ts";
import type { Ambiance } from "./palette.ts";

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** One member's tree in the bundle: a sprite at the picture's own pixel size. */
export interface TreeArt {
  /** The sprite's size. */
  w: number;
  h: number;
  /** The point of the sprite that stands on the glade's foot. */
  foot: Point;
  /** Every picture pixel the tree touches. */
  box: Box;
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
  /** The clearing's loop, by `{season}` and `{ambiance}`; its near mask, by `{season}`. */
  loop: string;
  near: string;
  /** A tree's sprite, by `{level}`, `{variant}`, `{season}` and `{ambiance}`. */
  tree: string;
  /** The front path's row, where characters stand. */
  ground: number;
  /** Where the next cone lies on the moss by the hearth. */
  cone: Point;
  /** The 1-bit mask of the stones in front of the hearth's fire, which a cone thrown in sinks behind. */
  front: string;
  /** Each tree's sprite, by `L<level>-v<variant>-<season>`. */
  trees: Map<string, TreeArt>;
}

export interface EffectsManifest {
  /** The welcome's aurora, `frames` frames stacked down one image, by `{season}`. */
  aurora: string;
  /** The open sky the aurora may light, the same size, by `{season}`. */
  sky: string;
  frames: number;
}

export interface Point {
  x: number;
  y: number;
}

/** The Campfire (grove/campfire.py): the welcome's clearing with the drawn fire ring, two seat logs, the stump and the cat. */
export interface CampfireManifest {
  /** By `{season}` and `{ambiance}`: 160 frames, as the glade's loops. */
  loop: string;
  /** The near mask, by `{season}` (the glade's own). */
  near: string;
  /** The fire's foot, where cones burn: the ring's flame origin. */
  fire: Point;
  /** Where friends sit, each a log's seat point or a standing spot (its foot row), in the bundle's order. */
  seats: Point[];
  /** The grove cat, asleep on its stump: the stump's perch, where the cat lies. */
  cat: Point;
  /** Where the spirit out of a burned cone lands, clear of every seat. */
  landing: Point;
  /** The 1-bit mask of the stones in front of the fire, which a cone thrown in sinks behind. */
  front: string;
}

/** A place on the ground, `x0` to `x1` and `y0` to `y1` (the ends past its last pixel). */
export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** The Forest's places a tap answers: the Great Sequoia, its hollow, the Swamp memorial, the pond, the stall and the sign. */
export type PlaceName = "great" | "hollow" | "swamp" | "pond" | "stall" | "farm";

/** Where a lantern hangs in the Great Sequoia: a column under its canopy, the canopy's underside there, its cord. */
export interface Hook {
  x: number;
  y: number;
  cord: number;
}

/** A crab's place on the pond's bank (No. 08's by the sign). */
export interface CrabSpot {
  x: number;
  foot: number;
  numbered: boolean;
}

/** A layer of the Forest's parallax: a layer at `depth` slides `depth` pixels for each pixel of ground. */
export interface ForestLayer {
  depth: number;
  width: number;
}

/**
 * A row of members' trees, standing on `foot`: at `scale` 1 the glade's own painted trees, and
 * behind them their outlines at `scale` of that size, as distant trees. Rows come back to front.
 */
export interface ForestRow {
  name: string;
  scale: number;
  foot: number;
}

/** A member tree's place in its row's atlas, and its foot within that box. */
export interface AtlasBox {
  x: number;
  y: number;
  w: number;
  h: number;
  footX: number;
  footY: number;
}

/** The guild's Forest (grove/forest.py): a valley in parallax layers, and its members' trees. */
export interface ForestManifest {
  /** The ground plane's size, and the Great Sequoia's centre, the crab pond's and the gate's. */
  width: number;
  height: number;
  heart: number;
  pond: number;
  gate: number;
  /** `far` (opaque: the drawn far valley and its sky), `ground` and `near`. */
  layers: { far: ForestLayer; ground: ForestLayer; near: ForestLayer };
  rows: ForestRow[];
  /** Where members' trees stand, nearest the heart first. */
  spots: { row: string; x: number }[];
  seasons: string[];
  ambiances: string[];
  /** By `{layer}`, `{season}` and `{ambiance}`. */
  layer: string;
  /** The tree atlases, by `{row}`, `{season}` and `{ambiance}`. */
  trees: string;
  /** The Great Sequoia's span on the ground layer. */
  great: { x: number; w: number };
  /** Each place's box on the ground. */
  places: Record<PlaceName, Rect>;
  /** Where lanterns hang in the Great Sequoia, nearest the heart first. */
  hooks: Hook[];
  /** Where the guild's sun pennant stands on the far ridge, in the far layer's own pixels (its pole's foot). */
  pennant: Point;
  /** Where a war win raises another pennant on the far ridge, in the far layer's own pixels. */
  ridge: Point;
  /** Where the crabs amble. */
  crabs: CrabSpot[];
  /** Each atlas's boxes, by season, then row, then `L<level>-v<variant>`. */
  index: Map<string, Map<string, Map<string, AtlasBox>>>;
}

export interface Manifest {
  version: number;
  width: number;
  height: number;
  frameMs: number;
  frames: number;
  glade: GladeManifest;
  effects: EffectsManifest | null;
  campfire: CampfireManifest | null;
  forest: ForestManifest | null;
  /** Sections this client does not read, as they came. */
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

function int(v: unknown, path: string): number {
  return Math.round(num(v, path));
}

function box(v: unknown, path: string): Box {
  const [x, y, w, h] = list(v, path, num);
  if (x === undefined || y === undefined || w === undefined || h === undefined)
    throw new Error(`manifest: ${path} is not a box`);
  return { x, y, w, h };
}

function treeArt(v: unknown, path: string): TreeArt {
  const t = rec(v, path);
  const size = pair(field(t, "size", path), `${path}.size`);
  return {
    w: size.x,
    h: size.y,
    foot: pair(field(t, "foot", path), `${path}.foot`),
    box: box(field(t, "box", path), `${path}.box`),
  };
}

export function readManifest(json: unknown): Manifest {
  const m = rec(json, "manifest");
  const canvas = rec(field(m, "canvas", "manifest"), "canvas");
  const g = rec(field(m, "glade", "manifest"), "glade");
  const trees = rec(field(g, "trees", "glade"), "glade.trees");
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
    cone: pair(field(g, "cone", "glade"), "glade.cone"),
    front: str(field(g, "front", "glade"), "glade.front"),
    trees: new Map(Object.entries(trees).map(([k, v]) => [k, treeArt(v, `glade.trees.${k}`)])),
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
  const known = new Set(["version", "canvas", "frame_ms", "frames", "glade", "effects", "campfire", "forest"]);
  return {
    version: num(field(m, "version", "manifest"), "manifest.version"),
    width: num(field(canvas, "width", "canvas"), "canvas.width"),
    height: num(field(canvas, "height", "canvas"), "canvas.height"),
    frameMs: num(field(m, "frame_ms", "manifest"), "manifest.frame_ms"),
    frames: num(field(m, "frames", "manifest"), "manifest.frames"),
    glade,
    effects,
    campfire: isRecord(m["campfire"]) ? readCampfire(m["campfire"]) : null,
    forest: isRecord(m["forest"]) ? readForest(m["forest"]) : null,
    other: new Map(Object.entries(m).filter(([k]) => !known.has(k))),
  };
}

function readCampfire(c: Record<string, unknown>): CampfireManifest {
  const seat = (v: unknown, p: string): Point => {
    const s = rec(v, p);
    return { x: int(field(s, "x", p), `${p}.x`), y: int(field(s, "y", p), `${p}.y`) };
  };
  return {
    loop: str(field(c, "loop", "campfire"), "campfire.loop"),
    near: str(field(c, "near", "campfire"), "campfire.near"),
    fire: pair(field(c, "fire", "campfire"), "campfire.fire"),
    seats: list(field(c, "seats", "campfire"), "campfire.seats", seat),
    cat: pair(field(c, "cat", "campfire"), "campfire.cat"),
    landing: pair(field(c, "landing", "campfire"), "campfire.landing"),
    front: str(field(c, "front", "campfire"), "campfire.front"),
  };
}

function readForest(f: Record<string, unknown>): ForestManifest {
  const layers = rec(field(f, "layers", "forest"), "forest.layers");
  const layer = (name: string): ForestLayer => {
    const l = rec(field(layers, name, "forest.layers"), `forest.layers.${name}`);
    const p = `forest.layers.${name}`;
    return { depth: num(field(l, "depth", p), `${p}.depth`), width: int(field(l, "width", p), `${p}.width`) };
  };
  const row = (v: unknown, p: string): ForestRow => {
    const r = rec(v, p);
    return {
      name: str(field(r, "name", p), `${p}.name`),
      scale: num(field(r, "scale", p), `${p}.scale`),
      foot: int(field(r, "foot", p), `${p}.foot`),
    };
  };
  const spot = (v: unknown, p: string): { row: string; x: number } => {
    const s = rec(v, p);
    return { row: str(field(s, "row", p), `${p}.row`), x: int(field(s, "x", p), `${p}.x`) };
  };
  const atlas = (v: unknown, p: string): AtlasBox => {
    const [x, y, w, h, footX, footY] = list(v, p, int);
    if (
      x === undefined ||
      y === undefined ||
      w === undefined ||
      h === undefined ||
      footX === undefined ||
      footY === undefined
    )
      throw new Error(`manifest: ${p} is not an atlas box`);
    return { x, y, w, h, footX, footY };
  };
  const seasons = list(field(f, "seasons", "forest"), "forest.seasons", str);
  const index = new Map<string, Map<string, Map<string, AtlasBox>>>();
  for (const season of seasons) {
    const p = `forest.index-${season}`;
    const rows = rec(field(f, `index-${season}`, "forest"), p);
    index.set(
      season,
      new Map(
        Object.entries(rows).map(([name, boxes]) => [
          name,
          new Map(Object.entries(rec(boxes, `${p}.${name}`)).map(([k, v]) => [k, atlas(v, `${p}.${name}.${k}`)])),
        ]),
      ),
    );
  }
  const great = rec(field(f, "great", "forest"), "forest.great");
  const placeBoxes = rec(field(f, "places", "forest"), "forest.places");
  const place = (name: PlaceName): Rect => {
    const p = `forest.places.${name}`;
    const [x0, y0, x1, y1] = list(field(placeBoxes, name, "forest.places"), p, int);
    if (x0 === undefined || y0 === undefined || x1 === undefined || y1 === undefined || x1 <= x0 || y1 <= y0)
      throw new Error(`manifest: ${p} is not a box`);
    return { x0, y0, x1, y1 };
  };
  const hook = (v: unknown, p: string): Hook => {
    const h = rec(v, p);
    return {
      x: int(field(h, "x", p), `${p}.x`),
      y: int(field(h, "y", p), `${p}.y`),
      cord: int(field(h, "cord", p), `${p}.cord`),
    };
  };
  const crab = (v: unknown, p: string): CrabSpot => {
    const c = rec(v, p);
    return {
      x: int(field(c, "x", p), `${p}.x`),
      foot: int(field(c, "foot", p), `${p}.foot`),
      numbered: field(c, "numbered", p) === true,
    };
  };
  const out: ForestManifest = {
    width: int(field(f, "width", "forest"), "forest.width"),
    height: int(field(f, "height", "forest"), "forest.height"),
    heart: int(field(f, "heart", "forest"), "forest.heart"),
    pond: int(field(f, "pond", "forest"), "forest.pond"),
    gate: int(field(f, "gate", "forest"), "forest.gate"),
    layers: { far: layer("far"), ground: layer("ground"), near: layer("near") },
    rows: list(field(f, "rows", "forest"), "forest.rows", row),
    spots: list(field(f, "spots", "forest"), "forest.spots", spot),
    seasons,
    ambiances: list(field(f, "ambiances", "forest"), "forest.ambiances", str),
    layer: str(field(f, "layer", "forest"), "forest.layer"),
    trees: str(field(f, "trees", "forest"), "forest.trees"),
    great: {
      x: int(field(great, "x", "forest.great"), "forest.great.x"),
      w: int(field(great, "w", "forest.great"), "forest.great.w"),
    },
    places: {
      great: place("great"),
      hollow: place("hollow"),
      swamp: place("swamp"),
      pond: place("pond"),
      stall: place("stall"),
      farm: place("farm"),
    },
    hooks: list(field(f, "hooks", "forest"), "forest.hooks", hook),
    pennant: pair(field(f, "pennant", "forest"), "forest.pennant"),
    ridge: pair(field(f, "ridge", "forest"), "forest.ridge"),
    crabs: list(field(f, "crabs", "forest"), "forest.crabs", crab),
    index,
  };
  if (out.spots.some((s) => !out.rows.some((r) => r.name === s.row)))
    throw new Error("manifest: a forest spot names no row");
  return out;
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

/** The glade for one member: the clearing's loop, their tree's sprite and where it stands. */
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
  /** Every picture pixel the tree touches. */
  box: Box;
  /** The picture pixel the sprite's top left corner goes on. */
  at: Point;
}

/** The glade for a member's tree: the nearest level the bundle has, their variant, the season and light. */
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
  const art = g.trees.get(tree);
  return {
    level,
    variant,
    season,
    ambiance,
    tree,
    loopPath: fill(g.loop, values),
    treePath: fill(g.tree, values),
    nearPath: fill(g.near, values),
    box: art?.box ?? { x: g.foot.x - 4, y: g.foot.y - 10, w: 9, h: 11 },
    at: { x: g.foot.x - (art?.foot.x ?? 0), y: g.foot.y - (art?.foot.y ?? 0) },
  };
}
