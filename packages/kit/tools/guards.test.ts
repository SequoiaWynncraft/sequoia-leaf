/**
 * The guards: the ratchet that holds counts to the base branch's, the import check on a repository of its
 * own, the runs the clone check counts as copied, and the repository's own lint rules, run by oxlint
 * on a file that breaks each.
 */
import { describe, expect, test } from "bun:test";
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { code, RUN, shared, tokens } from "./clones.ts";
import { built, entries, type Graph, root } from "./graph.ts";
import { findings, loops } from "./imports.ts";
import { isDiagnostics } from "./lint.ts";
import { compare, type Rekey, withMoves } from "./ratchet.ts";

/** A key that is a pair of files, in order. */
const sorted: Rekey = (_g, key, moved) => key.split(" ").map(moved).toSorted().join(" ");

describe("the ratchet", () => {
  const base = { "raw-browser": { "a.ts": 3, "b.ts": 1 } };
  test("tells what is new or more from what is less", () => {
    const { worse, better } = compare(base, {
      "raw-browser": { "a.ts": 4, "c.ts": 1 },
      "module-let": { "a.ts": 1 },
    });
    expect(worse.map((c) => `${c.group} ${c.key} ${c.was}->${c.now}`)).toEqual([
      "module-let a.ts 0->1",
      "raw-browser a.ts 3->4",
      "raw-browser c.ts 0->1",
    ]);
    expect(better.map((c) => `${c.key} ${c.was}->${c.now}`)).toEqual(["b.ts 1->0"]);
  });
  test("reads the base's keys with moved files' new paths, two that come to one added up", () => {
    const renamed = new Map([["a.ts", "games/a.ts"]]);
    expect(withMoves(base, renamed)).toEqual({ "raw-browser": { "games/a.ts": 3, "b.ts": 1 } });
    const pairs = { copied: { "a.ts z.ts": 2, "b.ts games/a.ts": 1 } };
    expect(withMoves(pairs, new Map([["z.ts", "b.ts"]]), sorted)).toEqual({
      copied: { "a.ts b.ts": 2, "b.ts games/a.ts": 1 },
    });
  });
});

/**
 * A repository of its own, with the ratchet and a check that counts the lines saying HIT in each
 * `.hit` file, holding the working tree's to the base's; its main branch has `a.hit` with two. Runs
 * the check with only the environment it is given, as a developer's machine or GitHub's CI would.
 */
