/**
 * The cast's portraits and the members' player heads as tiny PNGs for the HTML menus: drawn from
 * the same palette sprites as the scenes, through the dusk light, and scaled by whole units.
 */

import { castMember } from "../../art/cast/cast.ts";
import { buildLut } from "../../engine/palette.ts";
import type { Sprite } from "../../engine/raster.ts";
import { playerHead } from "../../scenes/forest/heads.ts";

const lut = buildLut("dusk", "normal", "#fdd36f");
const cache = new Map<string, string>();

function spriteUrl(sp: Sprite, silhouette: boolean): string {
  const canvas = document.createElement("canvas");
  canvas.width = sp.w;
  canvas.height = sp.h;
  const g = canvas.getContext("2d");
  if (!g) return "";
  const img = g.createImageData(sp.w, sp.h);
  const out = new Uint32Array(img.data.buffer);
  const table = lut.levels[0];
  for (let i = 0; i < sp.data.length; i++) {
    const v = sp.data[i] ?? 0;
    if (!v) continue;
    // An unfound spirit is a shadow with a faint violet rim of light.
    out[i] = silhouette ? 0xff221a1c : (table?.[v] ?? 0);
  }
  if (silhouette)
    for (let y = 0; y < sp.h; y++)
      for (let x = 0; x < sp.w; x++) {
        const i = y * sp.w + x;
        if (!sp.data[i]) continue;
        const above = y === 0 || !sp.data[i - sp.w];
        if (above) out[i] = 0xff4a3346;
      }
  g.putImageData(img, 0, 0);
  return canvas.toDataURL();
}

/** A spirit's 32x32 portrait, or its silhouette if you have not found it. */
export function portraitUrl(id: string, silhouette = false): string {
  const key = `${id}:${silhouette ? "s" : "p"}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const m = castMember(id);
  const url = m ? spriteUrl(m.portrait, silhouette) : "";
  cache.set(key, url);
  return url;
}

export const portrait = (id: string, scale: number, silhouette = false): string =>
  `<img class="px" alt="" src="${portraitUrl(id, silhouette)}" style="width:calc(var(--mu) * ${32 * scale});height:calc(var(--mu) * ${32 * scale})">`;

/** A spirit as it stands in the glade (its first idle drawing), one unit per pixel. */
export function figure(id: string, silhouette = false): string {
  const key = `${id}:fig:${silhouette ? "s" : "p"}`;
  let url = cache.get(key);
  const sp = castMember(id)?.idle[0]?.sprite;
  if (!sp) return "";
  if (url === undefined) {
    url = spriteUrl(sp, silhouette);
    cache.set(key, url);
  }
  return `<img class="px figure" alt="" src="${url}" style="width:calc(var(--mu) * ${sp.w});height:calc(var(--mu) * ${sp.h})">`;
}

/** A member's 8x8 player head: made up from a seed, never a real member's face. */
export function headUrl(seed: string): string {
  const key = `head:${seed}`;
  const hit = cache.get(key);
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
  cache.set(key, url);
  return url;
}

export const head = (seed: string, scale: number): string =>
  `<img class="px head" alt="" src="${headUrl(seed)}" style="width:calc(var(--mu) * ${8 * scale});height:calc(var(--mu) * ${8 * scale})">`;
