/**
 * The page with a yard of its own on a land of any size the tests make: today's (`?land=3`) or
 * tier 5's seven plots by seven (`?land=7`, the tests' two rings round today's nine,
 * `packages/factory/test/ring.ts`). For measuring and looking at the page on more land before
 * the plots themselves are written. Nothing is opened from Leaf (`S.alone`), but you stand in it
 * at the depot's door, as in your own yard.
 *
 * `own` is how many plots the yard owns, in the land's order (today's nine first, then the first
 * ring); every other plot is open, so those that touch the yard's land are for sale. `pieces` is
 * about how many pieces the rules' generator (`packages/factory/test/gen.ts`) builds on it, and the
 * yard is run 3,000 ticks, as the bench does. Built as the bench is (`bench.ts`), with this file in
 * place of `src/main.ts`, and opened at `land.html?land=7&own=25&pieces=2500`.
 *
 * With `wait`, the page makes the yard and then waits for `works.go()` before it opens, so a probe can
 * slow the browser down for the opening alone; `works.opened` then says how many milliseconds the
 * opening took, up to and with its first frame.
 */
import { create, LAND, MILLI, step } from "@sequoia-leaf/factory";
import { generate } from "@sequoia-leaf/factory/test/gen.ts";
import { SEVEN } from "@sequoia-leaf/factory/test/ring.ts";
import { fromLeaf } from "@sequoia-leaf/kit/purse.ts";

import { makeGround } from "../src/art/ground.ts";
import { holdView } from "../src/camera.ts";
import { comeIn } from "../src/figure/you.ts";
import { S } from "../src/state.ts";
import { installHandles } from "./handles.ts";

const params = new URLSearchParams(location.search);
const land = params.get("land") === "7" ? SEVEN : LAND;
const own = Number(params.get("own") ?? land.plots.length);
const start = create({ land, tier: 5, seed: 1758855484 });
start.plots.splice(0, start.plots.length, ...land.plots.slice(0, own).map((p) => p.plot));
start.till = 1_000_000_000 * MILLI;
const made = generate(land, Number(params.get("pieces") ?? 1000), 1, () => undefined, start);
for (let k = 0; k < 3000; k++) step(made.y);
// Every plot open, the tests' rings too (the rules' table has room for today's plots alone), after
// the goals the generator did opened what they open.
made.y.open = { ...made.y.open, plots: new Uint8Array(land.plots.length).fill(1) };
S.world = made.y;
S.alone = true;
fromLeaf({ coins: 1_000_000_000, leaf: 0, version: 0 });

declare global {
  interface Window {
    /** A probe's hold on a page opened with `wait`: it opens on `go`, and `opened` is how long that took. */
    land?: { ready: boolean; go: () => void; opened: number | null };
  }
}
const hold = { ready: true, go: (): void => undefined, opened: null as number | null };
window.land = hold;
if (params.has("wait")) await new Promise<void>((go) => (hold.go = go));
const began = performance.now();
const { page } = await import("../src/main.ts");
const opened = await page;
if (opened) {
  installHandles(opened);
  // You stand at the depot's door, as in your own yard, and the view goes with you.
  comeIn("Tamsin", makeGround(S.world.land));
  holdView(true);
  opened.draw(performance.now());
  hold.opened = performance.now() - began;
}
