/**
 * Stored yards are read shape-first. A record of the wrong shape is refused whole; anything that
 * depends on today's tuning (what a piece may hold, how far a tunnel goes, which goals and plots open
 * when, what a grade costs) is clamped or carried, never a reason to refuse a yard, and nothing a
 * player has is lost: a piece that cannot stand today is paid back into the till.
 *
 * `saves/` holds yards as each version kept them (7, 6, and the first design's 3), written once and
 * never again: each must keep reading, with what it read then.
 */
import { describe, expect, test } from "bun:test";

import * as F from "../src/index.ts";
import { staged } from "./yards.ts";

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);
const record = (text: string): Rec => {
  const raw: unknown = JSON.parse(text);
  if (!isRec(raw)) throw new Error("not a record");
  return raw;
};

/** What a save read as when it was written: its pieces, goals done, plots, totals, till and blueprints. */
interface Read {
  pieces: number;
  done: string[];
  plots: string[];
  sold: number;
  paid: number;
  bank: number;
  till: number;
  blueprints: number;
}
const num = (v: unknown): number => (typeof v === "number" ? v : Number.NaN);
const names = (v: unknown): string[] => (Array.isArray(v) ? v.filter((n) => typeof n === "string") : []);
const SAVES = ["v7-small", "v7-mid", "v7-study", "v7-gate", "v6-mid", "v3-tier2"] as const;
async function save(name: string): Promise<{ text: string; read: Read }> {
  const raw: unknown = await Bun.file(`${import.meta.dir}/saves/${name}.json`).json();
  const r = isRec(raw) && isRec(raw.read) ? raw.read : null;
  if (!isRec(raw) || typeof raw.text !== "string" || !r) throw new Error(`${name} is not a save`);
  const read: Read = {
    pieces: num(r.pieces),
    done: names(r.done),
    plots: names(r.plots),
    sold: num(r.sold),
    paid: num(r.paid),
    bank: num(r.bank),
    till: num(r.till),
    blueprints: num(r.blueprints),
  };
  return { text: raw.text, read };
}
const pieces = (y: F.Yard): number => y.kind.filter((k) => k !== F.NONE && k !== F.DEPOT).length;
const ids = (y: F.Yard): (string | undefined)[] => y.done.map((g) => F.GOALS[g]?.id);

describe("a yard kept by any version", () => {
  for (const name of SAVES)
    test(`${name} reads, with all it read when it was kept, and reads the same again`, async () => {
      const { text, read } = await save(name);
      const y = F.decode(text);
      if (!y) throw new Error(`${name} does not read`);
      expect(pieces(y)).toBeGreaterThanOrEqual(read.pieces);
      expect(ids(y)).toEqual(expect.arrayContaining(read.done));
      expect(y.plots.map(F.plotName)).toEqual(expect.arrayContaining(read.plots));
      expect([y.sold, y.paid, y.bank]).toEqual([read.sold, read.paid, read.bank]);
      expect(y.till).toBeGreaterThanOrEqual(read.till);
      expect(y.blueprints.filter((b) => b !== null).length).toBeGreaterThanOrEqual(read.blueprints);
      const again = F.decode(F.encode(y));
      expect(again && F.encode(again)).toBe(F.encode(y));
    });
});

/** A whole number below 16,384 as the packed bytes write it, seven bits a byte. */
const varint = (v: number): number[] => (v < 128 ? [v] : [(v & 127) | 128, v >> 7]);
/** A kept yard with its pieces' bytes put in place of its own. */
const withCells = (good: string, bytes: readonly number[]): string =>
  JSON.stringify({ ...record(good), cells: F.toBase64(Uint8Array.from(bytes)) });
/** The tile of the yard's own ground nearest its depot where nothing stands and a kind (a crate) may: (x, y) and its number. */
function freeTile(y: F.Yard, kind: F.Kind = F.CRATE): { x: number; y: number; i: number } {
  const [cx, cy] = y.land.depot;
  for (let r = 2; r < 9; r++)
    for (let z = cy - r; z <= cy + r; z++)
      for (let x = cx - r; x <= cx + r; x++)
        if (F.refusal(y, kind, x, z, Infinity) === null) return { x, y: z, i: F.at(y, x, z) };
  throw new Error("no free tile");
}

