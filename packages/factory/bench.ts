/**
 * What the flat yard costs, beside today's yard on the same yards: `bun bench.ts [real-yard.json]`.
 *
 * Yards: a real one if its file is given (read with today's rules and, one way, into the flat
 * yard; checked to be the same yard first), and two made by the scale study's generator on the
 * flat rules and built again on today's from the same commands: about 6,000 pieces on 112 by 84,
 * and about 10,000 on 160 by 120. Each is run 3,000 ticks first, as a yard in play would be kept.
 * Times are medians, in milliseconds. Nothing is asserted here; the budgets are tests.
 */
import { heapStats } from "bun:jsc";
import { readFileSync } from "node:fs";

import * as Y from "@sequoia-leaf/yard";

import * as F from "./src/index.ts";
import { generate } from "./test/gen.ts";
import { makeLand } from "./test/land.ts";
import { fromText, landOf, Pair } from "./test/sides.ts";

const now = (): number => Bun.nanoseconds() / 1e6;
/** The median time of `f`, run for about `ms` and at least `least` times after a warm-up. */
function median(f: () => void, ms = 1500, least = 15): number {
  for (let k = 0; k < 3; k++) f();
  const times: number[] = [];
  const end = now() + ms;
  while (times.length < least || now() < end) {
    const t = now();
    f();
    times.push(now() - t);
  }
  return times.toSorted((a, b) => a - b)[Math.floor(times.length / 2)] ?? Number.NaN;
}
const fmt = (n: number, d = 4): string => (n >= 100 ? n.toFixed(0) : n >= 1 ? n.toFixed(2) : n.toPrecision(d - 1));
/** The bytes held by what `make` makes and keeps, a hundred times over: the JS heap and the arrays' own memory. */
function heldBy(make: () => unknown, copies = 100): number {
  const kept: unknown[] = [];
  Bun.gc(true);
  const before = heapStats();
  for (let k = 0; k < copies; k++) kept.push(make());
  Bun.gc(true);
  const after = heapStats();
  const grew = after.heapSize + after.extraMemorySize - (before.heapSize + before.extraMemorySize);
  return kept.length > 0 ? grew : 0;
}

interface Bench {
  readonly name: string;
  readonly yard: Y.World;
  readonly flat: F.Yard;
  readonly yLand: Y.Land;
}

function made(name: string, cols: number, rows: number, target: number): Bench {
  const yLand = makeLand(cols, rows, 7);
  const land = landOf(yLand);
  const t = now();
  const g = generate(land, target);
  console.error(`${name}: generated in ${fmt(now() - t)} ms with ${g.commands.length} commands`);
  const pair = new Pair(
    Y.create({ land: yLand, story: 20, seed: 1758855484 }),
    F.create({ land, story: 20, seed: 1758855484 }),
  );
  for (const c of g.commands) pair.do(c);
  pair.run(3000, 1000, name);
  return { name, yard: pair.yard, flat: pair.flat, yLand };
}

function real(file: string): Bench {
  const text = readFileSync(file, "utf8");
  const yard = Y.load(text);
  const flat = fromText(text);
  if (!yard || !flat) throw new Error(`${file} is not a yard`);
  const pair = new Pair(yard, flat);
  pair.same("real, read");
  pair.run(3000, 100, "real");
  return { name: "real", yard: pair.yard, flat: pair.flat, yLand: Y.LAND };
}

const benches: Bench[] = [];
const file = process.argv[2];
if (file) benches.push(real(file));
benches.push(made("6000", 7, 7, 6000), made("10000", 10, 10, 10_000));

const rows: string[][] = [];
for (const b of benches) {
  const pieces = b.flat.kind.filter((k) => k !== F.NONE).length;
  const text = Y.save(b.yard);
  const packed = F.encode(b.flat);
  const flatLand = b.flat.land;
  const tickY = median(() => Y.step(b.yard));
  const tickF = median(() => F.step(b.flat));
  const loadY = median(() => Y.load(text, b.yLand), 1500, 5);
  const decodeF = median(() => F.decode(packed, flatLand), 1500, 5);
  const saveY = median(() => Y.save(b.yard));
  const encodeF = median(() => F.encode(b.flat));
  const check = median(() => F.check(b.flat));
  const heapY = heldBy(() => Y.load(text, b.yLand)) / 100;
  const heapF = heldBy(() => F.decode(packed, flatLand)) / 100;
  rows.push([
    b.name,
    String(pieces),
    fmt(tickY),
    fmt(tickF),
    fmt(loadY),
    fmt(decodeF),
    fmt(saveY),
    fmt(encodeF),
    fmt(check),
    String(text.length),
    String(packed.length),
    String(F.bytesHeld(b.flat)),
    fmt(heapY / 1e6),
    fmt(heapF / 1e6),
  ]);
}
console.log(
  "| yard | pieces | tick, today | tick, flat | load, today | decode | save, today | encode | check | text, bytes | kept, bytes | held, bytes | heap a yard, today, MB | heap a yard, flat, MB |",
);
console.log(`|${" ---: |".repeat(14)}`);
for (const r of rows) console.log(`| ${r.join(" | ")} |`);

// Eight hours of a yard of about 6,000 pieces, on each rules.
const six = benches.find((b) => b.name === "6000");
if (six && !process.argv.includes("--short")) {
  for (const [name, run] of [
    [
      "flat",
      () => {
        for (let k = 0; k < 288_000; k++) F.step(six.flat);
      },
    ],
    [
      "today",
      () => {
        for (let k = 0; k < 288_000; k++) Y.step(six.yard);
      },
    ],
  ] as const) {
    const t = now();
    run();
    console.log(`eight hours (288,000 ticks) of the 6000 yard, ${name}: ${fmt((now() - t) / 1000)} s`);
  }
}
