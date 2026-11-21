/**
 * Who holds what, as a see-through layer over the map: the guild's lands lit and edged in gold, the
 * wilds dimmed, the rival's reddened. When a land changes hands the new colour spreads across it
 * from a point, and only that land's corner of the layer is repainted while it does.
 */
import { makeCanvas } from "./pix.ts";
import type { Box, Terrain } from "./terrain.ts";
import { H, LANDS, type Owner, W } from "./world.ts";

export type Spread = { land: number; ox: number; oy: number; r: number; to: Owner; max: number };

/** Tint, edge line and inner glow for each holder, as [r, g, b, alpha 0..255]. */
const TINT = [
  [255, 214, 140, 16],
  [26, 15, 30, 92],
  [112, 20, 42, 108],
] as const;
const LINE = [
  [255, 222, 150, 240],
  [176, 170, 184, 120],
  [244, 120, 104, 235],
] as const;
const BAND = [
  [245, 185, 94, 112],
  [0, 0, 0, 0],
  [232, 92, 84, 112],
] as const;

export type Lands = ReturnType<typeof makeLands>;

export function makeLands(t: Terrain) {
  const [canvas, g] = makeCanvas(W, H);
  const img = g.createImageData(W, H);
  const data = img.data;
  const owner: Owner[] = LANDS.map((l) => l.owner);
  const spreads: Spread[] = [];
  const { landId } = t;

  // How far each pixel is from the nearest border between two lands, up to 8: most are far, and skip the work.
  const near = new Uint8Array(W * H).fill(9);
  for (let y = 1; y < H - 1; y++)
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      const id = landId[i] as number;
      if (id === 255) continue;
      for (const j of [i - 1, i + 1, i - W, i + W]) {
        const o = landId[j] as number;
        if (o !== 255 && o !== id) near[i] = 1;
      }
    }
  for (let d = 2; d <= 8; d++)
    for (let y = 1; y < H - 1; y++)
      for (let x = 1; x < W - 1; x++) {
        const i = y * W + x;
        if (near[i] !== 9 || landId[i] === 255) continue;
        if (near[i - 1] === d - 1 || near[i + 1] === d - 1 || near[i - W] === d - 1 || near[i + W] === d - 1) near[i] = d;
      }

  const ownerAt = (x: number, y: number): number => {
    if (x < 0 || y < 0 || x >= W || y >= H) return -1;
    const id = landId[y * W + x] as number;
    if (id === 255) return -1;
    let o: number = owner[id] as Owner;
    for (const s of spreads) if (s.land === id && (x - s.ox) * (x - s.ox) + (y - s.oy) * (y - s.oy) < s.r * s.r) o = s.to;
    return o;
  };

  function paint(b: Box): void {
    const x0 = Math.max(0, b.x0 - 8);
    const y0 = Math.max(0, b.y0 - 8);
    const x1 = Math.min(W - 1, b.x1 + 8);
    const y1 = Math.min(H - 1, b.y1 + 8);
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const i = y * W + x;
        const o4 = i * 4;
        const id = landId[i] as number;
        if (id === 255) {
          data[o4 + 3] = 0;
          continue;
        }
        const o = ownerAt(x, y);
        const tint = TINT[o] as (typeof TINT)[number];
        let r: number = tint[0];
        let gg: number = tint[1];
        let bl: number = tint[2];
        let a: number = tint[3];
        const busy = spreads.some((s) => s.land === id);
        if ((near[i] as number) <= 8 || busy) {
          // An edge where the holder changes is a solid line; between two lands of one holder, a dotted one.
          let line = 0;
          for (let k = 0; k < 4; k++) {
            const nx = x + (k === 0 ? -1 : k === 1 ? 1 : 0);
            const ny = y + (k === 2 ? -1 : k === 3 ? 1 : 0);
            const no = ownerAt(nx, ny);
            if (no < 0) continue;
            if (no !== o) line = 2;
            else if (line === 0 && (landId[ny * W + nx] as number) > id) line = 1;
          }
          if (line === 2 && (o !== 1 || (x + y) % 3 !== 0)) {
            const c = LINE[o] as (typeof LINE)[number];
            r = c[0];
            gg = c[1];
            bl = c[2];
            a = c[3];
          } else if (line === 1 && (x + y) % 4 < 2) {
            const c = LINE[o] as (typeof LINE)[number];
            r = c[0];
            gg = c[1];
            bl = c[2];
            a = c[3] * 0.42;
          } else if (o !== 1) {
            let depth = 0;
            for (let d = 2; d <= 8 && depth === 0; d++)
              if (
                differs(ownerAt(x - d, y), o) ||
                differs(ownerAt(x + d, y), o) ||
                differs(ownerAt(x, y - d), o) ||
                differs(ownerAt(x, y + d), o)
              )
                depth = d;
            if (depth > 0) {
              const c = BAND[o] as (typeof BAND)[number];
              const ba = (c[3] / 255) * (1 - (depth - 2) / 7.5);
              const ta = a / 255;
              const out = ba + ta * (1 - ba);
              r = (c[0] * ba + r * ta * (1 - ba)) / out;
              gg = (c[1] * ba + gg * ta * (1 - ba)) / out;
              bl = (c[2] * ba + bl * ta * (1 - ba)) / out;
              a = out * 255;
            }
          }
        }
        data[o4] = r;
        data[o4 + 1] = gg;
        data[o4 + 2] = bl;
        data[o4 + 3] = a;
      }
    g.putImageData(img, 0, 0, x0, y0, x1 - x0 + 1, y1 - y0 + 1);
  }
  const differs = (other: number, mine: number): boolean => other >= 0 && other !== mine;

  paint({ x0: 0, y0: 0, x1: W - 1, y1: H - 1 });

  return {
    canvas,
    owner,
    spreads,
    ownerAt,
    held: (): number => owner.filter((o) => o === 0).length,
    /** A land begins changing hands, the new colour spreading from a point. */
    begin(land: number, ox: number, oy: number, to: Owner): void {
      const b = t.bounds[land] as Box;
      const max = Math.max(
        Math.hypot(b.x0 - ox, b.y0 - oy),
        Math.hypot(b.x1 - ox, b.y0 - oy),
        Math.hypot(b.x0 - ox, b.y1 - oy),
        Math.hypot(b.x1 - ox, b.y1 - oy),
      );
      spreads.push({ land, ox, oy, r: 0, to, max });
    },
    /** Moves every spread on, and returns the lands that have just finished changing. */
    update(dt: number): number[] {
      const done: number[] = [];
      for (let n = spreads.length - 1; n >= 0; n--) {
        const s = spreads[n] as Spread;
        s.r += dt * (60 + s.r * 0.9);
        if (s.r >= s.max) {
          owner[s.land] = s.to;
          spreads.splice(n, 1);
          done.push(s.land);
        }
        paint(t.bounds[s.land] as Box);
      }
      return done;
    },
  };
}
