/**
 * Everything that moves: people, pets, flames, banners, strings of lights. They are built of the
 * same boxes and 16-pixel tiles as the world, at the same pixel size, and take the world's light
 * where they stand, so a figure by the fire is lit by it.
 */
import { addTile, tileIndex } from "../art/tiles.ts";
import type { FaceTiles } from "./blocks.ts";
import { FACES, STRIDE, uvOf } from "./mesh.ts";
import { ihash } from "./rand.ts";
import type { World } from "./world.ts";

type V3 = [number, number, number];

/** The moving things' triangles, rebuilt every frame. */
export class Dyn {
  readonly data = new Float32Array(STRIDE * 4 * 8000);
  quads = 0;

  reset(): void {
    this.quads = 0;
  }

  quad(
    p: readonly V3[],
    uv: readonly (readonly [number, number])[],
    tile: number,
    emit: number,
    n: V3,
    sky: number,
    glow: number,
    sun: number,
  ): void {
    if (this.quads >= 8000) return;
    for (let k = 0; k < 4; k++) {
      this.data.set(
        [p[k]![0], p[k]![1], p[k]![2], uv[k]![0], uv[k]![1], tile, emit, n[0], n[1], n[2], sky, glow, sun, 1],
        (this.quads * 4 + k) * STRIDE,
      );
    }
    this.quads++;
  }
}

/** A box of a model, in pixels from the model's feet: x to its left, y up, z the way it faces. */
export interface Part {
  box: [number, number, number, number, number, number];
  tiles: FaceTiles;
  /** Where the part turns about, and its turn about x, then z, then y. */
  pivot?: V3;
  rot?: V3;
  off?: V3;
  emit?: boolean;
  /** Pushes every face outward by this many pixels without stretching its picture: a hat over a head. */
  grow?: number;
}

export interface Actor {
  pos: V3;
  yaw: number;
  parts: Part[];
  /** How much of the low sun reaches it, worked out once where it stands. */
  sun?: number;
  /** 1 is a pixel to a sixteenth of a block. */
  scale?: number;
  update?: (t: number) => void;
}

const turn = (v: V3, r: V3): V3 => {
  let [x, y, z] = v;
  let c = Math.cos(r[0]);
  let s = Math.sin(r[0]);
  [y, z] = [y * c - z * s, y * s + z * c];
  c = Math.cos(r[2]);
  s = Math.sin(r[2]);
  [x, y] = [x * c - y * s, x * s + y * c];
  c = Math.cos(r[1]);
  s = Math.sin(r[1]);
  [x, z] = [x * c + z * s, -x * s + z * c];
  return [x, y, z];
};

const UV0 = 3;

export function draw(dyn: Dyn, w: World, a: Actor): void {
  const yaw: V3 = [0, a.yaw, 0];
  const size = a.scale ?? 1;
  for (const part of a.parts) {
    const [x0, y0, z0, x1, y1, z1] = part.box;
    const pivot = part.pivot ?? [0, 0, 0];
    const rot = part.rot ?? [0, 0, 0];
    const off = part.off ?? [0, 0, 0];
    const place = (p: V3): V3 => {
      const q = turn([p[0] - pivot[0], p[1] - pivot[1], p[2] - pivot[2]], rot);
      const r = turn([q[0] + pivot[0] + off[0], q[1] + pivot[1] + off[1], q[2] + pivot[2] + off[2]], yaw);
      return [a.pos[0] + (r[0] / 16) * size, a.pos[1] + (r[1] / 16) * size, a.pos[2] + (r[2] / 16) * size];
    };
    for (let f = 0; f < 6; f++) {
      const { n, c } = FACES[f]!;
      const normal = turn(turn([n[0], n[1], n[2]], rot), yaw);
      const pos: V3[] = [];
      const uv: [number, number][] = [];
      const mid: V3 = [0, 0, 0];
      for (let k = 0; k < 4; k++) {
        const lx = c[k]![0] ? x1 : x0;
        const ly = c[k]![1] ? y1 : y0;
        const lz = c[k]![2] ? z1 : z0;
        const gr = part.grow ?? 0;
        const q = place([lx + (c[k]![0] ? gr : -gr), ly + (c[k]![1] ? gr : -gr), lz + (c[k]![2] ? gr : -gr)]);
        pos.push(q);
        mid[0] += q[0] / 4;
        mid[1] += q[1] / 4;
        mid[2] += q[2] / 4;
        uv.push(uvOf(f, (UV0 + lx - x0) / 16, (UV0 + ly - y0) / 16, (UV0 + lz - z0) / 16));
      }
      // A face takes the light of the air just in front of it, so the side toward the fire is the warm one.
      const cx = Math.floor(mid[0] + normal[0] * 0.7);
      const cy = Math.floor(mid[1] + normal[1] * 0.7);
      const cz = Math.floor(mid[2] + normal[2] * 0.7);
      const here = (f: (x: number, y: number, z: number) => number): number =>
        Math.max(f(cx, cy, cz), f(Math.floor(mid[0]), Math.floor(mid[1]), Math.floor(mid[2])) - 2) / 15;
      dyn.quad(
        pos,
        uv,
        part.tiles[f]!,
        part.emit ? 1 : 0,
        normal,
        here((x, y, z) => w.skyAt(x, y, z)),
        here((x, y, z) => w.glowAt(x, y, z)),
        a.sun ?? 0,
      );
    }
  }
}

