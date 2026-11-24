/**
 * The import check (`bun run imports`, in `bun run verify` and CI), on the source graph (`graph.ts`):
 *
 * - `cycle`: no loop of runtime imports among the files that ship, where which runs first matters;
 * - `app-to-app`: no app imports another app;
 * - `rule-package`: the games' rules (core, factory, raid, town, pulls) import nothing of the kit, the
 *   figures or an app, and are checked by a tsconfig with no DOM in it;
 * - `review`: nothing that ships imports review code: a `review/` folder, or the review code that
 *   still lives among what ships (`REVIEW_CODE`).
 *
 * What is found is held to `baseline/imports.json` (`ratchet.ts`), which holds only what the
 * rebuilds will take out.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { type Edge, graph, isTest, root } from "./graph.ts";
import { count, type Counts, hold } from "./ratchet.ts";

/** The packages of the games' rules, which run on Leaf and on the page alike. */
const RULES = ["core", "factory", "raid", "town", "pulls"];

/**
 * Review code that ships today, each reached from a page's entry and the API: the town's handles for
 * tours and the console, which `main.ts` installs, and the raid's bot, which only the balance run and
 * the battler's tour drive, exported by the raid's barrel. The Town and Little Raid rebuilds take
 * them out of what ships.
 */
const REVIEW_CODE = new Set(["apps/town/src/review.ts", "packages/raid/src/bot.ts"]);

const isReview = (f: string): boolean => f.split("/").includes("review") || REVIEW_CODE.has(f);
/** A file that goes into the image: an app's page, or source of an app or a package, and no test. */
const ships = (f: string): boolean =>
  !isTest(f) &&
  !isReview(f) &&
  (/^(apps|packages)\/[^/]+\/src\//.test(f) ||
    f.startsWith("apps/api/migrations/") ||
    /^apps\/[^/]+\/index\.html$/.test(f));
/** The workspace a file is in: `apps/town`, `packages/kit`. */
const home = (f: string): string => f.split("/").slice(0, 2).join("/");

/** The loops of runtime imports among `nodes`: each strongly connected group of more than one, or one that imports itself. */
export function loops(g: ReadonlyMap<string, readonly Edge[]>, nodes: ReadonlySet<string>): string[][] {
  const next = (f: string): string[] => (g.get(f) ?? []).filter((e) => e.runtime && nodes.has(e.to)).map((e) => e.to);
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const out: string[][] = [];
  const visit = (f: string): void => {
    index.set(f, index.size);
    low.set(f, index.get(f) ?? 0);
    stack.push(f);
    for (const t of next(f)) {
      if (!index.has(t)) {
        visit(t);
        low.set(f, Math.min(low.get(f) ?? 0, low.get(t) ?? 0));
      } else if (stack.includes(t)) low.set(f, Math.min(low.get(f) ?? 0, index.get(t) ?? 0));
    }
    if (low.get(f) !== index.get(f)) return;
    const group: string[] = [];
    for (let t = stack.pop(); t !== undefined; t = t === f ? undefined : stack.pop()) group.push(t);
    if (group.length > 1 || next(f).includes(f)) out.push(group.toSorted());
  };
  for (const f of [...nodes].toSorted()) if (!index.has(f)) visit(f);
  return out;
}

/** What the import check finds, by group. */
export function findings(g: ReadonlyMap<string, readonly Edge[]>): Counts {
  const found: Counts = {};
  const shipped = new Set([...g.keys()].filter(ships));
  for (const group of loops(g, shipped)) count(found, "cycle", group.join(" "));
  for (const [from, edges] of g)
    for (const { to, runtime } of edges) {
      const edge = `${from} -> ${to}`;
      if (from.startsWith("apps/") && to.startsWith("apps/") && home(from) !== home(to))
        count(found, "app-to-app", edge);
      const rules = RULES.some((r) => from.startsWith(`packages/${r}/src/`)) && !isTest(from);
      if (rules && (to.startsWith("apps/") || to.startsWith("packages/kit/") || to.startsWith("packages/figures/")))
        count(found, "rule-package", edge);
      if (runtime && shipped.has(from) && isReview(to)) count(found, "review", edge);
    }
  for (const r of RULES) {
    const config: unknown = JSON.parse(readFileSync(join(root, "packages", r, "tsconfig.json"), "utf8"));
    const options =
      typeof config === "object" && config !== null && "compilerOptions" in config ? config.compilerOptions : null;
    const text = JSON.stringify(options ?? {});
    if (/"dom/i.test(text) || /"types":\[[^\]]+\]/.test(text))
      count(found, "rule-package", `packages/${r}/tsconfig.json gives it a library beyond the language's`);
  }
  return found;
}

if (import.meta.main) {
  const found = findings(graph());
  if (!hold("imports", found, "bun run imports")) process.exit(1);
  const n = Object.values(found).reduce((sum, keys) => sum + Object.keys(keys).length, 0);
  console.log(`Imports: nothing new; ${n} held to the baseline.`);
}
