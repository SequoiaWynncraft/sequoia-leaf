/**
 * What a yard costs: `bun bench.ts [--short]`.
 *
 * Yards made by the scale study's generator with commands: about 6,000 pieces on 112 by 84, and
 * about 10,000 on 160 by 120. Each is run 3,000 ticks first, as a yard in play would be kept.
 * Times are medians, in milliseconds. Nothing is asserted here; the budgets are tests.
 */
import { heapStats } from "bun:jsc";

import * as F from "./src/index.ts";
import { generate } from "./test/gen.ts";
import { makeLand } from "./test/land.ts";

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

function made(name: string, cols: number, rows: number, target: number): { name: string; y: F.Yard } {
  const t = now();
  const g = generate(makeLand(cols, rows, 7), target);
  console.error(`${name}: generated in ${fmt(now() - t)} ms with ${g.commands.length} commands`);
  for (let k = 0; k < 3000; k++) F.step(g.y);
  return { name, y: g.y };
}

const rows: string[][] = [];
for (const { name, y } of [made("6000", 7, 7, 6000), made("10000", 10, 10, 10_000)]) {
  const pieces = y.kind.filter((k) => k !== F.NONE).length;
  const packed = F.encode(y);
  rows.push([
    name,
    String(pieces),
    fmt(median(() => F.step(y))),
    fmt(median(() => F.decode(packed, y.land), 1500, 5)),
    fmt(median(() => F.encode(y))),
    fmt(median(() => F.check(y))),
    String(packed.length),
    String(F.bytesHeld(y)),
    fmt(heldBy(() => F.decode(packed, y.land)) / 100 / 1e6),
  ]);
  if (name === "6000" && !process.argv.includes("--short")) {
    const t = now();
    for (let k = 0; k < 288_000; k++) F.step(y);
    console.error(`eight hours (288,000 ticks) of the 6000 yard: ${fmt((now() - t) / 1000)} s`);
  }
}
console.log("| yard | pieces | tick | decode | encode | check | kept, bytes | held, bytes | heap a yard, MB |");
console.log(`|${" ---: |".repeat(9)}`);
for (const r of rows) console.log(`| ${r.join(" | ")} |`);
