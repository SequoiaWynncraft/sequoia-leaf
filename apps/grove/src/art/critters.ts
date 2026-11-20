/**
 * The spirits, as block creatures: each a few boxes at the world's own pixel size, with a face drawn
 * on its front and a way of moving. Their tiles must exist before the world's texture is built, so
 * this file is imported for that as well as for `critter`.
 */
import { type Actor, all, flecked, front, type Part, six } from "../engine/actors.ts";
import { addTile } from "./tiles.ts";

type V3 = [number, number, number];
type Box = Part["box"];

/** A flat colour with a few darker flecks, as a tile of its own. */
const made = new Set<string>();
function paint(hex: string, dark = hex): string {
  const name = `cr_${hex.slice(1)}_${dark.slice(1)}`;
  if (!made.has(name)) {
    made.add(name);
    addTile(name, flecked(hex, dark, hex.charCodeAt(2) * 7 + hex.charCodeAt(5)));
  }
  return name;
}
interface Face {
  /** Eye and cheek colours, and how the eyes are set: two tall, two wide (sleepy), or large round. */
  eye?: string;
  cheek?: string;
  eyes?: "tall" | "sleepy" | "big" | "none";
  mouth?: "smile" | "wide" | "none";
}
/** A face for a box front `w` wide and `h` tall, drawn in the body's own colours. */
function face(id: string, w: number, h: number, col: string, dark: string, f: Face = {}): string {
  const rows = Array.from({ length: h }, () => Array.from({ length: w }, () => "G"));
  const put = (x: number, y: number, ch: string): void => {
    if (y >= 0 && y < h && x >= 0 && x < w) rows[y]![x] = ch;
  };
  for (const [x, y] of [
    [0, 0],
    [w - 1, 0],
    [0, h - 1],
    [w - 1, h - 1],
  ] as const)
    put(x, y, "g");
  const c1 = Math.max(1, Math.round(w * 0.22));
  const c2 = w - 1 - c1;
  const r = Math.max(1, Math.round(h * 0.3));
  for (const c of [c1, c2]) {
    if (f.eyes === "none") continue;
    if (f.eyes === "sleepy") {
      put(c, r + 1, "e");
      put(c + (c === c1 ? 1 : -1), r + 1, "e");
    } else if (f.eyes === "big") {
      for (const [dx, dy] of [
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 1],
      ] as const)
        put(c - (c === c2 ? 1 : 0) + dx, r + dy, dx + dy === 0 ? "w" : "e");
    } else {
      put(c, r, "e");
      put(c, r + 1, "e");
    }
  }
  if (f.cheek) {
    put(c1 - 1, r + 2, "p");
    put(c2 + 1, r + 2, "p");
  }
  const mid = Math.floor(w / 2);
  if (f.mouth === "wide") for (let x = c1 + 1; x < c2; x++) put(x, Math.min(h - 2, r + 3), "m");
  else if (f.mouth !== "none") {
    put(mid - 1, Math.min(h - 2, r + 3), "m");
    put(mid, Math.min(h - 2, r + 3), "m");
  }
  const name = `cr_face_${id}`;
  addTile(
    name,
    front(
      rows.map((row) => row.join("")),
      { G: col, g: dark, e: f.eye ?? "#241612", w: "#fff3cf", p: f.cheek ?? col, m: dark },
      col,
    ),
  );
  return name;
}

/** A moving part: it swings about its pivot on one axis (0 x, 1 z, 2 y), `amp` radians at `speed`. */
interface Limb extends Part {
  swing?: readonly [axis: number, amp: number, speed: number, phase: number, rest: number];
}
interface Look {
  /** Blocks high, for shadows and for being tapped. */
  readonly tall: number;
  readonly parts: Limb[];
  /** Seconds between hops and how high one goes in pixels; a floater bobs in the air instead. */
  readonly hop?: readonly [every: number, high: number];
  readonly float?: readonly [high: number, bob: number];
  /** It breathes: its first part swells this many pixels. */
  readonly breathe?: number;
}
const box = (b: Box, tile: string, more: Partial<Limb> = {}): Limb => ({ box: b, tiles: all(tile), ...more });

