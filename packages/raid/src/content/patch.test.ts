/**
 * Numbers by era: a release is a patch, and the catalogue of an era is the base and every patch open
 * by then, folded in order. What release 1 brought and changed is its patch; a patch that changes a
 * trait's steps on a date changes a run's count from that moment, and not a millisecond before; a
 * patch that brings a thing twice, or changes what nothing brought, is refused; and no table of
 * content is read but through a catalogue.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { type Ctx, isRefused } from "@sequoia-leaf/core";

import { RAID, type Table } from "../game.ts";
import { traitStates } from "../party.ts";
import { pieces } from "../run.ts";
import { BOON_IDS } from "./boons.ts";
import { type Catalog, catalogAt, catalogsOf } from "./catalog.ts";
import { figureIn, traitsOf } from "./figures.ts";
import { COMPONENT_IDS, EMBLEM_IDS, FINISHED_IDS, ITEM_IDS } from "./items.ts";
import type { Patch } from "./patch.ts";
import { type Era, eraAt, eraOf, RELEASES } from "./releases.ts";
import { BASE } from "./releases/base.ts";
import { GROOT } from "./releases/groot.ts";
import { TRAIT_IDS, traitIn } from "./traits.ts";

describe("release 1 is a patch on the base", () => {
  test("the base has the raid as it was before it, with the names it has now", () => {
    const base = catalogAt(eraOf("base"));
    expect(base.figures.seqwawa).toBeUndefined();
    expect([base.traits.graid, base.traits.rooted]).toEqual([undefined, undefined]);
    expect([figureIn(base, "greg").kin, figureIn(base, "whitefox").calling, figureIn(base, "whitefox").extra]).toEqual([
      "moss",
      "fang",
      ["sage"],
    ]);
    expect((["moth", "worm", "rock"] as const).map((id) => figureIn(base, id).extra)).toEqual([[], [], []]);
    expect([traitIn(base, "moss").steps, traitIn(base, "mender").steps]).toEqual([
      [2, 4],
      [2, 4],
    ]);
    expect([figureIn(base, "emberkit").name, figureIn(base, "crab40").ability?.name]).toEqual(["Flint", "In The Way"]);
  });

  test("the groot release brings Seqwawa, Graid and Rooted, makes five figures Graid, and Moss and Mender 2/3/4", () => {
    const groot = catalogAt(eraOf("groot"));
    expect(figureIn(groot, "seqwawa")).toMatchObject({ since: "groot", prize: "Treant", access: "shared", tier: 5 });
    expect([traitIn(groot, "graid").steps, traitIn(groot, "rooted").steps]).toEqual([[2, 3, 5], [1]]);
    expect(
      (["worm", "moth", "rock", "greg", "whitefox"] as const).filter((id) => traitsOf(groot, id).includes("graid")),
    ).toEqual(["worm", "moth", "rock", "greg", "whitefox"]);
    expect(traitsOf(groot, "whitefox")).toEqual(["mist", "sage", "graid"]);
    expect([traitIn(groot, "moss").steps, traitIn(groot, "mender").n.over]).toEqual([
      [2, 3, 4],
      [0, 0, 15],
    ]);
    // What it changed is changed field by field: the rest of Greg is the base's.
    expect(figureIn(groot, "greg")).toEqual({ ...figureIn(catalogAt(eraOf("base")), "greg"), kin: "graid" });
  });
});

// ---------- a trait's steps changed on a date ----------

/** A made-up patch on Penguin Month's day, which has none of its own yet: one Moss figure is enough for the first step. */
const LUSH: Patch = { release: "penguin-month", traits: { change: { moss: { steps: [1, 3, 4] } } } };
const PATCHED = catalogsOf([BASE, GROOT, LUSH]);
const patchedOf = (held: { readonly era: Era }): Catalog => {
  const cat = PATCHED[held.era - 1];
  if (!cat) throw new Error(`no era ${held.era}`);
  return cat;
};
const ctxAt = (now: number): Ctx => ({
  now,
  player: { id: "10000000-0000-0000-0000-00000000ca7c", guest: false },
  seed: 5,
  room: 1e9,
  awards: [],
  postcards: {},
});
function done(table: Table, c: unknown, now: number): Table {
  const read = RAID.command(c);
  if (!read) throw new Error(`no command ${JSON.stringify(c)}`);
  const answer = RAID.apply(table, read, ctxAt(now));
  if (isRefused(answer)) throw new Error(`refused ${JSON.stringify(c)}: ${answer.refused}`);
  return answer.state;
}

describe("a patch that changes a trait's steps at a made-up release", () => {
  const moment = RELEASES.find((r) => r.id === "penguin-month")?.at ?? 0;

  test("changes a run's count at that moment and not before", () => {
    let table = RAID.create(ctxAt(moment - 1));
    for (const c of [
      { do: "start", trail: 0 },
      { do: "choose", option: 0 },
    ])
      table = done(table, c, moment - 1);
    const run = table.held.main;
    if (!run) throw new Error("no run");
    // Velvet, a Moss Mender, fielded alone where the starter stood.
    const seat = run.board.findIndex((p) => p !== null);
    const starter = run.board[seat];
    if (!starter) throw new Error("no starter");
    run.board[seat] = { ...starter, kind: "mossmote" };
    const moss = (r: typeof run): number =>
      traitStates(patchedOf(r), pieces({ board: r.board, bench: [] })).find((t) => t.trait === "moss")?.step ?? 0;

    // A millisecond before: the run is in the era before the patch, and one Moss figure switches nothing on.
    expect([run.era, moss(run)]).toEqual([eraAt(moment - 1), 0]);
    // At the moment it moves, it is in the patch's era, and the same board has Moss on.
    const free = run.board.findIndex((p, i) => p === null && i !== seat);
    const moved = done(table, { do: "move", from: { on: "board", at: seat }, to: { on: "board", at: free } }, moment)
      .held.main;
    if (!moved) throw new Error("no run");
    expect([moved.era, moss(moved)]).toEqual([eraAt(moment), 1]);
    // The patch was the test's own: the catalogue of that era has Moss at 2/3/4, as release 1 left it.
    expect(traitIn(catalogAt(eraAt(moment)), "moss").steps).toEqual([2, 3, 4]);
    expect(traitIn(patchedOf({ era: eraAt(moment - 1) }), "moss").steps).toEqual([2, 3, 4]);
  });
});

