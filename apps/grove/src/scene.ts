import type { Creature } from "./art/creatures.ts";
import { CAMPFIRE, STAND } from "./art/items.ts";
import { PALETTE } from "./art/palette.ts";
import { draw, type Sprite } from "./art/sprite.ts";

// The grove: a little side-on diorama, drawn at a low resolution and scaled up
// by whole pixels. Your bonsai sits on its stand in a clearing among giant
// sequoias; your Sprites potter about; the sky follows the time of day.

export const WIDTH = 240;
export const HEIGHT = 150;
const GROUND = 118;

export type TimeOfDay = "morning" | "day" | "golden" | "dusk" | "night";

const SKIES: Record<TimeOfDay, readonly string[]> = {
  morning: ["#cfe4ea", "#dcebe7", "#eef0dd", "#f6ecd4"],
  day: ["#9fcfe0", "#b5dbe4", "#cbe5e5", "#e3f2f2"],
  golden: ["#e8c48a", "#f0cf8f", "#f3d9a0", "#f7e6bd"],
  dusk: ["#46507a", "#6b5a8e", "#a46d8c", "#e58e55"],
  night: ["#151b33", "#1d2547", "#283157", "#323c66"],
};

/** How strongly the distance fades into the sky, per time of day. */
const MIST: Record<TimeOfDay, string> = {
  morning: "#e6ece2",
  day: "#d6ebec",
  golden: "#f2d7a2",
  dusk: "#8a6a8f",
  night: "#2a3358",
};

function mix(a: string, b: string, t: number): string {
  const pa = Number.parseInt(a.slice(1), 16);
  const pb = Number.parseInt(b.slice(1), 16);
  const channel = (shift: number) =>
    Math.round(((pa >> shift) & 255) * (1 - t) + ((pb >> shift) & 255) * t)
      .toString(16)
      .padStart(2, "0");
  return `#${channel(16)}${channel(8)}${channel(0)}`;
}

export function timeOfDay(hour: number): TimeOfDay {
  if (hour >= 5 && hour < 9) return "morning";
  if (hour >= 9 && hour < 16) return "day";
  if (hour >= 16 && hour < 19) return "golden";
  if (hour >= 19 && hour < 21) return "dusk";
  return "night";
}

/** A giant trunk in the distance: a tall column with furrows, faded into the mist. */
function farTrunk(context: CanvasRenderingContext2D, x: number, width: number, fade: number, time: TimeOfDay) {
  const mist = MIST[time];
  const base = [PALETTE.b, PALETTE.B, PALETTE.r].map((color) => mix(color, mist, fade));
  for (let y = 0; y < GROUND + 4; y += 1) {
    const flare = Math.max(0, y - (GROUND - 10)) * 0.6;
    const left = Math.round(x - flare);
    const span = Math.round(width + flare * 2);
    for (let i = 0; i < span; i += 1) {
      const furrow = (i + Math.floor(y / 5)) % 4 === 0;
      context.fillStyle =
        i <= 1 ? (base[2] ?? "") : i >= span - 3 ? (base[0] ?? "") : furrow ? (base[0] ?? "") : (base[1] ?? "");
      context.fillRect(left + i, y, 1, 1);
    }
  }
}

/** A band of ferns and undergrowth along the back of the clearing. */
function undergrowth(context: CanvasRenderingContext2D, time: TimeOfDay, fade: number, y: number, seed: number) {
  const colors = [PALETTE.g, PALETTE.G, PALETTE.f].map((color) => mix(color, MIST[time], fade));
  for (let x = 0; x < WIDTH; x += 1) {
    // A gentle, hand-tuned rhythm of fronds rather than noise: two waves beating together.
    const height = 4 + Math.round(2.5 * Math.sin((x + seed) / 5.3) + 1.5 * Math.sin((x + seed * 2) / 2.1));
    for (let h = 0; h < height; h += 1) {
      context.fillStyle = h === height - 1 ? (colors[2] ?? "") : h > height - 3 ? (colors[1] ?? "") : (colors[0] ?? "");
      context.fillRect(x, y - h, 1, 1);
    }
  }
}

