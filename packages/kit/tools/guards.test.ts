/**
 * The guards: the ratchet that holds counts to a baseline, the loops the import check finds, the
 * runs the clone check counts as copied, and the repository's own lint rules, run by oxlint on a
 * file that breaks each.
 */
import { describe, expect, test } from "bun:test";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { RUN, shared, tokens } from "./clones.ts";
import { type Edge, root } from "./graph.ts";
import { loops } from "./imports.ts";
import { compare, lowered } from "./ratchet.ts";

describe("the ratchet", () => {
  const baseline = { "raw-browser": { "a.ts": 3, "b.ts": 1 } };
  test("fails what is new or more, and asks for what is less to be written down", () => {
    const { worse, better } = compare(baseline, {
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
  test("lowered, never takes a new key or a higher count", () => {
    expect(lowered(baseline, { "raw-browser": { "a.ts": 2, "b.ts": 5, "c.ts": 1 } })).toEqual({
      "raw-browser": { "a.ts": 2, "b.ts": 1 },
    });
  });
});

/**
 * A repository of its own, with the ratchet and a check that holds the counts it is given to the
 * `x` baseline, and a main branch whose baseline is `{ r: { f: 1 } }`. Runs the check with only
 * the environment it is given, as a developer's machine or GitHub's CI would.
 */
function repo() {
  const dir = mkdtempSync(join(tmpdir(), "leaf-ratchet-"));
  const tools = join(dir, "tools");
  const git = (...args: string[]): string => {
    const out = Bun.spawnSync(
      ["git", "-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args],
      { cwd: dir, stdout: "pipe", stderr: "pipe" },
    );
    if (out.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${out.stderr.toString()}`);
    return out.stdout.toString().trim();
  };
  const baseline = (counts: object): void => {
    mkdirSync(join(tools, "baseline"), { recursive: true });
    writeFileSync(join(tools, "baseline", "x.json"), JSON.stringify(counts));
    git("add", "-A");
    git("commit", "-qm", "baseline");
  };
  mkdirSync(tools);
  copyFileSync(join(import.meta.dir, "ratchet.ts"), join(tools, "ratchet.ts"));
  writeFileSync(
    join(tools, "check.ts"),
    'import { hold } from "./ratchet.ts";\nprocess.exit(hold("x", JSON.parse(process.env.NOW ?? "{}"), "check") ? 0 : 1);\n',
  );
  git("init", "-qb", "main");
  baseline({ r: { f: 1 } });
  /** Runs the check on counts found now, in an environment of only `env`: says whether it passed, and what it said. */
  const check = (now: object, env: Record<string, string> = {}): [boolean, string] => {
    const out = Bun.spawnSync([process.execPath, join(tools, "check.ts")], {
      cwd: dir,
      env: { PATH: process.env.PATH ?? "", HOME: dir, NOW: JSON.stringify(now), ...env },
      stdout: "pipe",
      stderr: "pipe",
    });
    return [out.exitCode === 0, out.stderr.toString()];
  };
  return { dir, git, baseline, check, done: () => rmSync(dir, { recursive: true, force: true }) };
}
describe("the ratchet's baseline, held to the base branch's", () => {
  const CI = { GITHUB_ACTIONS: "true" };

  test("a branch that raises a count or adds a key beside a new hit fails; one that lowers passes", () => {
    const r = repo();
    try {
      r.git("update-ref", "refs/remotes/origin/main", "main");
      r.git("checkout", "-qb", "change");
      r.baseline({ r: { f: 2 } });
      const [raised, said] = r.check({ r: { f: 2 } });
      expect([raised, said]).toEqual([
        false,
        expect.stringContaining("raised in the baseline: r f, 2 (the base branch has 1)"),
      ]);
      r.baseline({ r: { f: 1, g: 1 } });
      expect(r.check({ r: { f: 1, g: 1 } })[0]).toBe(false);
      r.baseline({});
      expect(r.check({})[0]).toBe(true);
    } finally {
      r.done();
    }
  });

  test("on main itself passes; a baseline the base has none of is starting", () => {
    const r = repo();
    try {
      r.git("update-ref", "refs/remotes/origin/main", "main");
      expect(r.check({ r: { f: 1 } }, CI)[0]).toBe(true);
      r.git("checkout", "-qb", "change");
      r.git("rm", "-q", "tools/baseline/x.json");
      r.git("commit", "-qm", "none");
      r.git("update-ref", "refs/remotes/origin/main", "change");
      r.git("checkout", "-qb", "start");
      r.baseline({ r: { f: 5 } });
      expect(r.check({ r: { f: 5 } }, CI)[0]).toBe(true);
    } finally {
      r.done();
    }
  });

  test("in a pull request's CI run, held to the merge commit's first parent; with no base, CI fails and elsewhere it warns", () => {
    const r = repo();
    try {
      r.git("checkout", "-qb", "change");
      r.baseline({ r: { f: 3 } });
      r.git("checkout", "-q", "main");
      r.git("merge", "-q", "--no-ff", "-m", "merge", "change");
      const pull = { ...CI, GITHUB_BASE_REF: "main" };
      expect(r.check({ r: { f: 3 } }, pull)[0]).toBe(false);
      // No origin/main here, and not a pull request's run: nothing to hold the baseline to.
      expect(r.check({ r: { f: 3 } }, CI)).toEqual([false, expect.stringContaining("CI fails without it")]);
      expect(r.check({ r: { f: 3 } })[0]).toBe(true);
      expect(r.check({ r: { f: 3 } }, { ...CI, ACT: "true" })[0]).toBe(true);
    } finally {
      r.done();
    }
  });
});

describe("the import check's loops", () => {
  const g = new Map<string, Edge[]>([
    ["a", [{ to: "b", runtime: true }]],
    ["b", [{ to: "a", runtime: true }]],
    ["c", [{ to: "d", runtime: false }]],
    ["d", [{ to: "c", runtime: true }]],
    ["e", [{ to: "e", runtime: true }]],
    ["f", [{ to: "a", runtime: true }]],
  ]);
  test("are groups that import each other at runtime; an import of types alone closes none", () => {
    expect(loops(g, new Set(g.keys()))).toEqual([["a", "b"], ["e"]]);
  });
});

describe("the clone check", () => {
  test("reads tokens without comments or spacing", () => {
    expect(tokens("const a = 1; // one\n/* two */ a => a")).toEqual(["const", "a", "=", "1", ";", "a", "=>", "a"]);
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

describe("the repository's lint rules", () => {
  test("find raw browser operations, `let` at the top of a module, and hook frameworks", () => {
    const dir = mkdtempSync(join(tmpdir(), "leaf-lint-"));
    try {
      const file = join(dir, "probe.ts");
      writeFileSync(
        file,
        [
          'import { useState } from "preact/hooks";',
          "let top = 0;",
          "export function f(): number { let inside = top; inside += 1; return inside; }",
          'window.addEventListener("x", f);',
          "setTimeout(f, 1);",
          "const watch = new ResizeObserver(f);",
          'const r: unknown = require("react");',
          "console.log(useState, watch, r);",
        ].join("\n"),
      );
      const run = Bun.spawnSync(
        [join(root, "node_modules/.bin/oxlint"), "-c", join(root, ".oxlintrc.json"), "-f", "json", file],
        {
          cwd: root,
          stdout: "pipe",
        },
      );
      const out: unknown = JSON.parse(run.stdout.toString());
      const said =
        typeof out === "object" && out !== null && "diagnostics" in out && Array.isArray(out.diagnostics)
          ? out.diagnostics.map((d: unknown) =>
              typeof d === "object" && d !== null && "code" in d ? String(d.code) : "",
            )
          : [];
      expect(said.filter((c: string) => c.startsWith("leaf(") || c.includes("restricted")).toSorted()).toEqual([
        "eslint(no-restricted-imports)",
        "leaf(hook-framework)",
        "leaf(module-let)",
        "leaf(raw-browser)",
        "leaf(raw-browser)",
        "leaf(raw-browser)",
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
