/**
 * The Grove's stage: one clearing at the edge of town, drawn the way the town is drawn (its sunset,
 * its far trees, its great trunks, its lantern posts), in three lights: day for a filler prize, dusk
 * for a mid-tier one, night for a top one. A scene pixel is two of the picture's art pixels, so the
 * stage is handed over already doubled.
 *
 * It is composed for a frame, and goes on round it as far as the window does: more far trees, sky
 * and ground to either side, and the canopy and the great trunks above.
 */

import { CREAM, EARTH, GOLD, GREEN, INK, SKY } from "@sequoia-leaf/kit/palette.ts";
import { rgb } from "@sequoia-leaf/kit/pix.ts";
import { clamp, hash, makeCanvas, vnoise } from "@sequoia-leaf/kit/util.ts";

import { DEEP, drawFern, paintTrunk } from "./ground.ts";
import { at, type Sprite, type Sprites } from "./sprites.ts";
export type Light = "day" | "dusk" | "night";
type Pt = [number, number];

export interface Stage {
  /** The whole picture in each light, in the screen's art pixels. Every place below is counted from the frame's corner. */
  pic: Record<Light, HTMLCanvasElement>;
  /** White where the sky shows, and white along the tops of whatever stands against it. */
  sky: HTMLCanvasElement;
  rim: HTMLCanvasElement;
  horizon: number;
  lanterns: Pt[];
  /** Ten dark places up among the trees, left to right. */
  perches: Pt[];
  stars: [number, number, number][];
  /** A spot on the path, where a drop of light can land. */
  root: Pt;
}

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const dither = (x: number, y: number): number => ((BAYER[(y & 3) * 4 + (x & 3)] ?? 0) + 0.5) / 16;
const STOPS = [0, 0.3, 0.47, 0.6, 0.73, 0.85, 0.94, 1.2];

/** Over the frame the canopy goes on in hanging rows of boughs: how many hang lower than a pixel, and the shade of each row in turn. */
const boughs = (x: number, y: number): number => {
  let k = 0;
  while (y < -4 - k * 22 - vnoise(x / 34, k, 64) * 16 - vnoise(x / 9, k, 65) * 9 - vnoise(x / 3, y / 3, 66) * 4) k++;
  return k;
};
const BOUGHS = [SKY[0], "#22132a", INK, "#22132a"] as const;

/**
 * The frame is `w` by `h` scene pixels, and the picture has `side` more columns to either side of it
 * and `up` more rows above; the path runs from the gap in the far trees down to `standX` at the near edge.
 */
