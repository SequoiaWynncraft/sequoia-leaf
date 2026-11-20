/**
 * Pixel art inside the menus, painted into canvases after the HTML is in place so each is exactly
 * as many art pixels wide as its box holds at the menu's unit, and scaled by that whole unit:
 * the raid banner's canyon at dusk, and the cross-section of your tree's rings.
 */

import { bayer } from "../../engine/dither.ts";
import { hash3 } from "../../engine/rng.ts";

type Paint = (g: CanvasRenderingContext2D, W: number, H: number, el: HTMLCanvasElement) => void;

/** Fills every `canvas[data-art]` under `root`: `data-h` art rows tall and as wide as it can be. */
export function mountArt(root: HTMLElement, unit: number): void {
  for (const el of root.querySelectorAll<HTMLCanvasElement>("canvas[data-art]")) {
    const paint = PAINTERS[el.dataset["art"] ?? ""];
    const box = el.parentElement;
    if (!paint || !box) continue;
    const fixedW = Number(el.dataset["w"] ?? 0);
    const H = Number(el.dataset["h"] ?? 40);
    let scale = Number(el.dataset["scale"] ?? 1);
    // A fixed-size picture steps down a whole scale rather than overflow a narrow box.
    if (el.dataset["fit"] !== undefined && el.dataset["w"]) {
      el.style.width = "0px";
      while (scale > 1 && Number(el.dataset["w"]) * scale * unit > (box.clientWidth || Infinity)) scale--;
    }
    // Measure the box without the canvas in it, so the canvas never widens the box it fills.
    el.style.width = "0px";
    const W = fixedW || Math.max(40, Math.floor(box.clientWidth / (unit * scale)));
    el.width = W;
    el.height = H;
    el.style.width = `${W * unit * scale}px`;
    el.style.height = `${H * unit * scale}px`;
    const g = el.getContext("2d");
    if (g) paint(g, W, H, el);
  }
}

const px = (g: CanvasRenderingContext2D, x: number, y: number, colour: string): void => {
  g.fillStyle = colour;
  g.fillRect(x, y, 1, 1);
};

/** The Canyon Colossus at dusk: banded sky, a low sun, three stepped mesas fading into haze. */
const banner: Paint = (g, W, H) => {
  const sky = ["#3a1f52", "#5a296e", "#7a348a", "#a24768", "#d06170", "#e67967", "#f5b95e"];
  for (let y = 0; y < H; y++) {
    const u = (y / (H * 0.78)) * (sky.length - 1);
    for (let x = 0; x < W; x++) {
      const k = Math.min(sky.length - 1, Math.floor(u + bayer(x, y) * 0.9));
      px(g, x, y, sky[k] ?? "#000");
    }
  }
  // Streaked clouds, as the welcome scenes draw them.
  for (let i = 0; i < 6; i++) {
    const cy = Math.round(H * (0.12 + 0.36 * hash3(i, 2, 7)));
    const cx = Math.round(W * hash3(i, 1, 7));
    const len = 10 + Math.round(hash3(i, 3, 7) * W * 0.18);
    g.fillStyle = cy < H * 0.3 ? "#86388e" : "#ee965f";
    g.fillRect(cx, cy, len, 1);
    g.fillRect(cx + 4, cy + 1, Math.max(2, len - 9), 1);
  }
  // The sun, low over the canyon's far rim.
  const sx = Math.round(W * 0.7);
  const sy = Math.round(H * 0.5);
  for (let y = -6; y <= 6; y++)
    for (let x = -6; x <= 6; x++) {
      const d = Math.hypot(x, y);
      if (d < 5.6) px(g, sx + x, sy + y, d < 4 ? "#fff1c0" : "#ffd98a");
    }
  const layers: [string, string, number, number][] = [
    ["#9a4c8c", "#b85a7e", 0.5, 1],
    ["#663478", "#843f86", 0.64, 2],
    ["#331c42", "#472755", 0.8, 3],
  ];
  for (const [fill, rim, base, seed] of layers) {
    let x = 0;
    while (x < W) {
      const w = 6 + Math.floor(hash3(x, seed, 11) * 22);
      const top = Math.round(H * base - hash3(x, seed, 12) * H * 0.16);
      for (let xx = x; xx < Math.min(W, x + w); xx++) {
        // Mesas: flat tops with a stepped shoulder at each end.
        const edge = Math.min(xx - x, x + w - 1 - xx);
        const yTop = top + (edge === 0 ? 2 : edge === 1 ? 1 : 0);
        for (let y = yTop; y < H; y++) px(g, xx, y, y === yTop ? rim : fill);
      }
      x += w;
    }
  }
};

/** How far a point is from the heart, in rings: 1 is the bark. The wood's own wobble, not a circle. */
export function ringBand(x: number, y: number): number {
  const dx = (x - 48) / 45;
  const dy = (y - 34) / 28;
  const a = Math.atan2(dy, dx);
  return (
    Math.hypot(dx, dy) * (1 + 0.055 * Math.sin(3 * a + 0.6) + 0.023 * Math.cos(7 * a - 0.8) + 0.017 * Math.sin(5 * a))
  );
}

/** The tree's cross-section: five seasons of rings, the last gilded, the bark and its shadow. */
const rings: Paint = (g, W, H, el) => {
  const picked = Number(el.dataset["pick"] ?? -1);
  const colours = ["#bc8558", "#c58b5b", "#cc9364", "#d6a474", "#e6b75e"];
  const wash = ["#b57d53", "#ba8054", "#be895b", "#c79a67", "#d6a656"];
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const d = ringBand(x, y);
      const below = ringBand(x, y - 5);
      if (d > 1) {
        if (below <= 1) px(g, x, y, x % 7 < 2 ? "#57353a" : "#854831");
        continue;
      }
      const i = Math.min(4, Math.floor(d * 5));
      const f = d * 5 - i;
      const grain = Math.sin(x * 0.53 + y * 0.75) + Math.sin(x * 0.8 - y * 0.14);
      const washed = grain > 1.6 && (x + 3 * y) % 5 < 3;
      let c =
        f > 0.81
          ? i === 4
            ? "#805430"
            : "#915b42"
          : f < 0.16
            ? i === 4
              ? "#ffe69a"
              : "#e2ae76"
            : washed
              ? (wash[i] ?? "#000")
              : (colours[i] ?? "#000");
      // The picked season's ring catches the light.
      if (i === picked && f >= 0.16 && f <= 0.81) c = i === 4 ? "#f6d58a" : "#e9bd86";
      px(g, x, y, c);
    }
};

const PAINTERS: Record<string, Paint> = { banner, rings };