// ---------- what the fold refuses ----------

describe("the fold", () => {
  test("refuses a patch that brings what is out already, changes what nothing brought, or doubles a release", () => {
    const greg = BASE.figures?.add?.greg;
    if (!greg) throw new Error("no Greg in the base");
    expect(() => catalogsOf([BASE, { release: "groot", figures: { add: { greg } } }])).toThrow("greg is brought twice");
    expect(() => catalogsOf([BASE, { release: "groot-night", traits: { change: { graid: { steps: [1] } } } }])).toThrow(
      "graid is changed before anything brings it",
    );
    expect(() => catalogsOf([BASE, GROOT, { ...GROOT }])).toThrow("groot has 2 patches");
  });

  test("gives every era a whole catalogue: every step said and numbered, every recipe and emblem open, every figure's traits open", () => {
    const eras = RELEASES.map(({ id }) => catalogAt(eraOf(id)));
    for (const cat of eras) {
      for (const id of TRAIT_IDS) {
        const t = cat.traits[id];
        if (!t) continue;
        expect([t.text.length, t.short.length, ...Object.values(t.n).map((n) => n.length)]).toEqual(
          Array.from({ length: 2 + Object.keys(t.n).length }, () => t.steps.length),
        );
      }
      for (const id of ITEM_IDS) {
        for (const half of cat.items[id]?.made ?? []) expect(cat.items[half]).toBeDefined();
        const grants = cat.items[id]?.grants;
        if (grants) expect(cat.traits[grants]).toBeDefined();
      }
      for (const id of BOON_IDS) {
        const gives = cat.boons[id]?.gives;
        if (gives) expect(cat.items[gives]).toBeDefined();
      }
      for (const id of cat.order) for (const t of traitsOf(cat, id)) expect(cat.traits[t]).toBeDefined();
      // Items and boons are the base's, from Groot Night its four emblems and their charms, from Penguin Month the
      // Knife, its five emblems, and the Guild Onesie and its charm, and from Up The Tree A Good Branch and its
      // charm; a release that brings one adds it here.
      const night = cat.era >= eraOf("groot-night") ? 4 : 0;
      const penguin = cat.era >= eraOf("penguin-month") ? 1 : 0;
      const tree = cat.era >= eraOf("up-the-tree") ? 1 : 0;
      const counts: number[] = [
        5 + penguin,
        FINISHED_IDS.length,
        7 + night + 6 * penguin + tree,
        20 + night + penguin + tree,
      ];
      const { components, finished, emblems, boons } = cat.ids;
      expect([components, finished, emblems, boons].map((kind) => kind.length)).toEqual(counts);
      expect([COMPONENT_IDS.length, EMBLEM_IDS.length, BOON_IDS.length]).toEqual([6, 18, 26]);
    }
  });
});

// ---------- nothing reads a table of content ----------

/** The repository's own TypeScript files, from its root, skipping what is installed. */
function sources(dir: string, from: string): string[] {
  return readdirSync(join(from, dir)).flatMap((name) => {
    if (name === "node_modules" || name.startsWith(".")) return [];
    const path = join(dir, name);
    if (statSync(join(from, path)).isDirectory()) return sources(path, from);
    return name.endsWith(".ts") ? [path] : [];
  });
}

test("the base's tables are read by its patch alone, the patches by the catalogue alone, and the old tables are gone", () => {
  const root = join(import.meta.dir, "../../../..");
  const content = join("packages", "raid", "src", "content");
  const files = ["apps", "packages"]
    .flatMap((dir) => sources(dir, root))
    .filter((path) => path !== join(content, "patch.test.ts"));
  const text = (path: string): string => readFileSync(join(root, path), "utf8");
  // Each base table is named where it is written and by the base's patch, and nowhere else.
  const homes: Readonly<Record<string, string>> = {
    BASE_FIGURES: "figures.ts",
    BASE_TRAITS: "traits.ts",
    BASE_ITEMS: "items.ts",
    BASE_BOONS: "boons.ts",
  };
  const strays = Object.entries(homes).flatMap(([name, home]) =>
    files
      .filter((path) => path !== join(content, home) && path !== join(content, "releases", "base.ts"))
      .filter((path) => new RegExp(`\\b${name}\\b`).test(text(path)))
      .map((path) => `${name} in ${path}`),
  );
  expect(strays).toEqual([]);
  // A release's patch is read by the catalogue alone (and by tests that fold made-up spreads of them).
  const read = files.filter(
    (path) => !path.endsWith(".test.ts") && /from "[^"]*releases\/[\w-]+\.ts"/.test(text(path)),
  );
  expect(read).toEqual([join(content, "catalog.ts")]);
  // Nothing in the raid exports the old tables.
  const exported = files
    .filter((path) => path.startsWith(join("packages", "raid")))
    .filter((path) => /export const (FIGURES|TRAITS|ITEMS|BOONS|COMPONENTS|FINISHED|EMBLEMS)\b/.test(text(path)));
  expect(exported).toEqual([]);
});
