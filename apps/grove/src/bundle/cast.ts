/**
 * Sprite sheets in the bundle's one format: the cast (`cast/cast.json`, from the welcome authoring
 * package's `grove/cast`: the spirits, the gnome herald and Cinfy) and the props (`props/props.json`,
 * `grove/props.py`: the cone, the drop of raid water, the lanterns, the pennant), drawn as the
 * welcome draws its characters and small things. Each has one frame box (`w` by `h`) with its
 * ground contact at `foot`, and named animations, each a list of strip frames shown `ms` apiece.
 * Its strips, in the sheet's folder:
 *
 *   <id>.png  <id>-night.png  [<id>-winter.png  <id>-winter-night.png]
 *
 * one row of frames each, the night strips already moonlit and the winter ones (when it has a
 * winter look) lined up frame for frame with the normal ones. A strip loads the first time a scene
 * asks for it.
 */

import type { Handle, Pixels } from "./art.ts";
import type { Ambiance } from "./palette.ts";

export interface Anim {
  frames: number[];
  ms: number;
}

export interface CastEntry {
  id: string;
  w: number;
  h: number;
  foot: { x: number; y: number };
  anims: Map<string, Anim>;
  winter: boolean;
}

/** One frame of a strip, ready to draw: its pixels and where its foot is. */
export interface CastFrame {
  strip: Pixels;
  index: number;
  w: number;
  h: number;
  foot: { x: number; y: number };
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function readEntry(id: string, v: unknown): CastEntry | null {
  if (!isRecord(v)) return null;
  const { w, h, foot, anims, winter } = v;
  if (!isNum(w) || !isNum(h) || !isRecord(anims)) return null;
  const f = Array.isArray(foot) ? foot : isRecord(foot) ? [foot["x"], foot["y"]] : [];
  const [fx, fy] = f;
  if (!isNum(fx) || !isNum(fy)) return null;
  const table = new Map<string, Anim>();
  for (const [name, a] of Object.entries(anims)) {
    if (!isRecord(a)) continue;
    const frames = Array.isArray(a["frames"]) ? a["frames"].filter(isNum) : [];
    const ms = a["ms"];
    if (frames.length > 0) table.set(name, { frames, ms: isNum(ms) && ms > 0 ? ms : 100 });
  }
  return { id, w, h, foot: { x: fx, y: fy }, anims: table, winter: winter === true };
}

/** Reads a sheet index (`cast.json`, `props.json`) in folder `dir`: the table itself or `{ cast: table }`. */
export function readCast(json: unknown, dir: string, image: (path: string) => Handle<Pixels>): CastSheet {
  const root = isRecord(json) && isRecord(json["cast"]) ? json["cast"] : json;
  const entries = new Map<string, CastEntry>();
  if (isRecord(root))
    for (const [id, v] of Object.entries(root)) {
      const e = readEntry(id, v);
      if (e) entries.set(id, e);
    }
  return new CastSheet(entries, dir, image);
}

export class CastSheet {
  readonly entries: ReadonlyMap<string, CastEntry>;
  private readonly dir: string;
  private readonly image: (path: string) => Handle<Pixels>;

  constructor(entries: ReadonlyMap<string, CastEntry>, dir: string, image: (path: string) => Handle<Pixels>) {
    this.entries = entries;
    this.dir = dir;
    this.image = image;
  }

  has(id: string): boolean {
    return this.entries.has(id);
  }

  /** The first of `ids` the sheets have. */
  find(...ids: string[]): string | null {
    return ids.find((id) => this.entries.has(id)) ?? null;
  }

  /**
   * The frame of `anim` (or the member's first animation) `ms` into it, in the season and light;
   * null while its strip is loading.
   */
  frame(id: string, anim: string, ms: number, season: string, ambiance: Ambiance): CastFrame | null {
    const e = this.entries.get(id);
    if (!e) return null;
    const a = e.anims.get(anim) ?? e.anims.values().next().value;
    if (!a) return null;
    const step = Math.floor(Math.max(0, ms) / a.ms) % a.frames.length;
    const index = a.frames[step] ?? 0;
    const winter = season === "winter" && e.winter ? "-winter" : "";
    const night = ambiance === "night" ? "-night" : "";
    const strip = this.image(`${this.dir}/${id}${winter}${night}.png`).value;
    return strip ? { strip, index, w: e.w, h: e.h, foot: e.foot } : null;
  }

  /** A member's strip, once it has loaded (for a picture painted once, as the menus' portraits are). */
  async load(id: string, season = "normal", ambiance: Ambiance = "dusk"): Promise<Pixels | null> {
    const e = this.entries.get(id);
    if (!e) return null;
    const winter = season === "winter" && e.winter ? "-winter" : "";
    const night = ambiance === "night" ? "-night" : "";
    return this.image(`${this.dir}/${id}${winter}${night}.png`).promise;
  }

  /** A member as the cards and menus show them: the first frame of their idle, at dusk. */
  portrait(id: string): CastFrame | null {
    return this.frame(id, "idle", 0, "normal", "dusk");
  }

  /** How long one pass of `anim` takes, in ms. */
  length(id: string, anim: string): number {
    const a = this.entries.get(id)?.anims.get(anim);
    return a ? a.frames.length * a.ms : 0;
  }
}
