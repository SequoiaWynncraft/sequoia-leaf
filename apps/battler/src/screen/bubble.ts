/**
 * Yule's Bubble Bath on the table, in five beats (`LOOK-BAR.md`):
 *
 * 1. Wind-up (`LOOKS.yule.wind`): it puffs up to half again its width (its cast picture).
 * 2. The catch (the step it goes off): a bubble closes round each friend it is for in one frame,
 *    one after another, `APART` steps apart; each floats two pixels up.
 * 3. Dread (the rules' own seconds, while they are hidden): the table dims but for the bubbles, and
 *    inside each the friend is drawn in outline only.
 * 4. Release (the step it lands): the bubbles pop together; the friends drop back filled in, their
 *    mana bars ticking bright, the heal's green numbers over them; a bump, the clock held.
 * 5. Aftermath: a wet ring on each hex (`litter.ts`), and Yule its own width again.
 *
 * A bubble is the rules' `hidden` status with Yule as `by`; it is drawn as a bubble and never as an
 * absence. Everything is counted from the step it goes off, on the fight's clock (`hung.ts`).
 */
import { framesOf } from "@sequoia-leaf/figures/sprites.ts";
import { CREAM, WATER } from "@sequoia-leaf/kit/palette.ts";
import { R } from "@sequoia-leaf/kit/pix.ts";
import { clamp, type Ctx, makeCanvas } from "@sequoia-leaf/kit/util.ts";
import type { Fight, FightEvent, UnitKind } from "@sequoia-leaf/raid";

import { clockNow, fightNow, FOOT, FV } from "./board.ts";
import { calling } from "./call.ts";
import { bathOf, fateOf, hangs, type Hung } from "./hung.ts";
import { LOOKS } from "./looks.ts";
import type { Actor } from "./motion.ts";
import { dimRounds, hushing } from "./spells.ts";
import { V } from "./stage.ts";

interface Bubble {
  readonly fight: Fight;
  readonly by: number;
  /** Who is in a bubble, in the order they close. */
  readonly ids: readonly number[];
  readonly hung: Hung;
  landed: boolean;
  readonly land: () => void;
}
const bubbles: Bubble[] = [];

/** How far up a friend in a bubble floats. */
const FLOAT = 2;
/** Steps a bubble is kept after it pops. */
const KEPT = 4;
/** The light round each bubble while the table is dim. */
const POOL = { rx: 14, ry: 11 } as const;

/** Whether a figure's ability shuts its friends in bubbles, so that a friend it hides is drawn in one. */
const shutsInBubbles = (kind: UnitKind | undefined): boolean => kind !== undefined && LOOKS[kind]?.lands === "bubble";

/** Shuts each friend it is for in a bubble from step `at`, one after another, to pop `ticks` steps on with `land`. */
export function hangBubble(ev: Extract<FightEvent, { t: "cast" }>, at: number, land: () => void): void {
  const fight = fightNow();
  if (!fight || ev.targets.length === 0) return land();
  bubbles.push({ fight, by: ev.id, ids: ev.targets, hung: hangs(at, ev.ticks), landed: false, land });
}

/** Pops what is due, filling each friend's mana bar as they come out, and forgets what has popped or never will. */
export function stepBubbles(c: number): void {
  for (const b of bubbles.splice(0)) {
    const fate = b.fight === fightNow() ? fateOf(b.hung, c, b.fight) : "never";
    if (fate === "never") continue;
    // Kept a moment after it pops, so that the friend coming out is known to have been in it.
    if (fate === "hangs" || c < b.hung.lands + KEPT) bubbles.push(b);
    if (fate === "hangs" || b.landed) continue;
    b.landed = true;
    for (const id of b.ids) {
      const a = FV.actors[id];
      if (a) a.giftAt = c;
    }
    b.land();
  }
}

/** Whether a figure is in a bubble of the fight on show, or has just come out of one. */
const wasBubbled = (id: number): boolean => bubbles.some((b) => b.fight === fightNow() && b.ids.includes(id));