const six = (front: string, rest: string, top = rest): FaceTiles => [
  tileIndex(rest),
  tileIndex(rest),
  tileIndex(top),
  tileIndex(rest),
  tileIndex(front),
  tileIndex(rest),
];
const all = (name: string): FaceTiles => six(name, name);

/** Paints small art onto the part of a tile that a box's front shows; the rest of the tile is `fill`. */
const front =
  (art: readonly string[], key: Record<string, string>, fill: string) =>
  (x: number, y: number): string => {
    const row = art[y - (16 - UV0 - art.length)];
    const ch = row?.[x - UV0];
    return ch ? (key[ch] ?? fill) : fill;
  };
const flecked =
  (a: string, b: string, seed: number) =>
  (x: number, y: number): string =>
    ihash(x, y, 1, seed) < 0.18 ? b : a;

// ---------- the leafling: a pet the size of a boot, a sprout on its head ----------

addTile(
  "leafling_face",
  front(
    ["gGGGGGGg", "GGGGGGGG", "GGeGGeGG", "GGeGGeGG", "GpGGGGpG", "GGGmmGGG", "gGGGGGGg"],
    { g: "#524915", G: "#857022", e: "#241612", p: "#d49045", m: "#453814" },
    "#6a5f1a",
  ),
);
addTile("leafling_body", flecked("#6a5f1a", "#524915", 95));
addTile("leafling_top", flecked("#857022", "#6a5f1a", 96));
addTile("sprout_leaf", flecked("#9b7724", "#857022", 97));

export function leafling(pos: V3, yaw: number, phase: number): Actor {
  const body: Part = { box: [-4, 0, -4, 4, 7, 4], tiles: six("leafling_face", "leafling_body", "leafling_top") };
  const stem: Part = { box: [-0.5, 7, -0.5, 0.5, 9, 0.5], tiles: all("sprout_leaf") };
  const leafA: Part = { box: [0, 9, -1.5, 4, 10, 1.5], tiles: all("sprout_leaf"), pivot: [0, 9, 0] };
  const leafB: Part = { box: [-4, 9, -1.5, 0, 10, 1.5], tiles: all("sprout_leaf"), pivot: [0, 9, 0] };
  const parts = [body, stem, leafA, leafB];
  return {
    pos,
    yaw,
    parts,
    update(time) {
      // A hop now and then, the sprout swaying after it.
      const beat = (time * 0.9 + phase) % 3;
      const hop = beat < 0.5 ? Math.sin((beat / 0.5) * Math.PI) * 3.5 : 0;
      const sway = Math.sin(time * 2.2 + phase) * 0.25;
      for (const p of parts) p.off = [0, hop, 0];
      leafA.rot = [0, 0, 0.35 + sway];
      leafB.rot = [0, 0, -0.35 + sway];
    },
  };
}

// ---------- the grove cat, asleep ----------

addTile("cat_fur", (x, y) =>
  (x + (y >> 2)) % 5 === 0 ? "#94582c" : ihash(x, y, 1, 98) < 0.15 ? "#d9a05a" : "#c98a4a",
);
addTile(
  "cat_face",
  front(["fffff", "dfffd", "ffnff", "wwwww"], { f: "#c98a4a", d: "#3a1f12", n: "#e67967", w: "#f0d9b5" }, "#c98a4a"),
);
addTile("cat_ear", () => "#94582c");

