/**
 * The read set (`bun run budget`, printed by `bun run verify`; it fails nothing): how many lines of
 * source each page and the API reach by code that runs, which is what a change to one of them may
 * need read. From each app's `index.html`, and from the API's `main.ts` with its migrations (which
 * its migrator reads from their folder), every file reached by a runtime import, a page's script or
 * a style's import, counted once whole, as physical lines; by workspace, the largest first.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { graph, reach, root, tracked } from "./graph.ts";

const lines = (f: string): number => readFileSync(join(root, f), "utf8").split("\n").length - 1;
/** The workspace a file is in: `apps/town`, `packages/kit`. */
const home = (f: string): string => f.split("/").slice(0, 2).join("/");

if (import.meta.main) {
  const files = tracked();
  const g = graph(files);
  const entries: [string, string[]][] = [
    ["Town", ["apps/town/index.html"]],
    ["Works", ["apps/works/index.html"]],
    ["Raid", ["apps/battler/index.html"]],
    ["API", ["apps/api/src/main.ts", ...files.filter((f) => /^apps\/api\/migrations\/.+\.ts$/.test(f))]],
  ];
  console.log("Read set: lines reached by code that runs, from each page and the API.");
  for (const [name, from] of entries) {
    const reached = [...reach(g, from)];
    const by = new Map<string, number>();
    for (const f of reached) by.set(home(f), (by.get(home(f)) ?? 0) + lines(f));
    const total = [...by.values()].reduce((a, b) => a + b, 0);
    const parts = [...by].toSorted((a, b) => b[1] - a[1]).map(([w, n]) => `${w} ${n.toLocaleString("en-US")}`);
    console.log(
      `  ${name.padEnd(5)} ${total.toLocaleString("en-US").padStart(7)} lines in ${reached.length} files: ${parts.join(", ")}`,
    );
  }
}