/** The forest roof: clumps of needles across the top, so the trunks rise into it and the clearing is framed. */
function canopy(context: CanvasRenderingContext2D, time: TimeOfDay) {
  const night = time === "night" ? 0.5 : time === "dusk" ? 0.3 : 0;
  const colors = [PALETTE.g, PALETTE.G, PALETTE.f, PALETTE.F].map((color) => mix(color, "#151b33", night));
  for (let x = 0; x < WIDTH; x += 1) {
    // Deep at the sides, thin over the middle where the sky shows through.
    const edge = Math.min(x, WIDTH - x) / (WIDTH / 2);
    const depth = Math.round(26 - 20 * edge + 3 * Math.sin(x / 4.7) + 2 * Math.sin(x / 1.9 + 1));
    for (let y = 0; y < depth; y += 1) {
      context.fillStyle =
        y === depth - 1
          ? (colors[3] ?? "")
          : y > depth - 3
            ? (colors[2] ?? "")
            : y > depth - 6
              ? (colors[1] ?? "")
              : (colors[0] ?? "");
      context.fillRect(x, y, 1, 1);
    }
  }
}

/** A warm, stepped circle of firelight, dithered at its rim like a sprite would be. */
function firelight(context: CanvasRenderingContext2D, cx: number, cy: number, time: TimeOfDay) {
  if (time !== "dusk" && time !== "night") return;
  context.save();
  for (const [radius, alpha] of [
    [26, 0.07],
    [18, 0.08],
    [11, 0.1],
  ] as const) {
    context.globalAlpha = alpha;
    context.fillStyle = "#f3d06a";
    for (let y = -radius; y <= radius; y += 1) {
      for (let x = -radius; x <= radius; x += 1) {
        const d = Math.hypot(x, y * 1.6);
        if (d <= radius - 2 || (d <= radius && (x + y) % 2 === 0)) context.fillRect(cx + x, cy + y, 1, 1);
      }
    }
  }
  context.restore();
}

function ground(context: CanvasRenderingContext2D, time: TimeOfDay) {
  const dark = time === "night" ? 0.45 : time === "dusk" ? 0.25 : 0;
  const shade = (color: string) => mix(color, "#151b33", dark);
  context.fillStyle = shade(PALETTE.M);
  context.fillRect(0, GROUND, WIDTH, 3);
  context.fillStyle = shade(PALETTE.G);
  context.fillRect(0, GROUND + 3, WIDTH, HEIGHT - GROUND);
  // A worn path of needles and earth to the stand.
  context.fillStyle = shade(PALETTE.m);
  for (let y = GROUND + 4; y < HEIGHT; y += 1) {
    const half = 18 + (y - GROUND) * 1.6;
    context.fillRect(WIDTH / 2 - half, y, half * 2, 1);
  }
  // Needles and pebbles along the path.
  for (const [x, y, key] of [
    [112, 124, "K"],
    [126, 129, "K"],
    [104, 135, "k"],
    [138, 141, "K"],
    [96, 146, "k"],
    [131, 120, "k"],
    [147, 133, "K"],
  ] as const) {
    context.fillStyle = shade(PALETTE[key]);
    context.fillRect(x, y, 2, 1);
  }
  // Moss tufts and fallen needles, placed by hand.
  const tufts = [12, 31, 44, 63, 171, 186, 203, 222, 98, 140];
  for (const [i, x] of tufts.entries()) {
    const y = GROUND + 2 + ((i * 7) % 9);
    context.fillStyle = shade(PALETTE.n);
    context.fillRect(x, y, 3, 1);
    context.fillRect(x + 1, y - 1, 1, 1);
  }
}

/** Shafts of low sun through the canopy. */
function sunbeams(context: CanvasRenderingContext2D, time: TimeOfDay) {
  if (time !== "golden" && time !== "morning") return;
  context.save();
  context.globalAlpha = time === "golden" ? 0.16 : 0.1;
  context.fillStyle = "#fff4cf";
  for (const [x, width] of [
    [36, 10],
    [92, 6],
    [158, 12],
    [206, 5],
  ] as const) {
    for (let y = 0; y < GROUND; y += 1) {
      context.fillRect(x + Math.floor(y * 0.45), y, width, 1);
    }
  }
  context.restore();
}

