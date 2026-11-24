/**
 * The repository's source as a graph, for the checks on it (`imports.ts`, `budget.ts`): every
 * tracked TypeScript file, page and style, and what each imports, resolved as Bun's bundler resolves
 * it, through each workspace package's `exports`. Only imports inside the repository are edges.
 *
 * An import is `runtime` when it is in the code that runs: Bun's own scanner drops imports of types
 * alone, as the bundler does. Imports of types are edges too, for the boundaries, which hold for
 * them as well.
 */
import { readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";

/** The repository's root folder. */
export const root = join(import.meta.dir, "..", "..", "..");

export interface Edge {
  /** The file imported, from the root. */
  readonly to: string;
  /** Whether it is imported by code that runs, not for types alone. */
  readonly runtime: boolean;
}

/** Every tracked file, from the root. */
export function tracked(): string[] {
  const out = Bun.spawnSync(["git", "ls-files", "-z"], { cwd: root, stdout: "pipe" });
  return out.stdout.toString().split("\0").filter(Boolean);
}

const scanner = new Bun.Transpiler({ loader: "ts" });
/** What an import or export declaration names, types too: a line that begins one, up to its `from "x"`. */
const named = /^[ \t]*(?:import|export)\b[^;'"`]*?\bfrom\s*["']([^"']+)["']/gm;
/** What a page loads, and what a style imports. */
const loaded = /<(?:script|link)\b[^>]*\b(?:src|href)=["']([^"']+\.(?:ts|css))["']/g;
const imported = /@import\s+(?:url\()?["']([^"']+)["']/g;

/** Where a specifier leads from a file, from the root; null for a package outside the repository or the runtime's own. */
function resolve(file: string, spec: string): string | null {
  let at: string;
  try {
    at = Bun.resolveSync(spec, join(root, dirname(file)));
  } catch {
    if (spec.startsWith(".") || spec.startsWith("@sequoia-leaf/")) throw new Error(`${file}: cannot resolve ${spec}`);
    return null;
  }
  const path = relative(root, at);
  return path.startsWith("..") || path.split("/").includes("node_modules") || !at.startsWith("/") ? null : path;
}

/** What a file imports, as edges. */
export function edgesOf(file: string): Edge[] {
  const text = readFileSync(join(root, file), "utf8");
  const edges = new Map<string, boolean>();
  const add = (spec: string, runtime: boolean): void => {
    const to = resolve(file, spec);
    if (to !== null) edges.set(to, (edges.get(to) ?? false) || runtime);
  };
  if (file.endsWith(".html")) for (const m of text.matchAll(loaded)) add(m[1] ?? "", true);
  else if (file.endsWith(".css")) for (const m of text.matchAll(imported)) add(m[1] ?? "", true);
  else {
    for (const i of scanner.scanImports(text)) add(i.path, true);
    for (const m of text.matchAll(named)) add(m[1] ?? "", false);
  }
  return [...edges].map(([to, runtime]) => ({ to, runtime }));
}

/** Whether a file is a test or only helps tests. */
export const isTest = (file: string): boolean =>
  file.endsWith(".test.ts") ||
  file.split("/").includes("test") ||
  file === "packages/kit/src/standin.ts" ||
  file === "packages/raid/src/testkit.ts";

/** The graph of the source files, each with its edges. */
export function graph(files: readonly string[] = tracked()): Map<string, Edge[]> {
  const source = files.filter((f) => /^(apps|packages)\/.*\.(ts|css)$/.test(f) || /^apps\/[^/]+\/index\.html$/.test(f));
  return new Map(source.map((f) => [f, edgesOf(f)]));
}

/** Everything a set of entries reaches by code that runs, the entries included. */
export function reach(g: ReadonlyMap<string, readonly Edge[]>, entries: readonly string[]): Set<string> {
  const seen = new Set<string>();
  const todo = [...entries];
  for (let f = todo.pop(); f !== undefined; f = todo.pop()) {
    if (seen.has(f)) continue;
    seen.add(f);
    for (const e of g.get(f) ?? []) if (e.runtime) todo.push(e.to);
  }
  return seen;
}
