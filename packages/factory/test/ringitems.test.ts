/**
 * Each thing moves at most once a tick, on a ring as anywhere (`round.ts`), followed thing by thing:
 * on rings built at random (`randomring.ts`), every thing in the yard is made its own kind, so where
 * each is can be read after every tick. Each is where it was, or one way on from there as things go:
 * a tile it hands to (`realTo`), a tunnel's next tile under the ground or its far mouth, or into what it
 * was handed to. A thing handed on twice in a tick would be two ways on. And none is made or lost.
 */
import { expect, test } from "bun:test";

import * as F from "../src/index.ts";
import { randomRing } from "./randomring.ts";

/** Where a thing is: the tile it is on or in, or under the ground, -1 less its row (`Tunnels.under`). */
type Place = number;

/** Makes every thing in the yard its own kind, as many as there are kinds; the rest go. */
function oneOfEach(y: F.Yard): void {
  const kinds = [...F.ALL_ITEMS];
  const next = (): number => kinds.shift() ?? F.NONE;
  for (let i = 0; i < y.kind.length; i++) {
    if (y.kind[i] === F.NONE) continue;
    if (F.carries(y.kind[i] ?? F.NONE) && y.item[i] !== F.NONE) {
      // Every other thing, so the ring has room to move.
      y.item[i] = i % 2 === 0 ? next() : F.NONE;
      if (y.item[i] === F.NONE) y.prog[i] = 0;
    }
    const t = F.tunnelOf(y, i);
    for (let u = t * F.SPAN_MOST; u < t * F.SPAN_MOST + (t >= 0 ? (y.span[i] ?? 0) : 0); u++)
      if (y.tunnels.under[u] !== F.NONE) y.tunnels.under[u] = next();
    const r = F.holderOf(y, i);
    if (r < 0 || F.pieceOf(y, i) !== i) continue;
    for (const n of F.ALL_ITEMS) F.take(y.holders, r, n, F.held(y.holders, r, n));
    y.holders.out[r] = F.NONE;
    const n = next();
    if (n !== F.NONE) F.put(y.holders, r, n);
  }
  F.changed(y);
}

/** Where each thing is, by its kind. */
function places(y: F.Yard): Map<number, Place> {
  const at = new Map<number, Place>();
  for (let i = 0; i < y.kind.length; i++) {
    if (y.kind[i] === F.NONE) continue;
    if (F.carries(y.kind[i] ?? F.NONE) && y.item[i] !== F.NONE) at.set(y.item[i] ?? 0, i);
    const t = F.tunnelOf(y, i);
    for (let u = t * F.SPAN_MOST; u < t * F.SPAN_MOST + (t >= 0 ? (y.span[i] ?? 0) : 0); u++)
      if (y.tunnels.under[u] !== F.NONE) at.set(y.tunnels.under[u] ?? 0, -1 - u);
    const r = F.holderOf(y, i);
    if (r < 0 || F.pieceOf(y, i) !== i) continue;
    for (const n of F.ALL_ITEMS) if (F.held(y.holders, r, n) > 0) at.set(n, i);
    for (const n of [y.holders.out[r], y.holders.also[r]]) if (n !== undefined && n !== F.NONE) at.set(n, i);
  }
  return at;
}

/** The places one way on from a place, as things go. */
function onFrom(y: F.Yard, p: Place): Place[] {
  if (p < 0) {
    const u = -1 - p;
    const t = Math.floor(u / F.SPAN_MOST);
    const mouth = y.tunnels.tile[t] ?? -1;
    return u - t * F.SPAN_MOST + 1 < (y.span[mouth] ?? 0) ? [p - 1] : [F.farMouth(y, mouth)];
  }
  if ((y.span[p] ?? 0) > 0 && F.tunnelOf(y, p) >= 0) return [-1 - F.tunnelOf(y, p) * F.SPAN_MOST];
  return Array.from({ length: Math.max(1, F.waysAt(y, p)) }, (_, c) => F.realTo(y, p, c)).filter((t) => t >= 0);
}

test("on rings built at random, each thing, followed by itself, moves at most one way on a tick, and none is made or lost", () => {
  const seen: string[] = [];
  for (let seed = 1; seed <= 40; seed++) {
    const { y } = randomRing(seed);
    oneOfEach(y);
    let was = places(y);
    const things = was.size;
    let twice = 0;
    let moved = 0;
    for (let tick = 0; tick < 300; tick++) {
      F.step(y);
      const now = places(y);
      for (const [n, p] of was) {
        const q = now.get(n);
        if (q === undefined || q === p) continue;
        moved++;
        if (!onFrom(y, p).includes(q)) twice++;
      }
      was = now;
    }
    seen.push(`${seed}: ${twice} ${was.size === things} ${moved > 0}`);
  }
  expect(seen).toEqual(Array.from({ length: 40 }, (_, k) => `${k + 1}: 0 true true`));
});
