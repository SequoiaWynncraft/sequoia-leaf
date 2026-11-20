/**
 * The level-up ceremony. Gnome heralds (from the cast's sheets, when the bundle has them) march in
 * and trumpet, ta, ta, taaa; firefly light gathers and climbs the tree; then, under a burst of the
 * welcome's sparkle stars and gold motes over the tree, the glade swaps to the next level's loop,
 * and the new crown throws a handful of gold leaves. Then a GG card in the mod's milestone style:
 * "No gg left behind."
 *
 * Timeline, in seconds from the start:
 *   0.2  heralds march in, one after another      2.7  motes gather and climb the tree
 *   2.1  ta   2.5  ta   2.9  taaa                  3.5  the burst: the next level's loop
 *   4.7  the GG card opens; the heralds cheer       12   all done
 */

import { castFrame, leaf, mote, sparkleStage } from "../../bundle/vocabulary.ts";
import { hash3 } from "../../engine/rng.ts";
import { STAGE_OF_LEVEL, STAGE_TITLE } from "../../game/stages.ts";
import { type Canvas, drawLevelBadge, mix, type PopupSpec, UI } from "../../ui/hud.ts";
import { crown, type Fx, isTree } from "./stage.ts";

export interface LevelUpEvent {
  t0: number;
  from: number;
  to: number;
}

const ARRIVE = 1.9;
const TOOTS = [2.1, 2.5, 2.9] as const;
const GATHER = 2.7;
export const LEVELUP_SWAP = 3.5;
const CARD = 4.7;
const END = 12;

export const shownLevel = (ev: LevelUpEvent, t: number): number => (t - ev.t0 >= LEVELUP_SWAP ? ev.to : ev.from);

const ease = (u: number): number => 1 - Math.pow(1 - Math.max(0, Math.min(1, u)), 3);

// ---------------------------------------------------------------------------------------------
// The heralds.

/** Each herald's start, a beat apart, and how far below the path it stands (nearer is lower). */
const HERALDS = [
  { delay: 0.2, dy: 0 },
  { delay: 0.35, dy: -1 },
  { delay: 0.45, dy: 1 },
] as const;

const HERALD_IDS = ["gnome"] as const;

/** The heralds on the path; nothing until the cast has a herald. */
function drawHeralds(fx: Fx, ev: LevelUpEvent, t: number): void {
  const tau = t - ev.t0;
  if (tau > END) return;
  HERALDS.forEach((h, i) => {
    const stop = fx.places.heralds[i];
    if (!stop) return;
    const stopX = stop.x;
    const y = fx.ground + h.dy;
    const startX = stop.from < 0 ? -16 : fx.pic.W + 16;
    const u = (tau - h.delay) / Math.max(0.6, ARRIVE - h.delay);
    if (u < 0) return;
    const x = Math.round(u < 1 ? startX + (stopX - startX) * u : stopX);
    let anims: readonly string[] = ["idle", "stand"];
    let ms = (tau - h.delay) * 1000;
    if (u < 1) anims = ["march", "walk", "hop", "idle"];
    else if (tau >= CARD - 0.2) {
      anims = ["cheer", "happy", "hop", "idle"];
      ms = ((tau - CARD + 0.2 + i * 0.23) % 1.1) * 1000;
    } else {
      const beat = TOOTS.findIndex((at, k) => tau >= at && tau < at + (k === 2 ? 0.55 : 0.25));
      if (beat === 2 || beat === i) anims = ["toot", "trumpet", "idle"];
    }
    const f = castFrame(fx, HERALD_IDS, anims, ms);
    if (!f) return;
    // The herald's strip carries its own notes on the toot frames.
    fx.pic.sprite(f, x, y, stop.from > 0);
  });
}

// ---------------------------------------------------------------------------------------------
// The tree's moment.