describe("what depends on today's tuning", () => {
  test("a crate holding more than any piece holds today reads, holding what a crate holds", () => {
    const y = staged("mid");
    const t = freeTile(y);
    const crate = [1, ...varint(t.i), F.CRATE | 128, 2, 1, F.item("plank"), ...varint(F.CRATE_MOST + 40)];
    const back = F.decode(withCells(F.encode(y), crate));
    if (!back) throw new Error("the yard does not read");
    expect(back.kind[t.i]).toBe(F.CRATE);
    expect(F.held(back.holders, back.row[t.i] ?? -1, F.item("plank"))).toBe(back.open.crate);
  });

  test("a thing today's tables do not have, held, is let go and the rest kept", () => {
    const y = staged("mid");
    const t = freeTile(y);
    const crate = [1, ...varint(t.i), F.CRATE | 128, 2, 2, F.ITEM_COUNT, 3, F.item("plank"), 4];
    const back = F.decode(withCells(F.encode(y), crate));
    if (!back) throw new Error("the yard does not read");
    expect(F.held(back.holders, back.row[t.i] ?? -1, F.item("plank"))).toBe(4);
  });

  test("a tunnel longer than tunnels go today reads, and is paid back", () => {
    const y = staged("mid");
    const t = freeTile(y);
    const span = F.SPAN_MOST + 1;
    const tunnel = [1, ...varint(t.i), F.TUNNEL | 128, ...varint(128), span + 8, ...Array<number>(span * 2).fill(0)];
    const back = F.decode(withCells(F.encode(y), tunnel));
    if (!back) throw new Error("the yard does not read");
    expect(back.kind[t.i]).toBe(F.NONE);
    expect(back.till).toBe(y.till + F.price(F.TUNNEL, 1) * F.MILLI);
  });

  test("a piece that cannot stand where it is today is paid back, at today's price for its grade", () => {
    const y = staged("mid");
    // A gatherer on bare ground: it gathers only from what lies there.
    const t = freeTile(y);
    const gatherer = [1, ...varint(t.i), F.GATHERER];
    const back = F.decode(withCells(F.encode(y), gatherer));
    if (!back) throw new Error("the yard does not read");
    expect(back.kind[t.i]).toBe(F.NONE);
    expect(back.till).toBe(y.till + F.price(F.GATHERER, 1) * F.MILLI);
  });

  test("a piece at a grade the yard may not build today stands at the highest it may, and the difference is paid back", () => {
    const y = staged("mid");
    const t = freeTile(y, F.MILL);
    expect(F.highest(y.open, F.MILL)).toBe(1);
    const mill = [1, ...varint(t.i), F.MILL | 128, ...varint(8192), 3];
    const back = F.decode(withCells(F.encode(y), mill));
    if (!back) throw new Error("the yard does not read");
    expect([back.kind[t.i], back.grade[t.i]]).toEqual([F.MILL, 1]);
    expect(back.till).toBe(y.till + (F.price(F.MILL, 3) - F.price(F.MILL, 1)) * F.MILLI);
  });

  test("goals done, plots owned and orders on the board are carried, whatever opens them today; told past the goals there are reads", () => {
    const y = staged("mid");
    const rec = record(F.encode(y));
    const done = Array.isArray(rec.done) ? rec.done : [];
    // A goal of a later tier done, out of today's order; a plot today's tier does not sell; three things asked.
    const later = F.GOALS.find((g) => g.kind === "project" && g.tier === 4)?.id;
    if (later === undefined) throw new Error("no tier 4 project");
    const board = Array.isArray(rec.board) ? rec.board : [];
    const asked = {
      id: 1_000,
      title: "x",
      from: "y",
      line: "",
      want: { plank: 1, gear: 1, tool: 1 },
      pay: 5,
      filled: {},
      starts: 0,
    };
    const kept = JSON.stringify({
      ...rec,
      done: [...done, later],
      told: 9_999,
      plots: [...(Array.isArray(rec.plots) ? rec.plots : []), "pond"],
      board: [...board, asked],
      serial: 1_001,
    });
    const back = F.decode(kept);
    if (!back) throw new Error("the yard does not read");
    expect(ids(back)).toContain(later);
    expect(back.told).toBe(back.done.length);
    expect(back.plots).toContain(F.plot("pond"));
    expect(back.board.some((o) => o.id === 1_000)).toBe(true);
  });
});
