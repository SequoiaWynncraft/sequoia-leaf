/**
 * Whoever walks about the yard: a gnome come to the gate for a crate (Pipwick for his own orders,
 * in his blue hat; one of the town's gnomes for anybody else's), and the yard's own gnome who
 * carries a story order out. They are the yard's gnomes (`art/machines.ts`), never a member's
 * figure.
 */

import type { Dir as Facing } from "@sequoia-leaf/kit/skin.ts";
import type { Pt } from "@sequoia-leaf/kit/util.ts";

export interface Walker {
  name: string;
  /** Which hat (`art/machines.ts`): Pipwick's blue, or one of the others. */
  hat: number;
  x: number;
  y: number;
  dir: Facing;
  moving: boolean;
  walked: number;
  /** Where they are going, nearest first, and what to do when they get to the end of it. */
  path: Pt[];
  after: (() => void) | null;
  speed: number;
  /** Carrying a crate over their head. */
  carrying: boolean;
  say: string;
  sayFor: number;
  hop: number;
  alpha: number;
  /** The standing order they have come for, if any. */
  order: number;
  gone: boolean;
}

export const walkers: Walker[] = [];

export function walker(name: string, hat: number, at: Pt, order = -1): Walker {
  const w: Walker = {
    name,
    hat,
    x: at.x,
    y: at.y,
    dir: 0,
    moving: false,
    walked: 0,
    path: [],
    after: null,
    speed: 22,
    carrying: false,
    say: "",
    sayFor: 0,
    hop: 0,
    alpha: 0,
    order,
    gone: false,
  };
  walkers.push(w);
  return w;
}

/** Sends someone along a path; `after` is called when they reach the end of it. */
export function send(w: Walker, path: readonly Pt[], after: (() => void) | null = null): void {
  w.path = [...path];
  w.after = after;
}

export function speak(w: Walker, text: string, seconds = 2.6): void {
  w.say = text;
  w.sayFor = seconds;
}

export const HOP = 0.28;

export function stepWalkers(dt: number): void {
  for (let n = walkers.length - 1; n >= 0; n--) {
    const w = walkers[n];
    if (!w) continue;
    if (w.gone) {
      w.alpha -= dt * 4;
      if (w.alpha <= 0) walkers.splice(n, 1);
      continue;
    }
    w.alpha = Math.min(1, w.alpha + dt * 4);
    if (w.hop > 0) w.hop = Math.max(0, w.hop - dt);
    if (w.sayFor > 0) {
      w.sayFor -= dt;
      if (w.sayFor <= 0) w.say = "";
    }
    const to = w.path[0];
    if (!to) {
      w.moving = false;
      continue;
    }
    const dx = to.x - w.x;
    const dy = to.y - w.y;
    const d = Math.hypot(dx, dy);
    const stride = w.speed * dt;
    if (d <= stride) {
      w.x = to.x;
      w.y = to.y;
      w.path.shift();
      if (w.path.length === 0) {
        w.moving = false;
        const after = w.after;
        w.after = null;
        after?.();
      }
      continue;
    }
    w.x += (dx / d) * stride;
    w.y += (dy / d) * stride;
    w.walked += stride;
    w.moving = true;
    w.dir = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 1 : 2) : dy < 0 ? 3 : 0;
  }
}

/** A crate thrown from one spot to another: from the depot's door to whoever has come for it. */
export interface Flight {
  from: Pt;
  to: Pt;
  life: number;
  ttl: number;
  after: (() => void) | null;
}
export const flights: Flight[] = [];

export function toss(from: Pt, to: Pt, after: (() => void) | null = null): void {
  flights.push({ from, to, life: 0, ttl: 0.2 + Math.hypot(to.x - from.x, to.y - from.y) / 220, after });
}

export function stepFlights(dt: number): void {
  for (let n = flights.length - 1; n >= 0; n--) {
    const f = flights[n];
    if (!f) continue;
    f.life += dt;
    if (f.life < f.ttl) continue;
    flights.splice(n, 1);
    f.after?.();
  }
}