/** Everything the ceremony draws in the world, behind the near layer. */
export function drawLevelUp(fx: Fx, ev: LevelUpEvent, t: number): void {
  drawHeralds(fx, ev, t);
  const tau = t - ev.t0;
  const { tree, pic, ink } = fx;
  const c = crown(tree);
  const foot = tree.foot;
  if (tau >= GATHER && tau < LEVELUP_SWAP) {
    // Firefly light gathers and climbs the tree in a spiral, brighter as it nears the swap.
    const u = (tau - GATHER) / (LEVELUP_SWAP - GATHER);
    const h = foot.y - c.y;
    for (let i = 0; i < 18; i++) {
      const v = (((u * 1.6 + i / 18) % 1) + 1) % 1;
      if (v > u * 1.4 + 0.1) continue;
      const a = v * 14 + i;
      const x = Math.round(foot.x + Math.sin(a) * (3 + c.w * 0.3 * v));
      const y = Math.round(foot.y - v * h);
      mote(fx, x, y, 0.45 + 0.55 * Math.max(0, Math.cos(a)));
    }
  }
  const since = tau - LEVELUP_SWAP;
  if (since < -0.05 || since > 3.4) return;
  // The new tree breathes out its light as the burst covers the swap.
  if (since >= 0 && since < 0.6) {
    const k = 0.42 * (1 - since / 0.6);
    const lit = ink.c("lantern_light");
    for (let y = tree.box.y; y < tree.box.y + tree.box.h; y++)
      for (let x = tree.box.x; x < tree.box.x + tree.box.w; x++) if (isTree(tree, x, y)) pic.light(x, y, lit, k);
  }
  // The burst: the welcome's sparkle stars over the tree, each opening and closing on its own beat.
  const count = Math.min(40, 12 + Math.round((tree.box.w * tree.box.h) / 160));
  for (let i = 0; i < count; i++) {
    const u = (since - hash3(i, 1, 31) * 0.55) / (0.5 + hash3(i, 2, 31) * 0.4);
    if (u < 0 || u >= 1) continue;
    const x = Math.round(tree.box.x - 4 + (tree.box.w + 8) * hash3(i, 3, 31));
    const y = Math.round(tree.box.y - 4 + (tree.box.h + 4) * hash3(i, 4, 31));
    pic.sparkle(x, y, sparkleStage(u, hash3(i, 5, 31) < 0.6), ink.c("star"), ink.c("star_arm"));
  }
  // Gold motes flung out of the crown, drifting down as they dim.
  const cx = c.x + c.w / 2;
  const cy = c.y + c.h * 0.4;
  for (let i = 0; i < 22; i++) {
    const v = (since - hash3(i, 6, 31) * 0.25) / (1.4 + hash3(i, 7, 31));
    if (v < 0 || v > 1) continue;
    const a = hash3(i, 8, 31) * Math.PI * 2;
    const reach = (10 + c.w * 0.5) * (0.5 + hash3(i, 9, 31) * 0.7);
    const x = Math.round(cx + Math.cos(a) * reach * ease(v * 2.5));
    const y = Math.round(cy + Math.sin(a) * reach * 0.7 * ease(v * 2.5) + v * v * 14);
    mote(fx, x, y, 1 - v * 0.85);
  }
  // A handful of gold leaves from the new crown, fluttering down.
  const fall = since - 0.5;
  if (fall > 0)
    for (let i = 0; i < 9; i++) {
      const v = (fall - hash3(i, 10, 31) * 0.4) / (2.2 + hash3(i, 11, 31));
      if (v < 0 || v > 1) continue;
      const x0 = c.x + c.w * hash3(i, 12, 31);
      const y0 = c.y + c.h * 0.5 * hash3(i, 13, 31);
      const x = Math.round(x0 + (hash3(i, 14, 31) - 0.5) * 30 * ease(v * 3) + Math.sin(v * 12 + i) * 3);
      const y = Math.round(y0 + v * (foot.y - y0 + 6));
      leaf(fx, x, y, Math.floor(v * 14 + i), ink.c("falling_leaf"), ink.c("falling_leaf_dark"));
    }
}

/** Whether the ceremony is still drawing anything. */
export const levelUpOver = (ev: LevelUpEvent, t: number): boolean => t - ev.t0 > END;

// ---------------------------------------------------------------------------------------------
// The GG card.

export function ggPopupOpen(ev: LevelUpEvent, t: number): number {
  const tau = t - ev.t0;
  if (tau < CARD || tau > END) return 0;
  if (tau > END - 0.3) return Math.max(0.01, (END - tau) / 0.3);
  return Math.min(1, (tau - CARD) / 0.15);
}

export function ggPopup(ev: LevelUpEvent, stage: string): PopupSpec {
  const before = STAGE_OF_LEVEL[ev.from - 1];
  const after = STAGE_OF_LEVEL[ev.to - 1];
  const grew = before !== after && after !== undefined;
  return {
    accent: UI.gold,
    label: "GG!",
    title: `Level ${ev.to}!`,
    lines: [
      { text: "No gg left behind.", colour: UI.lore },
      {
        text: grew ? `Your tree is now a ${after ? STAGE_TITLE[after] : stage}.` : "Your tree grew taller.",
        colour: mix(UI.leaf, UI.text, 0.25),
      },
    ],
    medal: (c: Canvas, x: number, y: number) => drawLevelBadge(c, ev.to, x, y, true, 0.25),
  };
}