export function cat(pos: V3, yaw: number): Actor {
  const body: Part = { box: [-3, 0, -4, 3, 4, 4], tiles: all("cat_fur") };
  const head: Part = { box: [-2.5, 1, 3, 2.5, 5, 7], tiles: six("cat_face", "cat_fur") };
  const ears: Part[] = [-2.5, 1.5].map((x) => ({ box: [x, 5, 4, x + 1, 6, 5], tiles: all("cat_ear") }));
  const tail: Part = { box: [3, 0, -4, 4, 1, 3], tiles: all("cat_ear"), pivot: [3.5, 0, -4] };
  return {
    pos,
    yaw,
    parts: [body, head, ...ears, tail],
    update(time) {
      body.box[4] = 4 + (Math.sin(time * 1.1) > 0.3 ? 0.5 : 0);
      tail.rot = [0, Math.max(0, Math.sin(time * 0.7)) * 0.25, 0];
    },
  };
}

// ---------- flames, banners, strings of lights ----------

const SHEET: readonly (readonly [number, number])[] = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
];
/** A sheet seen from both sides. */
function sheet(
  dyn: Dyn,
  p: V3[],
  tile: number,
  emit: number,
  sky: number,
  glow: number,
  v0 = 0,
  v1 = 1,
  u0 = 0,
  u1 = 1,
): void {
  const uv = SHEET.map(([u, v]) => [u0 + (u1 - u0) * u, v0 + (v1 - v0) * v] as const);
  dyn.quad(p, uv, tile, emit, [0, 1, 0], sky, glow, 0);
  dyn.quad([p[1]!, p[0]!, p[3]!, p[2]!], [uv[1]!, uv[0]!, uv[3]!, uv[2]!], tile, emit, [0, 1, 0], sky, glow, 0);
}

/** The fire's flames: two crossed sheets two blocks tall, a new drawing nine times a second. */
export function flames(dyn: Dyn, at: V3, time: number): void {
  const f = Math.floor(time * 9) % 4;
  // A tall flame in the middle and a low one across it, a frame apart, so the fire is never a flat card.
  for (const [ax, az, bx, bz, wide, tall, lag] of [
    [-1, -1, 1, 1, 0.72, 1.25, 0],
    [-1, 1, 1, -1, 0.6, 0.95, 1],
    [-1, 0, 1, 0, 0.5, 0.7, 2],
  ] as const)
    for (const [part, y] of [
      ["lo", 0],
      ["hi", 1],
    ] as const) {
      const h0 = at[1] + y * tall;
      const p: V3[] = [
        [at[0] + ax * wide, h0, at[2] + az * wide],
        [at[0] + bx * wide, h0, at[2] + bz * wide],
        [at[0] + bx * wide, h0 + tall, at[2] + bz * wide],
        [at[0] + ax * wide, h0 + tall, at[2] + az * wide],
      ];
      sheet(dyn, p, tileIndex(`flame${(f + lag) % 4}_${part}`), 1, 1, 1);
    }
}

/** A banner hanging from a bar at `at`, facing `yaw`, its foot moving more than its head. */
export function banner(dyn: Dyn, w: World, at: V3, yaw: number, time: number, phase: number): void {
  const sky = w.skyAt(Math.floor(at[0]), Math.floor(at[1]), Math.floor(at[2])) / 15;
  const glow = w.glowAt(Math.floor(at[0]), Math.floor(at[1] - 1), Math.floor(at[2])) / 15;
  const row = (i: number): [V3, V3] => {
    const push = (Math.sin(time * 1.5 + i * 0.6 + phase) * i * 0.4 + Math.sin(time * 0.6 + phase) * i * 0.25) / 16;
    const a = turn([-6 / 16, 0, push], [0, yaw, 0]);
    const b = turn([6 / 16, 0, push], [0, yaw, 0]);
    return [
      [at[0] + a[0], at[1] - (i * 4) / 16, at[2] + a[2]],
      [at[0] + b[0], at[1] - (i * 4) / 16, at[2] + b[2]],
    ];
  };
  for (let i = 0; i < 7; i++) {
    const [a0, b0] = row(i);
    const [a1, b1] = row(i + 1);
    const foot = i >= 4;
    const j = foot ? i - 4 : i;
    sheet(
      dyn,
      [a1, b1, b0, a0],
      tileIndex(foot ? "banner_foot" : "banner_top"),
      0,
      sky,
      glow,
      1 - (j + 1) / 4,
      1 - j / 4,
      2 / 16,
      14 / 16,
    );
  }
  draw(dyn, w, { pos: at, yaw, parts: [{ box: [-7, 0, -1, 7, 2, 1], tiles: all("planks") }] });
}

