/**
 * The budgets, each held by a test that measures what it names: on a working yard of about 6,000
 * pieces on 112 by 84 tiles made by the scale study's generator, and on the most a yard can hold.
 * What is measured and not promised is printed beside them.
 */
import { describe, expect, test } from "bun:test";
import { rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

import * as F from "../src/index.ts";
import { loopIn, makes, reached } from "./calls.ts";
import { type Gen, generate } from "./gen.ts";
import { makeLand, widened } from "./land.ts";
import { delivering, staged } from "./yards.ts";

const land = makeLand(7, 7, 7);
let made: Gen | null = null;
/** The generated yard, made once, and the commands that made it. */
const gen = (): Gen => (made ??= generate(land, 6000));
const pieces = (y: F.Yard): number => y.kind.filter((k) => k !== F.NONE).length;
const kb = (bytes: number): string => `${(bytes / 1024).toFixed(1)} KB`;
/** The bytes text takes as the store keeps it. */
const utf8 = (s: string): number => Buffer.byteLength(s, "utf8");

/** Gives a yard's blueprints as many of its pieces as each holds, from boxes across the middle of the yard. */
function saveBlueprints(y: F.Yard): void {
  const { w, h } = F.BLUEPRINT;
  const most = y.open.pieces;
  for (let slot = 0; slot < y.blueprints.length; slot++)
    for (let shrink = 0; shrink < 12 && !y.blueprints[slot]; shrink++) {
      const x0 = 8 + slot * w;
      const y0 = 30;
      const tiles = F.within(y, x0, y0, x0 + w - 1 - shrink, y0 + h - 1 - shrink);
      if (tiles.length <= most) F.saveBlueprint(y, slot, tiles);
    }
}

let ran: F.Yard | null = null;
/** The generated yard after running 3,000 ticks, read back and with its blueprints full, as a yard in play is kept. */
function running(): F.Yard {
  if (ran) return ran;
  const y = F.decode(F.encode(gen().y), land);
  if (!y) throw new Error("the generated yard does not read back");
  for (let k = 0; k < 3000; k++) F.step(y);
  saveBlueprints(y);
  ran = y;
  return y;
}

/** The generated yard made again, by the same commands, on a land of another size with the generator's land at its top left. */
function remade(w: number, h: number): F.Yard {
  const y = F.create({ land: widened(land, w, h), tier: 4, seed: 1758855484 });
  for (const c of gen().commands) {
    const read = F.readCommand(c);
    if (read) F.play(y, read);
  }
  for (let k = 0; k < 3000; k++) F.step(y);
  return y;
}

/**
 * A copy of a yard that counts every number read out of its arrays: the tile arrays, side tables,
 * plumbing, land, tallies and orders. Its arrays are the yard's own, so a tick of it moves the yard.
 */
function counted(y: F.Yard): { readonly yard: F.Yard; readonly reads: () => number } {
  let n = 0;
  const handler: ProxyHandler<object> = {
    get(target, key) {
      const c = typeof key === "string" ? key.charCodeAt(0) : 0;
      if (c >= 48 && c <= 57) n++;
      const v: unknown = Reflect.get(target, key);
      return typeof v === "function" ? v.bind(target) : v;
    },
  };
  const wrapped = <T extends object>(o: T): T => {
    const c = { ...o };
    for (const [key, v] of Object.entries(c))
      if (ArrayBuffer.isView(v) || Array.isArray(v)) Reflect.set(c, key, new Proxy(v, handler));
    return c;
  };
  const yard = wrapped({
    ...y,
    holders: wrapped(y.holders),
    tunnels: wrapped(y.tunnels),
    land: wrapped(y.land),
    wire: y.wire && wrapped(y.wire),
    seen: wrapped(y.seen),
    board: y.board.map(wrapped),
  });
  return { yard, reads: () => n };
}

describe("the generated yard", () => {
  test("is about 6,000 pieces", () => {
    expect(pieces(gen().y)).toBeGreaterThan(5500);
  }, 60_000);
});

/** What a function makes, as the allocation guard names it: the function and the kind, without the text it was found in. */
const kindOf = (m: string): string => m.split(": ").slice(0, 2).join(": ");

describe("memory", () => {
  test("a yard of about 6,000 pieces holds under 400 KB: every array it reaches but its land", () => {
    const y = running();
    expect(F.bytesHeld(y)).toBeLessThan(400 * 1024);
    console.log(`held, at ${pieces(y)} pieces: ${kb(F.bytesHeld(y))}`);
    // The letter's tally of what came in while its owner was away is held too, when there is one.
    const held = F.bytesHeld(y);
    y.away = { seconds: 600, coins: 0, made: F.counts() };
    expect(F.bytesHeld(y)).toBe(held + F.ITEM_COUNT * 8);
    y.away = null;
  }, 60_000);

  test("at worst, a yard of nothing but crates, as many as the land holds, holds under 1 MB", () => {
    const y = F.create({ land, tier: 4, seed: 1 });
    let room = 0;
    for (let z = 0; z < land.h; z++)
      for (let x = 0; x < land.w; x++) {
        if (F.refusal(y, F.CRATE, x, z, Infinity) !== null) continue;
        room++;
        F.build(y, F.CRATE, x, z, 0, Infinity);
      }
    F.rewire(y);
    expect(y.kind.filter((k) => k === F.CRATE).length).toBe(room);
    expect(room).toBeGreaterThan(8000);
    expect(F.bytesHeld(y)).toBeLessThan(1024 * 1024);
    console.log(`held, ${room} crates: ${kb(F.bytesHeld(y))}`);
  }, 60_000);
});

describe("kept", () => {
  test("packed, under 40 KB; as the store keeps it, UTF-8 text with its pieces and blueprints in base64, under 56 KB", () => {
    const text = F.encode(running());
    const rec: unknown = JSON.parse(text);
    if (typeof rec !== "object" || rec === null || !("cells" in rec)) throw new Error("the kept yard is not a record");
    const cells = typeof rec.cells === "string" ? F.fromBase64(rec.cells) : null;
    const kept = "blueprints" in rec && Array.isArray(rec.blueprints) ? rec.blueprints : [];
    const prints = kept.map((b: unknown) => (typeof b === "string" ? F.fromBase64(b) : null));
    if (!cells) throw new Error("the kept yard has no pieces' bytes");
    expect(cells.length).toBeGreaterThan(10_000);
    expect(prints.filter((b) => b !== null && b.length >= F.PIECE_BYTES * 100).length).toBe(3);
    const rest = utf8(JSON.stringify({ ...rec, cells: "", blueprints: prints.map(() => "") }));
    const packed = rest + cells.length + prints.reduce((n, b) => n + (b?.length ?? 0), 0);
    expect(packed).toBeLessThan(40 * 1024);
    expect(utf8(text)).toBeLessThan(56 * 1024);
    console.log(`kept: packed ${kb(packed)}, as text ${kb(utf8(text))} (pieces ${kb(cells.length)})`);
  }, 60_000);
});

interface Window {
  /** What each collection in it says was allocated since the last, in KB: the first is the one that opens it. */
  readonly kb: readonly number[];
  readonly filled: number;
  readonly came: number;
}
/** Runs `alloc.ts` on a yard's text in a Bun of its own, and reads its windows off the collector's log. */
function windows(text: string, on: "generated" | "guild"): Map<string, Window> {
  const file = `${tmpdir()}/factory-alloc-${process.pid}-${on}.txt`;
  writeFileSync(file, text);
  const child = Bun.spawnSync([process.execPath, `${import.meta.dir}/alloc.ts`, file, on], {
    // The compiler on the main thread, so it compiles at the same ticks every run, never in a window by chance.
    env: { ...process.env, BUN_JSC_logGC: "1", BUN_JSC_useConcurrentJIT: "0" },
  });
  rmSync(file);
  const log = child.stderr.toString();
  if (child.exitCode !== 0) throw new Error(log.slice(-2000));
  return new Map(
    [...log.matchAll(/BEGIN (\w+)\n([\s\S]*?)END \1 (\d+) (\d+)/g)].map((m): [string, Window] => [
      m[1] ?? "",
      {
        kb: [...(m[2] ?? "").matchAll(/=> \w+Collection, ca=([\d.]+)kb/g)].map((c) => Number(c[1])),
        filled: Number(m[3]),
        came: Number(m[4]),
      },
    ]),
  );
}
/** What a window allocated after the collection that opened it. */
const since = (w: Window | undefined): string => kb((w?.kb.slice(1) ?? []).reduce((a, b) => a + b, 0) * 1024);

describe("allocation", () => {
  test("a tick of a yard whose plumbing is worked out, in which no order is filled, allocates nothing: in a thousand ticks no collection, young or full, but the two that open and close the window, and not a byte between them", () => {
    const generated = windows(F.encode(running()), "generated");
    const reference = windows(F.encode(delivering()), "guild");
    expect([...generated.keys()]).toEqual(["steady", "changed", "repowered"]);
    expect([...reference.keys()]).toEqual(["steady", "changed", "repowered", "filled"]);
    // The generated yard's lines end in crates; the delivering yard's at the depot, so its thousand
    // ticks take in things, and go through the orders, without filling one.
    expect(generated.get("steady")).toEqual({ kb: [expect.any(Number), 0], filled: 0, came: 0 });
    expect(reference.get("steady")).toEqual({ kb: [expect.any(Number), 0], filled: 0, came: expect.any(Number) });
    expect(reference.get("steady")?.came).toBeGreaterThan(0);
    expect(reference.get("filled")?.filled).toBe(1);
    console.log(
      `allocated: a thousand ticks ${since(generated.get("steady"))}, and ${since(reference.get("steady"))} taking in ${reference.get("steady")?.came} things; the first tick after a change ${since(generated.get("changed"))}, after power may have moved ${since(generated.get("repowered"))} (at ${pieces(running())} pieces); a tick that fills an order ${since(reference.get("filled"))}`,
    );
  }, 60_000);

  test("the check, which the page takes with every command, makes nothing for a tile or a piece: only what it makes once a call", () => {
    const check = reached("check.ts", "check", new Set());
    // Each tile's and piece's part of it, which runs for every piece, makes nothing at all.
    for (const f of [
      "check.ts:pieceWord",
      "check.ts:settingsWord",
      "pieces.ts:waysOn",
      "yard.ts:holderOf",
      "yard.ts:tunnelOf",
    ])
      expect(check.reached).toContain(f);
    // And the loop over the tiles, read on its own: nothing in it makes anything, for any tile.
    const tiles = loopIn("check.ts", "check", "kind.length");
    expect([tiles.includes("pieceWord"), makes(tiles)]).toEqual([true, []]);
    // What the rest makes, once a call: its hash's closures, its loops over the goals, the orders, the
    // blueprints and what Undo would undo. Anything more, a per-tile array among it, is new here.
    expect(check.makes.map(kindOf)).toEqual([
      "check.ts:check: an array",
      "check.ts:check: a closure",
      "check.ts:check: an iterator",
      "check.ts:check: a copy",
      "check.ts:bytes: an array",
      "check.ts:bytes: an iterator",
      "check.ts:mixKept: an iterator",
    ]);
    // How long it takes here, as a number to read: a shared machine's clock is no limit.
    const y = staged("large");
    const times: number[] = [];
    for (let k = 0; k < 2001; k++) {
      const t = Bun.nanoseconds();
      F.check(y);
      times.push((Bun.nanoseconds() - t) / 1e3);
    }
    console.log(`the check of ${pieces(y)} pieces: ${(times.toSorted((p, q) => p - q)[1000] ?? 0).toFixed(1)} µs`);
  });

  test("nothing the tick calls, in any file, makes an array, object, closure, string or iterator, but where the plumbing is worked out again or an order is filled", () => {
    const excused = new Set([
      // Worked out once after a change, by the first tick after it.
      "rewire",
      // A goal finished, and a standing order filled.
      "finish",
      "filledOrder",
    ]);
    const tick = reached("tick.ts", "step", excused);
    for (const f of ["orders.ts:deliver", "orders.ts:offer", "land.ts:toward", "yard.ts:put", "wire.ts:nextOf"])
      expect(tick.reached).toContain(f);
    // Each kind's step, which the tick finds by the kind's number: the guard reads them all.
    for (const f of [
      "kinds/line.ts:carryOn",
      "kinds/splitter.ts:hands",
      "kinds/sorter.ts:hands",
      "kinds/tunnel.ts:passUnder",
      "kinds/crate.ts:hands",
      "kinds/maker.ts:work",
      "kinds/gatherer.ts:work",
      "kinds/study.ts:work",
      "kinds/boiler.ts:burn",
      "kinds/maker.ts:room",
      "kinds/joiner.ts:room",
    ])
      expect(tick.reached).toContain(f);
    expect(tick.makes).toEqual([]);
    // And the guard sees what it looks for: with nothing excused, it finds the plumbing and the orders.
    const all = reached("tick.ts", "step", new Set());
    expect(all.makes.some((m) => m.startsWith("wire.ts:rewire: new"))).toBe(true);
    expect(all.makes.some((m) => m.startsWith("orders.ts:filledOrder: an object"))).toBe(true);
  });
});

describe("work in step with what stands", () => {
  test("a tick reads as many numbers for the same pieces on maps of two sizes", () => {
    // Both maps larger than the generator's, so every piece meets the same ground at every edge.
    const small = remade(land.w + 16, land.h + 12);
    const large = remade(land.w * 2, land.h * 2);
    expect(pieces(large)).toBe(pieces(small));
    expect(Array.from(large.depot)).toEqual(Array.from(small.depot));
    const a = counted(small);
    const b = counted(large);
    F.step(a.yard);
    F.step(b.yard);
    expect(a.reads()).toBe(b.reads());
    expect(a.reads()).toBeGreaterThan(pieces(small));
    // A bare yard reads next to nothing, on either map.
    const bare = (w: number, h: number): number => {
      const y = F.create({ land: widened(land, w, h), tier: 4 });
      F.rewire(y);
      const c = counted(y);
      F.step(c.yard);
      return c.reads();
    };
    expect(bare(land.w * 2, land.h * 2)).toBe(bare(land.w + 16, land.h + 12));
    console.log(
      `reads in a tick: ${a.reads()} for ${pieces(small)} pieces on ${small.land.w} by ${small.land.h} and on ${large.land.w} by ${large.land.h}; a bare yard ${bare(land.w, land.h)}`,
    );
  }, 60_000);
});

describe("time", () => {
  test("the median tick at about 6,000 pieces takes under 2 ms", () => {
    const y = running();
    const time = (before: () => void, n: number): number => {
      const times: number[] = [];
      for (let k = 0; k < n; k++) {
        before();
        const t = Bun.nanoseconds();
        F.step(y);
        times.push((Bun.nanoseconds() - t) / 1e6);
      }
      return times.toSorted((p, q) => p - q)[Math.floor(n / 2)] ?? Infinity;
    };
    const median = time(() => {}, 501);
    expect(median).toBeLessThan(2);
    const changed = time(() => F.changed(y), 21);
    const repowered = time(() => {
      y.powered = false;
      F.changed(y);
    }, 21);
    console.log(
      `the median tick ${median.toFixed(2)} ms; the first after a change ${changed.toFixed(2)} ms, after power may have moved ${repowered.toFixed(2)} ms`,
    );
  }, 60_000);
});
