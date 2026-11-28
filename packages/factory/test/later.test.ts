/**
 * Which version a yard is kept as, and what a reader leaves as a newer Leaf's (`named.ts`). A yard
 * naming nothing past what the last Leaf of version 10 knew is kept as version 9, byte for byte as
 * before; one holding any tier 5 progress, anywhere in it, as this version, which that Leaf leaves as
 * a newer Leaf's. And on every version, a yard naming anything this Leaf does not know, or a tunnel
 * longer than its longest, is a newer Leaf's here: never read with that thing let go or paid back.
 */
import { describe, expect, test } from "bun:test";

import { PARTS, unpackCells } from "../src/cells.ts";
import { ENTRY_FLAGS, MASK_BITS, SETTING_PARTS } from "../src/history.ts";
import * as F from "../src/index.ts";
import { KNOWN_AT_10 } from "../src/known10.ts";
import { beforeReach } from "./goals.ts";
import { bareLand } from "./land.ts";
import { near, xy } from "./near.ts";
import { Player } from "./player.ts";
import { bare, TIER5, tunnel } from "./tier5.ts";
import { generated, must, saved, SAVES, staged } from "./yards.ts";

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);
/** A kept yard's record. */
function record(text: string): Rec {
  const v: unknown = JSON.parse(text);
  if (!isRec(v)) throw new Error("not a record");
  return v;
}
/** The words in a kept list. */
const words = (v: unknown): string[] => (Array.isArray(v) ? v.filter((w) => typeof w === "string") : []);

describe("the version a yard is kept as", () => {
  for (const [name, make] of Object.entries(TIER5))
    test(`one with ${name}, and nothing else of tier 5, is kept as ${F.VERSION}, past the 10 the Leaf before reads, and is this Leaf's own`, () => {
      const y = make();
      const text = F.encode(y);
      expect([F.VERSION > 10, record(text).v]).toEqual([true, F.VERSION]);
      expect([F.keptLater(text, y.land), F.decode(text, y.land) !== null]).toEqual([false, true]);
    });

  test("each of those yards names nothing else past version 10: with its tier 5 part taken out, it is kept as version 9", () => {
    const AT_10 = new Set<string>(KNOWN_AT_10.goals);
    for (const [name, make] of Object.entries(TIER5)) {
      const y = make();
      const names = F.namesOf(record(F.encode(y)), y.land);
      const past = [...(names?.goals ?? [])].filter((id) => !AT_10.has(id) && F.GOALS[F.goal(id)]?.tier !== 5);
      expect([name, past]).toEqual([name, []]);
    }
    // A deep tunnel taken out of a plan, a blueprint and what Undo would stand again: nothing past 10 is left.
    for (const name of [
      "a 6-tile tunnel in a blueprint",
      "a 6-tile tunnel in a plan of the whole yard",
      "a 6-tile tunnel Undo would stand again",
    ]) {
      const y = TIER5[name]?.();
      if (!y) throw new Error(`no ${name}`);
      y.blueprints = y.blueprints.map(() => null);
      y.history = [];
      expect([name, record(F.encode(y)).v]).toEqual([name, F.PLACED]);
    }
  });

  test("one holding nothing past version 10 is kept as version 9: every staged yard and kept save without Long reach, a tunnel of 5 tiles", () => {
    const yards = [
      ...(["new", "small", "mid", "gate", "large"] as const).map((n) => staged(n)),
      ...SAVES.map(saved),
      generated().y,
    ].map(beforeReach);
    for (const y of yards) expect(record(F.encode(y)).v).toBe(F.PLACED);
    const y = bare();
    must(y, tunnel(2, 4, 5));
    expect(record(F.encode(y)).v).toBe(F.PLACED);
  });

  test("its version is what the whole scan of the kept yard says, and asked cheaply it says the same: staged, kept, random play, tier 5", () => {
    // The land's 40 plots are past what version 10 knew: while the tables have anything past it, the
    // whole scan decides (`WIDER`), and the cheap rule is asked only while they have nothing.
    expect(F.WIDER).toBe(true);
    const yards = [
      ...(["new", "small", "mid", "gate", "large"] as const).map((n) => staged(n)),
      ...SAVES.map(saved),
      generated().y,
      ...Object.values(TIER5).map((make) => make()),
    ];
    // Random play from a yard with tier 5's research done, and from one in tier 4: every 25 commands.
    for (const [seed, tier] of [
      [31, 6],
      [32, 5],
    ] as const) {
      const y = F.create({ seed, tier });
      const p = new Player(y, seed * 7919, new Map());
      for (let k = 0; k < 400; k++) {
        const c = F.readCommand({ ...p.command(), tick: y.tick });
        if (c) F.play(y, c);
        if (k % 25 === 24) yards.push(F.decode(F.encode(y), y.land) ?? y);
      }
    }
    let later = 0;
    for (const y of yards) {
      const text = F.encode(y);
      const names = F.namesOf(record(text), y.land);
      if (!names) throw new Error("the yard's pieces do not read");
      expect(record(text).v).toBe(F.knownAt10(names) ? F.PLACED : F.VERSION);
      if (!F.WIDER) expect(F.pastTen(y)).toBe(!F.knownAt10(names));
      if (!F.knownAt10(names)) later++;
    }
    expect(later).toBeGreaterThan(10);
  });

  test("the version 10 a kind past 15 was kept as still reads", () => {
    const text = JSON.stringify({ ...record(F.encode(staged("mid"))), v: 10 });
    expect(F.decode(text)).not.toBeNull();
  });
});

