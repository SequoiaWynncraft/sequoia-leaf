/**
 * Which version a yard is kept as, and what a reader leaves as a newer Leaf's (`named.ts`). A yard
 * naming nothing past what the last Leaf of version 10 knew is kept as version 9, byte for byte as
 * before; one holding any tier 5 progress, anywhere in it, as this version, which that Leaf leaves as
 * a newer Leaf's. And on every version, a yard naming anything this Leaf does not know, or a tunnel
 * longer than its longest, is a newer Leaf's here: never read with that thing let go or paid back.
 */
import { describe, expect, test } from "bun:test";

import * as F from "../src/index.ts";
import { beforeReach } from "./goals.ts";
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

  test("one holding nothing past version 10 is kept as version 9: every staged yard and kept save without Long reach, a tunnel of 5 tiles", () => {
    const yards = [
      ...(["new", "small", "mid", "gate", "large"] as const).map((n) => staged(n)),
      ...SAVES.map(saved),
      generated().y,
    ].map(beforeReach);
    for (const y of yards) expect(record(F.encode(y)).v).toBe(F.PLACED);
    const y = beforeReach(bare());
    must(y, tunnel(2, 4, 5));
    expect(record(F.encode(y)).v).toBe(F.PLACED);
  });

  test("asked cheaply as it is kept, it says what the whole scan of the kept yard says: staged, kept, random play, tier 5", () => {
    expect(F.WIDER).toBe(false);
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
      expect([F.pastTen(y), record(text).v]).toEqual([!F.knownAt10(names), F.knownAt10(names) ? F.PLACED : F.VERSION]);
      if (F.pastTen(y)) later++;
    }
    expect(later).toBeGreaterThan(10);
  });

  test("the version 10 a kind past 15 was kept as still reads", () => {
    const text = JSON.stringify({ ...record(F.encode(staged("mid"))), v: 10 });
    expect(F.decode(text)).not.toBeNull();
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
