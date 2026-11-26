/**
 * What looms at whoever an ability is for, from the moment it goes off until it lands: its owner's
 * face, many times the size of anyone on the board, leaning in between us and the table just in
 * front of them, with the ability's name as a caption and whoever is caught marked at the corners.
 * It is drawn over everyone, so whoever stands nearer than the one caught is out of sight for that
 * long, and the one caught never is. As the ability lands the face goes at them in pieces; if they
 * fell first, or the fight ended, it only goes.
 *
 * Everything is by the fight's clock, so 2x and 4x speed it up and a hit-stop holds it.
 */
import { rigOf } from "@sequoia-leaf/figures/sprites.ts";
import { GOLD, INK, PAPER } from "@sequoia-leaf/kit/palette.ts";
import { R } from "@sequoia-leaf/kit/pix.ts";
import { widthOf, write } from "@sequoia-leaf/kit/text.ts";
import { clamp, type Ctx, must } from "@sequoia-leaf/kit/util.ts";
import type { Fight, UnitKind } from "@sequoia-leaf/raid";

import { clockNow, fightNow, FV } from "./board.ts";
import { burst } from "./fx.ts";
import { BOARD_H, BOARD_W } from "./geometry.ts";
import { V } from "./stage.ts";

interface Omen {
  readonly fight: Fight;
  /** Whose face looms, if anybody's: an ability may hang with nothing to see but what its owner does. */
  readonly kind: UnitKind | null;
  /** Whoever it is for, by their number in the fight. */
  readonly to: number;
  readonly name: string;
  readonly t0: number;
  readonly lands: number;
  /** What happens as it lands. */
  readonly land: () => void;
}
const hung: Omen[] = [];

/** A face is eight pixels square, drawn this many times the size. */
const FACE = 8;
const SIZE = 5;
/** How far past the board's near edge a face may reach, over the bench. */
const UNDER = 26;
/** Steps the face takes to come up to its size, steps before its name is written out, and steps that takes. */
const GROW = [2, 3, 4] as const;
const SAYS = 3;
const SPELL = 7;

/** Hangs an ability over whoever it is for, to land `ticks` steps on; with `kind`, that figure's face looms meanwhile. */
export function hang(kind: UnitKind | null, to: number, name: string, ticks: number, land: () => void): void {
  const fight = fightNow();
  if (!fight) return;
  const t0 = clockNow();
  hung.push({ fight, kind, to, name, t0: Math.floor(t0), lands: Math.floor(t0) + ticks, land });
  const caught = FV.actors[to];
  if (caught) caught.dread = { from: Math.floor(t0) + 1, until: Math.floor(t0) + ticks };
}

/** Somebody's face, if they are a person: only a person's looms. */
const faceOf = (kind: UnitKind | null): HTMLCanvasElement | null => (kind && rigOf(kind)?.face) || null;

const tones = new WeakMap<HTMLCanvasElement, readonly string[]>();
/** The colour of each pixel of a face, a row at a time. */
function tonesOf(face: HTMLCanvasElement): readonly string[] {
  let t = tones.get(face);
  if (!t) {
    const d = must(face.getContext("2d"), "2d context").getImageData(0, 0, FACE, FACE).data;
    t = Array.from({ length: FACE * FACE }, (_, i) =>
      (d[i * 4 + 3] ?? 0) < 40 ? "" : `rgb(${d[i * 4] ?? 0},${d[i * 4 + 1] ?? 0},${d[i * 4 + 2] ?? 0})`,
    );
    tones.set(face, t);
  }
  return t;
}

/** Where a face is at the fight's clock `c`, from the board's corner: its corner, how many times the size it is, and the feet of whoever it is for. */
function placed(o: Omen, c: number): { x: number; y: number; s: number; feet: { x: number; y: number } } | null {
  const a = FV.actors[o.to];
  if (!a || !faceOf(o.kind)) return null;
  const since = c - o.t0;
  const s = since < 3 ? (GROW[Math.floor(since)] ?? SIZE) : SIZE;
  // Just nearer us than their feet; over their head instead where the board's near edge leaves no room.
  const under = a.y + 5 + FACE * SIZE <= BOARD_H + UNDER;
  const top = (under ? a.y + 5 : a.y - 27 - FACE * SIZE) + (FACE * (SIZE - s)) / 2;
  // It leans in at them over the last of it, and settles a pixel as it breathes.
  const lean = o.lands - c <= 3 ? (under ? -3 : 3) : Math.floor(since / 7) % 2;
  const x = clamp(a.x - (FACE * s) / 2, -6, BOARD_W + 6 - FACE * s);
  return { x: Math.round(x), y: Math.round(top + lean), s, feet: { x: a.x, y: a.y } };
}

/** The face comes apart: thrown at whoever it was for as it lands, each of its pixels a piece; or a third of them drifting up as it only goes. */
function shatter(o: Omen, at: NonNullable<ReturnType<typeof placed>>, lands: boolean): void {
  const face = faceOf(o.kind);
  if (!face) return;
  tonesOf(face).forEach((col, i) => {
    if (!col || (!lands && i % 3 !== 0)) return;
    const x = at.x + ((i % FACE) + 0.5) * at.s;
    const y = at.y + (Math.floor(i / FACE) + 0.5) * at.s;
    const to = lands ? Math.atan2(at.feet.y - 8 - y, at.feet.x - x) : -Math.PI / 2;
    burst(
      x,
      y,
      1,
      [col],
      lands
        ? { size: 2, speed: 150, toward: to, spread: 0.9, grav: 0, ttl: 0.24 }
        : { speed: 16, toward: to, spread: 1, grav: -20, ttl: 0.4 },
    );
  });
}