/** A whole number as packed bytes write it, seven bits a byte, the lowest first. */
const varint = (v: number): number[] => (v < 128 ? [v] : [(v % 128) | 128, ...varint(Math.floor(v / 128))]);

/** The bits below `width` that `known` does not have, and for a varint one far past them all. */
const unknownBits = (known: number, width: number): number[] => [
  ...Array.from({ length: width }, (_, b) => 2 ** b).filter((bit) => Math.floor(known / bit) % 2 === 0),
  ...(width > 8 ? [2 ** 40] : []),
];

/**
 * A yard with one entry in its history, a belt taken away ("r-1"), as kept: its record, and the
 * entry's bytes, with where its parts are. The entry's flags follow its id (its length, then a byte
 * each); last are what it did to the one piece (a count, then `UP`), and the piece it stands again (a
 * count, the tile, then its first byte: no parts follow).
 */
function oneEntry(): { kept: Rec; bytes: Uint8Array; mask: number } {
  const y = F.create({ seed: 1, tier: 4 });
  must(y, { do: "build", kind: "belt", ...near(0, -6), dir: 0 });
  y.history = [];
  must(y, { do: "remove", ...near(0, -6), id: "r-1" });
  const kept = record(F.encode(y));
  const bytes = F.fromBase64(words(kept.history)[0] ?? "");
  if (!bytes) throw new Error("no entry");
  const mask = bytes.length - 3 - varint(F.at(y, ...xy(0, -6))).length;
  expect([bytes[0], bytes[4], bytes[mask - 1], bytes[mask], (bytes.at(-1) ?? 0) & 128]).toEqual([3, 0, 1, 1, 0]);
  return { kept, bytes, mask };
}

describe("every bit a save keeps that this Leaf does not use", () => {
  test("is a newer Leaf's, in every mask and flag field: pieces and their parts, Undo entries, their pieces and their settings, blueprints", () => {
    const good = record(F.encode(F.create({ seed: 1 })));
    const { kept, bytes, mask } = oneEntry();
    const entry = (b: readonly number[]): string =>
      JSON.stringify({ ...kept, history: [F.toBase64(Uint8Array.from(b))] });
    const at = (i: number, v: readonly number[]): number[] => [...bytes.subarray(0, i), ...v, ...bytes.subarray(i + 1)];
    // Each field: the bits this Leaf keeps in it, how wide it is, and a save with one other bit set.
    // A field with every bit in use (a piece's first byte, a setting's first byte, a blueprint piece's
    // flags) has none to set; the clearing keeps no field of bits, only names, which a name no Leaf
    // knows already makes a newer Leaf's (`clearing.test.ts`).
    const fields: readonly (readonly [string, number, number, (bit: number) => string])[] = [
      [
        "a piece's parts",
        PARTS,
        31,
        (bit) =>
          JSON.stringify({ ...good, cells: F.toBase64(Uint8Array.from([1, 5, F.BELT | 128, ...varint(bit), 7, 7])) }),
      ],
      ["an Undo entry's flags", ENTRY_FLAGS, 8, (bit) => entry(at(4, [bit]))],
      ["what an Undo entry did to a piece", MASK_BITS, 31, (bit) => entry(at(mask, varint(bit)))],
      [
        "the parts of a piece an Undo entry stands again",
        SETTING_PARTS,
        8,
        (bit) => entry([...at(bytes.length - 1, [(bytes.at(-1) ?? 0) | 128]), bit]),
      ],
      ["a piece's first byte, a setting's, a blueprint piece's flags", 0xff, 8, () => ""],
    ];
    expect([F.keptLater(entry([...bytes])), F.decode(entry([...bytes])) === null]).toEqual([false, false]);
    for (const [name, known, width, save] of fields)
      for (const bit of unknownBits(known, width)) {
        const text = save(bit);
        expect([name, bit, F.keptLater(text), F.decode(text)]).toEqual([name, bit, true, null]);
      }
  });
});

