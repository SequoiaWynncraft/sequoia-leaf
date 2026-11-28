/**
 * The import check (`bun run imports`, in `bun run verify` and CI), on what Bun builds for each page
 * and the API and what each TypeScript project reads, types too (`graph.ts`):
 *
 * - `cycle`: no loop of imports a build waits on (all but `import()`), where which runs first matters;
 * - `app-to-app`: no app imports another; `kit-to-app`: the kit imports no app;
 * - `rule-package`: the games' rules (core, factory, raid, town, pulls) import nothing of the kit, the
 *   figures or an app, and none of their projects reads the DOM;
 * - `review`: no page, and not the API, reaches review code: a `review/` folder, or `REVIEW_CODE`.
 *   Each is a build and an import into review code it reaches, through review code too, so a build
 *   newly shipping review code another already does, or review code that imports more of it, is
 *   new; a failing check prints the whole way from the entry to each.
 *
 * Imports of types count as imports. What is found is held to what the base branch has
 * (`ratchet.ts`), which is only what the rebuilds will take out. A loop's key is its files in
 * order, so a file moved in it keeps it.
 */
import { built, entries, type Graph, root, typed } from "./graph.ts";
import { type Counts, hold, type Rekey } from "./ratchet.ts";

/** The packages of the games' rules, which run on Leaf and on the page alike. */
const RULES = ["core", "factory", "raid", "town", "pulls"].map((r) => `packages/${r}`);

/**
 * Review code that ships today: the town's handles for tours and the console, which `main.ts`
 * installs. The Town rebuild takes them out. (The raid's bot is not review code: the regulars at a
 * sitting play by it, on Leaf.)
 */
const REVIEW_CODE = new Set(["apps/town/src/review.ts"]);

const isReview = (f: string): boolean => f.split("/").includes("review") || REVIEW_CODE.has(f);
/** Whether a file is a test or only helps tests. */
const isTest = (f: string): boolean =>
  f.endsWith(".test.ts") || f.split("/").includes("test") || f === "packages/raid/src/testkit.ts";
/** The workspace a file is in: `apps/town`, `packages/kit`. */
const home = (f: string): string => f.split("/").slice(0, 2).join("/");

/** Every file reached from `from` by `next`, breadth first, each with the file it was first reached from. */
function walk(from: readonly string[], next: (f: string) => string[]): Map<string, string | null> {
  const before = new Map<string, string | null>(from.map((f) => [f, null]));
  for (const f of before.keys()) for (const t of next(f)) if (!before.has(t)) before.set(t, f);
  return before;
}

/** The loops of eager imports: each group of files that all reach each other, and a file that imports itself. */
export function loops(g: Graph): string[][] {
  const next = (f: string): string[] => (g.get(f) ?? []).filter((e) => e.eager).map((e) => e.to);
  const reach = new Map([...g.keys()].map((f) => [f, [...walk(next(f), next).keys()]]));
  const loop = ([f, r]: [string, string[]]): string[] => r.filter((t) => reach.get(t)?.includes(f)).toSorted();
  const groups = [...reach].filter(([f, r]) => r.includes(f)).map(loop);
  return [...new Map(groups.map((group) => [group.join(" "), group])).values()];
}

/** Each import into review code a build reaches, review code's own too, with the shortest way to it from an entry. */
function intoReview(g: Graph, from: readonly string[]): [string, string[]][] {
  const before = walk(from, (f) => (g.get(f) ?? []).map((e) => e.to));
  const way = (f: string | null | undefined): string[] => (f ? [...way(before.get(f)), f] : []);
  const into = (f: string): string[] => (g.get(f) ?? []).map((e) => e.to).filter(isReview);
  return [...before.keys()].flatMap((f) => into(f).map((t): [string, string[]] => [`${f} -> ${t}`, [...way(f), t]]));
}

/** What the import check finds in the repository at `at`, by group, and the whole way to each import of review code. */
export async function findings(at = root): Promise<{ found: Counts; ways: string[] }> {
  const found: Counts = {};
  const mark = (group: string, key: string): void => void ((found[group] ??= {})[key] = 1);
  const judge = (from: string, to: string): void => {
    const edge = `${from} -> ${to}`;
    if (from.startsWith("apps/") && to.startsWith("apps/") && home(from) !== home(to)) mark("app-to-app", edge);
    if (from.startsWith("packages/kit/") && to.startsWith("apps/")) mark("kit-to-app", edge);
    if (RULES.some((r) => from.startsWith(`${r}/`)) && !isTest(from) && /^(apps|packages\/(kit|figures))\//.test(to))
      mark("rule-package", edge);
  };
  const ways: string[] = [];
  const builds = await Promise.all(entries(at).map(async (entry) => ({ entry, g: await built(entry, at) })));
  for (const { entry, g } of builds) {
    for (const group of loops(g)) mark("cycle", group.join(" "));
    for (const [from, edges] of g) for (const { to } of edges) judge(from, to);
    for (const [edge, way] of intoReview(g, entry.from)) {
      mark("review", `${entry.name}: ${edge}`);
      ways.push(`${entry.name}: ${way.join(" -> ")}`);
    }
  }
  for (const project of await typed(at)) {
    for (const [from, to] of project.edges) judge(from, to);
    const rules = RULES.find((r) => project.config.startsWith(`${r}/`));
    if (rules && project.files.some((f) => f.endsWith("/lib.dom.d.ts")))
      mark("rule-package", `${rules} reads lib.dom.d.ts`);
  }
  return { found, ways };
}

/** A key with moved files' new paths: a loop's files in order again, an edge's as they were. */
const rekey: Rekey = (group, key, moved) => {
  const words = key.split(" ").map(moved);
  return (group === "cycle" ? words.toSorted() : words).join(" ");
};

if (import.meta.main) {
  const { found, ways } = await findings();
  if (!(await hold("imports", found, async (at) => (await findings(at)).found, rekey))) {
    for (const way of ways) console.error(`review code reached: ${way}`);
    process.exit(1);
  }
  const n = Object.values(found).reduce((sum, keys) => sum + Object.keys(keys).length, 0);
  console.log(`Imports: nothing new; ${n} held to the base branch's.`);
}
