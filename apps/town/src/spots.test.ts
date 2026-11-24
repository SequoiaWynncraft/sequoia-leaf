import { describe, expect, test } from "bun:test";

import { seedOf } from "@sequoia-leaf/town/clock.ts";
import { TOWN } from "@sequoia-leaf/town/map/map.ts";
import type { Stand } from "@sequoia-leaf/town/map/rows.ts";

import {
  atWork,
  choose,
  clearOf,
  footprint,
  further,
  keepClear,
  LAID,
  makeSpots,
  meet,
  poseAt,
  sits,
  type Thing,
  WORK_MS,
} from "./spots.ts";

/** Noon, by Leaf's clock. */
const T0 = Date.UTC(2026, 10, 25, 12);
const PLACES: readonly Stand[] = ["works", "table", "grove"];
const id = (n: number): string => `7e570000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ids = (n: number, from = 0): string[] => Array.from({ length: n }, (_, k) => id(from + k));
const open = (p: { x: number; y: number }): boolean => !TOWN.footBlocked(p.x, p.y);

describe("who has which spot", () => {
  test("a member's spot is the one their account wants among those laid by hand, whatever order the others come in", () => {
    for (const someone of ids(40)) {
      const laid = LAID.works.length;
      expect(choose(12, laid, [someone], new Map()).get(someone)).toBe(seedOf(someone) % laid);
    }
    const crowd = ids(9);
    const once = choose(12, 5, crowd, new Map());
    expect(choose(12, 5, crowd.toReversed(), new Map())).toEqual(once);
  });

  test("a member keeps their spot for as long as they stay, while others come and go", () => {
    const spots = makeSpots(() => Array.from({ length: 12 }, (_, k) => ({ x: k * 20, y: 0, dir: 0 as const })));
    const [a = "", b = "", c = "", d = ""] = ids(4);
    const first = spots.place("works", [a]).get(a)?.n;
    for (const there of [[a, b], [a, b, c], [c, a], [d, a, c, b], [a]])
      expect(spots.place("works", there).get(a)?.n).toBe(first);
    // Whoever stays keeps theirs whoever else is there.
    const many = spots.place("works", [a, b, c, d]);
    expect(spots.place("works", [d, b]).get(b)).toEqual(many.get(b));
  });

  test("no two members share a spot while one is free; past the spots laid by hand they take those further out, first first", () => {
    for (let n = 1; n <= 20; n++) {
      const got = choose(14, 5, ids(n), new Map());
      const taken = [...got.values()];
      expect(new Set(taken).size).toBe(taken.length);
      expect(got.size).toBe(Math.min(n, 14));
      // Those laid by hand go first, and further ones in order.
      const out = taken.filter((k) => k >= 5).toSorted((x, y) => x - y);
      expect(out).toEqual(Array.from({ length: out.length }, (_, k) => 5 + k));
      if (n <= 5) expect(taken.every((k) => k < 5)).toBe(true);
    }
  });

  test("a spot somebody leaves is free for the next to come, and nobody is moved to it", () => {
    const spots = makeSpots(() => Array.from({ length: 3 }, (_, k) => ({ x: k * 20, y: 0, dir: 0 as const })));
    const [a = "", b = "", c = "", d = ""] = ids(4, 100);
    const three = spots.place("table", [a, b, c]);
    expect(spots.place("table", [a, b, c, d]).has(d)).toBe(false);
    const left = three.get(b)?.n;
    const after = spots.place("table", [a, c, d]);
    expect(after.get(d)?.n).toBe(left);
    expect(after.get(a)).toEqual(three.get(a));
    expect(after.get(c)).toEqual(three.get(c));
  });
});

describe("where the spots are", () => {
  const laidBoxes = PLACES.flatMap((at) => LAID[at].map((s, n) => ({ at, n, boxes: footprint(at, s, sits(at, n)) })));

  test("nobody at a spot laid by hand is on top of anybody at another, at any place, or of a seat, the town's own, a lantern post or the way in", () => {
    const clear = keepClear();
    for (const one of laidBoxes) {
      for (const other of laidBoxes)
        if (one !== other)
          for (const b of one.boxes)
            for (const o of other.boxes)
              if (meet(b, o)) throw new Error(`${one.at} ${one.n} is on top of ${other.at} ${other.n}`);
      for (const b of one.boxes)
        for (const c of clear) if (meet(b, c)) throw new Error(`${one.at} ${one.n} is on ${JSON.stringify(c)}`);
    }
  });

  test("further out, a spot is on open ground, on nobody, and on or behind no thing standing, however many are wanted", () => {
    // A bush and a cart where the Works' spots run out, a stall by the stump, and a tree by the stone.
    const things: Thing[] = [
      { box: { x: 380, y: 160, w: 30, h: 20 }, z: 180 },
      { box: { x: 430, y: 150, w: 12, h: 30 }, z: 180 },
      { box: { x: 470, y: 200, w: 10, h: 12 }, z: 212 },
      { box: { x: 60, y: 140, w: 24, h: 50 }, z: 190 },
    ];
    const clear = keepClear();
    const offThings = clearOf(things);
    for (const at of PLACES) {
      const spots = further(at, 16, open, (b) => offThings(b) && clear.every((c) => !meet(b, c)));
      expect(spots.slice(0, LAID[at].length)).toEqual([...LAID[at]]);
      expect(spots.length).toBeGreaterThan(LAID[at].length);
      const boxes = spots.map((s, n) => footprint(at, s, sits(at, n)));
      spots.slice(LAID[at].length).forEach((s, k) => {
        const n = LAID[at].length + k;
        expect(open(s)).toBe(true);
        for (const b of boxes[n] ?? []) {
          for (const t of things) {
            // Not standing on its foot, nor behind it.
            expect(meet({ ...b, y: b.y + b.h - 4, h: 4 }, { ...t.box, y: t.z - 4, h: 5 })).toBe(false);
            if (t.z > b.y + b.h) expect(meet(b, t.box)).toBe(false);
          }
          boxes.forEach((others, m) => {
            if (m !== n) for (const o of others) expect(meet(b, o)).toBe(false);
          });
        }
      });
      // A step out: each is near one laid by hand.
      for (const s of spots.slice(LAID[at].length))
        expect(Math.min(...LAID[at].map((l) => Math.hypot(s.x - l.x, s.y - l.y)))).toBeLessThanOrEqual(56);
    }
  });

  test("the spots further out are the same each time they are worked out", () => {
    const clear = keepClear();
    const lay = () => further("works", 14, open, (b) => clear.every((c) => !meet(b, c)));
    expect(lay()).toEqual(lay());
  });
});

describe("what each is doing in their spot", () => {
  const spot = LAID.works[0];
  if (!spot) throw new Error("no spot at the Works");

  test("somebody away dozes in their spot, sat down facing us, at each of the games", () => {
    for (const at of PLACES) {
      const s = LAID[at][1];
      if (!s) throw new Error(`no second spot at ${at}`);
      for (let now = T0; now < T0 + WORK_MS; now += 250) {
        const p = poseAt({ id: id(7), at, spot: s, n: 1, away: true, now });
        expect(p).toMatchObject({ x: s.x, y: s.y, dir: 0, seated: true, dozing: true, work: null });
      }
    }
  });

  test("at the Works somebody works at their crate without leaving their spot: hammering, lifting it to look it over, setting it down", () => {
    const seen = new Set<string>();
    let blows = 0;
    let last = atWork(id(3), spot, T0).blow;
    for (let now = T0; now < T0 + 2 * WORK_MS; now += 50) {
      const p = poseAt({ id: id(3), at: "works", spot, n: 0, away: false, now });
      expect([p.x, p.y, p.seated, p.dozing]).toEqual([spot.x, spot.y, false, false]);
      const w = p.work;
      if (!w) throw new Error("not at work");
      // The hammer is out only while the crate is on the ground; held, they turn to us or stay as they were.
      if (w.held) expect(w.hammer).toBeNull();
      expect([spot.dir, 0]).toContain(w.dir);
      seen.add(`${w.held ? "held" : "down"} ${w.hammer ?? "by"}`);
      if (w.blow !== last) {
        expect(w.blow).toBeLessThanOrEqual(now);
        expect(w.hammer).toBe("down");
        blows += 1;
        last = w.blow;
      }
    }
    expect([...seen].toSorted()).toEqual(["down by", "down down", "down up", "held by"]);
    // Six blows a round.
    expect(blows).toBe(12);
  });

  test("two at the Works keep their own time, the same on every page", () => {
    expect(atWork(id(3), spot, T0 + 1234)).toEqual(atWork(id(3), spot, T0 + 1234));
    const apart = Array.from({ length: 40 }, (_, k) => T0 + k * 333).some(
      (now) => JSON.stringify(atWork(id(3), spot, now)) !== JSON.stringify(atWork(id(4), spot, now)),
    );
    expect(apart).toBe(true);
  });

  test("at the stump they sit over the board, before the stone they stand facing it", () => {
    LAID.table.forEach((s, n) => {
      expect(poseAt({ id: id(5), at: "table", spot: s, n, away: false, now: T0 })).toMatchObject({
        x: s.x,
        y: s.y,
        dir: s.dir,
        seated: true,
      });
    });
    for (const s of LAID.grove)
      expect(poseAt({ id: id(5), at: "grove", spot: s, n: 0, away: false, now: T0 })).toMatchObject({
        x: s.x,
        y: s.y,
        dir: s.dir,
        seated: false,
      });
  });
});