describe("a grower's place in its runs", () => {
  test("is kept, with what it grew, in parts every reader since tier 5 knows (`MIX`, `MORE`): no field of bits above grows", () => {
    const y = F.create({ land: bareLand(20, 12, [], [16, 6]), tier: 8, seed: 1 });
    must(y, { do: "build", kind: "grower", x: 4, y: 4, dir: 0 });
    const r = F.holderOf(y, F.at(y, 4, 4));
    y.holders.mix[r] = 1;
    y.holders.out[r] = F.item("crystal");
    y.holders.more[r] = 1;
    const text = F.encode(y);
    const cells = unpackCells(F.fromBase64(String(record(text).cells)) ?? new Uint8Array(), y.land.w * y.land.h);
    const kept = Array.isArray(cells) ? cells.find((p) => p.kind === F.kind("grower")) : undefined;
    expect([kept?.mix, kept?.more, kept?.out, PARTS]).toEqual([1, 1, F.item("crystal"), 0x7fffe]);
    const back = F.decode(text, y.land);
    const r2 = back ? F.holderOf(back, F.at(back, 4, 4)) : -1;
    expect([back?.holders.mix[r2], back?.holders.more[r2], back && F.check(back)]).toEqual([1, 1, F.check(y)]);
  });
});

describe("a yard naming what this Leaf does not know is a newer Leaf's", () => {
  const rec = record(F.encode(staged("mid")));
  const later = (part: Rec): boolean => {
    const text = JSON.stringify({ ...rec, ...part });
    return F.decode(text) === null && F.keptLater(text);
  };

  test("research, a node, a thing counted, a thing given to a goal, a thing an order wants, a plot: on version 9 as on this one", () => {
    const done = words(rec.done);
    for (const v of [F.PLACED, F.VERSION]) {
      expect(later({ v })).toBe(false);
      expect(later({ v, done: [...done, "nothing"] })).toBe(true);
      expect(later({ v, line: ["nothing"] })).toBe(true);
      expect(later({ v, queue: ["nothing"] })).toBe(true);
      expect(later({ v, hand: "nothing" })).toBe(true);
      expect(later({ v, got: { nothing: {} } })).toBe(true);
      expect(later({ v, depot: { nothing: 3 } })).toBe(true);
      expect(later({ v, seen: { tick: 0, till: 0, depot: { nothing: 1 } } })).toBe(true);
      expect(later({ v, plots: [...words(rec.plots), "nothing"] })).toBe(true);
      const order: unknown = Array.isArray(rec.board) ? rec.board[0] : null;
      if (!isRec(order) || !isRec(order.want)) throw new Error("no order on the board");
      expect(later({ v, board: [{ ...order, want: { ...order.want, nothing: 1 } }] })).toBe(true);
    }
  });

  test("a tunnel longer than this Leaf's longest, in a blueprint or a plan of the whole yard", () => {
    const y = F.create({ seed: 1, tier: 6 });
    const plan = record(F.encode(y));
    // A blueprint of one tunnel passing under one tile more than any may: its kind, x, y, way (4: a span follows), span.
    const print = F.toBase64(Uint8Array.from([F.TUNNEL, 0, 0, 4, F.SPAN_MOST + 1]));
    expect(later({ ...plan, blueprints: [print] })).toBe(true);
    expect(later({ ...plan, blueprints: [{ whole: print }] })).toBe(true);
    const fits = F.toBase64(Uint8Array.from([F.TUNNEL, 0, 0, 4, F.SPAN_MOST]));
    expect(later({ ...plan, blueprints: [fits] })).toBe(false);
  });

  test("Undo's record of a tunnel longer than this Leaf's longest: never stood again into another tunnel's row", () => {
    const y = bare(["deepculvert"]);
    must(y, tunnel(2, 4, 12));
    y.history = [];
    must(y, { do: "remove", x: 2, y: 4, id: "r-1" });
    const kept = record(F.encode(y));
    const [entry] = words(kept.history);
    const bytes = F.fromBase64(entry ?? "");
    if (!bytes) throw new Error("no entry");
    // Its far mouth's span (-12) is the one byte 252 in it; one tile longer is 251.
    const far = bytes.indexOf(F.spanByte(-12));
    expect([far >= 0, bytes.indexOf(F.spanByte(-12), far + 1)]).toEqual([true, -1]);
    const longer = Uint8Array.from(bytes);
    longer[far] = F.spanByte(-(F.SPAN_MOST + 1));
    const text = JSON.stringify({ ...kept, history: [F.toBase64(longer)] });
    expect([F.decode(text, y.land), F.keptLater(text, y.land)]).toEqual([null, true]);
    // As kept, it reads and undoes.
    const back = F.decode(F.encode(y), y.land);
    if (!back) throw new Error("the yard does not read back");
    must(back, { do: "undo", entry: "r-1" });
    expect([back.span[F.at(back, 2, 4)], back.span[F.at(back, 15, 4)]]).toEqual([12, -12]);
  });
});

