/**
 * What abilities leave lying on the table for the rest of a fight, under the figures: chips of
 * shell where Peep's hat shattered and where Munch bit, the two halves of the egg a Hatchling came
 * out of, the wet print Crab #8 leaves on the hex it came up from (for a second), and chips under
 * every figure a Grooter has cracked, more as it cracks (the Grooter origin's mark on the board).
 *
 * Everything lies where it fell, in board pixels, but the chips of a crack, which follow whoever
 * is cracked. All of it belongs to the fight on show and goes with it.
 */
import { CREAM, INK, PAPER, WATER } from "@sequoia-leaf/kit/palette.ts";
import { R } from "@sequoia-leaf/kit/pix.ts";
import { clamp, type Ctx } from "@sequoia-leaf/kit/util.ts";
import type { Fight } from "@sequoia-leaf/raid";

import { clockNow, fightNow, FV } from "./board.ts";
import { burst } from "./fx.ts";
import type { Pt } from "./geometry.ts";
import type { Actor } from "./motion.ts";
import { snd } from "./sounds.ts";
import { V } from "./stage.ts";

/** What lies on a hex: chips of shell, an egg's two halves, or a wet print that dries. */
type Kind = "chips" | "halves" | "print";
interface Left {
  readonly fight: Fight;
  readonly kind: Kind;
  readonly at: Pt;
  /** How many chips, and from which step it lies there (a print dries a second after). */
  readonly n: number;
  readonly t0: number;
}
const L: { left: Left[]; cracked: Map<number, number>; fight: Fight | null } = {
  left: [],
  cracked: new Map(),
  fight: null,
};

/** Steps a wet print takes to dry. */
const DRIES = 20;
/** Chips under a cracked figure: one for each this many points of armour and ward taken, up to six. */
const CHIP_PER = 8;
const MOST = 6;

/** Forgets what lay on the table of any fight but the one on show. */
function current(): Fight | null {
  const f = fightNow();
  if (L.fight !== f) {
    L.left = [];
    L.cracked.clear();
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

/** A wet print, drying: a darker smear on the wood with a glint of water. */
function print(g: Ctx, x: number, y: number, k: number): void {
  g.globalAlpha = 0.6 * (1 - k);
  R(g, x - 5, y - 1, 10, 3, INK);
  R(g, x - 3, y - 2, 6, 1, INK);
  R(g, x - 1, y, 2, 1, WATER[3]);
  g.globalAlpha = 1;
}

/** What lies on the table, under everyone standing on it. */
export function drawLitter(g: Ctx): void {
  const f = current();
  if (!f) return;
  const c = clockNow();
  L.left = L.left.filter((l) => l.kind !== "print" || c < l.t0 + DRIES);
  L.left.forEach((l, i) => {
    if (c < l.t0) return;
    const x = Math.round(V.bx + l.at.x);
    const y = Math.round(V.by + l.at.y);
    if (l.kind === "chips") chips(g, x, y, l.n, i + 1);
    else if (l.kind === "halves") halves(g, x, y);
    else print(g, x, y, clamp((c - l.t0) / DRIES, 0, 1));
  });
  for (const [id, total] of L.cracked) {
    const a = FV.actors[id];
    if (!a || a.gone || !a.unit.alive) continue;
    const n = clamp(Math.ceil(total / CHIP_PER), 1, MOST);
    chips(g, Math.round(V.bx + a.x), Math.round(V.by + a.y) + 1, n, id + 31);
  }
}
