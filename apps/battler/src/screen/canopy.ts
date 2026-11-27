/**
 * The Canopy origin on the table: its figures start the fight up the tree, where nothing reaches
 * them (hidden from the fight's first step). For as long as they are up, a branch lies across over
 * their party, the width of the board, with each of them along it, evenly spaced in the order of
 * their seats: sitting on it, as red pandas do, and Flop hanging under it by its tail. As each
 * comes down (its `hidden` ends) it jumps down onto its seat with a thump, and a leaf comes down
 * after it.
 *
 * Who is up the tree is whoever is hidden as the fight opens: nothing else hides anyone before the
 * first step. All of it belongs to the fight on show.
 */
import { drawFigure, framesOf } from "@sequoia-leaf/figures/sprites.ts";
import { BARK, GREEN, INK, LEAF } from "@sequoia-leaf/kit/palette.ts";
import { R } from "@sequoia-leaf/kit/pix.ts";
import type { Ctx } from "@sequoia-leaf/kit/util.ts";
import type { Fight } from "@sequoia-leaf/raid";
import { cellAt, COLS, type Side } from "@sequoia-leaf/raid/hex.ts";

import { feetAt, fightNow, FV } from "./board.ts";
import { burst } from "./fx.ts";
import type { Pt } from "./geometry.ts";
import type { Actor } from "./motion.ts";
import { snd } from "./sounds.ts";
import { V } from "./stage.ts";

/** Who of the fight on show started it up the tree, and who of them has come down. */
const UP: { fight: Fight | null; all: readonly number[]; down: Set<number> } = {
  fight: null,
  all: [],
  down: new Set(),
};

/** Steps a figure takes to jump down from the branch to its seat, and how high it goes on the way. */
const DROP = 6;
const ARC = 6;
/** How far over the highest of their seats the branch lies, in pixels, and how far past the board's edge hexes it reaches. */
const OVER = 12;
const PAST = 6;
/** Flop hangs under it by its tail; everyone else sits on it. */
const BY_TAIL = new Set(["flop"]);

function upTree(): typeof UP {
  const f = fightNow();
  if (UP.fight !== f) {
    UP.fight = f;
    UP.all = f && f.tick === 0 ? f.units.filter((u) => u.hiddenUntil > 0).map((u) => u.id) : [];
    UP.down = new Set();
  }
  return UP;
}

/** Whether a figure is up the tree now: it started there and has not come down. */
export const hanging = (a: Actor): boolean => {
  const f = fightNow();
  const up = upTree();
  return f !== null && up.all.includes(a.unit.id) && !up.down.has(a.unit.id) && a.unit.alive;
};

/** A side's branch: the board's width over its highest seat, at `y` from the board's corner, from `x0` to `x1`. */
function branchOf(side: Side): { x0: number; x1: number; y: number } {
  const ids = upTree().all.flatMap((id) => {
    const a = FV.actors[id];
    return a && a.unit.side === side ? [a] : [];
  });
  const top = Math.min(...ids.map((a) => feetAt(a.unit.cell).y));
  const row = side === FV.ours ? 4 : 3;
  const ends = [feetAt(cellAt(0, row)).x, feetAt(cellAt(COLS - 1, row)).x];
  return { x0: Math.min(...ends) - PAST, x1: Math.max(...ends) + PAST, y: top - OVER };
}

/** Where on its side's branch a figure is: evenly along it, in the order of their seats from our left. */
function perchOf(a: Actor): Pt {
  const side = a.unit.side;
  const mine = upTree()
    .all.flatMap((id) => {
      const o = FV.actors[id];
      return o && o.unit.side === side ? [o] : [];
    })
    .toSorted((p, q) => feetAt(p.unit.cell).x - feetAt(q.unit.cell).x || p.unit.id - q.unit.id);
  const b = branchOf(side);
  const i = mine.indexOf(a);
  return { x: Math.round(b.x0 + ((b.x1 - b.x0) * (i + 1)) / (mine.length + 1)), y: b.y };
}

/** Comes down out of the tree onto its seat at step `at`: a jump, a thump, and a leaf after it. Gives back whether it was up there. */
export function droppedDown(a: Actor, at: number): boolean {
  if (!hanging(a)) return false;
  const from = perchOf(a);
  upTree().down.add(a.unit.id);
  const seat = feetAt(a.unit.cell);
  a.x = from.x;
  a.y = from.y;
  a.move = { from, to: seat, t0: at, dur: DROP, arc: ARC, smooth: false, under: false };
  a.landAt = at + DROP;
  burst(seat.x + 3, seat.y - 34, 1, [LEAF, GREEN[4]], {
    speed: 4,
    grav: 8,
    ttl: 1.4,
    toward: Math.PI / 2,
    spread: 0.6,
  });
  snd.ability({ n: -16, wave: "triangle", hiss: 400, slide: 0.6, vol: 0.08 });
  return true;
}

/** A branch from `x0` to `x1` at `y`: bark with a darker underside, a few leaves along its top, a knot here and there. */
function branch(g: Ctx, x0: number, x1: number, y: number): void {
  R(g, x0 - 1, y - 1, x1 - x0 + 2, 5, INK);
  R(g, x0, y, x1 - x0, 2, BARK[3]);
  R(g, x0, y + 2, x1 - x0, 1, BARK[1]);
  for (let x = x0 + 5; x < x1 - 3; x += 11) {
    R(g, x - 1, y - 3, 4, 3, INK);
    R(g, x, y - 2, 2, 2, Math.floor(x / 11) % 2 === 0 ? GREEN[3] : GREEN[4]);
  }
}

/** Each side's branch with whoever is up it, over everyone standing on the table. */
export function drawCanopy(g: Ctx): void {
  if (!fightNow()) return;
  for (const side of [0, 1] as const) {
    const up = FV.actors.filter((a): a is Actor => a !== undefined && a.unit.side === side && hanging(a));
    if (up.length === 0) continue;
    const back = side === FV.ours ? 0 : Math.round(V.gap);
    const b = branchOf(side);
    const y = Math.round(V.by + b.y - back);
    branch(g, Math.round(V.bx + b.x0), Math.round(V.bx + b.x1), y);
    for (const a of up) {
      const p = perchOf(a);
      const x = Math.round(V.bx + p.x);
      if (BY_TAIL.has(a.unit.kind)) {
        // Upside down, its tail round the branch: the picture flipped about the branch's underside.
        const tall = framesOf(a.unit.kind).tall;
        g.save();
        g.translate(0, 2 * (y + 3) + tall);
        g.scale(1, -1);
        drawFigure(g, a.unit.kind, x, y + 3 + tall, { left: a.left });
        g.restore();
      } else drawFigure(g, a.unit.kind, x, y + 1, { left: a.left });
    }
  }
}
