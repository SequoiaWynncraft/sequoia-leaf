/**
 * Time away: Leaf runs a yard for eight hours after its owner's last command, in slices of work,
 * and then it stands still. Both rules, sliced differently, come to the same yard.
 */
import { describe, expect, test } from "bun:test";

import type { Ctx } from "@sequoia-leaf/core";
import * as Y from "@sequoia-leaf/yard";

import * as F from "../src/index.ts";
import { fromText, pictureF, pictureY } from "./sides.ts";

const ctx = (now: number): Ctx => ({ now, player: { id: "p", guest: false }, seed: 99, room: 1e9, awards: [] });
const HOUR = 3600 * 1000;
const at0 = 1_800_000_000_000;

/** A slice of `n` ticks: `more` says yes that many times. */
const slice = (n: number): (() => boolean) => {
  let left = n;
  return () => left-- > 0;
};

/** Tends a yard to `now` in slices of `n`, and says how many slices it took. */
function tendAll<S>(
  game: { tend?: (s: S, c: Ctx, more: () => boolean) => boolean },
  s: S,
  now: number,
  n: number,
): number {
  let slices = 0;
  for (let further = true; further; slices++) further = game.tend?.(s, ctx(now), slice(n)) ?? false;
  return slices;
}

async function yards(): Promise<[Y.World, F.Yard]> {
  const text = await Bun.file(new URL("../../yard/src/yards/large.json", import.meta.url)).text();
  const w = Y.WORKS.decode(text);
  const y = fromText(text);
  if (!w || !y) throw new Error("the large yard does not read");
  // Both last seen at the tick they were kept at, at the same moment of Leaf's clock.
  w.at = at0;
  w.seen = Y.here(w);
  y.at = at0;
  y.seen = F.here(y);
  return [w, y];
}

describe("time away", () => {
  test("tended to eight hours and past, in slices of any size, both yards come to the same yard and stand still", async () => {
    const [w, y] = await yards();
    const ywork = tendAll(Y.WORKS, w, at0 + 9 * HOUR, 1000);
    const fwork = tendAll(F.FACTORY, y, at0 + 9 * HOUR, 7777);
    expect(ywork).toBeGreaterThan(fwork);
    expect(pictureF(y)).toEqual(pictureY(w));
    expect(y.tick - y.seen.tick).toBe(F.AWAY_MOST_MS / F.TICK_MS);
    // Standing still, Leaf's clock is kept: advance lets the hours go.
    Y.WORKS.advance(w, ctx(at0 + 10 * HOUR));
    F.FACTORY.advance(y, ctx(at0 + 10 * HOUR));
    expect(y.at).toBe(at0 + 10 * HOUR);
    expect(pictureF(y)).toEqual(pictureY(w));
    // The letter: what it did while its owner was away, as the page is shown it.
    expect(JSON.parse(F.FACTORY.view(y, ctx(at0 + 10 * HOUR)).yard).away).toEqual(
      JSON.parse(Y.WORKS.view(w, ctx(at0 + 10 * HOUR)).yard).away,
    );
  }, 30_000);

  test("one slice, many slices, or the tick of a command: the same yard at every tick", async () => {
    const [w, y] = await yards();
    const [, z] = await yards();
    tendAll(F.FACTORY, y, at0 + HOUR, 1);
    tendAll(F.FACTORY, z, at0 + HOUR, 1e9);
    tendAll(Y.WORKS, w, at0 + HOUR, 500);
    expect(pictureF(z)).toEqual(pictureF(y));
    expect(pictureF(z)).toEqual(pictureY(w));
    // Toward a command's tick, then the command, then on to the clock.
    const c = { do: "collect", tick: w.tick + 36_000 + 5 } as const;
    const cw = Y.WORKS.command(c);
    const cf = F.FACTORY.command(c);
    if (!cw || !cf) throw new Error("collect does not read");
    for (let further = true; further;) further = Y.WORKS.tend?.(w, ctx(at0 + HOUR), slice(333), cw) ?? false;
    for (let further = true; further;) further = F.FACTORY.tend?.(z, ctx(at0 + HOUR), slice(5000), cf) ?? false;
    const a = Y.WORKS.apply(w, cw, ctx(at0 + HOUR));
    const b = F.FACTORY.apply(z, cf, ctx(at0 + HOUR));
    expect(JSON.stringify({ ...b, state: null })).toBe(JSON.stringify({ ...a, state: null }));
    tendAll(Y.WORKS, w, at0 + 2 * HOUR, 2500);
    tendAll(F.FACTORY, z, at0 + 2 * HOUR, 9000);
    expect(pictureF(z)).toEqual(pictureY(w));
  }, 30_000);
});
