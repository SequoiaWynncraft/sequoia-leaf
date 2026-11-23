/**
 * A working yard of about 6,000 pieces on 112 by 84 tiles, made by the scale study's generator:
 * the same in both rules, and held to the budgets.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

import * as Y from "@sequoia-leaf/yard";

import * as F from "../src/index.ts";
import { type Gen, generate } from "./gen.ts";
import { makeLand } from "./land.ts";
import { landOf, Pair, pictureF } from "./sides.ts";

const land = makeLand(7, 7, 7);
const flatLand = landOf(land);
let made: Gen | null = null;
/** The generated yard, made once, and the commands that made it. */
const gen = (): Gen => (made ??= generate(flatLand, 6000));
/** The generated yard as it stands after running 3,000 ticks, as a yard in play would be kept. */
let ran: F.Yard | null = null;
function running(): F.Yard {
  if (ran) return ran;
  const y = F.decode(F.encode(gen().y), flatLand);
  if (!y) throw new Error("the generated yard does not read back");
  for (let k = 0; k < 3000; k++) F.step(y);
  ran = y;
  return y;
}
const pieces = (y: F.Yard): number => y.kind.filter((k) => k !== F.NONE).length;

describe("the generated yard", () => {
  test("is about 6,000 pieces", () => {
    expect(pieces(gen().y)).toBeGreaterThan(5500);
  }, 60_000);

  test("built by the same commands on today's rules, is the same yard, and runs 3,000 ticks the same", () => {
    const g = gen();
    const pair = new Pair(
      Y.create({ land, story: 20, seed: 1758855484 }),
      F.create({ land: flatLand, story: 20, seed: 1758855484 }),
    );
    g.commands.forEach((c, k) => {
      pair.do(c, `command ${k}`);
      if (k % 10_000 === 0) pair.same(`after command ${k}`);
    });
    pair.same("built");
    expect(pictureF(pair.flat)).toEqual(pictureF(g.y));
    pair.run(3000, 100, "running");
    expect(pair.commands).toBeGreaterThan(50_000);
  }, 60_000);
});

describe("budgets, at about 6,000 pieces", () => {
  test("a yard takes under 400 KB in memory: its arrays, side tables and plumbing", () => {
    const y = running();
    expect(F.bytesHeld(y)).toBeLessThan(400 * 1024);
  }, 60_000);

  test("packed, it takes under 40 KB; it is kept as text with the pieces in base64", () => {
    const text = F.encode(running());
    const cells = /"cells":"([^"]*)"/.exec(text)?.[1] ?? "";
    const packed = text.length - cells.length + (F.fromBase64(cells)?.length ?? Infinity);
    expect(packed).toBeLessThan(40 * 1024);
    expect(text.length).toBeLessThan(48 * 1024);
  }, 60_000);

  test("a thousand ticks allocate nothing: the collector counts no bytes between two collections", async () => {
    const file = `${tmpdir()}/factory-alloc-${process.pid}.txt`;
    await Bun.write(file, F.encode(running()));
    const child = Bun.spawnSync([process.execPath, `${import.meta.dir}/alloc.ts`, file], {
      env: { ...process.env, BUN_JSC_logGC: "1" },
    });
    rmSync(file);
    const log = child.stderr.toString();
    const window = log.slice(log.indexOf("WINDOW"));
    const collections = [...window.matchAll(/FullCollection, ca=([\d.]+)kb/g)].map((m) => Number(m[1]));
    expect(window).toContain("DONE 0");
    expect(collections.length).toBe(2);
    // Less than a kilobyte: what the loop and the call to the collector themselves take.
    expect(collections[1] ?? Infinity).toBeLessThan(1);
    console.log(
      `allocated in a thousand ticks: ${collections[1] ?? "?"} KB (the collection before: ${collections[0] ?? "?"} KB)`,
    );
  }, 60_000);

  test("the tick's code makes no arrays, objects, closures or strings", () => {
    const source = readFileSync(new URL("../src/tick.ts", import.meta.url), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    const body = source.slice(source.indexOf("export function step"));
    for (const [what, pattern] of [
      ["new", /\bnew\s/],
      ["an array", /[=(,:?]\s*\[/],
      ["an object", /[=(,:?]\s*\{|return\s*\{/],
      ["a closure", /=>/],
      ["a string", /[`"']/],
      ["a spread", /\.\.\./],
      ["a copy", /\.(map|filter|slice|concat|flatMap|from)\(/],
    ] as const)
      expect(`${what}: ${pattern.exec(body)?.[0] ?? "none"}`).toBe(`${what}: none`);
  });

  test("a tick looks only at tiles where something stands, once or twice each, whatever the size of the map", () => {
    const y = running();
    const wire = y.wire ?? F.rewire(y);
    const lists = [wire.order, wire.carry, wire.work, wire.boilers];
    const looked = lists.reduce((n, l) => n + l.length, 0);
    for (const list of lists) for (const i of list) expect(y.kind[i]).not.toBe(F.NONE);
    expect(looked).toBeLessThanOrEqual(2 * pieces(y));
    // An empty yard of the same size looks at nothing.
    const empty = F.rewire(F.create({ land: flatLand }));
    expect(empty.order.length + empty.carry.length + empty.work.length + empty.boilers.length).toBe(0);
  }, 60_000);

  test("a tick takes under 2 ms", () => {
    const y = running();
    const times: number[] = [];
    for (let k = 0; k < 500; k++) {
      const t = Bun.nanoseconds();
      F.step(y);
      times.push((Bun.nanoseconds() - t) / 1e6);
    }
    times.sort((a, b) => a - b);
    expect(times[250] ?? Infinity).toBeLessThan(2);
  }, 60_000);
});
