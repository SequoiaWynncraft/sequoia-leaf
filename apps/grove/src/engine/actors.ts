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
}

export interface Actor {
  pos: V3;
  yaw: number;
  parts: Part[];
  /** How much of the low sun reaches it, worked out once where it stands. */
  sun?: number;
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
  for (const part of a.parts) {
    const [x0, y0, z0, x1, y1, z1] = part.box;
    const pivot = part.pivot ?? [0, 0, 0];
    const rot = part.rot ?? [0, 0, 0];
    const off = part.off ?? [0, 0, 0];
    const place = (p: V3): V3 => {
      const q = turn([p[0] - pivot[0], p[1] - pivot[1], p[2] - pivot[2]], rot);
      const r = turn([q[0] + pivot[0] + off[0], q[1] + pivot[1] + off[1], q[2] + pivot[2] + off[2]], yaw);
      return [a.pos[0] + r[0] / 16, a.pos[1] + r[1] / 16, a.pos[2] + r[2] / 16];
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
        const q = place([lx, ly, lz]);
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
/** A tile coloured in bands by height, for limbs: `bands` gives a colour to the pixels from that height up. */
const banded =
  (height: number, base: string, low: number, lowColour: string) =>
  (_x: number, y: number): string => {
    const up = 15 - y - UV0;
    return up >= 0 && up < low && up < height ? lowColour : base;
  };
const flecked =
  (a: string, b: string, seed: number) =>
  (x: number, y: number): string =>
    ihash(x, y, 1, seed) < 0.18 ? b : a;

// ---------- people ----------

export interface Look {
  skin: string;
  hair: string;
  hairDark: string;
  top: string;
  topDark: string;
  accent: string;
  legs: string;
  shoes: string;
}

export const LOOKS: Look[] = [
  {
    skin: "#e8b48a",
    hair: "#3b1910",
    hairDark: "#2a110c",
    top: "#54286a",
    topDark: "#472365",
    accent: "#f5b95e",
    legs: "#2c1e25",
    shoes: "#241612",
  },
  {
    skin: "#f0c9a0",
    hair: "#d49045",
    hairDark: "#9b7724",
    top: "#524915",
    topDark: "#453814",
    accent: "#e67967",
    legs: "#3b1910",
    shoes: "#241612",
  },
  {
    skin: "#b9774f",
    hair: "#241612",
    hairDark: "#150a09",
    top: "#763332",
    topDark: "#602714",
    accent: "#f5b95e",
    legs: "#2c1e25",
    shoes: "#150a09",
  },
  {
    skin: "#e8b48a",
    hair: "#e0c39a",
    hairDark: "#c9a57a",
    top: "#3d2050",
    topDark: "#321b3c",
    accent: "#b84d84",
    legs: "#47253b",
    shoes: "#241612",
  },
  {
    skin: "#f0c9a0",
    hair: "#453814",
    hairDark: "#363210",
    top: "#453814",
    topDark: "#363210",
    accent: "#d49045",
    legs: "#3b1910",
    shoes: "#241612",
  },
];

const FACE = [
  "hhhhhhhhhh",
  "hhhhhhhhhh",
  "hhhhhhhhhh",
  "hhsssssshh",
  "ssssssssss",
  "ssewssewss",
  "sseesseess",
  "sbssssssbs",
  "ssssmmssss",
  "ssssssssss",
];
const SHIRT = ["aaaaaaaa", "ttaatttt", "ttaatttt", "tttttttt", "tttddttt", "tttttttt", "dddddddd", "tttttttt"];

LOOKS.forEach((l, i) => {
  addTile(
    `p${i}_face`,
    front(FACE, { h: l.hair, s: l.skin, e: "#241612", w: "#fff3cf", b: "#e67967", m: "#8a3b3c" }, l.hair),
  );
  addTile(`p${i}_hair`, flecked(l.hair, l.hairDark, 90 + i));
  addTile(`p${i}_body`, front(SHIRT, { a: l.accent, t: l.top, d: l.topDark }, l.top));
  addTile(`p${i}_side`, banded(8, l.top, 2, l.topDark));
  addTile(`p${i}_arm`, banded(8, l.top, 2, l.skin));
  addTile(`p${i}_leg`, banded(7, l.legs, 2, l.shoes));
});
addTile("stick", () => "#74501f");
addTile("mallow", (x, y) => ((x + y) & 3 ? "#fff3cf" : "#e0c39a"));

export interface Person extends Actor {
  head: Part;
  armL: Part;
  armR: Part;
}

/** A small person, 25 pixels tall with a large head. `sit` folds the legs forward for a seat. */
export function person(look: number, pos: V3, yaw: number, sit: boolean, phase: number, roast = false): Person {
  const t = (n: string): string => `p${look}_${n}`;
  const legs: Part[] = [-4, 0].map((x) => ({
    box: [x, 0, -2, x + 4, 7, 2],
    tiles: all(t("leg")),
    pivot: [0, 7, 0],
    rot: [sit ? -Math.PI / 2 : 0, 0, 0],
  }));
  const body: Part = { box: [-4, 7, -2.5, 4, 15, 2.5], tiles: six(t("body"), t("side")) };
  const arm = (x: number): Part => ({
    box: [x, 7, -1.5, x + 3, 15, 1.5],
    tiles: all(t("arm")),
    pivot: [x + 1.5, 14, 0],
    rot: [sit ? -0.55 : -0.1, 0, 0],
  });
  const armL = arm(-7);
  const armR = arm(4);
  const head: Part = {
    box: [-5, 15, -5, 5, 25, 5],
    tiles: six(t("face"), t("hair")),
    pivot: [0, 15, 0],
    rot: [0, 0, 0],
  };
  const parts = [...legs, body, armL, armR, head];
  if (roast) {
    armR.rot = [-1.25, 0, 0];
    // The stick and its marshmallow, held out from the hand.
    parts.push({ box: [5, 13, 6, 6, 14, 22], tiles: all("stick"), pivot: [5.5, 14, 6], rot: [-0.18, 0, 0] });
    parts.push({ box: [4.5, 15.5, 20, 6.5, 17.5, 23], tiles: all("mallow") });
  }
  const turnTo = ihash(look, 1, 0, 7) - 0.5;
  return {
    pos,
    yaw,
    parts,
    head,
    armL,
    armR,
    update(time) {
      const breath = Math.sin(time * 1.6 + phase) * 0.35;
      for (const p of [body, armL, armR, head]) p.off = [0, breath, 0];
      head.rot = [Math.sin(time * 0.5 + phase) * 0.05, turnTo * 0.5 + Math.sin(time * 0.33 + phase * 2) * 0.25, 0];
    },
  };
}

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
