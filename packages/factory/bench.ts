/**
 * What a yard costs: `bun bench.ts [--short] [--hours] [--lines]`.
 *
 * Yards made by the scale study's generator with commands: about 6,000 pieces on 112 by 84, and
 * about 10,000 on 160 by 120. Each is run 3,000 ticks first, as a yard in play would be kept.
 * Times are medians, in milliseconds. Nothing is asserted here; the budgets are tests.
 *
 * Then the work of catching a yard up, as Leaf does for one its owner left: each staged yard, the
 * generated yard of about 1,000 pieces, a ring of 40 belts with 4 growers on it (tier 7), a folded ring
 * of 6,000 tiles with one free, its sorters set to nothing and set to stone (`test/folded.ts`), and each
 * save run on for eight hours of ticks, in
 * milliseconds of work for each hour of the yard's time, the best of three. And lines that never
 * wait: three of 41 belts each, from crates full of planks into the depot, in milliseconds for 1,500
 * ticks of twenty copies, the median of nine. `--hours` prints those two tables alone, `--lines` the
 * last alone.
 */
import { heapStats } from "bun:jsc";

import * as F from "./src/index.ts";
import { generate } from "./test/gen.ts";
import { folded } from "./test/folded.ts";
import { ringOfGrowers } from "./test/growers.ts";
import { bareLand, makeLand } from "./test/land.ts";
import { generated, must, saved, SAVES, staged, STAGES } from "./test/yards.ts";

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
const pieces = (y: F.Yard): number => y.kind.filter((k) => k !== F.NONE).length;

function made(name: string, cols: number, rows: number, target: number): { name: string; y: F.Yard } {
  const t = now();
  const g = generate(makeLand(cols, rows, 7), target);
  console.error(`${name}: generated in ${fmt(now() - t)} ms with ${g.commands.length} commands`);
  for (let k = 0; k < 3000; k++) F.step(g.y);
  return { name, y: g.y };
}

function sizes(): void {
  const rows: string[][] = [];
  for (const { name, y } of [made("6000", 7, 7, 6000), made("10000", 10, 10, 10_000)]) {
    const packed = F.encode(y);
    rows.push([
      name,
      String(pieces(y)),
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
}

const HOURS = 8;
const HOUR = 36_000;

/** The work of running a yard on for eight hours, in milliseconds an hour: the best of three runs, each on a copy of it. */
function perHour(y: F.Yard): number {
  const text = F.encode(y);
  let best = Infinity;
  for (let run = 0; run < 3; run++) {
    const copy = F.decode(text, y.land);
    if (!copy) throw new Error("the yard does not read back");
    const t = now();
    for (let k = 0; k < HOURS * HOUR; k++) F.step(copy);
    best = Math.min(best, (now() - t) / HOURS);
  }
  return best;
}

function hours(): void {
  const yards: [string, F.Yard][] = [
    ...STAGES.map((s): [string, F.Yard] => [`staged ${s}`, staged(s)]),
    ["generated", generated().y],
    ["a ring of 40 belts with 4 growers", ringOfGrowers()],
    ["a folded ring of 6,000 belts and sorters, one tile free", folded().y],
    ["the same, its sorters set to stone", folded(true).y],
    ...SAVES.map((s): [string, F.Yard] => [`save ${s}`, saved(s)]),
  ];
  console.log("| yard | pieces | ms an hour |");
  console.log("| --- | ---: | ---: |");
  for (const [name, y] of yards) console.log(`| ${name} | ${pieces(y)} | ${fmt(perHour(y))} |`);
}

/** Three lines of 41 belts into the depot, each from a crate full of planks, which none of them empties in 1,500 ticks. */
function flowing(): F.Yard {
  const y = F.create({ land: bareLand(56, 15, [], [50, 7]), tier: 5, seed: 1 });
  for (const z of [6, 7, 8]) {
    must(y, { do: "build", kind: "crate", x: 7, y: z, dir: 0 });
    for (let x = 8; x <= 48; x++) must(y, { do: "build", kind: "belt", x, y: z, dir: 0 });
    const crate = F.holderOf(y, F.at(y, 7, z));
    for (let k = 0; k < y.open.crate; k++) F.put(y.holders, crate, F.item("plank"));
  }
  return y;
}

/** The work of 1,500 ticks of the flowing lines on twenty copies of them, the median of nine such runs. */
function lines(): void {
  const y = flowing();
  const text = F.encode(y);
  const times: number[] = [];
  let came = 0;
  for (let run = 0; run < 9; run++) {
    const copies = Array.from({ length: 20 }, () => F.decode(text, y.land) ?? y);
    const t = now();
    for (const copy of copies) for (let k = 0; k < 1500; k++) F.step(copy);
    times.push(now() - t);
    came = copies[0]?.depot[F.item("plank")] ?? 0;
  }
  console.log("| lines that never wait | ms for 1,500 ticks of 20 copies | planks in, each |");
  console.log("| --- | ---: | ---: |");
  console.log(
    `| three of 41 belts from full crates | ${fmt(times.toSorted((p, q) => p - q)[4] ?? Number.NaN)} | ${came} |`,
  );
}

if (!process.argv.includes("--hours")) sizes();
if (!process.argv.includes("--lines")) hours();
lines();
