/**
 * What abilities leave lying on the table for the rest of a fight, under the figures: chips of
 * shell where Peep's hat shattered and where Munch bit, the two halves of the egg a Hatchling came
 * out of, the wet print Crab #8 leaves on the hex it came up from (for a second), and chips under
 * every figure a Grooter has cracked, more as it cracks (the Grooter origin's mark on the board);
 * the bank of snow Dibs pats up round a friend, which melts as its shield goes, and the wet ring a
 * bubble of Yule's leaves; and a low bank of snow under every Huddle figure whose group's shield
 * holds, which all fall in the same frame when it breaks (the Huddle origin's mark).
 *
 * Everything lies where it fell, in board pixels, but the chips of a crack and the banks of a
 * group's shield, which follow whoever they are under. All of it belongs to the fight on show and
 * goes with it.
 */
import { CREAM, INK, PAPER, WATER } from "@sequoia-leaf/kit/palette.ts";
import { R } from "@sequoia-leaf/kit/pix.ts";
import { clamp, type Ctx } from "@sequoia-leaf/kit/util.ts";
import type { Fight, FightEvent } from "@sequoia-leaf/raid";

import { clockNow, fightNow, FV } from "./board.ts";
import { burst } from "./fx.ts";
import type { Pt } from "./geometry.ts";
import type { Actor } from "./motion.ts";
import { snd } from "./sounds.ts";
import { V } from "./stage.ts";

/** What lies on a hex: chips of shell, an egg's two halves, a wet print or ring that dries, or a bank of snow that melts. */
type Kind = "chips" | "halves" | "print" | "ring" | "bank";
interface Left {
  readonly fight: Fight;
  readonly kind: Kind;
  readonly at: Pt;
  /** How many chips, and from which step it lies there (a print dries a second after). */
  readonly n: number;
  readonly t0: number;
}
const L: { left: Left[]; cracked: Map<number, number>; pools: Map<number, boolean>; fight: Fight | null } = {
  left: [],
  cracked: new Map(),
  pools: new Map(),
  fight: null,
};

/** Steps a wet print or ring takes to dry, and a bank of Dibs's lasts (its shield's 4 seconds). */
const DRIES = 20;
const MELTS = 80;
/** How long each thing lies there, in steps; chips and halves for the rest of the fight. */
const LASTS: Partial<Record<Kind, number>> = { print: DRIES, ring: DRIES, bank: MELTS };
/** Chips under a cracked figure: one for each this many points of armour and ward taken, up to six. */
const CHIP_PER = 8;
const MOST = 6;

/** Forgets what lay on the table of any fight but the one on show. */
function current(): Fight | null {
  const f = fightNow();
  if (L.fight !== f) {
    L.left = [];
    L.cracked.clear();
    L.pools.clear();
    L.fight = f;
  }
  return f;
}

/** Leaves something on the table at a spot (a figure's feet), from now. */
export function leave(kind: Kind, at: Pt, n = 1): void {
  const fight = current();
  if (fight) L.left.push({ fight, kind, at, n, t0: clockNow() });
}

/** The dry crack of a Grooter's hit taking armour and ward off. */
const CRACK = { n: 26, wave: "square", hiss: 5200, slide: 0.4, vol: 0.03 } as const;
/** A figure has been cracked by `total` armour and ward so far this fight: a dry crack, chips off it, and more lying under it. */
export function cracked(a: Actor, total: number): void {
  if (!current()) return;
  L.cracked.set(a.unit.id, total);
  burst(a.x, a.y - 6, 4, [CREAM, PAPER[2]], { speed: 26, ttl: 0.3 });
  snd.ability(CRACK);
}

/** A group's shield made or back: a pat. Broken: a crunch, and every bank of the group falls in that frame. */
const PAT = { n: -7, wave: "triangle", hiss: 900, slide: 0.8, vol: 0.05 } as const;
const CRUNCH = { n: -12, wave: "square", hiss: 2400, slide: 0.5, vol: 0.06 } as const;
/** A group's shield changed (Huddle): banks settle under its figures, or all fall at once. */
export function pooled(ev: Extract<FightEvent, { t: "pool" }>): void {
  if (!current()) return;
  const was = L.pools.get(ev.group) ?? false;
  L.pools.set(ev.group, ev.on);
  if (ev.on && !was) snd.ability(PAT);
  if (ev.on) return;
  for (const id of ev.ids) {
    const a = FV.actors[id];
    if (a && a.unit.alive)
      burst(a.x, a.y - 1, 6, [CREAM, WATER[3]], { speed: 30, toward: -Math.PI / 2, spread: 2, ttl: 0.35 });
  }
  snd.ability(CRUNCH);
}

/** A small hash of whole numbers, for scattering chips the same way every frame. */
const scatter = (i: number, seed: number): number => ((i * 73 + seed * 151) % 97) / 97;