const LOOKS: Record<string, () => Look> = {
  leafling: () => ({
    tall: 0.6,
    hop: [3.3, 3.5],
    parts: [
      { box: [-4, 0, -4, 4, 7, 4], tiles: six("leafling_face", "leafling_body", "leafling_top") },
      box([-0.5, 7, -0.5, 0.5, 9, 0.5], "sprout_leaf"),
      box([0, 9, -1.5, 4, 10, 1.5], "sprout_leaf", { pivot: [0, 9, 0], swing: [1, 0.25, 2.2, 0, 0.35] }),
      box([-4, 9, -1.5, 0, 10, 1.5], "sprout_leaf", { pivot: [0, 9, 0], swing: [1, 0.25, 2.2, 0, -0.35] }),
    ],
  }),
  mossmote: () => {
    const [c, d] = ["#5d7a34", "#465c28"];
    return {
      tall: 0.5,
      hop: [4.1, 2],
      breathe: 0.4,
      parts: [
        {
          box: [-4, 0, -4, 4, 6, 4],
          tiles: six(
            face("mossmote", 8, 6, c, d, { eyes: "sleepy", cheek: "#8aa24a" }),
            paint(c, d),
            paint("#6c8a3a", c),
          ),
        },
        box([-5, 1, -3, -4, 4, 3], paint("#6c8a3a", c)),
        box([4, 1, -3, 5, 4, 3], paint("#6c8a3a", c)),
        box([-2, 6, -2, 2, 7, 2], paint("#7fa043", c)),
      ],
    };
  },
  glorp: () => {
    const [c, d] = ["#4d8fd6", "#3a6fb0"];
    return {
      tall: 0.55,
      hop: [2.4, 4],
      breathe: 0.7,
      parts: [
        {
          box: [-4, 0, -4, 4, 6, 4],
          tiles: six(face("glorp", 8, 6, c, d, { eyes: "big", mouth: "wide" }), paint(c, d), paint("#6aa8e6", c)),
        },
        box([-0.5, 6, -0.5, 0.5, 8, 0.5], paint(d)),
        box([-1, 8, -1, 1, 10, 1], paint("#9fd0ff", "#6aa8e6"), { emit: true }),
      ],
    };
  },
  slug: () => {
    const [c, d] = ["#c9a36a", "#a07c48"];
    return {
      tall: 0.4,
      breathe: 0.3,
      parts: [
        {
          box: [-3, 0, -5, 3, 3, 5],
          tiles: six(face("slug", 6, 3, c, d, { eyes: "none", mouth: "none" }), paint(c, d)),
        },
        box([-2, 3, -4, 2, 5, 1], paint("#8a5a3a", "#6f4426")),
        box([-2, 3, 3, -1, 6, 4], paint(c, d), { pivot: [-1.5, 3, 3.5], swing: [0, 0.2, 1.3, 0, 0.1] }),
        box([1, 3, 3, 2, 6, 4], paint(c, d), { pivot: [1.5, 3, 3.5], swing: [0, 0.2, 1.3, 1.6, 0.1] }),
        box([-2.5, 6, 2.5, -0.5, 7, 4.5], paint("#241612")),
        box([0.5, 6, 2.5, 2.5, 7, 4.5], paint("#241612")),
      ],
    };
  },
  chickaree: () => {
    const [c, d] = ["#a8623a", "#7f4426"];
    return {
      tall: 0.6,
      hop: [1.7, 3],
      parts: [
        {
          box: [-3, 0, -3, 3, 6, 3],
          tiles: six(face("chickaree", 6, 6, c, d, { cheek: "#e0c39a", eyes: "tall" }), paint(c, d)),
        },
        box([-3, 6, 0, -1, 8, 1], paint(d)),
        box([1, 6, 0, 3, 8, 1], paint(d)),
        box([-2, 1, -6, 2, 9, -3], paint("#c98a4a", c), { pivot: [0, 1, -3], swing: [0, 0.18, 3.1, 0, -0.15] }),
        box([-2, 0, 3, 2, 3, 4], paint("#e0c39a", "#c9a36a")),
      ],
    };
  },
  emberkit: () => {
    const [c, d] = ["#e6703a", "#b84a22"];
    return {
      tall: 0.5,
      breathe: 0.5,
      parts: [
        box([-3, 0, -4, 3, 4, 4], paint(c, d)),
        {
          box: [-2.5, 1, 3, 2.5, 5, 7],
          tiles: six(face("emberkit", 5, 4, c, d, { eyes: "sleepy", mouth: "none" }), paint(c, d)),
        },
        box([-2.5, 5, 4, -1.5, 6.5, 5], paint(d)),
        box([1.5, 5, 4, 2.5, 6.5, 5], paint(d)),
        box([3, 0, -4, 4, 1, 2], paint(d), { pivot: [3.5, 0, -4], swing: [2, 0.3, 1.4, 0, 0.2] }),
        box([2.5, 0, 2, 4.5, 2, 4], paint("#ffd98a", "#f5b95e"), { emit: true }),
      ],
    };
  },
  rock: () => {
    const [c, d] = ["#8f8a8c", "#6c676a"];
    return {
      tall: 0.6,
      hop: [5.5, 1.5],
      parts: [
        {
          box: [-4.5, 0, -4, 4.5, 7, 4],
          tiles: six(face("rock", 9, 7, c, d, { eyes: "tall", mouth: "none" }), paint(c, d), paint("#5d7a34", c)),
        },
        box([-5.5, 2, -1, -4.5, 4, 1], paint(d)),
        box([4.5, 2, -1, 5.5, 4, 1], paint(d)),
        box([-3, 7, -2, 1, 8, 2], paint("#6c8a3a", "#5d7a34")),
      ],
    };
  },
  worm: () => {
    const [c, d] = ["#d98a8a", "#b06464"];
    const seg = (z: number, i: number): Limb =>
      box([-2, 0, z, 2, 4, z + 3], paint(i % 2 ? "#e6a0a0" : c, d), {
        pivot: [0, 0, z + 1.5],
        swing: [2, 0.25, 2.4, i * 1.1, 0],
      });
    return {
      tall: 0.45,
      parts: [
        {
          box: [-2.5, 0, 3, 2.5, 5, 7],
          tiles: six(face("worm", 5, 5, c, d, { eyes: "big", mouth: "none" }), paint(c, d)),
          pivot: [0, 0, 3],
          swing: [2, 0.2, 2.4, 0, 0],
        },
        seg(0, 1),
        seg(-3, 2),
        seg(-6, 3),
      ],
    };
  },
  owl: () => {
    const [c, d] = ["#aab4c8", "#7e88a0"];
    return {
      tall: 0.75,
      breathe: 0.3,
      parts: [
        {
          box: [-3.5, 0, -3, 3.5, 9, 3],
          tiles: six(
            face("owl", 7, 9, c, d, { eyes: "big", mouth: "none", cheek: "#f5b95e" }),
            paint(c, d),
            paint("#c8d0e0", c),
          ),
        },
        box([-3.5, 9, -1, -2.5, 10.5, 0], paint(d)),
        box([2.5, 9, -1, 3.5, 10.5, 0], paint(d)),
        box([-4.5, 2, -2, -3.5, 7, 2], paint(d), { pivot: [-3.5, 7, 0], swing: [1, 0.12, 0.9, 0, -0.05] }),
        box([3.5, 2, -2, 4.5, 7, 2], paint(d), { pivot: [3.5, 7, 0], swing: [1, 0.12, 0.9, 3.14, 0.05] }),
        box([-0.5, 4, 3, 0.5, 5, 4], paint("#f5b95e")),
      ],
    };
  },
  moth: () => {
    const [c, d] = ["#e8dcc0", "#c2b08a"];
    return {
      tall: 0.5,
      float: [7, 1.2],
      parts: [
        {
          box: [-1.5, 0, -2, 1.5, 3, 3],
          tiles: six(
            face("moth", 3, 3, "#8a6a4a", "#6a4a2a", { eyes: "none", mouth: "none" }),
            paint("#8a6a4a", "#6a4a2a"),
          ),
        },
        box([-7, 1.5, -3, -1.5, 2.5, 3], paint(c, d), { pivot: [-1.5, 2, 0], swing: [1, 0.6, 9, 0, 0.2] }),
        box([1.5, 1.5, -3, 7, 2.5, 3], paint(c, d), { pivot: [1.5, 2, 0], swing: [1, 0.6, 9, 3.14, -0.2] }),
        box([-5, 2.5, -1, -3, 2.7, 1], paint("#e67fb0", "#b07ae6"), {
          pivot: [-1.5, 2, 0],
          swing: [1, 0.6, 9, 0, 0.2],
        }),
        box([3, 2.5, -1, 5, 2.7, 1], paint("#e67fb0", "#b07ae6"), {
          pivot: [1.5, 2, 0],
          swing: [1, 0.6, 9, 3.14, -0.2],
        }),
        box([-1, 3, 2, -0.5, 5, 2.5], paint("#6a4a2a")),
        box([0.5, 3, 2, 1, 5, 2.5], paint("#6a4a2a")),
      ],
    };
  },
  greg: () => {
    const [c, d] = ["#7a4aa8", "#573080"];
    return {
      tall: 0.85,
      hop: [2.9, 2.5],
      breathe: 0.4,
      parts: [
        {
          box: [-4, 2, -3, 4, 11, 3],
          tiles: six(face("greg", 8, 9, c, d, { eyes: "big", mouth: "wide", cheek: "#b07ae6" }), paint(c, d)),
        },
        box([-3, 0, -1, -1, 2, 1], paint(d)),
        box([1, 0, -1, 3, 2, 1], paint(d)),
        box([-5, 4, -1, -4, 8, 1], paint(d), { pivot: [-4, 8, 0], swing: [1, 0.3, 2.9, 0, -0.2] }),
        box([4, 4, -1, 5, 8, 1], paint(d), { pivot: [4, 8, 0], swing: [1, 0.3, 2.9, 3.14, 0.2] }),
        box([-3.5, 11, -0.5, -2.5, 13, 0.5], paint("#f5b95e", "#d49045")),
        box([2.5, 11, -0.5, 3.5, 13, 0.5], paint("#f5b95e", "#d49045")),
      ],
    };
  },
  fox: () => {
    const [c, d] = ["#f4f0e8", "#cfc8bc"];
    const gold = paint("#ffd98a", "#f5b95e");
    return {
      tall: 0.8,
      breathe: 0.3,
      parts: [
        box([-2.5, 3, -5, 2.5, 8, 4], paint(c, d)),
        {
          box: [-2.5, 6, 3, 2.5, 11, 8],
          tiles: six(face("fox", 5, 5, c, d, { eyes: "tall", mouth: "none", eye: "#5aa9e6" }), paint(c, d)),
        },
        box([-1, 6, 8, 1, 8, 10], paint(c, d)),
        box([-2.5, 11, 4, -1.5, 13, 5], paint(c, d)),
        box([1.5, 11, 4, 2.5, 13, 5], paint(c, d)),
        box([-2, 0, 2, -1, 3, 3], paint(d)),
        box([1, 0, 2, 2, 3, 3], paint(d)),
        box([-2, 0, -4, -1, 3, -3], paint(d)),
        box([1, 0, -4, 2, 3, -3], paint(d)),
        box([-1.5, 4, -10, 1.5, 8, -5], paint(c, d), { pivot: [0, 6, -5], swing: [2, 0.25, 1.6, 0, 0] }),
        // Antlers of gold: a stem and two tines each side.
        box([-2.2, 13, 5, -1.8, 16, 5.4], gold, { emit: true }),
        box([-4, 15, 5, -2, 15.4, 5.4], gold, { emit: true }),
        box([-4, 15, 5, -3.6, 17, 5.4], gold, { emit: true }),
        box([1.8, 13, 5, 2.2, 16, 5.4], gold, { emit: true }),
        box([2, 15, 5, 4, 15.4, 5.4], gold, { emit: true }),
        box([3.6, 15, 5, 4, 17, 5.4], gold, { emit: true }),
      ],
    };
  },
};
// Every look's tiles are made now, before any texture is built.
const BUILT: Record<string, Look> = Object.fromEntries(Object.entries(LOOKS).map(([id, make]) => [id, make()]));
export const tallOf = (id: string): number => BUILT[id]?.tall ?? 0.6;