/** Lands what is due, and lets go of what will never land: whoever it was for fell first, or the fight is over or another. */
export function stepOmens(c: number): void {
  for (let i = hung.length - 1; i >= 0; i--) {
    const o = hung[i];
    if (!o) continue;
    const a = FV.actors[o.to];
    const off = o.fight !== fightNow() || !a;
    const missed = off || (c < o.lands ? a.fallAt <= c : a.fallAt < o.lands) || (o.fight.over && c < o.lands);
    if (!missed && c < o.lands) continue;
    hung.splice(i, 1);
    const at = off ? null : placed(o, Math.min(c, o.lands - 1));
    if (a) a.dread = null;
    if (at) shatter(o, at, !missed);
    if (!missed) o.land();
  }
}

/** The corners marking whoever is caught: they close in, then stay, blinking as it comes. */
function corners(g: Ctx, o: Omen, c: number, feet: { x: number; y: number }): void {
  const since = c - o.t0;
  if (o.lands - c < 6 && Math.floor(c) % 2 === 0) return;
  const out = Math.max(0, 4 - Math.floor(since)) * 2;
  const x = Math.round(V.bx + feet.x);
  const y = Math.round(V.by + feet.y);
  for (const sx of [-1, 1] as const)
    for (const sy of [-1, 1] as const) {
      const cx = x + sx * (9 + out) - (sx === 1 ? 1 : 0);
      const cy = y - 10 + sy * (14 + out) - (sy === 1 ? 1 : 0);
      const lx = cx - (sx === 1 ? 5 : 0);
      const ty = cy - (sy === 1 ? 5 : 0);
      R(g, lx - 1, cy - 1 - (sy === 1 ? 1 : 0), 8, 4, INK);
      R(g, cx - 1 - (sx === 1 ? 1 : 0), ty - 1, 4, 8, INK);
      R(g, lx, cy - (sy === 1 ? 1 : 0), 6, 2, GOLD[2]);
      R(g, cx - (sx === 1 ? 1 : 0), ty, 2, 6, GOLD[2]);
    }
}

/** Each face, and the corners round whoever it is for: drawn over everyone standing on the table. */
export function drawOmens(g: Ctx): void {
  const c = clockNow();
  for (const o of hung) {
    const at = o.fight === fightNow() ? placed(o, c) : null;
    const face = faceOf(o.kind);
    if (!at || !face) continue;
    const w = FACE * at.s;
    const x = V.bx + at.x;
    const y = V.by + at.y;
    R(g, x - 1, y, w + 2, w, INK);
    R(g, x, y - 1, w, w + 2, INK);
    g.drawImage(face, 0, 0, FACE, FACE, x, y, w, w);
    corners(g, o, c, at.feet);
  }
}

/** The lines a caption is written in: one, or two where one would be wider than the board. */
function linesOf(ctx: Ctx, text: string, px: number): string[] {
  if (widthOf(ctx, text, px, true) <= (BOARD_W - 10) * V.z) return [text];
  const cut = text.lastIndexOf(" ", Math.ceil(text.length / 2) + 2);
  return cut < 0 ? [text] : [text.slice(0, cut), text.slice(cut + 1)];
}

/** Each ability's name over its face, as a caption on a strip of paper, written out a letter at a time. */
export function wordsOmens(ctx: Ctx, px: number): void {
  const c = clockNow();
  for (const o of hung) {
    const at = o.fight === fightNow() ? placed(o, c) : null;
    const shown = Math.ceil(clamp((c - o.t0 - SAYS) / SPELL, 0, 1) * o.name.length);
    if (!at || c - o.t0 < SAYS) continue;
    const z = V.z;
    const lines = linesOf(ctx, o.name, px);
    const tall = px * 10;
    const wide = Math.max(...lines.map((l) => widthOf(ctx, l, px, true))) + 6 * z;
    const high = lines.length * tall + 2 * z;
    const mid = clamp(
      (V.bx + at.x + (FACE * at.s) / 2) * z,
      (V.bx + 2) * z + wide / 2,
      (V.bx + BOARD_W - 2) * z - wide / 2,
    );
    const left = Math.round(mid - wide / 2);
    // On the side of the face away from whoever is caught.
    const under = at.y > at.feet.y;
    const top = under ? (V.by + at.y + FACE * at.s + 2) * z : (V.by + at.y - 2) * z - high;
    ctx.fillStyle = INK;
    ctx.fillRect(left - z, top - z, wide + 2 * z, high + 2 * z);
    ctx.fillStyle = PAPER[2];
    ctx.fillRect(left, top, wide, high);
    let toWrite = shown;
    lines.forEach((line, i) => {
      const part = line.slice(0, Math.max(0, toWrite));
      toWrite -= line.length + 1;
      const lx = Math.round(mid - widthOf(ctx, line, px, true) / 2);
      if (part) write(ctx, part, lx, top + z + i * tall, { px, bold: true, colour: INK, shadow: false });
    });
  }
}
