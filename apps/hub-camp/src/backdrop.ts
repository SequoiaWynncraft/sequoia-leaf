/**
 * The clearing itself, painted once and kept: the dusk sky and the far forest (which firelight
 * never reaches), then the redwoods, the undergrowth and the ground (which it does), then the
 * boughs and ferns nearest the eye. Ground is coloured place by place from noise, never tiled.
 */
import { canvas, clamp, type Cv, type G2, hash, INK as I, mix, noise, R, rng } from "./gfx.ts";

export interface View {
  /** The window, in CSS pixels. */
  W: number;
  H: number;
  /** The scene, in its own pixels. */
  w: number;
  h: number;
  /** CSS pixels to one scene pixel. */
  k: number;
  tall: boolean;
  /** The clearing: where things stand and people walk. */
  gx0: number;
  gy0: number;
  gx1: number;
  gy1: number;
  /** Where the trail leaves the clearing. */
  trail: [number, number];
}

export function measure(): View {
  const W = Math.max(200, window.innerWidth);
  const H = Math.max(200, window.innerHeight);
  const dpr = window.devicePixelRatio || 1;
  // Upright or on its side is the window's doing; then the scene is cut to whole device pixels,
  // as near as that allows to 200 across (upright) or 250 down (on its side).
  const tall = W < H * 0.82;
  const dw = W * dpr;
  const dh = H * dpr;
  const s = Math.max(
    1,
    tall ? Math.min(Math.round(dw / 200), Math.floor(dh / 330)) : Math.min(Math.round(dh / 250), Math.floor(dw / 380)),
  );
  const w = Math.ceil(dw / s);
  const h = Math.ceil(dh / s);
  const gx0 = tall ? 9 : 24;
  const gx1 = w - gx0;
  const gy0 = Math.round(h * (tall ? 0.335 : 0.47));
  const gy1 = h - (tall ? 36 : 12);
  return { W, H, w, h, k: s / dpr, tall, gx0, gy0, gx1, gy1, trail: [w + 16, Math.round(gy0 + (gy1 - gy0) * 0.8)] };
}

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const bayer = (x: number, y: number): number => (BAYER[(y & 3) * 4 + (x & 3)]! + 0.5) / 16;

function conifer(g: G2, x: number, base: number, h: number, col: string): void {
  const w = h * 0.42;
  const tier = Math.max(5, Math.round(h / 7));
  g.fillStyle = col;
  for (let r = 0; r < h; r++) {
    const saw = 0.45 + 0.55 * ((r % tier) / tier);
    const hw = (r / h) * (w / 2) * saw + 0.7;
    g.fillRect(Math.round(x - hw), base - h + r, Math.max(1, Math.round(hw * 2)), 1);
  }
  g.fillRect(Math.round(x) - 1, base - 2, 2, 4);
}

export interface Far {
  c: Cv;
  stars: [number, number, number][];
}