export interface GroveState {
  /** Where the lantern hangs, for its glow after dark. */
  readonly lights?: readonly { x: number; y: number }[];
  readonly time: TimeOfDay;
  readonly tree: Sprite;
  readonly decorations: readonly { sprite: Sprite; x: number; y: number }[];
  readonly creatures: readonly { creature: Creature; x: number }[];
  readonly campfire: boolean;
  /** Whether to draw the stand and the tree in the middle; a gathering draws its own. */
  readonly centrePiece?: boolean;
}

/** Draws one frame of the grove. `tick` advances the idle animations. */
export function drawGrove(context: CanvasRenderingContext2D, state: GroveState, tick: number): void {
  const { time } = state;
  // Twelve bands stepped between the sky's colours: soft, but still visibly pixel-made.
  const sky = SKIES[time];
  const bands = 12;
  const band = Math.ceil(GROUND / bands);
  for (let i = 0; i < bands; i += 1) {
    const t = (i / (bands - 1)) * (sky.length - 1);
    const from = sky[Math.floor(t)] ?? "#000000";
    const to = sky[Math.min(sky.length - 1, Math.floor(t) + 1)] ?? from;
    context.fillStyle = mix(from, to, t - Math.floor(t));
    context.fillRect(0, i * band, WIDTH, band);
  }
  if (time === "night") {
    context.fillStyle = "#e3f2f2";
    for (const [x, y] of [
      [20, 8],
      [57, 20],
      [88, 6],
      [131, 15],
      [177, 9],
      [214, 24],
      [230, 5],
    ] as const) {
      if ((tick + x) % 90 > 6) context.fillRect(x, y, 1, 1);
    }
  }
  farTrunk(context, 6, 18, 0.72, time);
  farTrunk(context, 196, 22, 0.72, time);
  farTrunk(context, 58, 10, 0.82, time);
  farTrunk(context, 166, 12, 0.8, time);
  canopy(context, time);
  undergrowth(context, time, 0.55, GROUND - 2, 3);
  farTrunk(context, -14, 26, 0.35, time);
  farTrunk(context, 222, 28, 0.35, time);
  sunbeams(context, time);
  undergrowth(context, time, 0.15, GROUND + 1, 17);
  ground(context, time);

  const scale = 1;
  if (state.centrePiece !== false) {
    const standX = Math.floor((WIDTH - STAND.width) / 2);
    const standY = GROUND - STAND.height + 6;
    draw(context, STAND, standX, standY, scale);
    const treeX = Math.floor((WIDTH - state.tree.width) / 2);
    draw(context, state.tree, treeX, standY - state.tree.height + 1, scale);
  }

  for (const light of state.lights ?? []) {
    firelight(context, light.x, light.y, time);
  }
  for (const decoration of state.decorations) {
    draw(context, decoration.sprite, decoration.x, decoration.y, scale);
  }
  if (state.campfire) {
    const fire = CAMPFIRE[Math.floor(tick / 12) % 2];
    if (fire !== undefined) {
      firelight(context, 37, GROUND + 12, time);
      draw(context, fire, 30, GROUND + 6, scale);
    }
  }
  for (const [i, { creature, x }] of state.creatures.entries()) {
    const frame = creature.frames[Math.floor((tick + i * 17) / 30) % 2];
    if (frame !== undefined) {
      draw(context, frame, x, GROUND + 14 - frame.height + (i % 2) * 6, scale);
    }
  }
  // Fireflies after dark, drifting on slow loops.
  if (time === "dusk" || time === "night") {
    context.fillStyle = "#f3d06a";
    for (let i = 0; i < 9; i += 1) {
      const x = (i * 29 + Math.round(8 * Math.sin((tick + i * 40) / 50))) % WIDTH;
      const y = 60 + ((i * 23) % 50) + Math.round(5 * Math.cos((tick + i * 31) / 37));
      if ((tick + i * 13) % 80 < 60) context.fillRect(x, y, 1, 1);
    }
  }
  // Evening and night tint everything a little towards blue.
  if (time === "dusk" || time === "night") {
    context.save();
    context.globalAlpha = time === "night" ? 0.32 : 0.14;
    context.fillStyle = "#1d2547";
    context.fillRect(0, 0, WIDTH, HEIGHT);
    context.restore();
  }
}