export function buildStage(s: Sprites, w: number, h: number, standX: number, side: number, up: number): Stage {
  const wide = w > h;
  const fw = w + side * 2;
  const fh = h + up;
  const horizon = Math.round(h * (wide ? 0.7 : 0.72));
  const sunX = Math.round(w / 2);

  // ---- what stands against the sky: 0 nothing, 1 the farthest trees, 2 nearer ones
  const farTrunk = (x: number, y: number, spacing: number, thin: number, fat: number, seed: number): boolean => {
    const flare = Math.max(0, y - (horizon - 12)) * 0.4;
    for (let k = Math.floor(x / spacing) - 1; k <= Math.floor(x / spacing) + 1; k++) {
      if (hash(k, seed, 61) < 0.18) continue;
      const cx = k * spacing + hash(k, seed, 62) * spacing * 0.6;
      if (Math.abs(x - cx) < (thin + hash(k, seed, 63) * (fat - thin)) / 2 + flare) return true;
    }
    return false;
  };
  const far = (x: number, y: number): 0 | 1 | 2 => {
    const canopy =
      horizon * 0.08 +
      vnoise(x / 34, 0, 64) * horizon * 0.17 +
      vnoise(x / 9, 1, 65) * 12 +
      vnoise(x / 3, y / 3, 66) * 5;
    if (y < canopy) return 2;
    const open = Math.abs(x - sunX) < 26;
    if (!open && farTrunk(x, y, 58, 13, 24, 2)) return 2;
    if (y < canopy + 11 + vnoise(x / 6, 2, 67) * 9) return 1;
    if (!open && y > horizon - 5 - vnoise(x / 44, 4, 68) * 9) return 1;
    if (!open && farTrunk(x, y, 37, 6, 12, 1)) return 1;
    return 0;
  };
  const band = (x: number, y: number, lift: number): number => {
    const v = y / horizon + lift;
    let b = 0;
    while (b < STOPS.length - 2 && v >= (STOPS[b + 1] ?? 9)) b++;
    const t = (v - (STOPS[b] ?? 0)) / ((STOPS[b + 1] ?? 1) - (STOPS[b] ?? 0));
    return t > 0.55 && dither(x, y) < (t - 0.55) / 0.45 ? b + 1 : b;
  };
  const skyAt = (x: number, y: number, light: Light): string => {
    if (y < 0) return at(BOUGHS, light === "night" ? 2 + (boughs(x, y) % 2) : boughs(x, y) % 4);
    const f = far(x, y);
    if (light === "night")
      return f === 2
        ? INK
        : f === 1
          ? "#22132a"
          : at(SKY, Math.min(2, Math.floor((y / horizon) * 2.5 + dither(x, y) * 0.6)));
    if (f) return at(SKY, (light === "day" ? 0 : -1) + f - (f === 2 ? 2 : 0));
    const sun = Math.hypot(x - sunX, (y - horizon) * 1.05);
    if (light === "dusk") return at(SKY, band(x, y, Math.max(0, 1 - sun / 90) * 0.12) - 2);
    if (sun < 13) return CREAM;
    if (sun < 21) return GOLD[2];
    return at(SKY, band(x, y, Math.max(0, 1 - sun / 110) * 0.16));
  };

  // ---- the land this side of the far trees: the floor, the great trunks, and what stands on it
  const land = makeCanvas(fw, fh);
  land.g.translate(side, up);
  const D = h - horizon;
  const pathX = (d: number): number => sunX + (standX - sunX) * (d / D) ** 1.3;
  const floor = land.g.createImageData(fw, D);
  for (let d = 0; d < D; d++)
    for (let x = -side; x < w + side; x++) {
      const y = horizon + d;
      const off = Math.abs(x - pathX(d));
      const half = 5 + d * (wide ? 1.0 : 0.75);
      let col: string;
      if (off < half) {
        if (d < 1) col = CREAM;
        else if (d < 3) col = GOLD[1];
        else if (off > half - 1.6) col = EARTH[0];
        else col = hash(x >> 1, y, 43) > 0.992 ? EARTH[0] : vnoise(x / 15, y / 4, 41) > 0.62 ? EARTH[2] : EARTH[1];
      } else if (d < 3) col = at(DEEP, d / 2 + hash(x >> 1, y, 71) * 0.8);
      else {
        const n = vnoise(x / 34, y / 6, 3);
        let idx = n > 0.7 ? 3 : n < 0.27 ? 1 : 2;
        if (Math.min(x, w - x) < 8 + vnoise(x / 26, y / 9, 8) * 40) idx -= 1;
        if (d < 7 || off < half + 1.6) idx -= 1;
        idx = clamp(idx, 0, 3);
        const gx = Math.floor(x / 13);
        const gy = Math.floor(y / 5);
        const dx = x - (gx * 13 + 1 + Math.floor(hash(gx, gy, 32) * 9));
        const dy = y - (gy * 5 + 1 + Math.floor(hash(gx, gy, 33) * 3));
        if (hash(gx, gy, 31) > 0.62 && dy === 0 && (dx === 0 || dx === 2)) idx -= 1;
        if (hash(gx, gy, 31) > 0.62 && dy === -1 && dx === 1) idx += 1;
        col = at(GREEN, idx);
      }
      const [r, gg, b] = rgb(col);
      floor.data.set([r, gg, b, 255], (d * fw + x + side) * 4);
    }
  land.g.putImageData(floor, 0, horizon + up);

  const things: { c: HTMLCanvasElement; x: number; y: number }[] = [];
  const stand = (sp: Sprite | undefined, x: number, y: number): void => {
    if (sp) things.push({ c: sp.c, x: Math.round(x) - sp.ax, y: Math.round(y) - sp.ay });
  };
  const trunk = (hw: number, x: number, y: number, seed: number): void => {
    const t = paintTrunk(hw, y + 8, seed, 70, up);
    things.push({ c: t.c, x: Math.round(x) - t.ax, y: y - t.ay });
  };
  trunk(wide ? 20 : 15, wide ? w * 0.045 : 2, horizon + 17, 3);
  trunk(wide ? 30 : 20, w - (wide ? 4 : 0), h - 6, 8);
  const posts: Pt[] = [
    [sunX - (wide ? 46 : 38), horizon + 9],
    [sunX + (wide ? 54 : 40), horizon + 21],
  ];
  for (const [x, y] of posts) stand(s.post, x, y);
  if (wide) stand(s.tree, w * 0.79, horizon + 9);
  stand(s.bushes[0], w * 0.2, horizon + 6);
  stand(s.bushes[1], w * 0.63, horizon + 5);
  stand(s.bushes[2], wide ? w * 0.37 : w * 0.8, horizon + 7);
  stand(s.ferns[0], wide ? w * 0.13 : 20, horizon + 20);
  stand(s.ferns[1], w * 0.9, h - 12);
  stand(s.mushroom, wide ? w * 0.11 : 24, horizon + 26);
  stand(s.flowers[0], sunX - 22, horizon + 14);
  stand(s.flowers[1], sunX + 30, horizon + 30);
  stand(s.rocks[0], w * 0.7, horizon + 26);
  things.sort((a, b) => a.y + a.c.height - (b.y + b.c.height));
  for (const t of things) land.g.drawImage(t.c, t.x, t.y);
  // The dark ferns of the near edge, in the corners.
  for (const [x, size] of [
    [6, 24],
    [26, 17],
    [w - 30, 20],
    [w - 52, 15],
  ] as const)
    drawFern(land.g, x, h + 3, size, [DEEP[1], DEEP[2]], 100 + x);

  // ---- the three lights
  const landPx = land.g.getImageData(0, 0, fw, fh).data;
  const at4 = (x: number, y: number): number => ((y + up) * fw + x + side) * 4;
  const covered = (x: number, y: number): boolean => (landPx[at4(x, y) + 3] ?? 0) > 0;
  const isSky = (x: number, y: number): boolean =>
    y >= 0 && y < horizon && x < w + side && !covered(x, y) && far(x, y) === 0;
  const ink = rgb(INK);
  const plum = rgb(SKY[0]);
  const doubled = (d: ImageData): HTMLCanvasElement => {
    const a = makeCanvas(fw, fh);
    a.g.putImageData(d, 0, 0);
    const b = makeCanvas(fw * 2, fh * 2);
    b.g.drawImage(a.c, 0, 0, fw * 2, fh * 2);
    return b.c;
  };
  const picture = (light: Light): HTMLCanvasElement => {
    const d = new ImageData(fw, fh);
    for (let y = -up; y < h; y++)
      for (let x = -side; x < w + side; x++) {
        const i = at4(x, y);
        let c: readonly [number, number, number];
        if (!covered(x, y)) c = rgb(skyAt(x, Math.min(y, horizon - 1), light));
        else {
          const r = landPx[i] ?? 0;
          const gg = landPx[i + 1] ?? 0;
          const b = landPx[i + 2] ?? 0;
          if (light === "day") c = [r, gg, b];
          else if (light === "dusk") c = [(r + plum[0]) / 2, (gg + plum[1]) / 2, (b + plum[2]) / 2];
          else {
            // At night the land is three dark tones, by how bright it was.
            const lum = 0.3 * r + 0.55 * gg + 0.15 * b;
            c = lum < 62 ? ink : lum < 104 ? [34, 19, 42] : plum;
          }
        }
        d.data.set([c[0], c[1], c[2], 255], i);
      }
    return doubled(d);
  };
  const white = (on: (x: number, y: number) => boolean): HTMLCanvasElement => {
    const d = new ImageData(fw, fh);
    for (let y = 0; y < h; y++)
      for (let x = -side; x < w + side; x++) if (on(x, y)) d.data.set([255, 255, 255, 255], at4(x, y));
    return doubled(d);
  };

  // Seventy stars over the frame, and as many to the same width of sky beside it.
  const stars: [number, number, number][] = [];
  for (const [x0, span, seed] of [
    [0, w, 77],
    [-side, side, 78],
    [w, side, 79],
  ] as const) {
    const most = stars.length + Math.round((70 * span) / w);
    for (let k = 0; stars.length < most && k < 9000; k++) {
      const x = x0 + Math.floor(hash(k, 1, seed) * span);
      const y = Math.floor(hash(k, 2, seed) * horizon * 0.8);
      if (isSky(x, y) && isSky(x, y + 2) && isSky(x + 1, y)) stars.push([x * 2, y * 2, hash(k, 3, seed)]);
    }
  }
  // One perch to each tenth of the width, so the lights spread right across.
  const perches: Pt[] = [];
  for (let i = 0; i < 10; i++)
    for (let k = 0; k < 400; k++) {
      const x = clamp(Math.floor(((i + hash(k, i, 63)) * w) / 10), 5, w - 6);
      const y = 5 + Math.floor(hash(k, i + 20, 63) * horizon * 0.6);
      let dark = true;
      for (let dy = -3; dy <= 3 && dark; dy++)
        for (let dx = -3; dx <= 3 && dark; dx++) if (isSky(x + dx, y + dy)) dark = false;
      if (!dark) continue;
      perches.push([x * 2, y * 2]);
      break;
    }

  return {
    pic: { day: picture("day"), dusk: picture("dusk"), night: picture("night") },
    sky: white(isSky),
    rim: white((x, y) => y > 0 && y <= horizon && !isSky(x, y) && isSky(x, y - 1)),
    horizon: horizon * 2,
    lanterns: posts.map(([x, y]) => [(x + 7) * 2, (y - 25) * 2]),
    perches,
    stars,
    root: [Math.round(pathX(24)) * 2, (horizon + 24) * 2],
  };
}
