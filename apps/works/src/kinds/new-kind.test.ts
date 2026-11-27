/**
 * A new kind of piece is one module of the rules and one of the page, each with its line in its
 * registry, and nothing else changes. The lines are by design: a list's order is the kinds' numbers,
 * kept by hand and only ever added to, so a kind is numbered where a person put it and never moves.
 *
 * The test proves it on a copy of the repository: it adds a throwaway kind (a sieve, which lets each
 * item through after a second where power reaches it) as those two modules and those two lines, and
 * nothing else; then the copy type-checks, the sieve plays by the rules beside the other kinds (built,
 * fed, worked, handed on, standing and said, counted a minute, priced and taken up), and the page
 * builds it, counts it in the dock and draws its card's numbers, its map colour and its lamp from its
 * module. A second throwaway (a furnace, which burns for power at ten boilers' worth) is counted as
 * its own in the power book, beside a boiler gone cold. Anything else that had to change to have a
 * kind fails here.
 *
 * A 17th kind is kept in a save and in an Undo entry past the four bits a kind once had, and read
 * back as itself.
 *
 * Kinds of more than one tile are two more throwaways (`test/throwaways.ts`), each one module of the
 * rules and one of the page, with the recipes they make added to the content: built, fed on their
 * backs and sides and never their fronts, working, handing out of their ways out, standing as one
 * from any tile, and removed, moved, copied, blueprinted, undone, kept, checked and walked round.
 */
