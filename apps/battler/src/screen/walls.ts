/**
 * Bhlue's Firewall on the table: a low wall of warm bricks settles in front of each friend it is
 * given to, and stays for as long as their `firewall` lasts. When a wall blocks an enemy's ability
 * (`block`), its bricks flash, that one wall is gone, and Bhlue cheers (its cast picture) for four
 * steps. All of it belongs to the fight on show.
 */
import { BARK, CORAL, CREAM, INK } from "@sequoia-leaf/kit/palette.ts";
import { R } from "@sequoia-leaf/kit/pix.ts";
import { clamp, type Ctx } from "@sequoia-leaf/kit/util.ts";
import type { Fight } from "@sequoia-leaf/raid";

import { clockNow, fightNow, FV } from "./board.ts";
import { burst } from "./fx.ts";
import { snd } from "./sounds.ts";
import { V } from "./stage.ts";

interface Wall {
  /** Who it stands in front of, and whose Firewall it is. */
  readonly id: number;
  readonly by: number;
  readonly from: number;
  /** When it blocked, flashing until it is gone. */
  blockedAt: number;
}
const W: { fight: Fight | null; walls: Wall[] } = { fight: null, walls: [] };

/** Steps the bricks take to settle, and to flash before they go. */
const SETTLE = 3;
const FLASH = 4;
/** Steps Bhlue cheers for when a wall of its blocks. */
const CHEER = 4;

function current(): Wall[] {
  const f = fightNow();
  if (W.fight !== f) {
    W.fight = f;
    W.walls = [];
  }
  return W.walls;
}

/** A wall settles in front of `id` from step `at`, Bhlue's (`by`). */
export function wallUp(id: number, by: number, at: number): void {
  const walls = current().filter((w) => w.id !== id);
  walls.push({ id, by, from: at, blockedAt: Infinity });
  W.walls = walls;
}

/** The wall in front of `id` is gone, its seconds over. */
export function wallDown(id: number): void {
  W.walls = current().filter((w) => w.id !== id || w.blockedAt !== Infinity);
}

/** It blocks an enemy's ability on `id` at step `at`: the bricks flash and go, and Bhlue cheers. */
export function blocked(id: number, at: number): void {
  const wall = current().find((w) => w.id === id && w.blockedAt === Infinity);
  const a = FV.actors[id];
  if (a) burst(a.x, a.y - 2, 6, [CORAL, CREAM, BARK[3]], { speed: 28, ttl: 0.3 });
  snd.ability({ n: 7, wave: "square", two: 5, hiss: 1800, vol: 0.06 });
  if (!wall) return;
  wall.blockedAt = at;
  const bhlue = FV.actors[wall.by];
  if (bhlue?.unit.alive) bhlue.castUntil = Math.max(bhlue.castUntil, at + CHEER);
}

/** Two courses of bricks, thirteen pixels across, standing on the front of a figure's base. */
function bricks(g: Ctx, x: number, y: number, lit: boolean): void {
  const face = lit ? CREAM : CORAL;
  R(g, x - 7, y - 4, 15, 6, INK);
  R(g, x - 6, y - 3, 13, 4, BARK[3]);
  for (const [dx, dy, w] of [
    [-6, -3, 3],
    [-2, -3, 3],
    [2, -3, 3],
    [6, -3, 1],
    [-6, -1, 1],
    [-4, -1, 3],
    [0, -1, 3],
    [4, -1, 3],
  ] as const)
    R(g, x + dx, y + dy, w, 1, face);
}

/** The walls standing now, over the figures they stand in front of. */
export function drawWalls(g: Ctx): void {
  const c = clockNow();
  W.walls = current().filter((w) => c < w.blockedAt + FLASH);
  for (const w of W.walls) {
    const a = FV.actors[w.id];
    if (!a?.unit.alive || c < w.from) continue;
    const back = a.unit.side === FV.ours ? 0 : Math.round(V.gap);
    const drop = Math.round(clamp(1 - (c - w.from) / SETTLE, 0, 1) * 4);
    const lit = c >= w.blockedAt && Math.floor(c) % 2 === 0;
    bricks(g, Math.round(V.bx + a.x), Math.round(V.by + a.y - back) + 1 - drop, lit);
  }
}