/** Chips of shell round a spot: each two pixels of cream with a darker underside, edged. */
function chips(g: Ctx, x: number, y: number, n: number, seed: number): void {
  for (let i = 0; i < n; i++) {
    const cx = Math.round(x + (scatter(i, seed) - 0.5) * 12);
    const cy = Math.round(y + (scatter(i + 7, seed) - 0.5) * 4);
    R(g, cx - 1, cy - 1, 4, 3, INK);
    R(g, cx, cy, 2, 1, i % 2 === 0 ? CREAM : PAPER[2]);
  }
}

/** The two halves of an egg, lying open either side of a spot. */
function halves(g: Ctx, x: number, y: number): void {
  for (const side of [-1, 1] as const) {
    const hx = x + side * 4 - (side === 1 ? 3 : 0);
    R(g, hx - 1, y - 2, 6, 4, INK);
    R(g, hx, y - 1, 4, 2, CREAM);
    R(g, hx + (side === 1 ? 0 : 1), y - 1, 3, 1, PAPER[1]);
    // The jagged rim of each half, up toward where the egg was.
    R(g, hx + (side === 1 ? 0 : 3), y - 2, 1, 1, CREAM);
  }
}

/** A wet print, drying: a smear of water on the wood (a stain: one tone, no edge). */
function print(g: Ctx, x: number, y: number, k: number): void {
  g.globalAlpha = 0.6 * (1 - k);
  R(g, x - 5, y - 1, 10, 3, WATER[2]);
  R(g, x - 3, y - 2, 6, 1, WATER[2]);
  g.globalAlpha = 1;
}

/** A wet ring on a hex round a figure's base, drying: a one-pixel line of water (a stain: one tone, no edge). */
function wetRing(g: Ctx, x: number, y: number, k: number): void {
  g.globalAlpha = 0.8 * (1 - k);
  R(g, x - 8, y - 4, 16, 1, WATER[2]);
  R(g, x - 8, y + 3, 16, 1, WATER[2]);
  R(g, x - 11, y - 3, 3, 1, WATER[2]);
  R(g, x + 8, y - 3, 3, 1, WATER[2]);
  R(g, x - 11, y + 2, 3, 1, WATER[2]);
  R(g, x + 8, y + 2, 3, 1, WATER[2]);
  R(g, x - 12, y - 2, 1, 4, WATER[2]);
  R(g, x + 11, y - 2, 1, 4, WATER[2]);
  g.globalAlpha = 1;
}

/** The lumps of a bank of snow, left to right: where each starts, how wide and how tall it is. */
const LUMPS: readonly (readonly [x: number, w: number, h: number])[] = [
  [-12, 6, 3],
  [-8, 6, 4],
  [-3, 6, 3],
  [2, 6, 4],
  [7, 5, 3],
];
/** A low bank of snow behind a figure's base, its lumps showing either side, never taller than 4 so it hides no feet; a pixel lower as it melts (`k` of the way). */
function bank(g: Ctx, x: number, y: number, k = 0): void {
  const low = k > 0.5 ? 1 : 0;
  for (const [dx, w, h] of LUMPS) R(g, x + dx - 1, y - h - 1 + low, w + 2, h + 2 - low, INK);
  for (const [dx, w, h] of LUMPS) {
    R(g, x + dx, y - h + low, w, h - low, PAPER[2]);
    R(g, x + dx, y - 1, w, 1, WATER[3]);
  }
}

/** What lies on the table, under everyone standing on it. */
export function drawLitter(g: Ctx): void {
  const f = current();
  if (!f) return;
  const c = clockNow();
  L.left = L.left.filter((l) => c < l.t0 + (LASTS[l.kind] ?? Infinity));
  L.left.forEach((l, i) => {
    if (c < l.t0) return;
    const x = Math.round(V.bx + l.at.x);
    const y = Math.round(V.by + l.at.y);
    if (l.kind === "chips") chips(g, x, y, l.n, i + 1);
    else if (l.kind === "halves") halves(g, x, y);
    else if (l.kind === "print") print(g, x, y, clamp((c - l.t0) / DRIES, 0, 1));
    else if (l.kind === "ring") wetRing(g, x, y, clamp((c - l.t0) / DRIES, 0, 1));
    else bank(g, x, y, clamp((c - l.t0) / MELTS, 0, 1));
  });
  // Huddle: a bank under everyone whose group's shield holds.
  for (const a of FV.actors) {
    const pool = a ? f.pools[a.unit.pool] : undefined;
    if (a && !a.gone && a.unit.alive && pool && pool.left > 0) bank(g, Math.round(V.bx + a.x), Math.round(V.by + a.y));
  }
  for (const [id, total] of L.cracked) {
    const a = FV.actors[id];
    if (!a || a.gone || !a.unit.alive) continue;
    const n = clamp(Math.ceil(total / CHIP_PER), 1, MOST);
    chips(g, Math.round(V.bx + a.x), Math.round(V.by + a.y) + 1, n, id + 31);
  }
}
