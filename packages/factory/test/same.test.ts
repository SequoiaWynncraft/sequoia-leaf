/**
 * The heart of it: today's yard and the flat yard, side by side, are the same game. Every pair here
 * compares the two after every command it is given, done or refused, and every 100 ticks.
 */
import { describe, expect, test } from "bun:test";

import * as Y from "@sequoia-leaf/yard";
import { workingYard } from "@sequoia-leaf/yard/fixtures.ts";

import * as F from "../src/index.ts";
import { bareLand } from "./land.ts";
import { Player } from "./random.ts";
import { isRec, landOf, Pair, pairOf, Reach, record } from "./sides.ts";

const YARDS = ["small", "short", "mid", "large"] as const;
const yardText = (name: string): Promise<string> =>
  Bun.file(new URL(`../../yard/src/yards/${name}.json`, import.meta.url)).text();

/** The large yard with every order on its board filled, so handing over is done as well as refused. */
async function boardFilled(): Promise<string> {
  const { rec } = record(await yardText("large"));
  const board = Array.isArray(rec.board) ? rec.board.filter(isRec) : [];
  for (const o of board) o.filled = o.want;
  return JSON.stringify({ ...rec, board });
}

describe("a new yard", () => {
  test("is the same yard in both, and stays so", () => {
    const pair = new Pair(Y.create({ seed: 7 }), F.create({ seed: 7 }));
    pair.same("new");
    pair.run(1000);
  });
});

describe("the reference yards", () => {
  for (const name of YARDS)
    test(`${name} reads into both as the same yard and runs 20,000 ticks the same`, async () => {
      const pair = pairOf(await yardText(name));
      pair.same(`${name} read`);
      pair.run(20_000, 100, name);
      expect(pair.compared).toBeGreaterThanOrEqual(201);
      // Standing orders filled on the way are handed over, the rest swapped, and it runs on.
      for (let round = 0; round < 3; round++) {
        const board = pair.yard.board.map((o) => ({ id: o.id, filled: Y.isFilled(o.want, o.filled) }));
        for (const o of board) pair.do({ do: o.filled ? "handOver" : "swap", order: o.id }, `${name} board`);
        pair.do({ do: "collect" }, `${name} collect`);
        pair.run(7000, 100, name);
      }
    });
});

describe("the edges of the map", () => {
  test("nothing is handed across an edge to the other side of the map, in either", () => {
    // A splitter or a joiner on each tile of the edge in turn, facing each way, fed by a gatherer behind
    // it, with belts on every other tile all facing one way. The tile after a row's last is the first of
    // the row below: a piece on the edge must hand nothing to it.
    const w = 7;
    const h = 5;
    const all: [number, number][] = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) all.push([x, y]);
    const stone = all.map(([x, y]): [number, number, "stone"] => [x, y, "stone"]);
    const edge = all.filter(([x, y]) => x === 0 || y === 0 || x === w - 1 || y === h - 1);
    const DX = [1, 0, -1, 0];
    const DY = [0, 1, 0, -1];
    let handed = 0;
    for (const kind of ["splitter", "joiner"])
      for (const [ex, ey] of edge)
        for (const dir of [0, 1, 2, 3])
          for (const belts of [0, 1, 2, 3]) {
            const land = bareLand(w, h, stone, [3, 2]);
            const pair = new Pair(
              Y.create({ land, story: 20, seed: 9 }),
              F.create({ land: landOf(land), story: 20, seed: 9 }),
            );
            const where = `${kind} facing ${dir} at ${ex},${ey}, belts facing ${belts}`;
            pair.do({ do: "build", kind, x: ex, y: ey, dir }, where);
            const bx = ex - (DX[dir] ?? 0);
            const by = ey - (DY[dir] ?? 0);
            pair.do({ do: "build", kind: "gatherer", x: bx, y: by, dir }, where);
            for (const [x, y] of all) pair.do({ do: "build", kind: "belt", x, y, dir: belts }, where);
            pair.run(90, 3, where);
            handed += pair.yard.cells.filter((b) => b?.kind === "belt" && b.item !== null).length;
          }
    // The splitters did hand things on, to belts that really stand beside them.
    expect(handed).toBeGreaterThan(200);
  });
});

