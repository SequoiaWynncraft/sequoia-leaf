/**
 * The repository as Bun's own tools read it (`imports.ts`, `budget.ts`): what a page or the API runs,
 * from `Bun.build`'s metafile, resolved as the build resolves it, types gone (`built`); and what each
 * TypeScript project reads, from `bun check --explainFiles` (tsc's), every file and library and who
 * imports or references each, types too, comments not (`typed`). Paths are from the repository's
 * root (`root`); only its own files, outside `node_modules`, are edges.
 */
import { join, relative, resolve } from "node:path";

export const root = join(import.meta.dir, "..", "..", "..");

/** An import: the file imported, and whether its importer waits for it to run first (all but a dynamic `import()`). */
export interface Edge {
  readonly to: string;
  readonly eager: boolean;
}
/** Each file read, from the root, and what it imports. */
export type Graph = Map<string, Edge[]>;

/** A file of the repository at `at`, from a path from there; null for a library, or one outside it or in `node_modules`. */
function inRepo(at: string, path: string): string | null {
  const from = relative(at, resolve(at, path));
  return /^\.\.|(^|\/)node_modules\/|:/.test(from) ? null : from;
}

/** What runs: a page, built for the browser, or the API (its `main.ts`, and the migrations its migrator reads from their folder), for Bun. */
export interface Entry {
  readonly name: string;
  readonly target: "browser" | "bun";
  readonly from: readonly string[];
}

const page = (p: string): Entry => ({ name: p.split("/")[1] ?? p, target: "browser", from: [p] });

/** Each page, and the API, always: a build of no file fails, where a pattern that matches nothing would skip it unseen. */
export function entries(at = root): Entry[] {
  const glob = (pattern: string): string[] => [...new Bun.Glob(pattern).scanSync({ cwd: at })].toSorted();
  const api: Entry = {
    name: "api",
    target: "bun",
    from: ["apps/api/src/main.ts", ...glob("apps/api/migrations/*.ts")],
  };
  return [...glob("apps/*/index.html").map(page), api];
}

/** What an entry runs, as Bun builds it, its styles' pictures and fonts too. */
export async function built({ from, target }: Entry, at = root): Promise<Graph> {
  const { metafile } = await Bun.build({ entrypoints: from.map((f) => join(at, f)), target, metafile: true });
  if (metafile === undefined) throw new Error(`Bun gave no metafile for ${from.join(", ")}`);
  const g: Graph = new Map();
  for (const [file, { imports }] of Object.entries(metafile.inputs)) {
    const path = inRepo(at, resolve(file));
    const edges = imports.flatMap(({ path: to, kind }) => {
      const where = inRepo(at, resolve(to));
      return where === null ? [] : [{ to: where, eager: kind !== "dynamic-import" }];
    });
    if (path !== null) g.set(path, edges);
  }
  return g;
}

/** A TypeScript project: its config, the files it reads (libraries as `bundled:///libs/lib.dom.d.ts`), and each import or reference between the repository's files. */
export interface Project {
  readonly config: string;
  readonly files: readonly string[];
  readonly edges: readonly (readonly [from: string, to: string])[];
}

/** A file `--explainFiles` lists; and a reason it gives, with the file that imports or references it. */
const FILE = /^[^\s<]\S*\.\w+$/;
const BY = /^\s+(?:Imported|Referenced) via .* from file '([^']+)'/;

/** What each workspace's TypeScript projects read; a project TypeScript does not pass fails, with what it said, as what it lists then is not to be trusted. */
export function typed(at = root): Promise<Project[]> {
  const configs = [...new Bun.Glob("{apps,packages}/*/tsconfig*.json").scanSync({ cwd: at })].toSorted();
  return Promise.all(
    configs.map(async (config): Promise<Project> => {
      const run = await Bun.$`${process.execPath} check -p ${config} --explainFiles`.cwd(at).quiet().nothrow();
      const said = run.text();
      if (run.exitCode !== 0) {
        const errors = said.match(/^<error [\s\S]*?^<\/error>$/gm) ?? [said, run.stderr.toString()];
        throw new Error(`bun check -p ${config} failed:\n${errors.join("\n")}`);
      }
      const files: string[] = [];
      const edges: [string, string][] = [];
      let to: string | null = null;
      for (const line of said.split("\n")) {
        if (FILE.test(line)) {
          files.push(line);
          to = inRepo(at, line);
        }
        const by = BY.exec(line)?.[1];
        const from = by === undefined ? null : inRepo(at, by);
        if (to !== null && from !== null) edges.push([from, to]);
      }
      if (files.length === 0) throw new Error(`bun check listed nothing for ${config}`);
      return { config, files, edges };
    }),
  );
}