function repo() {
  const dir = mkdtempSync(join(tmpdir(), "leaf-ratchet-"));
  const tools = join(dir, "packages", "kit", "tools");
  const git = (...args: string[]): string => {
    const out = Bun.spawnSync(
      ["git", "-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args],
      { cwd: dir, stdout: "pipe", stderr: "pipe" },
    );
    if (out.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${out.stderr.toString()}`);
    return out.stdout.toString().trim();
  };
  /** Writes a file of `hits` lines saying HIT, and stages it. */
  const hits = (path: string, n: number): void => {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), "HIT\n".repeat(n));
    git("add", "-A");
  };
  mkdirSync(tools, { recursive: true });
  // Where a file is moved to.
  mkdirSync(join(dir, "games"));
  copyFileSync(join(import.meta.dir, "ratchet.ts"), join(tools, "ratchet.ts"));
  writeFileSync(
    join(tools, "check.ts"),
    [
      'import { readFileSync } from "node:fs";',
      'import { join } from "node:path";',
      'import { type Counts, hold } from "./ratchet.ts";',
      "const counted = (at: string): Counts => {",
      "  const out: Counts = { hit: {} };",
      '  for (const f of new Bun.Glob("**/*.hit").scanSync({ cwd: at }))',
      '    out.hit[f] = readFileSync(join(at, f), "utf8").split("\\n").filter((l) => l === "HIT").length;',
      "  return out;",
      "};",
      'process.exit((await hold("x", counted(join(import.meta.dir, "../../..")), counted)) ? 0 : 1);',
      "",
    ].join("\n"),
  );
  git("init", "-qb", "main");
  hits("a.hit", 2);
  git("commit", "-qm", "two");
  /** Runs the check, in an environment of only `env`: says whether it passed, and what it said. */
  const check = (env: Record<string, string> = {}): [boolean, string] => {
    const out = Bun.spawnSync([process.execPath, join(tools, "check.ts")], {
      cwd: dir,
      env: { PATH: process.env.PATH ?? "", HOME: dir, TMPDIR: tmpdir(), ...env },
      stdout: "pipe",
      stderr: "pipe",
    });
    return [out.exitCode === 0, out.stderr.toString()];
  };
  return { git, hits, check, done: () => rmSync(dir, { recursive: true, force: true }) };
}

describe("the ratchet, held to the base branch's counts", () => {
  test("a count lowered passes with nothing written down; raised, or new in a new file, fails; a file moved keeps its counts", () => {
    const r = repo();
    try {
      r.git("update-ref", "refs/remotes/origin/main", "main");
      r.git("checkout", "-qb", "change");
      expect(r.check()[0]).toBe(true);
      r.hits("a.hit", 1);
      expect(r.check()).toEqual([true, ""]);
      r.hits("a.hit", 3);
      expect(r.check()).toEqual([false, expect.stringContaining("more: hit a.hit, 3 (was 2)")]);
      r.hits("a.hit", 2);
      r.git("mv", "a.hit", "games/a.hit");
      expect(r.check()[0]).toBe(true);
      // Committed, and moved again: held to the base all the same.
      r.git("commit", "-qm", "moved");
      r.git("mv", "games/a.hit", "games/b.hit");
      expect(r.check()[0]).toBe(true);
      r.hits("d.hit", 1);
      expect(r.check()).toEqual([false, expect.stringContaining("new: hit d.hit (1)")]);
    } finally {
      r.done();
    }
  });

  test("in a pull request's CI run, held to the merge commit's first parent; with no base, it fails and says how to fetch one", () => {
    const r = repo();
    try {
      r.git("checkout", "-qb", "change");
      r.hits("a.hit", 3);
      r.git("commit", "-qm", "three");
      r.git("checkout", "-q", "main");
      r.git("merge", "-q", "--no-ff", "-m", "merge", "change");
      const pull = { GITHUB_ACTIONS: "true", GITHUB_BASE_REF: "main" };
      expect(r.check(pull)).toEqual([false, expect.stringContaining("more: hit a.hit, 3 (was 2)")]);
      expect(r.check({ GITHUB_ACTIONS: "true", GITHUB_EVENT_NAME: "push" })[0]).toBe(false);
      // No origin/main here, and not a pull request's run: nothing to hold the counts to.
      expect(r.check()).toEqual([false, expect.stringContaining("git fetch origin main")]);
    } finally {
      r.done();
    }
  });
});

describe("the import check's loops", () => {
  const g: Graph = new Map([
    ["a", [{ to: "b", eager: true }]],
    ["b", [{ to: "a", eager: true }]],
    ["c", [{ to: "d", eager: false }]],
    ["d", [{ to: "c", eager: true }]],
    ["e", [{ to: "e", eager: true }]],
    ["f", [{ to: "a", eager: true }]],
  ]);
  test("are groups that import each other eagerly; a dynamic import() closes none", () => {
    expect(loops(g)).toEqual([["a", "b"], ["e"]]);
  });
});

/** A repository of its own, of `files` (path to text), with `node_modules` linked to the packages named in `links`. */
function fixture(files: Record<string, string>, links: Record<string, string>): { at: string; done: () => void } {
  const at = mkdtempSync(join(tmpdir(), "leaf-imports-"));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(at, path)), { recursive: true });
    writeFileSync(join(at, path), text);
  }
  for (const [name, to] of Object.entries(links)) {
    mkdirSync(dirname(join(at, "node_modules", name)), { recursive: true });
    symlinkSync(join(at, to), join(at, "node_modules", name));
  }
  return { at, done: () => rmSync(at, { recursive: true, force: true }) };
}

const project = (include: string): string =>
  JSON.stringify({ extends: "../../tsconfig.base.json", include: [include] });
/** A base for the projects, with `lib`, that passes TypeScript as the repository's does. */
const base = (lib: readonly string[]): string =>
  JSON.stringify({
    compilerOptions: {
      lib,
      module: "preserve",
      moduleResolution: "bundler",
      types: [],
      allowImportingTsExtensions: true,
      noEmit: true,
    },
  });

describe("the import check, on what Bun builds and checks", () => {
  test("finds review code reached through other files, resolved as the build resolves it, types imported in code, and the DOM a rule package inherits", async () => {
    const { at, done } = fixture(
      {
        // Every project has the DOM from the base, the rules' too.
        "tsconfig.base.json": base(["ES2024", "DOM"]),
        "apps/api/src/main.ts": "console.log(0);\n",
        "apps/town/tsconfig.json": project("src"),
        "apps/town/index.html": '<script type="module" src="./src/init.ts"></script>',
        "apps/town/src/init.ts": 'import "./extras.ts";\nimport { cond } from "@fx/cond";\nconsole.log(cond);\n',
        "apps/town/src/extras.ts": 'import { tour } from "../review/tour.ts";\nconsole.log(tour);\n',
        "apps/town/review/tour.ts": "export const tour = 1;\n",
        "apps/town/src/shapes.ts": [
          "/*",
          ' import { other } from "../../works/src/other.ts";',
          "*/",
          'export type Shape = import("../../works/src/shape.ts").Shape;',
        ].join("\n"),
        "apps/works/tsconfig.json": project("src"),
        "apps/works/src/shape.ts": "export interface Shape {\n  readonly n: number;\n}\n",
        "apps/works/src/other.ts": "export const other = 1;\n",
        "packages/cond/package.json": JSON.stringify({
          name: "@fx/cond",
          exports: { ".": { browser: "./browser.ts", default: "./bun.ts" } },
        }),
        "packages/cond/browser.ts":
          'import { tour } from "../../apps/town/review/tour.ts";\nexport const cond = tour;\n',
        "packages/cond/bun.ts": "export const cond = 0;\n",
        "packages/core/tsconfig.json": project("src"),
        "packages/core/src/rule.ts": "export const title = (): string => document.title;\n",
      },
      { "@fx/cond": "packages/cond" },
    );
    try {
      const { found, ways } = await findings(at);
      expect(found).toEqual({
        review: {
          "town: apps/town/src/extras.ts -> apps/town/review/tour.ts": 1,
          "town: packages/cond/browser.ts -> apps/town/review/tour.ts": 1,
        },
        "app-to-app": { "apps/town/src/shapes.ts -> apps/works/src/shape.ts": 1 },
        "rule-package": { "packages/core reads lib.dom.d.ts": 1 },
      });
      expect(ways).toContain(
        "town: apps/town/index.html -> apps/town/src/init.ts -> apps/town/src/extras.ts -> apps/town/review/tour.ts",
      );
    } finally {
      done();
    }
  });

  test("holds each build to the review code it reaches, and each import into it, review code's own too", async () => {
    const { at, done } = fixture(
      {
        "apps/api/src/main.ts": "console.log(0);\n",
        "apps/town/index.html": '<script type="module" src="./src/init.ts"></script>',
        "apps/town/src/init.ts":
          'import { tour } from "./review.ts";\nimport { play } from "../../../packages/raid/src/index.ts";\nconsole.log(tour, play);\n',
        "apps/town/src/review.ts": 'import { step } from "../review/step.ts";\nexport const tour = step;\n',
        "apps/town/review/step.ts": "export const step = 1;\n",
        // Works ships review code through the barrel the town already reaches it by.
        "apps/works/index.html": '<script type="module" src="./src/init.ts"></script>',
        "apps/works/src/init.ts": 'import { play } from "../../../packages/raid/src/index.ts";\nconsole.log(play);\n',
        "packages/raid/src/index.ts": 'export { bot as play } from "../review/bot.ts";\n',
        "packages/raid/review/bot.ts": "export const bot = 2;\n",
      },
      {},
    );
    try {
      expect((await findings(at)).found.review).toEqual({
        "town: apps/town/src/init.ts -> apps/town/src/review.ts": 1,
        "town: apps/town/src/review.ts -> apps/town/review/step.ts": 1,
        "town: packages/raid/src/index.ts -> packages/raid/review/bot.ts": 1,
        "works: packages/raid/src/index.ts -> packages/raid/review/bot.ts": 1,
      });
    } finally {
      done();
    }
  });

  test("fails on a project TypeScript does not pass, saying why", async () => {
    const { at, done } = fixture(
      {
        "tsconfig.base.json": base(["ES2024"]),
        "apps/api/src/main.ts": "export const main = 0;\n",
        "apps/api/tsconfig.json": project("src"),
        "apps/api/src/wrong.ts": 'export const n: number = "x";\n',
      },
      {},
    );
    try {
      const failed = await findings(at).then(
        () => "passed",
        (e: unknown) => String(e),
      );
      expect(failed).toMatch(/apps\/api\/tsconfig\.json[\s\S]*TS2322/);
    } finally {
      done();
    }
  });
});

describe("the builds the import check and the read set read", () => {
  test("are the three pages and the API, its migrations too, each reaching more than a handful of files", async () => {
    const all = entries();
    expect(all.map((e) => e.name)).toEqual(["battler", "town", "works", "api"]);
    const migrations = readdirSync(join(root, "apps/api/migrations")).filter((f) => f.endsWith(".ts"));
    expect(all.at(-1)?.from).toEqual([
      "apps/api/src/main.ts",
      ...migrations.toSorted().map((f) => `apps/api/migrations/${f}`),
    ]);
    const reached = await Promise.all(all.map(async (e): Promise<[string, number]> => [e.name, (await built(e)).size]));
    expect(reached.filter(([, n]) => n <= 20)).toEqual([]);
  });
});

describe("the clone check", () => {
  test("reads tokens without comments or spacing", () => {
    expect(tokens("const a = 1; // one\n/* two */ a => a")).toEqual(["const", "a", "=", "1", ";", "a", "=>", "a"]);
  });
  test("reads an operator of more than one sign as one token", () => {
    expect(tokens("a += 1; b **= c ** 2; d ??= e >>> 1; f++; g &&= h << 1;")).toEqual(
      ["a", "+=", "1", ";", "b", "**=", "c", "**", "2", ";", "d", "??=", "e", ">>>", "1", ";"].concat([
        "f",
        "++",
        ";",
        "g",
        "&&=",
        "h",
        "<<",
        "1",
        ";",
      ]),
    );
  });
  test("leaves import declarations out, but not a dynamic import or import.meta", () => {
    const names = Array.from({ length: RUN }, (_, i) => `import { k${i} } from "./k${i}.ts";`).join("\n");
    expect(code(`${names}\nconst a = 1;`)).toEqual(["const", "a", "=", "1", ";"]);
    const dynamic = 'const m = import("./m.ts"); const d = import.meta.dir;';
    expect(code(dynamic)).toEqual(tokens(dynamic));
    // A class field named `import` is code, with its initializer.
    const field = "class Task { done = false; import = runTask(); }";
    expect(code(field)).toEqual(tokens(field));
    // Every form of a static import is left out.
    const forms = [
      'import "./side.ts";',
      'import * as all from "./all.ts";',
      'import type { T } from "./t.ts";',
      'import one from "./one.ts";',
      'import two, { three } from "./two.ts";',
    ].join("\n");
    expect(code(`${forms}\nconst a = 1;`)).toEqual(["const", "a", "=", "1", ";"]);
    expect(
      shared(
        new Map([
          ["apps/town/src/a.ts", names],
          ["apps/works/src/b.ts", names],
        ]),
      ),
    ).toEqual({});
  });
  test("counts the runs two workspaces share, and none within one", () => {
    const copied = Array.from({ length: RUN + 4 }, (_, i) => `x${i}`).join(" + ");
    const found = shared(
      new Map([
        ["apps/town/src/a.ts", copied],
        ["apps/town/src/b.ts", copied],
        ["apps/works/src/c.ts", `// a copy\n${copied}`],
        ["apps/works/src/d.ts", "const short = 1;"],
      ]),
    );
    const runs = tokens(copied).length - RUN + 1;
    expect(found).toEqual({
      copied: { "apps/town/src/a.ts apps/works/src/c.ts": runs, "apps/town/src/b.ts apps/works/src/c.ts": runs },
    });
  });
});

