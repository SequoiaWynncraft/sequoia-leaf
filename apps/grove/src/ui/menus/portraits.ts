/**
 * The cast's portraits and the members' player heads for the HTML menus. A spirit is its idle
 * frame from the bundle's cast sheets (`cast/`), painted into a canvas at its own pixels and scaled
 * by whole menu units: the menus write a placeholder (`portrait`, `figure`) and `mountCast` paints
 * each once the sheet and the strip are in. An unfound spirit is its shadow with a faint violet rim
 * of light along its top.
 */

import type { Art } from "../../bundle/art.ts";
import type { CastSheet } from "../../bundle/cast.ts";
import { playerHead } from "../../scenes/forest/heads.ts";

/** The square a portrait sits in, in art pixels: the widest of the cast fits it. */
const BOX = 32;

/** A spirit's portrait in a 32-pixel square, at `scale` menu units a pixel, or its silhouette. */
export const portrait = (id: string, scale: number, silhouette = false): string =>
  `<canvas class="px cast" data-cast="${id}" data-box="${BOX}"${silhouette ? " data-sil" : ""} width="${BOX}" height="${BOX}" style="width:calc(var(--mu) * ${BOX * scale});height:calc(var(--mu) * ${BOX * scale})" aria-hidden="true"></canvas>`;

/** A spirit as it stands in the glade, one menu unit a pixel, its canvas as big as its frame. */
export const figure = (id: string, silhouette = false): string =>
  `<canvas class="px cast figure" data-cast="${id}"${silhouette ? " data-sil" : ""} width="1" height="1" aria-hidden="true"></canvas>`;

/** Paints every cast placeholder under `root` once its strip is in. */
export function mountCast(root: HTMLElement, art: Art): void {
  const canvases = [...root.querySelectorAll<HTMLCanvasElement>("canvas[data-cast]")];
  if (canvases.length > 0)
    void art.cast.promise.then((sheet) => (sheet ? Promise.all(canvases.map((el) => paint(el, sheet))) : []));
}

async function paint(el: HTMLCanvasElement, sheet: CastSheet): Promise<void> {
  const id = el.dataset["cast"] ?? "";
  if (!(await sheet.load(id))) return;
  const f = sheet.portrait(id);
  const g = el.getContext("2d");
  if (!f || !g) return;
  const box = Number(el.dataset["box"] ?? 0);
  const w = box || f.w;
  const h = box || f.h;
  if (!box) {
    el.style.width = `calc(var(--mu) * ${w})`;
    el.style.height = `calc(var(--mu) * ${h})`;
  }
  el.width = w;
  el.height = h;
  const img = g.createImageData(w, h);
  const out = new Uint32Array(img.data.buffer);
  const ox = Math.floor((w - f.w) / 2);
  const oy = Math.floor((h - f.h) / 2);
  const silhouette = el.dataset["sil"] !== undefined;
  const at = (x: number, y: number): number =>
    x >= 0 && y >= 0 && x < f.w && y < f.h ? (f.strip.data[y * f.strip.w + f.index * f.w + x] ?? 0) : 0;
  const solid = (x: number, y: number): boolean => at(x, y) >>> 24 >= 128;
  for (let y = 0; y < f.h; y++)
    for (let x = 0; x < f.w; x++) {
      if (!solid(x, y)) continue;
      const rim = silhouette && !solid(x, y - 1);
      out[(oy + y) * w + ox + x] = silhouette ? (rim ? 0xff4a3346 : 0xff221a1c) : (at(x, y) | 0xff000000) >>> 0;
    }
  g.putImageData(img, 0, 0);
}

/** A member's 8x8 player head: made up from a seed, never a real member's face. */
export function headUrl(seed: string): string {
  const key = `head:${seed}`;
  const hit = heads.get(key);
  if (hit !== undefined) return hit;
  const canvas = document.createElement("canvas");
  canvas.width = 8;
  canvas.height = 8;
  const g = canvas.getContext("2d");
  if (!g) return "";
  playerHead(seed).forEach((c, i) => {
    g.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`;
    g.fillRect(i % 8, Math.floor(i / 8), 1, 1);
  });
  const url = canvas.toDataURL();
  heads.set(key, url);
  return url;
}
const heads = new Map<string, string>();

export const head = (seed: string, scale: number): string =>
  `<img class="px head" alt="" src="${headUrl(seed)}" style="width:calc(var(--mu) * ${8 * scale});height:calc(var(--mu) * ${8 * scale})">`;