describe("the yard's 15 launch numbers", () => {
  /** A yard that has launched: twice of any kind, with a level of a track and launches spent, kept. */
  function launched(): { y: F.Yard; rec: Rec } {
    const y = F.create({ seed: 1, tier: 9 });
    y.launches.ever[0] = 2;
    y.launches.spent[0] = 1;
    y.launches.levels[4] = 1;
    return { y, rec: record(F.encode(y)) };
  }

  test("are kept by name, only those above 0, and read back as they were, with the same check; a yard with none keeps none", () => {
    const { y, rec } = launched();
    expect(rec.launches).toEqual({ ever: { any: 2 }, spent: { any: 1 }, levels: { roots: 1 } });
    const back = F.decode(JSON.stringify(rec), y.land);
    expect([back && [...back.launches.ever], back && F.check(back), rec.v]).toEqual([
      [2, 0, 0, 0, 0],
      F.check(y),
      F.LAUNCHED,
    ]);
    expect("launches" in record(F.encode(F.create({ seed: 1, tier: 9 })))).toBe(false);
  });

  test("a kind of launch, a track or a part this Leaf does not know, in any of the three, is a newer Leaf's, never read with it let go", () => {
    const { rec } = launched();
    const launches = isRec(rec.launches) ? rec.launches : {};
    for (const part of ["ever", "spent", "levels"]) {
      const had = isRec(launches[part]) ? launches[part] : {};
      const text = JSON.stringify({ ...rec, launches: { ...launches, [part]: { ...had, orbit: 1 } } });
      expect([part, F.keptLater(text), F.decode(text)]).toEqual([part, true, null]);
    }
    for (const odd of [{ ...launches, kept: { any: 1 } }, "many", [1]]) {
      const text = JSON.stringify({ ...rec, launches: odd });
      expect([F.keptLater(text), F.decode(text)]).toEqual([true, null]);
    }
    // Known names, as kept: this Leaf's own.
    expect([F.keptLater(JSON.stringify(rec)), F.decode(JSON.stringify(rec)) !== null]).toEqual([false, true]);
  });

  test("a yard keeping any is kept as version 12, past what the Leaf of version 11 keeps, and past version 10 by both rules", () => {
    const y = beforeReach(staged("mid"));
    const rec = record(F.encode(y));
    const names = (r: Rec): boolean | null => {
      const n = F.namesOf(r, y.land);
      return n && F.knownAt10(n);
    };
    expect([names(rec), F.pastTen(y), rec.v]).toEqual([true, false, F.PLACED]);
    y.launches.ever[0] = 1;
    expect([names({ ...rec, launches: { ever: { any: 1 } } }), F.pastTen(y), record(F.encode(y)).v]).toEqual([
      false,
      true,
      F.LAUNCHED,
    ]);
  });
});