export function buildFar(v: View): Far {
  const [c, g] = canvas(v.w, v.h);
  const y0 = v.gy0;
  // the sky, in flat bands that break into one another
  const cols = [I.a, I.b, I.c, I.d, I.e, I.f, I.g];
  const cuts = [0.1, 0.27, 0.46, 0.63, 0.79, 0.92, 1.2].map((f) => Math.round(f * y0));
  for (let y = 0; y < y0 + 8; y++) {
    let band = 0;
    while (band < 6 && y >= cuts[band]!) band++;
    const next = cuts[band]!;
    const zone = clamp((y - (next - 7)) / 7, 0, 1);
    for (let x = 0; x < v.w; x++) {
      g.fillStyle = band < 6 && zone > bayer(x, y) ? cols[band + 1]! : cols[band]!;
      g.fillRect(x, y, 1, 1);
    }
  }
  const rand = rng(v.w * 31 + v.h);
  const stars: [number, number, number][] = [];
  for (let n = 0; n < (v.tall ? 16 : 26); n++)
    stars.push([Math.floor(rand() * v.w), Math.floor(rand() * y0 * 0.34), rand() * 6]);
  // the sun, going down behind the trees
  const sx = Math.round(v.w * (v.tall ? 0.6 : 0.585));
  const sy = y0 - Math.round(y0 * 0.2);
  for (let dy = -22; dy <= 22; dy++) {
    for (let dx = -22; dx <= 22; dx++) {
      const d = Math.hypot(dx, dy);
      if (d > 21) continue;
      const px = sx + dx;
      const py = sy + dy;
      if (d <= 7) g.fillStyle = I.j;
      else if (d <= 11) g.fillStyle = I.i;
      else if (d <= 15) g.fillStyle = bayer(px, py) < 0.62 ? I.g : I.f;
      else if (bayer(px, py) < 0.3) g.fillStyle = I.g;
      else continue;
      g.fillRect(px, py, 1, 1);
    }
  }
  // long clouds, lit from underneath
  for (let n = 0; n < (v.tall ? 5 : 7); n++) {
    const cy = Math.round(y0 * (0.2 + rand() * 0.52));
    const len = 18 + Math.floor(rand() * (v.tall ? 40 : 70));
    const cx = Math.floor(rand() * (v.w + 40)) - 20;
    const high = cy < y0 * 0.45;
    const body = high ? I.d : I.e;
    const lit = high ? I.e : I.f;
    const rows = 2 + Math.floor(rand() * 2);
    for (let r = 0; r <= rows; r++) {
      const inset = Math.round(Math.abs(r - rows * 0.4) * 5 + rand() * 4);
      R(g, cx + inset, cy + r, len - inset * 2, 1, r === rows ? lit : body);
    }
    R(g, cx + Math.round(len * 0.3), cy - 1, Math.round(len * 0.3), 1, body);
  }
  // a far ridge, then three ranks of trees, each darker and nearer
  for (let x = 0; x < v.w; x++) {
    const top = y0 - 12 - Math.round(noise(x / 46, 3, 8) * 16 + noise(x / 9, 5, 8) * 3);
    R(g, x, top, 1, y0 - top + 10, I.d);
  }
  const rank = (col: string, gap: number, lo: number, hi: number, base: number, seed: number): void => {
    const r2 = rng(seed);
    for (let x = -10; x < v.w + 10; x += gap * (0.6 + r2() * 0.8)) {
      // lower in the middle, so the sunset shows through
      const mid = 1 - Math.abs((x / v.w) * 2 - 1.1);
      const h = lo + (hi - lo) * r2() * (1 - 0.35 * clamp(mid, 0, 1));
      conifer(g, x, base, Math.round(h), col);
    }
    R(g, 0, base - 3, v.w, 20, col);
  };
  const u = v.tall ? 1.25 : 1;
  rank(I.c, 9, 18 * u, 34 * u, y0 - 2, 5);
  rank(I.b, 13, 26 * u, 54 * u, y0 + 3, 6);
  rank(I.a, 21, 34 * u, 78 * u, y0 + 8, 7);
  return { c, stars };
}

/** What the ground is drawn round. */
export interface Marks {
  fire: [number, number];
  door: [number, number] | null;
}

function trunk(g: G2, cx: number, base: number, w: number, lit: number, tone: number, seed: number): void {
  const far = mix(I.k, I.a, 0.5);
  const ramp =
    tone > 0.75 ? [I.k, I.l, I.m, I.n, I.o] : tone > 0.4 ? [far, I.k, I.l, I.m, I.n] : [I.a, far, I.k, I.l, I.m];
  for (let y = 0; y <= base; y++) {
    const up = base - y;
    const flare = up < 20 ? (1 - up / 20) ** 2 * w * 0.34 : 0;
    const hw = w / 2 + flare;
    const x0 = Math.round(cx - hw);
    const x1 = Math.round(cx + hw);
    for (let x = x0; x < x1; x++) {
      const t = ((x - cx) / hw) * lit;
      const wob = noise(y / 44, x / 3, seed) * 3;
      const f = noise((x + wob) / 2.1, y / 30, seed + 1);
      let idx = 2 + (t > 0.3 ? 1 : t < -0.35 ? -1 : 0);
      if (f < 0.36) idx -= 1;
      else if (f > 0.68) idx += 1;
      if (x === x0 || x === x1 - 1) idx = 0;
      g.fillStyle = ramp[clamp(idx, 0, 4)]!;
      g.fillRect(x, y, 1, 1);
    }
  }
}

