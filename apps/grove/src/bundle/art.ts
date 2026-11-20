/**
 * The art bundle, fetched from a base URL: `grove-art/` beside the page (where `bun run art` puts a
 * copy), or whatever `?art=` says. Everything arrives as a `Handle`, which the frame loop reads
 * without waiting: its `value` is null until the asset is ready.
 *
 * - Loops (`Loop`) decode lazily: the first frame as soon as the bytes are in, the rest in the
 *   time each frame leaves over (`idle`). Only the loops a scene says it uses (`keep`) stay cached.
 * - Masks (1-bit PNGs) become `Mask`s: a bit per pixel and the list of pixels that are set.
 * - Images (the cast's and props' strips, the aurora) become packed RGBA `Pixels`.
 *
 * The scenes that move onto bundles next (the forest, the campfire) read their sections of the
 * manifest (`manifest.other`) and fetch their layers through the same handles.
 */

import { type CastSheet, readCast } from "./cast.ts";
import { Loop } from "./loop.ts";
import { type Manifest, readManifest } from "./manifest.ts";

export class Handle<T> {
  value: T | null = null;
  error: unknown = null;
  readonly promise: Promise<T | null>;

  constructor(load: () => Promise<T>) {
    this.promise = load().then(
      (v) => {
        this.value = v;
        return v;
      },
      (e: unknown) => {
        this.error = e;
        console.warn("grove art:", e);
        return null;
      },
    );
  }
}

/** Packed RGBA pixels (`0xAABBGGRR`). */
export interface Pixels {
  w: number;
  h: number;
  data: Uint32Array;
}

/** A 1-bit mask: `bits[y * w + x]` is 1 where it is set; `set` lists those pixels. */
export interface Mask {
  w: number;
  h: number;
  bits: Uint8Array;
  set: Uint32Array;
}

export function maskOf(p: Pixels): Mask {
  const bits = new Uint8Array(p.w * p.h);
  let n = 0;
  for (let i = 0; i < bits.length; i++) {
    // White is set: any channel past half.
    if (((p.data[i] ?? 0) & 0xff) > 127) {
      bits[i] = 1;
      n++;
    }
  }
  const set = new Uint32Array(n);
  let k = 0;
  for (let i = 0; i < bits.length; i++) if (bits[i]) set[k++] = i;
  return { w: p.w, h: p.h, bits, set };
}

/** Where the bundle is: `?art=` or `grove-art/` beside the page. */
export function artBase(search: string, page: string): URL {
  const given = new URLSearchParams(search).get("art");
  const base = new URL(given || "grove-art/", page);
  if (!base.pathname.endsWith("/")) base.pathname += "/";
  return base;
}

async function fetchOk(url: URL): Promise<Response> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url.pathname}: ${r.status}`);
  return r;
}

/** Decodes an image file to its exact pixels, with no colour management. */
async function decodeImage(url: URL): Promise<Pixels> {
  const blob = await (await fetchOk(url)).blob();
  const bitmap = await createImageBitmap(blob, { premultiplyAlpha: "none", colorSpaceConversion: "none" });
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const g = canvas.getContext("2d", { willReadFrequently: true });
  if (!g) throw new Error("no 2d context");
  g.drawImage(bitmap, 0, 0);
  bitmap.close();
  const img = g.getImageData(0, 0, canvas.width, canvas.height);
  return { w: img.width, h: img.height, data: new Uint32Array(img.data.buffer) };
}

const now = (): number => performance.now();

export class Art {
  readonly base: URL;
  readonly manifest: Handle<Manifest>;
  /** The cast's sheets and the props', or null when the bundle has none. */
  readonly cast: Handle<CastSheet | null>;
  readonly props: Handle<CastSheet | null>;
  private readonly loops = new Map<string, Handle<Loop>>();
  private readonly masks = new Map<string, Handle<Mask>>();
  private readonly images = new Map<string, Handle<Pixels>>();
  private kept = new Set<string>();

  constructor(base: URL) {
    this.base = base;
    this.manifest = new Handle(async () => readManifest(await (await fetchOk(this.url("manifest.json"))).json()));
    this.cast = this.sheet("cast", "cast.json");
    this.props = this.sheet("props", "props.json");
  }

  private sheet(dir: string, index: string): Handle<CastSheet | null> {
    return new Handle(async () => {
      const r = await fetch(this.url(`${dir}/${index}`));
      return r.ok ? readCast(await r.json(), dir, (path) => this.image(path)) : null;
    });
  }

  url(path: string): URL {
    return new URL(path, this.base);
  }

  /** A loop, fetched once and kept while some scene keeps it. */
  loop(path: string): Handle<Loop> {
    let h = this.loops.get(path);
    if (!h) {
      h = new Handle(async () => Loop.fromBytes(await (await fetchOk(this.url(path))).bytes()));
      this.loops.set(path, h);
    }
    return h;
  }

  /** The loops in use; every other loop is let go. */
  keep(paths: readonly string[]): void {
    this.kept = new Set(paths);
    for (const p of this.loops.keys()) if (!this.kept.has(p)) this.loops.delete(p);
  }

  mask(path: string): Handle<Mask> {
    let h = this.masks.get(path);
    if (!h) {
      h = new Handle(async () => maskOf(await decodeImage(this.url(path))));
      this.masks.set(path, h);
    }
    return h;
  }

  image(path: string): Handle<Pixels> {
    let h = this.images.get(path);
    if (!h) {
      h = new Handle(() => decodeImage(this.url(path)));
      this.images.set(path, h);
    }
    return h;
  }

  /** Lets go of a large image (the aurora) once its moment is over. */
  drop(path: string): void {
    this.images.delete(path);
  }

  /** Decodes ahead in the loops in use until `deadline` (performance.now() time). */
  idle(deadline: number): void {
    for (const p of this.kept) {
      const loop = this.loops.get(p)?.value;
      if (loop && !loop.ahead(deadline, now)) return;
    }
  }
}
