/**
 * The strings of lights slung about the town: where each is tied, how far it sags, and its wire.
 * Both ends of every string are tied to something that could hold them (`TIES`), and it sags
 * between them; nothing hangs from the air.
 */

import { lerp, type Pt } from "@sequoia-leaf/kit/util.ts";

import { trunkHalf } from "./ground.ts";
import { BUILDINGS, POSTS, STALL_FEET, type Trunk, TRUNKS, trunkTall } from "./world.ts";

/** A string of lights: where its two ends are tied, and how far its middle sags below the line between them. */
export interface Strand {
  from: Pt;
  to: Pt;
  sag: number;
}

export const STRINGS: readonly Strand[] = [
  // The Treasury's eave up to the trunk west of the gate, and that trunk to the gate's eave.
  { from: { x: 150, y: 72 }, to: { x: 172, y: 58 }, sag: 5 },
  { from: { x: 220, y: 54 }, to: { x: 228, y: 50 }, sag: 2 },
  // Across the gate, trunk to trunk.
  { from: { x: 222, y: 60 }, to: { x: 290, y: 60 }, sag: 9 },
  // The gate's eave to the trunk east of it, and that trunk down to the Works' eave.
  { from: { x: 284, y: 50 }, to: { x: 292, y: 54 }, sag: 2 },
  { from: { x: 340, y: 58 }, to: { x: 350, y: 70 }, sag: 3 },
  // From the west trunk along the market stalls to the arm of the post past the third.
  { from: { x: 34, y: 190 }, to: { x: 197, y: 243 }, sag: 8 },
  // The arm of the post over the stump's board to the east trunk.
  { from: { x: 433, y: 148 }, to: { x: 488, y: 154 }, sag: 7 },
  // The south-west trunk to the arm of the post by the garden.
  { from: { x: 34, y: 250 }, to: { x: 100, y: 262 }, sag: 5 },
];

/** The wire of a string, a pixel at a time from one end to the other. */
export function wire(s: Strand): Pt[] {
  const { from, to, sag } = s;
  const n = Math.max(2, Math.round(Math.hypot(to.x - from.x, to.y - from.y)));
  const out: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const p = { x: Math.round(lerp(from.x, to.x, t)), y: Math.round(lerp(from.y, to.y, t) + sag * 4 * t * (1 - t)) };
    const last = out[out.length - 1];
    if (last && last.x === p.x && last.y === p.y) continue;
    out.push(p);
  }
  return out;
}

// ---------- what a string can be tied to ----------

/** Something that could hold the end of a string, and whether a point is on it. */
export interface Tie {
  what: string;
  holds: (p: Pt) => boolean;
}

/** A level run of pixels from x1 to x2 on row y (a single pixel when x1 is x2); an end touching it is tied. */
const edge = (what: string, x1: number, x2: number, y: number): Tie => ({
  what,
  holds: (p) => p.x >= x1 - 1 && p.x <= x2 + 1 && Math.abs(p.y - y) <= 1,
});

/** Anywhere on a trunk's bark, clear of the ragged foot. */
const trunk = (t: Trunk): Tie => ({
  what: `the trunk at ${t.x},${t.y}`,
  holds: (p) => {
    const tall = trunkTall(t);
    const row = p.y - t.y + tall - 1;
    return row >= 0 && p.y <= t.y - 8 && Math.abs(p.x - t.x + 0.5) < trunkHalf(t.hw, tall, t.seed, row);
  },
});

const { treasury, works, gate } = BUILDINGS;

/**
 * Everything in town a string can be tied to, worked out from where it stands and how it is drawn
 * (`post()`, `stall()`, `treasury()`, `gate()` and `works()` in sprites.ts, `paintTrunk` in ground.ts).
 */
export const TIES: readonly Tie[] = [
  // The tip of a lantern post's arm.
  ...POSTS.map((p) => edge(`the arm of the post at ${p.x},${p.y}`, p.x + 9, p.x + 9, p.y - 33)),
  // The corners of a stall's awning.
  ...STALL_FEET.flatMap((s) =>
    [s.x, s.x + 39].flatMap((x) => [s.y - 44, s.y - 39].map((y) => edge(`the stall at ${s.x},${s.y}`, x, x, y))),
  ),
  // The eaves.
  edge("the Treasury's eave", treasury.x, treasury.x + 95, treasury.y - 47),
  edge("the gate's eave", gate.x - 31, gate.x + 30, gate.y - 47),
  edge("the Works' eave", works.x, works.x + 103, works.y - 49),
  ...TRUNKS.map(trunk),
];

/** What a point is tied to, if anything. */
export const tieAt = (p: Pt): Tie | undefined => TIES.find((t) => t.holds(p));