function clump(
  g: G2,
  x: number,
  y: number,
  r: number,
  inks: readonly [string, string, string],
  rand: () => number,
): void {
  for (let dy = -r; dy <= Math.round(r * 0.45); dy++) {
    const hw = Math.sqrt(Math.max(0, 1 - (dy / r) ** 2)) * r * 1.2;
    R(g, x - hw, y + dy, hw * 2, 1, inks[0]);
  }
  // leaves catch the light in dabs along the top, more on the side the fire is on
  const dabs = Math.round(r * 1.6);
  for (let n = 0; n < dabs; n++) {
    const a = Math.PI * (1.08 + rand() * 0.84);
    const d = r * (0.45 + rand() * 0.5);
    const px = x + Math.cos(a) * d * 1.15;
    const py = y + Math.sin(a) * d;
    R(g, px, py, 2, 1, inks[1]);
    if (rand() < 0.28) R(g, px, py - 1, 1, 1, inks[2]);
  }
}

/** The distance from a point to a line between two others. */
function toLine(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const t = clamp(((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1), 0, 1);
  return Math.hypot(px - ax - dx * t, (py - ay - dy * t) * 1.7);
}

export function buildNear(v: View, m: Marks): Cv {
  const [c, g] = canvas(v.w, v.h);
  const y0 = v.gy0;
  const [fx, fy] = m.fire;
  const [tx, ty] = v.trail;
  const deep = mix(I.p, I.a, 0.45);
  const bendX = (fx + tx) / 2 + 10;
  const bendY = ty + 2;
  // ---- the ground
  for (let y = y0 - 3; y < v.h; y++) {
    for (let x = 0; x < v.w; x++) {
      const n1 = noise(x / 23, y / 11, 1);
      const n2 = noise(x / 6, y / 3.4, 2);
      let val = n1 * 0.72 + n2 * 0.28;
      // darker toward the trees and toward the eye
      const edge = Math.min(x - v.gx0 + 14, v.gx1 + 14 - x, (v.gy1 + 16 - y) * 1.4, (y - y0 + 6) * 2.2);
      if (edge < 30) val -= (1 - edge / 30) * 0.4;
      let col: string = val < 0.14 ? deep : val < 0.39 ? I.p : val < 0.69 ? I.q : I.r;
      // worn earth round the fire, and the paths to the trail and the door
      const wob = (noise(x / 8, y / 4.5, 3) - 0.5) * 0.36;
      const dFire = Math.hypot((x - fx) / 52, (y - fy - 2) / 25) + wob;
      let dPath = Math.min(toLine(x, y, fx, fy, bendX, bendY), toLine(x, y, bendX, bendY, tx, ty)) / 9 + wob * 1.3;
      if (m.door) dPath = Math.min(dPath, toLine(x, y, fx, fy, m.door[0], m.door[1] + 6) / 5.5 + wob * 1.6);
      const d = Math.min(dFire, dPath);
      if (d < 0.74) {
        const e = noise(x / 5, y / 2.6, 5);
        col = e < 0.3 ? I.u : e > 0.9 ? I.w : I.v;
        if (dFire < 0.3) col = e < 0.5 ? I.u : mix(I.u, I.k, 0.5);
      } else if (d < 0.9) {
        col = hash(x, y, 4) < (0.9 - d) / 0.16 ? I.u : I.q;
      }
      g.fillStyle = col;
      g.fillRect(x, y, 1, 1);
    }
  }
  const onEarth = (x: number, y: number): boolean => {
    const dFire = Math.hypot((x - fx) / 52, (y - fy - 2) / 25);
    const dPath = Math.min(toLine(x, y, fx, fy, bendX, bendY), toLine(x, y, bendX, bendY, tx, ty)) / 9;
    const dDoor = m.door ? toLine(x, y, fx, fy, m.door[0], m.door[1] + 6) / 5.5 : 9;
    return Math.min(dFire, dPath, dDoor) < 1.05;
  };
  // ---- what grows in it: in drifts, not sprinkled
  const rand = rng(v.w * 7 + v.h * 3);
  const area = (v.gx1 - v.gx0) * (v.gy1 - y0);
  for (let n = 0; n < area / 60; n++) {
    const x = Math.round(v.gx0 - 10 + rand() * (v.gx1 - v.gx0 + 20));
    const y = Math.round(y0 + 6 + rand() * (v.h - y0 - 8));
    if (onEarth(x, y)) continue;
    const drift = noise(x / 34, y / 17, 9);
    const kind = rand();
    if (drift > 0.56) {
      // grass in tufts
      const ink = kind < 0.6 ? I.s : I.r;
      R(g, x, y - 2, 1, 2, ink);
      R(g, x + 2, y - 3, 1, 3, ink);
      R(g, x + 4, y - 2, 1, 2, ink);
      R(g, x + 1, y - 1, 3, 1, I.r);
      if (kind > 0.92) R(g, x + 2, y - 4, 1, 1, I.t);
    } else if (drift < 0.33 && kind < 0.5) {
      // small flowers keeping to themselves
      const bloom = [I.j, I.N, I.i][Math.floor(rand() * 3)]!;
      for (let k = 0; k < 3; k++) {
        const bx = x + Math.round((rand() - 0.5) * 9);
        const by = y + Math.round((rand() - 0.5) * 5);
        if (onEarth(bx, by)) continue;
        R(g, bx, by, 1, 1, bloom);
        R(g, bx, by + 1, 1, 1, I.r);
      }
    } else if (kind > 0.95) {
      R(g, x, y, 3, 2, I.y);
      R(g, x, y, 2, 1, I.z);
    }
  }
  // pebbles and twigs on the worn earth
  for (let n = 0; n < 26; n++) {
    const a = rand() * Math.PI * 2;
    const d = 0.3 + rand() * 0.55;
    const x = Math.round(fx + Math.cos(a) * 46 * d);
    const y = Math.round(fy + Math.sin(a) * 21 * d);
    if (n % 3 === 0) R(g, x, y, 3, 1, I.u);
    else {
      R(g, x, y, 2, 1, n % 2 ? I.w : I.y);
    }
  }
  // ---- the trees standing round the clearing
  const far = v.tall
    ? ([
        [0.37, 12, 0.3],
        [0.76, 10, 0.3],
      ] as const)
    : ([
        [0.135, 12, 0.3],
        [0.345, 11, 0.3],
        [0.52, 9, 0.3],
        [0.68, 12, 0.3],
        [0.89, 10, 0.3],
      ] as const);
  far.forEach(([f, w, tone], n) => trunk(g, Math.round(v.w * f), y0 + 1, w, f < 0.5 ? 1 : -1, tone, 20 + n));
  // the undergrowth along the back
  const dark: [string, string, string] = [mix(I.p, I.a, 0.55), mix(I.p, I.a, 0.2), I.q];
  const mid: [string, string, string] = [mix(I.p, I.a, 0.25), I.q, I.r];
  const br = rng(91);
  for (let x = -6; x < v.w + 6; x += 7 + br() * 6)
    clump(g, Math.round(x), y0 - 2 + Math.round(br() * 3), 7 + Math.round(br() * 5), dark, br);
  for (let x = -4; x < v.w + 4; x += 9 + br() * 9) {
    if (br() < 0.25) continue;
    clump(g, Math.round(x), y0 + 5 + Math.round(br() * 3), 5 + Math.round(br() * 4), mid, br);
  }
  const near = v.tall
    ? ([
        [0.0, 30, 1, 1],
        [0.56, 15, 1, 0.6],
        [1.0, 34, -1, 1],
      ] as const)
    : ([
        [0.012, 38, 1, 1],
        [0.262, 20, 1, 0.6],
        [0.775, 22, -1, 0.6],
        [0.99, 40, -1, 1],
      ] as const);
  near.forEach(([f, w, lit, tone], n) => {
    const x = Math.round(v.w * f);
    const base = y0 + (tone === 1 ? 16 : 8);
    trunk(g, x, base, w, lit, tone, 40 + n);
    // ferns at its foot
    for (let k = -1; k <= 1; k++) clump(g, x + k * Math.round(w * 0.55), base + 2, 4 + (k === 0 ? 1 : 0), mid, br);
  });
  // down the sides, where the clearing gives way to the wood
  for (let y = y0 + 18; y < v.h; y += 9 + br() * 7) {
    clump(g, Math.round(v.gx0 - 12 + br() * 8), Math.round(y), 6 + Math.round(br() * 4), dark, br);
    clump(g, Math.round(v.gx1 + 4 + br() * 8), Math.round(y), 6 + Math.round(br() * 4), dark, br);
  }
  return c;
}

/** The boughs overhead and the ferns at the eye's feet. */
export function buildOver(v: View): Cv {
  const [c, g] = canvas(v.w, v.h);
  const rand = rng(v.w + v.h * 13);
  const deep: [string, string, string] = [mix(I.p, I.a, 0.45), mix(I.p, I.a, 0.2), I.p];
  const lit: [string, string, string] = [mix(I.p, I.a, 0.2), I.p, I.q];
  // boughs: deep at the corners, thinning toward the middle
  const depth = (x: number): number => {
    const f = x / v.w;
    const side = f < 0.5 ? 1 - f / 0.44 : (f - 0.56) / 0.44;
    return Math.max(0, side) ** 1.5 * v.h * (v.tall ? 0.15 : 0.27) + 2;
  };
  const rows = v.tall ? 4 : 5;
  for (let row = 0; row < rows; row++) {
    for (let x = -8; x < v.w + 8; x += 8 + rand() * 7) {
      const d = depth(x);
      if (d < 5) continue;
      const y = Math.round((d * (row + 0.3)) / rows + rand() * 3);
      const r = 7 + Math.round(rand() * 5);
      clump(g, Math.round(x), y, r, row >= rows - 2 ? lit : deep, rand);
      // needles hanging off the underside
      if (row === rows - 1)
        for (let k = -r; k < r; k += 3) R(g, x + k, y + Math.round(r * 0.45), 1, 1 + Math.round(rand() * 3), lit[0]);
    }
  }
  // ferns and stones along the bottom
  const base = v.h;
  const frond = (x: number, h: number, lean: number): void => {
    for (let i = 0; i < h; i++) {
      const fx = x + Math.round(lean * (i / h) ** 1.6 * h * 0.7);
      const fy = base - i;
      const leaf = Math.round((1 - i / h) * 4) + 1;
      R(g, fx - leaf, fy, leaf * 2 + 1, 1, i % 3 === 0 ? deep[1] : deep[0]);
      R(g, fx, fy, 1, 1, lit[1]);
    }
  };
  const count = Math.round(v.w / 26);
  for (let n = 0; n <= count; n++) {
    const f = n / count;
    const x = Math.round(f * v.w + (rand() - 0.5) * 10);
    const side = Math.abs(f - 0.5) * 2;
    const h = Math.round((v.tall ? 12 : 6) + side * side * (v.tall ? 14 : 22) + rand() * 5);
    frond(x, h, -0.9);
    frond(x + 2, Math.round(h * 0.8), 0.9);
    frond(x + 1, Math.round(h * 1.1), 0.1);
    if (rand() < 0.4) {
      const sx = x + 9;
      const sw = 7 + Math.round(rand() * 5);
      R(g, sx + 1, base - 5, sw - 2, 5, mix(I.x, I.a, 0.45));
      R(g, sx, base - 4, sw, 4, mix(I.x, I.a, 0.45));
      R(g, sx + 1, base - 5, sw - 3, 1, mix(I.z, I.a, 0.35));
    }
  }
  return c;
}