import { describe, expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { KIND_DEFS, KINDS } from "@sequoia-leaf/factory";

import {
  MAKERS,
  PAGE_BIG,
  PAGE_CHUTE,
  PAGE_FORGE,
  PAGE_SIFTER,
  PAGED_BIG,
  PLAY_BIG,
  PLAYED_BIG,
  RECIPE_LINES,
  RULES_CHUTE,
  RULES_FORGE,
  RULES_SIFTER,
} from "../../test/throwaways.ts";
import { PAGES } from "./index.ts";

const root = join(import.meta.dir, "..", "..", "..", "..");
const RULES_KINDS = join(root, "packages", "factory", "src", "kinds");

/** The throwaway kind's rules: one module, as any kind's. */
const RULES_SIEVE = `/** A throwaway kind for the test that a kind is one module: a sieve lets each item through after a second. */
import { handOut, keep, readyOut } from "./holder.ts";
import { kind } from "./kind.ts";
import type { Kit } from "./kit.ts";
import { aheadOf, anything, behindOnly } from "./line.ts";
import { as } from "./say.ts";
import type { Yard } from "../yard.ts";

/** Room for one thing, while it holds nothing and has nothing out. */
function room(k: Kit, y: Yard, i: number): boolean {
  const r = k.holderOf(y, i);
  return (y.holders.count[r] ?? 0) === 0 && y.holders.out[r] === k.NONE;
}

/** It works on what it holds for a second, and then holds it out to hand on. */
function work(k: Kit, y: Yard, _i: number, r: number, speed: number): void {
  const h = y.holders;
  if ((h.count[r] ?? 0) === 0) return;
  h.work[r] = (h.work[r] ?? 0) + speed;
  if ((h.work[r] ?? 0) < 20) return;
  h.work[r] = 0;
  for (let n = 0; n < k.ITEM_COUNT; n++)
    if (k.held(h, r, n) > 0) {
      k.take(h, r, n);
      h.out[r] = n;
      return;
    }
}

export const sieve = kind({
  name: "sieve",
  info: { name: "Sieve", cost: 5, draw: 1, gives: 0, what: "Lets each item through after a second." },
  graded: true,
  holds: true,
  work: 20,
  does: ["Sifts", "items"],
  rules: {
    sides: behindOnly,
    next: aheadOf,
    wants: anything,
    room,
    give: keep,
    work,
    hands: handOut,
    ready: readyOut,
    condition: (_k, _y, _i, lit) => (lit ? as("working") : as("unpowered", true)),
    words: (_k, _y, _i, state) => ({ line: state === "working" ? "Sifting." : "No power here." }),
    most: () => 1,
  },
});
`;

/** The throwaway kind on the page: one module, as any kind's, with a picture of its own. */
const PAGE_SIEVE = `/** A throwaway kind for the test that a kind is one module: a sieve, a mesh in a frame. */
import { CREAM, GOLD } from "@sequoia-leaf/kit/palette.ts";

import { bm } from "../art/pal.ts";
import type { KindPage } from "./kind.ts";

const MESH = ["nnnnnn", "nynyny", "nnnnnn", "nynyny", "nnnnnn"];

export const sieve: KindPage = {
  picture: () => bm(MESH, 3, 5).c,
  draw(art, _y, at) {
    at.stand(art.zed, at.cx, at.foot - 4, at.z, at.a);
    return at.foot - 8;
  },
  pointer: "bare",
  lamps: (_y, _i, x, foot, _at, out) => out.push({ x, y: foot - 4, r: 9, power: 0.4, reach: false }),
  map: [GOLD[1], CREAM],
  dot: GOLD[2],
  dock: 15,
  pace: () => ({ label: "Sifts", value: "60 /min" }),
  faces: true,
};
`;

/** The tracked files of the repository, the packages and the Works' page, copied to a new folder, with each workspace's links to the others as they are and the installed packages shared. */
function copy(): string {
  const to = mkdtempSync(join(tmpdir(), "works-kind-"));
  const listed = Bun.spawnSync(
    ["git", "ls-files", "packages", "apps/works", "package.json", "tsconfig.base.json", "bunfig.toml"],
    {
      cwd: root,
    },
  );
  for (const file of listed.stdout.toString().split("\n").filter(Boolean)) {
    mkdirSync(dirname(join(to, file)), { recursive: true });
    cpSync(join(root, file), join(to, file));
  }
  // Each workspace's own links, as they stand, point within the copy; the installed packages are shared.
  for (const at of ["apps/works", ...readdirSync(join(root, "packages")).map((p) => `packages/${p}`)])
    try {
      cpSync(join(root, at, "node_modules"), join(to, at, "node_modules"), { recursive: true, verbatimSymlinks: true });
    } catch {
      // A workspace with nothing installed has no links to copy.
    }
  symlinkSync(join(root, "node_modules"), join(to, "node_modules"));
  return to;
}

/** Adds one line to a file of the copy after the last line that matches. */
function addAfter(file: string, last: RegExp, line: string): void {
  const lines = readFileSync(file, "utf8").split("\n");
  const at = lines.findLastIndex((l) => last.test(l));
  lines.splice(at + 1, 0, line);
  writeFileSync(file, lines.join("\n"));
}

/** Runs Bun in the copy; what it printed, and whether it ended well. */
function bun(at: string, ...args: string[]): { ok: boolean; out: string } {
  const run = Bun.spawnSync([process.execPath, ...args], { cwd: at, stdout: "pipe", stderr: "pipe" });
  return { ok: run.exitCode === 0, out: `${run.stdout.toString()}${run.stderr.toString()}` };
}

/** What plays the sieve by the rules, in the copy. */
const PLAY = `import * as F from "./packages/factory/src/index.ts";
import { act } from "./packages/factory/src/commands.ts";
import { bareLand } from "./packages/factory/test/land.ts";

const k = F.kindNamed("sieve");
if (k === null || k !== F.KIND_COUNT - 1) throw new Error("the sieve is not the last kind");
const y = F.create({ land: bareLand(20, 9, [], [15, 4]), tier: 4, seed: 1 });
// As if a goal had unlocked it: no goal names a throwaway kind.
y.open.kinds[k] = 1;
const built = [F.CRATE, k, F.BELT, F.BELT, F.BELT].map((kind, n) => F.build(y, kind, 9 + n, 4, 0, Infinity).ok);
const crate = F.holderOf(y, F.at(y, 9, 4));
for (let n = 0; n < 10; n++) F.put(y.holders, crate, F.item("plank"));
const sieve = F.at(y, 10, 4);
let says = "";
for (let t = 0; t < 400; t++) {
  F.step(y);
  if (t === 50) says = F.status(y, sieve)?.line ?? "";
}
const made = F.counts();
const needed = F.counts();
F.flow(y, made, needed);
// Kept and read back, a 17th kind past the four bits a kind once had.
const read = F.decode(F.encode(y), y.land);
const kept = read !== null && read.kind[sieve] === k && F.check(read) === F.check(y);
// Undo keeps what a command took up, and stands it again.
F.build(y, k, 5, 7, 0, Infinity);
act(y, { do: "remove", x: 5, y: 7 }, Infinity, "a1");
act(y, { do: "undo", entry: "a1" }, Infinity, "a2");
const undoKept = y.kind[F.at(y, 5, 7)] === k;
console.log(
  JSON.stringify({
    built,
    through: y.depot[F.item("plank")],
    says,
    perMinute: F.makes(k, 1, null),
    rate: F.machineRate(y, sieve).nominal,
    draws: F.powerSummary(y).draws.some((d) => d.kind === k),
    taken: F.takes(y, sieve, F.at(y, 9, 4)),
    behindOnly: !F.takes(y, sieve, F.at(y, 10, 3)),
    over: F.refusal(y, k, 10, 4, Infinity, 1),
    refund: F.remove(y, 10, 4),
    kept,
    undoKept,
  }),
);
`;

/** What the page makes of the sieve, in the copy: the dock, its card's numbers, its map colour and its lamp. */
const PAGE = `import * as F from "./packages/factory/src/index.ts";
import { bareLand } from "./packages/factory/test/land.ts";
import { PAGES } from "./apps/works/src/kinds/index.ts";
import { lampsIn } from "./apps/works/src/lamps.ts";
import { blockColour } from "./apps/works/src/plan.ts";
import { DRAWN } from "./apps/works/src/state.ts";
import { paceOf } from "./apps/works/src/ui/cards.ts";

const k = F.kindNamed("sieve");
if (k === null) throw new Error("no sieve");
const y = F.create({ land: bareLand(20, 9, [], [15, 4]), tier: 4, seed: 1 });
y.open.kinds[k] = 1;
F.build(y, k, 10, 4, 0, Infinity);
const lamps = lampsIn(y, { x: 0, y: 0 }, { x: 0, y: 0, w: 320, h: 144 }, 1, () => true, () => false);
console.log(
  JSON.stringify({
    docked: DRAWN.at(-1) === k,
    pace: paceOf(k, 1)?.value,
    colour: blockColour(k) === PAGES.sieve.map?.[0],
    lamp: lamps.some((l) => l.x === 10 * 16 + 8 && l.r === 9),
  }),
);
`;

/** A second throwaway kind, which burns for power as a boiler does: a furnace, ten boilers' worth. */
const RULES_FURNACE = `/** A throwaway kind for the test that a second kind that burns for power is counted as its own. */
import { BURNER } from "./burner.ts";
import { kind } from "./kind.ts";

export const furnace = kind({
  name: "furnace",
  info: { name: "Furnace", cost: 50, draw: 0, gives: 300, what: "Burns deadfall for a great deal of power." },
  holds: true,
  burns: { fuel: "deadfall", ticks: 100, holds: 4 },
  rules: BURNER,
});
`;

/** The furnace on the page: as little as a kind may have. */
const PAGE_FURNACE = `/** A throwaway kind for the test that a second kind that burns for power is counted as its own. */
import { bm } from "../art/pal.ts";
import type { KindPage } from "./kind.ts";

export const furnace: KindPage = { picture: () => bm(["nn", "nn"], 2, 2).c, dock: 16 };
`;

/** A furnace burning beside a boiler gone cold, in the copy: the rules' power book, and the page's rows of it. */
const BURN = `import * as F from "./packages/factory/src/index.ts";
import { bareLand } from "./packages/factory/test/land.ts";
import { S } from "./apps/works/src/state.ts";
import { plural, powerPrint } from "./apps/works/src/ui/panels.ts";

const k = F.kindNamed("furnace");
if (k === null) throw new Error("no furnace");
const y = F.create({ land: bareLand(20, 9, [], [15, 4]), tier: 4, seed: 1 });
y.open.kinds[k] = 1;
for (const [kind, x] of [[k, 10], [F.BOILER, 12]]) if (!F.build(y, kind, x, 4, 0, Infinity).ok) throw new Error("not built");
F.put(y.holders, F.holderOf(y, F.at(y, 10, 4)), F.item("deadfall"));
F.step(y);
S.world = y;
const s = F.powerSummary(y);
const p = powerPrint();
console.log(
  JSON.stringify({
    burnt: s.supply - s.depot,
    gives: s.gives.map((g) => ({ ...g, kind: F.KINDS[g.kind] })),
    rows: p.gives.map((g) => [plural(F.KIND_INFO[g.kind]?.name ?? ""), g.about, g.n]),
  }),
);
`;

/**
 * Adds a kind to the copy at `at` as a kind is added: its module of the rules and its module of the
 * page, and its line in each list after the last. The lists' order is the kinds' numbers, kept by hand
 * and only ever added to, so a new kind's lines are two more than its modules.
 */
function addKind(at: string, name: string, rules: string, page: string): void {
  writeFileSync(join(at, `packages/factory/src/kinds/${name}.ts`), rules);
  writeFileSync(join(at, `apps/works/src/kinds/${name}.ts`), page);
  for (const list of ["packages/factory/src/kinds/list.ts", "apps/works/src/kinds/index.ts"]) {
    addAfter(join(at, list), /^import \{ \w+ \} from "\.\/\w+\.ts";$/, `import { ${name} } from "./${name}.ts";`);
    addAfter(join(at, list), /^ {2}\w+,$/, `  ${name},`);
  }
}

/**
 * Unlocks kinds from a new yard's start in the copy: no goal names a throwaway kind, and a yard read
 * back keeps only pieces it may build, as it would a real kind that a goal unlocks.
 */
function unlockAtStart(at: string, names: readonly string[]): void {
  const nodes = join(at, "packages/factory/src/content/nodes.ts");
  const start = `kinds: ["belt", "gatherer", "mill", "pylon"],`;
  const text = readFileSync(nodes, "utf8");
  expect(text).toContain(start);
  writeFileSync(
    nodes,
    text.replace(start, `kinds: ["belt", "gatherer", "mill", "pylon", ${names.map((n) => `"${n}"`).join(", ")}],`),
  );
}

/** The copy type-checks: the rules, their tests and the page. */
function checks(at: string): void {
  for (const project of ["packages/factory", "packages/factory/tsconfig.test.json", "apps/works"]) {
    const checked = bun(at, "check", "-p", project, "--no-pretty");
    expect([project, checked.ok ? "" : checked.out]).toEqual([project, ""]);
  }
}

describe("a new kind of piece", () => {
  test("is one module of the rules and one of the page, and a line in each list: nothing else changes", () => {
    const at = copy();
    try {
      addKind(at, "sieve", RULES_SIEVE, PAGE_SIEVE);
      unlockAtStart(at, ["sieve"]);
      checks(at);
      writeFileSync(join(at, "play.ts"), PLAY);
      const played = bun(at, "play.ts");
      expect(played.out).not.toContain("error");
      expect(JSON.parse(played.out.trim().split("\n").at(-1) ?? "{}")).toEqual({
        built: [true, true, true, true, true],
        through: 10,
        says: "Sifting.",
        perMinute: 60,
        rate: 60,
        draws: true,
        taken: true,
        behindOnly: true,
        over: null,
        refund: { ok: true, refund: 5 },
        kept: true,
        undoKept: true,
      });
      writeFileSync(join(at, "page.ts"), PAGE);
      const paged = bun(at, "page.ts");
      expect(JSON.parse(paged.out.trim().split("\n").at(-1) ?? "{}")).toEqual({
        docked: true,
        pace: "60 /min",
        colour: true,
        lamp: true,
      });
    } finally {
      rmSync(at, { recursive: true, force: true });
    }
  }, 60_000);

  test("that burns for power is its own row in the power book, at its own power, beside the boilers", () => {
    const at = copy();
    try {
      addKind(at, "furnace", RULES_FURNACE, PAGE_FURNACE);
      checks(at);
      writeFileSync(join(at, "burn.ts"), BURN);
      const burnt = bun(at, "burn.ts");
      expect(JSON.parse(burnt.out.trim().split("\n").at(-1) ?? "{}")).toEqual({
        burnt: 300,
        gives: [
          { kind: "boiler", burns: true, giving: 0, idle: 1, dark: 0, gives: 0 },
          { kind: "furnace", burns: true, giving: 1, idle: 0, dark: 0, gives: 300 },
        ],
        rows: [
          ["Boilers", "0 burning, 1 cold", 0],
          ["Furnaces", "1 burning", 300],
        ],
      });
    } finally {
      rmSync(at, { recursive: true, force: true });
    }
  }, 60_000);

  test("of more than one tile is one module of the rules and one of the page, and plays as one piece", () => {
    const at = copy();
    try {
      addKind(at, "sifter", RULES_SIFTER, PAGE_SIFTER);
      addKind(at, "forge", RULES_FORGE, PAGE_FORGE);
      addKind(at, "chute", RULES_CHUTE, PAGE_CHUTE);
      unlockAtStart(at, ["sifter", "forge", "chute"]);
      // What they make is content, as every maker's recipes are.
      const recipes = join(at, "packages/factory/src/content/recipes.ts");
      const text = readFileSync(recipes, "utf8").replace(`"mill" | "bench" | "workshop"`, MAKERS);
      writeFileSync(recipes, text);
      for (const line of RECIPE_LINES) addAfter(recipes, /^ {2}\{ out: /, line);
      checks(at);
      writeFileSync(join(at, "big.ts"), PLAY_BIG);
      const played = bun(at, "big.ts");
      expect(played.out).not.toContain("rror");
      expect(JSON.parse(played.out.trim().split("\n").at(-1) ?? "{}")).toEqual(PLAYED_BIG);
      writeFileSync(join(at, "page.ts"), PAGE_BIG);
      const paged = bun(at, "page.ts");
      expect(paged.out).not.toContain("rror");
      expect(JSON.parse(paged.out.trim().split("\n").at(-1) ?? "{}")).toEqual(PAGED_BIG);
    } finally {
      rmSync(at, { recursive: true, force: true });
    }
  }, 60_000);

  test("is listed once in each list: every kind's module of the rules and of the page, and only they", () => {
    // The rules: each module that says a kind (`kind({`) is in the list, once, in its order.
    const modules = readdirSync(RULES_KINDS).filter(
      (f) =>
        f.endsWith(".ts") && !f.endsWith(".test.ts") && readFileSync(join(RULES_KINDS, f), "utf8").includes("= kind({"),
    );
    expect(modules.map((f) => f.replace(".ts", "")).toSorted()).toEqual([...KINDS].toSorted());
    expect(new Set(KIND_DEFS.map((d) => d.name)).size).toBe(KIND_DEFS.length);
    // The page: a module of the same name for each, and it is the one listed.
    for (const name of KINDS) {
      const text = readFileSync(join(import.meta.dir, `${name}.ts`), "utf8");
      expect([name, text.includes(`export const ${name}: KindPage`)]).toEqual([name, true]);
      expect(typeof PAGES[name].picture).toBe("function");
    }
  });
});
