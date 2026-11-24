/**
 * The read set (`bun run budget`, printed by `bun run verify`; it fails nothing): how many lines of
 * source each page and the API run, which is what a change to one of them may need read: each
 * script, page and style Bun's bundler reads for it (`graph.ts`), counted once whole, as physical
 * lines; by workspace, the largest first.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { built, entries, root } from "./graph.ts";

const lines = (f: string): number => readFileSync(join(root, f), "utf8").split("\n").length - 1;
/** The workspace a file is in: `apps/town`, `packages/kit`. */
const home = (f: string): string => f.split("/").slice(0, 2).join("/");

if (import.meta.main) {
  console.log("Read set: lines of source each page and the API run.");
  const builds = await Promise.all(entries().map(async (entry) => ({ entry, g: await built(entry) })));
  for (const { entry, g } of builds) {
    const reached = [...g.keys()].filter((f) => /\.(ts|css|html)$/.test(f));
    const by = new Map<string, number>();
    for (const f of reached) by.set(home(f), (by.get(home(f)) ?? 0) + lines(f));
    const total = [...by.values()].reduce((a, b) => a + b, 0);
    const parts = [...by].toSorted((a, b) => b[1] - a[1]).map(([w, n]) => `${w} ${n.toLocaleString("en-US")}`);
    console.log(
      `  ${entry.name.padEnd(7)} ${total.toLocaleString("en-US").padStart(7)} lines in ${reached.length} files: ${parts.join(", ")}`,
    );
  }
}