/** What the repository's own rules, and the restricted imports, say of `lines`, as oxlint finds it: each hit's line and rule. */
function linted(lines: readonly string[]): string[] {
  const dir = mkdtempSync(join(tmpdir(), "leaf-lint-"));
  try {
    const file = join(dir, "probe.ts");
    writeFileSync(file, lines.join("\n"));
    const run = Bun.spawnSync(
      [join(root, "node_modules/.bin/oxlint"), "-c", join(root, ".oxlintrc.json"), "-f", "json", file],
      { cwd: root, stdout: "pipe" },
    );
    const out: unknown = JSON.parse(run.stdout.toString());
    if (!isDiagnostics(out)) throw new Error("oxlint said something other than its diagnostics");
    return out.diagnostics
      .filter((d) => d.code.startsWith("leaf(") || d.code.includes("restricted"))
      .map((d) => `${d.labels[0]?.span.line ?? 0} ${d.code}`)
      .toSorted((a, b) => Number.parseInt(a) - Number.parseInt(b) || (a < b ? -1 : a > b ? 1 : 0));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("the repository's lint rules", () => {
  test("find raw browser operations, `let` at the top of a module, and hook frameworks", () => {
    expect(
      linted([
        'import { useState } from "preact/hooks";',
        "let top = 0;",
        "export function f(): number { let inside = top; inside += 1; return inside; }",
        'window.addEventListener("x", f);',
        "setTimeout(f, 1);",
        "const watch = new ResizeObserver(f);",
        'const r: unknown = require("react");',
        "console.log(useState, watch, r);",
      ]),
    ).toEqual([
      "1 eslint(no-restricted-imports)",
      "2 leaf(module-let)",
      "4 leaf(raw-browser)",
      "5 leaf(raw-browser)",
      "6 leaf(raw-browser)",
      "7 leaf(hook-framework)",
    ]);
  });

  test("find a number said its own way, outside `say.ts`: a format, or a rate in words of its own, but not prose", () => {
    expect(
      linted([
        "export const a = (v: number): string => v.toLocaleString('en-US');",
        "export const b = new Intl.NumberFormat('en-US');",
        "export const c = { maximumFractionDigits: 1 };",
        "export const d = (v: number): string => `${v} /min`;",
        "export const e = (v: number): string => `${v} folios a minute, from ${v} Studies`;",
        "export const f = 'Carries up to 150 items a minute.';",
        "export const g = 'Try again in a minute.';",
        "export const h = 'Its card says what it makes and needs a minute.';",
        "export const i = (id: string): string => `https://x.y/session/minecraft/profile/${id}`;",
        "export const j = (v: number): string => `${v} min`;",
      ]),
    ).toEqual([
      "1 leaf(said-number)",
      "2 leaf(said-number)",
      "3 leaf(said-number)",
      "4 leaf(said-number)",
      "5 leaf(said-number)",
      "6 leaf(said-number)",
    ]);
  });

  test("find a browser primitive taken as a value, and letting go of one, but not a name of its own or a type", () => {
    expect(
      linted([
        "export const frame = new Promise<number>(requestAnimationFrame);",
        "const raf = requestAnimationFrame;",
        "export const later = (f: () => void): unknown => [raf(f), window.setTimeout, globalThis['setInterval']];",
        "export const stop = (n: number): void => { clearTimeout(n); window.cancelAnimationFrame(n); clearInterval(n); };",
        "export const off = (el: Element, f: () => void): void => el.removeEventListener('x', f);",
        "const { setTimeout: wait } = window;",
        "export function own(setTimeout: (f: () => void) => void, f: () => void): void { setTimeout(f); }",
        "export const kept = (w: WebSocket): ReturnType<typeof setTimeout> | WebSocket => w;",
        "export const sockets = [WebSocket, new self.WebSocket('ws://x')];",
      ]),
    ).toEqual([
      "1 leaf(raw-browser)",
      "2 leaf(raw-browser)",
      "3 leaf(raw-browser)",
      "3 leaf(raw-browser)",
      "4 leaf(raw-browser)",
      "4 leaf(raw-browser)",
      "4 leaf(raw-browser)",
      "5 leaf(raw-browser)",
      "6 leaf(raw-browser)",
      "9 leaf(raw-browser)",
      "9 leaf(raw-browser)",
    ]);
  });
});
