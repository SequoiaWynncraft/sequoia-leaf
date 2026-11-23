/**
 * Keeping a yard: `decode(encode(yard))` is the same yard with the same check; a record of the wrong
 * shape is refused whole; what could not have come about by playing is left out, as today's `load`
 * leaves it out; and the check tells two yards apart by one thing on one belt.
 */
import { describe, expect, test } from "bun:test";

import * as Y from "@sequoia-leaf/yard";

import * as F from "../src/index.ts";
import { Player } from "./random.ts";
import { fromText, pairOf, pictureF, pictureY, record, strings } from "./sides.ts";

const yardText = (name: string): Promise<string> =>
  Bun.file(new URL(`../../yard/src/yards/${name}.json`, import.meta.url)).text();
const kept = { kept: true } as const;

/** Reads a yard back from what it keeps, and says it is the same yard with the same check. */
function roundTrip(y: F.Yard): F.Yard {
  const back = F.decode(F.encode(y), y.land);
  if (!back) throw new Error("the yard did not read back");
  expect(pictureF(back, kept)).toEqual(pictureF(y, kept));
  expect(F.check(back)).toBe(F.check(y));
  expect(F.encode(back)).toBe(F.encode(y));
  return back;
}

describe("decode(encode(yard))", () => {
  test("is the same yard, with the same check: new, read, running, and after random play", async () => {
    roundTrip(F.create({ seed: 3 }));
    const names = ["small", "short", "mid", "large"];
    const texts = await Promise.all(names.map(yardText));
    for (const [n, name] of names.entries()) {
      const pair = pairOf(texts[n] ?? "");
      roundTrip(pair.flat);
      pair.run(3000, 1000);
      roundTrip(pair.flat);
      new Player(pair, 77).play(200, name);
      roundTrip(pair.flat);
    }
  }, 30_000);

  test("what today's text says, read one way into the flat yard, is the yard today's rules read", async () => {
    const names = ["small", "short", "mid", "large"];
    const texts = await Promise.all(names.map(yardText));
    for (const [n, name] of names.entries()) {
      const text = texts[n] ?? "";
      const w = Y.load(text);
      const y = fromText(text);
      if (!w || !y) throw new Error(`${name} does not read`);
      expect(pictureF(y, kept)).toEqual(pictureY(w, kept));
    }
  });

  test("the page's view leaves the seed out and keeps the letter; a visitor's leaves the blueprints out", async () => {
    const pair = pairOf(await yardText("large"));
    new Player(pair, 5).play(150, "view");
    const ctx = { now: pair.flat.at + 9e6, player: { id: "p", guest: false }, seed: 1, room: 0, awards: [] };
    const view = F.FACTORY.view(pair.flat, ctx);
    const page = F.decode(view.yard);
    expect(page?.seed).toBeNull();
    expect(view.clock).toBe(Y.WORKS.view(pair.yard, ctx).clock);
    const visit = F.decode(F.FACTORY.visit?.(pair.flat, ctx).yard);
    expect(visit?.blueprints.every((b) => b === null)).toBe(true);
  });
});

describe("decode refuses whole", () => {
  test("anything that is not a kept yard of this version", async () => {
    const good = F.encode(F.create({ seed: 1 }));
    const { rec } = record(good);
    const cells = String(rec.cells);
    for (const bad of [
      "",
      "not json",
      "[]",
      await yardText("small"),
      JSON.stringify({ ...rec, v: 3 }),
      JSON.stringify({ ...rec, cells: undefined }),
      JSON.stringify({ ...rec, cells: "!!!!" }),
      JSON.stringify({ ...rec, cells: F.toBase64(Uint8Array.from([0, 64 + 0, 3])) }),
      JSON.stringify({ ...rec, cells: F.toBase64(Uint8Array.from([0xff, 0xff, 0xff, 0x7f, 0])) }),
      JSON.stringify({ ...rec, tick: -1 }),
      JSON.stringify({ ...rec, story: 99 }),
      JSON.stringify({ ...rec, plots: "yard" }),
    ])
      expect(F.decode(bad)).toBeNull();
    expect(F.decode(JSON.stringify({ ...rec, cells }))).not.toBeNull();
  });
});

describe("what could not have come about by playing is left out", () => {
  test("as today's load leaves it out: pieces, holdings, plots, plans, orders", async () => {
    const { rec: raw, cells: had } = record(await yardText("mid"));
    const cells = [
      ...had,
      { i: 0, k: "gatherer", d: 0 },
      { i: 5, k: "wheel", d: 0 },
      { i: 1700, k: "belt", d: 9 },
      { i: 99_999, k: "belt", d: 0 },
      { i: 300, k: "rocket", d: 0 },
      { i: 1000, k: "depot", d: 0 },
    ].map((c) =>
      c.k === "mill"
        ? Object.assign({}, c, { b: { gear: 3, deadfall: 9, stone: 2 }, o: "tool", m: "kit", w: 999 })
        : c.k === "belt"
          ? Object.assign({}, c, { it: "plank", p: 0.375, h: 9 })
          : c,
    );
    const text = JSON.stringify({
      ...raw,
      cells,
      plots: [...strings(raw.plots), "pond", "moon"],
      plans: ["jigs", ...strings(raw.plans), "magic"],
      filled: { plank: 9999, crab: 3 },
      board: [
        ...(Array.isArray(raw.board) ? raw.board : []),
        { id: 1, title: "x", from: "y", line: "", want: { plank: 1, gear: 1, tool: 1 }, pay: 5, filled: {} },
      ],
    });
    const w = Y.load(text);
    const y = fromText(text);
    if (!w || !y) throw new Error("the yard does not read");
    expect(pictureF(y, kept)).toEqual(pictureY(w, kept));
    roundTrip(y);
  });
});

describe("the check", () => {
  test("tells apart two yards that differ by one thing on one belt, 40 times in 40", async () => {
    const pair = pairOf(await yardText("large"));
    pair.run(3000, 3000);
    const y = pair.flat;
    const sum = F.check(y);
    const belts = [...y.kind.keys()].filter((i) => y.kind[i] === F.BELT);
    let told = 0;
    for (let k = 0; k < 40; k++) {
      const copy = F.decode(F.encode(y));
      if (!copy) throw new Error("no copy");
      const i = belts[(k * 7919) % belts.length] ?? 0;
      copy.item[i] = copy.item[i] === F.NONE ? F.item("plank") : F.NONE;
      if (F.check(copy) !== sum) told++;
    }
    expect(told).toBe(40);
  });
});

describe("where reading today's text differs, for what play cannot make", () => {
  test("the tile a carried thing came from is kept only when it is a neighbour; today's load keeps any tile", async () => {
    const { rec: raw, cells } = record(await yardText("small"));
    const belt = cells.find((c) => c.k === "belt");
    if (!belt) throw new Error("no belt");
    const i = Number(belt.i);
    for (const [via, flat] of [
      [i - 1, i - 1],
      [i + 48, i + 48],
      [3, -1],
    ] as const) {
      const text = JSON.stringify({
        ...raw,
        cells: cells.map((c) => (c === belt ? Object.assign({}, c, { it: "plank", p: 0.5, v: via }) : c)),
      });
      const tile = pictureF(fromText(text) ?? F.create(), kept).tiles.find((t) => t.i === i);
      expect(tile?.via).toBe(flat);
    }
  });
});