/** Whether a status is a bubble going on or off, which this draws, and not a figure going to ground. */
export const bubbleSays = (ev: Extract<FightEvent, { t: "status" }>): boolean =>
  ev.status === "hidden" && (wasBubbled(ev.id) || shutsInBubbles(FV.actors[ev.by]?.unit.kind));

/** How a figure in a bath of the fight on show is drawn now (`bathOf`); null for one in none. */
function bathNow(id: number, c: number): "itself" | "bubble" | null {
  for (const b of bubbles) {
    const i = b.ids.indexOf(id);
    if (i >= 0 && b.fight === fightNow() && !b.landed) return bathOf(b.hung, i, c);
  }
  return null;
}
const inBubble = (id: number, c: number): boolean => bathNow(id, c) === "bubble";

/** Whether a figure the rules have hidden is drawn as itself all the same: its bubble has not closed yet. */
export const waitsForBubble = (id: number): boolean => bathNow(id, clockNow()) === "itself";

const outlines = new WeakMap<HTMLCanvasElement, HTMLCanvasElement>();
/** A picture's dark edge alone, the rest of it clear: a friend drawn in outline only. */
function outlineOf(pic: HTMLCanvasElement): HTMLCanvasElement {
  let out = outlines.get(pic);
  if (out) return out;
  const { c, g } = makeCanvas(pic.width, pic.height);
  g.drawImage(pic, 0, 0);
  const img = g.getImageData(0, 0, c.width, c.height);
  const ink = [0x1a, 0x0f, 0x1e];
  for (let i = 0; i < img.data.length; i += 4) {
    const edge = img.data[i] === ink[0] && img.data[i + 1] === ink[1] && img.data[i + 2] === ink[2];
    if (!edge) img.data[i + 3] = 0;
  }
  g.putImageData(img, 0, 0);
  outlines.set(pic, c);
  return c;
}

/** A bubble round a figure standing with its feet at `x`, `y`: a pale ring with a bright arc at its top left. */
function ring(g: Ctx, x: number, y: number, rx: number, ry: number): void {
  const cy = y - ry;
  g.globalAlpha = 0.18;
  g.fillStyle = WATER[3];
  for (let dy = -ry + 1; dy < ry; dy++) {
    const half = Math.round(rx * Math.sqrt(1 - (dy / ry) ** 2));
    g.fillRect(x - half, cy + dy, half * 2 + 1, 1);
  }
  g.globalAlpha = 1;
  const steps = Math.round((rx + ry) * 4);
  for (let i = 0; i < steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    const px = Math.round(x + Math.cos(t) * rx);
    const py = Math.round(cy + Math.sin(t) * ry);
    const lit = t > Math.PI * 1.05 && t < Math.PI * 1.45;
    R(g, px, py, 1, 1, lit ? CREAM : WATER[3]);
  }
}

/**
 * Draws a figure in a bubble, if it is in one now, with its feet at the screen point `x`, `y`:
 * floated up, in outline only, the bubble round it. Gives back whether it did.
 */
export function drawBubbled(g: Ctx, a: Actor, x: number, y: number): boolean {
  const c = clockNow();
  if (!inBubble(a.unit.id, c)) return false;
  const f = framesOf(a.unit.kind, a.left, a.form);
  const pic = outlineOf(f.idle[0]);
  const top = y - FLOAT;
  g.drawImage(pic, x - f.ax, top - f.ay);
  const rx = Math.max(8, Math.round(f.wide / 2) + 3);
  const ry = Math.max(8, Math.round(f.tall / 2) + 3);
  ring(g, x, top + 2, rx, ry);
  return true;
}

/** The table dim but for the bubbles, under everyone standing on it; none while a seal or a call has it dark. */
export function drawBubblesUnder(g: Ctx): void {
  if (hushing() || calling()) return;
  const c = clockNow();
  const b = bubbles.find((x) => x.fight === fightNow() && !x.landed && c < x.hung.lands);
  if (!b) return;
  const pools = b.ids.flatMap((id) => {
    const a = FV.actors[id];
    return a ? [{ x: Math.round(V.bx + a.x), y: Math.round(V.by + a.y) - FOOT - 8 }] : [];
  });
  dimRounds(g, pools, POOL.rx, POOL.ry, clamp((c - b.hung.at) / 3, 0, 1));
}