/** Where a string of bulbs hangs between two points, sagging in the middle. */
export function string(a: V3, b: V3, bulbs: number, sag: number): V3[] {
  return Array.from({ length: bulbs }, (_, i) => {
    const k = (i + 1) / (bulbs + 1);
    return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k - Math.sin(Math.PI * k) * sag, a[2] + (b[2] - a[2]) * k];
  });
}

export function bulbs(dyn: Dyn, w: World, a: V3, b: V3, points: readonly V3[]): void {
  const line = [a, ...points, b];
  for (let i = 0; i + 1 < line.length; i++) {
    const p = line[i]!;
    const q = line[i + 1]!;
    const d: V3 = [q[0] - p[0], q[1] - p[1], q[2] - p[2]];
    const len = Math.hypot(...d) * 16;
    // The wire: a thin box laid from one bulb to the next.
    draw(dyn, w, {
      pos: p,
      yaw: 0,
      parts: [
        {
          box: [-0.5, -0.5, 0, 0.5, 0.5, len],
          tiles: all("wire"),
          rot: [-Math.asin((d[1] * 16) / len), Math.atan2(d[0], d[2]), 0],
        },
      ],
    });
  }
  for (const p of points)
    draw(dyn, w, {
      pos: [p[0], p[1] - 3 / 16, p[2]],
      yaw: 0,
      parts: [{ box: [-1, 0, -1, 1, 2.5, 1], tiles: all("bulb"), emit: true }],
    });
}

// ---------- people: a member in their own Minecraft skin, or one of the grove's own ----------

type Rect = readonly [number, number, number, number];
/** The six pictures of one box in a skin: its corner in the sheet and the box's width, height and depth. */
export const unwrap = (ox: number, oy: number, w: number, h: number, d: number): Rect[] => [
  [ox + d + w, oy + d, d, h],
  [ox, oy + d, d, h],
  [ox + d, oy, w, d],
  [ox + d + w, oy, w, d],
  [ox + d, oy + d, w, h],
  [ox + d + w + d, oy + d, w, h],
];

/** Something solid a person carries or wears, which moves with one of their limbs. */
export interface Extra {
  follow: "head" | "body" | "armR" | "armL";
  box: Part["box"];
  tile: string;
  emit?: boolean;
}
export type Pose = "stand" | "wave" | "sit" | "roast";
export type Wearer = (pos: V3, yaw: number, phase: number, pose?: Pose) => Actor;

/**
 * Cuts a 64x64 skin into tiles, one for each face of each limb, and returns the model that wears
 * them: the usual proportions, the outer layer (hat, jacket, sleeves) standing a little off the body.
 */
