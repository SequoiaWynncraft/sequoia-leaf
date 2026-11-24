/**
 * The lint (`bun run lint`, in `bun run verify` and CI): oxlint, type-aware, with `.oxlintrc.json`.
 * Any rule's hit fails, but for five rules newer than much of the code they judge: raw browser
 * operations outside the kit's scope, `let` at the top of a module, and files, functions and
 * branching over their size. Those are held to `baseline/lint.json` (`ratchet.ts`), and the
 * rebuilds take them out: a file's hits of the first two to as many as it had, and of the size
 * rules to the sizes it had (its lines, a function's lines, a function's complexity, summed over
 * the file's hits), so a file already too long cannot grow.
 */
import { join } from "node:path";

import { count, type Counts, hold } from "./ratchet.ts";

const root = join(import.meta.dir, "..", "..", "..");

/** The rules held to the baseline, by the names oxlint gives them. */
const HELD = new Set(["raw-browser", "module-let", "max-lines", "max-lines-per-function", "complexity"]);

/** The rules held by size, which oxlint gives as the first number in its message ("too many lines (667)"). */
const SIZED = new Set(["max-lines", "max-lines-per-function", "complexity"]);

/** How much a hit weighs: its size for a size rule, else one. */
const weight = (rule: string, message: string): number => (SIZED.has(rule) ? Number(/\d+/.exec(message)?.[0] ?? 1) : 1);

interface Diagnostic {
  readonly code: string;
  readonly message: string;
  readonly filename: string;
  readonly help?: string;
  readonly labels: readonly { readonly span: { readonly line: number; readonly column: number } }[];
}

function isDiagnostics(x: unknown): x is { diagnostics: Diagnostic[] } {
  return typeof x === "object" && x !== null && "diagnostics" in x && Array.isArray(x.diagnostics);
}

if (import.meta.main) {
  const run = Bun.spawnSync([join(root, "node_modules", ".bin", "oxlint"), "--type-aware", "-f", "json"], {
    cwd: root,
    stdout: "pipe",
    stderr: "inherit",
  });
  const out: unknown = JSON.parse(run.stdout.toString());
  if (!isDiagnostics(out)) throw new Error("oxlint said something other than its diagnostics");
  const held: Counts = {};
  let failed = false;
  for (const d of out.diagnostics) {
    // `eslint(max-lines)`, `leaf(raw-browser)`: the rule's own name.
    const rule = d.code.replace(/^[\w-]+\((.+)\)$/, "$1");
    if (HELD.has(rule)) {
      count(held, rule, d.filename, weight(rule, d.message));
      continue;
    }
    const at = d.labels[0]?.span;
    console.error(`${d.filename}:${at?.line ?? 0}:${at?.column ?? 0}  ${d.code}  ${d.message}`);
    if (d.help) console.error(`  ${d.help}`);
    failed = true;
  }
  const kept = hold("lint", held, "bun run lint");
  if (failed || !kept) process.exit(1);
  console.log(`Lint: nothing new, in ${out.diagnostics.length} hits held to the baseline.`);
}