describe("random play", () => {
  const reach = new Reach();
  const starts: [string, () => Promise<Pair>][] = [
    ["a new yard", async () => new Pair(Y.create({ seed: 11 }), F.create({ seed: 11 }), { reach })],
    [
      "a yard twelve orders in",
      async () => new Pair(Y.create({ seed: 12, story: 12 }), F.create({ seed: 12, story: 12 }), { reach }),
    ],
    [
      "a yard with the story done",
      async () => new Pair(Y.create({ seed: 13, story: 20 }), F.create({ seed: 13, story: 20 }), { reach }),
    ],
    ["the mid yard", async () => pairOf(await yardText("mid"), Y.LAND, { reach })],
    ["the large yard", async () => pairOf(await yardText("large"), Y.LAND, { reach })],
    ["the large yard, its board filled", async () => pairOf(await boardFilled(), Y.LAND, { reach })],
    ["today's working yard", async () => pairOf(Y.save(workingYard(5)), Y.LAND, { reach })],
  ];
  for (const [name, start] of starts)
    for (const seed of [1, 2, 3])
      test(`${name}, seed ${seed}: the same refusals, the same Coins, the same yards`, async () => {
        const pair = await start();
        new Player(pair, seed * 7919 + name.length).play(800, `${name} seed ${seed}`);
        expect(pair.commands).toBe(800);
      });

  test("reached every kind of command, piece and plan, and Leaf's play service ahead of its lead and in the past", () => {
    const keys = [
      ...[...Object.keys(F.REFUSED), "collect"].map((c) => `command ${c}`),
      ...Y.KINDS.filter((k) => k !== "depot").map((k) => `piece ${k}`),
      ...Y.PLAN_IDS.map((p) => `plan ${p}`),
      "through Game.apply",
      "ahead of the server's lead",
      "in the yard's past",
    ];
    console.log(`what random play did, of each:\n${reach.table(keys)}`);
    expect(reach.missing(keys)).toEqual([]);
  });
});

describe("a shut crate filled to its limit by two feeders", () => {
  test("once opened, lets out first what it holds most of, the first in the tables' order of those it holds as many of", () => {
    // Stone and ore gathered into one crate from above and below; the crate hands on east to the depot.
    const land = bareLand(
      12,
      9,
      [
        [3, 2, "stone"],
        [3, 6, "ore"],
      ],
      [8, 4],
    );
    const pair = new Pair(Y.create({ land, story: 20, seed: 5 }), F.create({ land: landOf(land), story: 20, seed: 5 }));
    const pieces: [string, number, number, number][] = [
      ["gatherer", 3, 2, 0],
      ["belt", 4, 2, 1],
      ["crate", 4, 3, 0],
      ["gatherer", 3, 6, 0],
      ["belt", 4, 6, 3],
      ["belt", 4, 5, 3],
      ["belt", 4, 4, 3],
      ["belt", 5, 3, 0],
      ["belt", 6, 3, 0],
    ];
    for (const [kind, x, y, dir] of pieces) pair.do({ do: "build", kind, x, y, dir }, "crate");
    pair.do({ do: "crate", x: 4, y: 3, open: false }, "crate");
    const crate = (): Y.Building | null => pair.yard.cells[Y.at(pair.yard, 4, 3)] ?? null;
    for (let k = 0; k < 100 && (crate()?.count ?? 0) < pair.yard.rates.crate; k++) pair.run(10, 10, "filling");
    expect(crate()?.count).toBe(pair.yard.rates.crate);
    // Both feeders back up behind it.
    pair.run(60, 10, "full");
    const held = Y.ITEMS.filter((k) => (crate()?.buf[k] ?? 0) > 0);
    expect(held).toEqual(["stone", "ore"]);
    const most = Math.max(...held.map((k) => crate()?.buf[k] ?? 0));
    const first = held.find((k) => crate()?.buf[k] === most);
    if (!first) throw new Error("the crate holds nothing");
    pair.do({ do: "crate", x: 4, y: 3, open: true }, "opened");
    pair.run(1, 1, "opened");
    expect(pair.yard.cells[Y.at(pair.yard, 5, 3)]?.item ?? crate()?.out).toBe(first);
    pair.run(400, 10, "emptying");
  });
});

describe("a refused command changes nothing", () => {
  test("a refused move of a loaded tunnel and a pylon refused on an occupied tile, then a tick taken cold", async () => {
    const warm = pairOf(await yardText("large"));
    warm.run(3000, 1000);
    // Read back, so nothing is worked out in either.
    const pair = pairOf(Y.save(warm.yard));
    const w = pair.yard;
    const mouth = w.cells.findIndex((b) => b?.kind === "tunnel" && b.span > 0 && b.under.some((k) => k !== null));
    const b = w.cells[mouth];
    if (!b) throw new Error("no tunnel has anything under it");
    const far = Y.at(
      w,
      (mouth % w.land.w) + Y.DX[b.dir] * (b.span + 1),
      Math.floor(mouth / w.land.w) + Y.DY[b.dir] * (b.span + 1),
    );
    const [dx, dy] = w.land.depot;
    expect(pair.do({ do: "move", tiles: [mouth, far], turns: 1, x: dx - 1, y: dy - 1 })).toMatchObject({
      refused: "cannot_move",
    });
    const belt = w.cells.findIndex((c) => c?.kind === "belt");
    const at = { x: belt % w.land.w, y: Math.floor(belt / w.land.w) };
    expect(pair.do({ do: "build", kind: "pylon", dir: 0, ...at })).toMatchObject({ refused: "cannot_build" });
    expect([pair.yard.power, pair.yard.wire, pair.flat.powered, pair.flat.wire]).toEqual([null, null, false, null]);
    pair.run(1, 1, "cold");
    expect(pair.flat.wire).not.toBeNull();
  });
});