export function skinned(id: string, rgba: Uint8ClampedArray, slim: boolean, extras: readonly Extra[] = []): Wearer {
  const aw = slim ? 3 : 4;
  const limbs: { name: string; box: Part["box"]; at: [number, number]; over: [number, number]; pivot: V3 }[] = [
    { name: "legR", box: [-4, 0, -2, 0, 12, 2], at: [0, 16], over: [0, 32], pivot: [-2, 12, 0] },
    { name: "legL", box: [0, 0, -2, 4, 12, 2], at: [16, 48], over: [0, 48], pivot: [2, 12, 0] },
    { name: "body", box: [-4, 12, -2, 4, 24, 2], at: [16, 16], over: [16, 32], pivot: [0, 12, 0] },
    { name: "armR", box: [-4 - aw, 12, -2, -4, 24, 2], at: [40, 16], over: [40, 32], pivot: [-5.5, 22, 0] },
    { name: "armL", box: [4, 12, -2, 4 + aw, 24, 2], at: [32, 48], over: [48, 48], pivot: [5.5, 22, 0] },
    { name: "head", box: [-4, 24, -4, 4, 32, 4], at: [0, 0], over: [32, 0], pivot: [0, 24, 0] },
  ];
  const make = (limb: (typeof limbs)[number], layer: "base" | "over"): FaceTiles => {
    const [x0, y0, z0, x1, y1, z1] = limb.box;
    const [ox, oy] = layer === "base" ? limb.at : limb.over;
    const names = unwrap(ox, oy, x1 - x0, y1 - y0, z1 - z0).map(([sx, sy, w, h], f) => {
      // Where this face's picture falls on its tile, from the corners of the box as the tile sees them.
      let u0 = 16;
      let v0 = 16;
      for (const c of FACES[f]!.c) {
        const [u, v] = uvOf(
          f,
          (UV0 + (c[0] ? x1 - x0 : 0)) / 16,
          (UV0 + (c[1] ? y1 - y0 : 0)) / 16,
          (UV0 + (c[2] ? z1 - z0 : 0)) / 16,
        );
        u0 = Math.min(u0, Math.round(u * 16));
        v0 = Math.min(v0, Math.round(v * 16));
      }
      const name = `skin_${id}_${limb.name}_${layer}_${f}`;
      addTile(name, (x, y) => {
        const i = x - u0;
        const j = y - (16 - v0 - h);
        if (i < 0 || j < 0 || i >= w || j >= h) return null;
        const o = ((sy + j) * 64 + sx + i) * 4;
        if (layer === "over" && rgba[o + 3]! < 128) return null;
        return `#${[rgba[o]!, rgba[o + 1]!, rgba[o + 2]!].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
      });
      return tileIndex(name);
    });
    return [names[0]!, names[1]!, names[2]!, names[3]!, names[4]!, names[5]!];
  };
  const tiles = limbs.map((l) => ({ base: make(l, "base"), over: make(l, "over") }));
  return (pos, yaw, phase, pose = "stand") => {
    const parts: Part[] = [];
    const of: Record<string, Part[]> = {};
    limbs.forEach((l, i) => {
      const base: Part = { box: [...l.box], tiles: tiles[i]!.base, pivot: l.pivot, rot: [0, 0, 0] };
      const over: Part = {
        box: [...l.box],
        tiles: tiles[i]!.over,
        pivot: l.pivot,
        rot: [0, 0, 0],
        grow: l.name === "head" ? 0.5 : 0.3,
      };
      of[l.name] = [base, over];
      parts.push(base, over);
    });
    for (const e of extras) {
      const part: Part = {
        box: [...e.box],
        tiles: all(e.tile),
        pivot: of[e.follow]![0]!.pivot!,
        ...(e.emit ? { emit: true } : {}),
      };
      of[e.follow]!.push(part);
      parts.push(part);
    }
    const set = (name: string, rot: V3, lift = 0): void => {
      for (const p of of[name]!) {
        p.rot = rot;
        p.off = [0, lift, 0];
      }
    };
    const sit = pose === "sit";
    return {
      pos,
      yaw,
      parts,
      scale: 0.9375,
      update(time) {
        const breath = Math.sin(time * 1.6 + phase) * 0.3;
        const sway = Math.sin(time * 0.9 + phase) * 0.06;
        set("body", [0, 0, 0]);
        set("head", [Math.sin(time * 0.5 + phase) * 0.06, Math.sin(time * 0.33 + phase * 1.7) * 0.32, 0], breath);
        set("armR", pose === "roast" ? [-1.2 + sway * 0.5, 0, 0] : [(sit ? -0.5 : 0) + sway, 0, -0.05], breath);
        set(
          "armL",
          pose === "wave" ? [0, 0, 2.5 + Math.sin(time * 5) * 0.28] : [(sit ? -0.5 : 0) - sway, 0, 0.05],
          breath,
        );
        set("legR", sit ? [-Math.PI / 2, 0.1, 0] : [0, 0, 0]);
        set("legL", sit ? [-Math.PI / 2, -0.1, 0] : [0, 0, 0]);
      },
    };
  };
}

/** Reads a skin picture into its pixels, or nothing if there is none. */
export async function loadSkin(url: string): Promise<Uint8ClampedArray | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const image = await createImageBitmap(await res.blob());
    if (image.width !== 64 || image.height !== 64) return null;
    const ctx = new OffscreenCanvas(64, 64).getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(image, 0, 0);
    return ctx.getImageData(0, 0, 64, 64).data;
  } catch {
    return null;
  }
}