/** A spirit standing at `pos`, facing `yaw`. Its `update` plays its idle life; `lift` is added on top by the game. */
export function critter(id: string, pos: V3, yaw: number, phase: number): Actor {
  const look = (LOOKS[id] ?? LOOKS.leafling!)();
  const parts = look.parts;
  const base = parts[0]!.box.slice() as Box;
  return {
    pos,
    yaw,
    parts,
    update(time) {
      let lift = 0;
      if (look.float) lift = look.float[0] + Math.sin(time * 1.7 + phase) * look.float[1];
      else if (look.hop) {
        const beat = (time + phase * 1.3) % look.hop[0];
        if (beat < 0.5) lift = Math.sin((beat / 0.5) * Math.PI) * look.hop[1];
      }
      if (look.breathe) {
        const b = Math.sin(time * 1.6 + phase) * look.breathe;
        parts[0]!.box[4] = base[4] + b;
        parts[0]!.box[0] = base[0] - b * 0.3;
        parts[0]!.box[3] = base[3] + b * 0.3;
      }
      for (const p of parts) {
        p.off = [0, lift, 0];
        if (p.swing) {
          const [axis, amp, speed, ph, rest] = p.swing;
          const a = rest + Math.sin(time * speed + ph + phase) * amp;
          p.rot = [axis === 0 ? a : 0, axis === 2 ? a : 0, axis === 1 ? a : 0];
        }
      }
    },
  };
}

// ---------- things the game moves about: a cone, a rain cloud ----------

/** A cone, lying where it fell or tumbling through the air. */
export function cone(pos: V3): Actor {
  return {
    pos,
    yaw: 0,
    parts: [
      { box: [-2, 0, -2, 2, 5, 2], tiles: all("cone"), pivot: [0, 2.5, 0] },
      { box: [-1, 5, -1, 1, 6.5, 1], tiles: all("cone"), pivot: [0, 2.5, 0] },
    ],
  };
}
const CLOUD = paint("#e8e4f0", "#cfc8dc");
const CLOUD_DARK = paint("#b8b0c8", "#9a92ac");
/** A small rain cloud, three boxes of it. */
export function cloud(pos: V3): Actor {
  return {
    pos,
    yaw: 0,
    parts: [
      box([-16, 0, -8, 16, 8, 8], CLOUD_DARK),
      box([-10, 6, -6, 8, 14, 6], CLOUD),
      box([-22, 2, -5, -12, 9, 5], CLOUD),
      box([12, 1, -6, 24, 8, 6], CLOUD),
    ],
  };
}
