import { beforeEach, describe, expect, test } from "bun:test";

import { dist } from "@sequoia-leaf/kit/util.ts";
import { TOWN } from "@sequoia-leaf/town/map/map.ts";

import {
  feet,
  goSit,
  goToSeat,
  headOf,
  HOP,
  hop,
  hopTo,
  makeActor,
  peopleOn,
  putAs,
  seatFree,
  sit,
  stepActor,
  stop,
  stopAt,
  walkTo,
  walkToSeat,
} from "./actors.ts";
import { crowds } from "./apart.ts";
import { type Actor, G, type Seat, SEATS } from "./game.ts";

let people: Actor[] = [];
peopleOn(TOWN, () => people);

/** Somebody in town at a point, by name. */
function member(name: string, x: number, y: number, you = false): Actor {
  const a = makeActor({ name, rank: "", level: 1, voice: 1 }, null, x, y, you);
  a.id = name;
  people.push(a);
  return a;
}
const seatAt = (x: number, y: number): Seat => {
  const s = SEATS.find((o) => o.x === x && o.y === y);
  if (!s) throw new Error(`no seat at ${x},${y}`);
  return s;
};
/** A member gone for the day, dozing on a seat. */
function dozer(name: string, s: Seat): Actor {
  const a = member(name, s.from.x, s.from.y);
  putAs(a, s);
  a.dozing = 1;
  return a;
}
/** Time passing for everybody. */
function run(seconds: number): void {
  for (let t = 0; t < seconds; t += 1 / 30) for (const a of people) stepActor(a, 1 / 30);
}
const onTop = (a: Actor, b: Actor): boolean => crowds({ ...feet(a), tall: headOf(a) }, { ...feet(b), tall: headOf(b) });

beforeEach(() => {
  people = [];
  for (const s of SEATS) s.taken = false;
});

describe("seats", () => {
  test("somebody standing just behind a seat facing us is on its sitter's head: it is not free", () => {
    const s = seatAt(248, 201);
    expect(seatFree(s, null)).toBe(true);
    // Where a sitter facing us is drawn 19 pixels tall: standing 12 pixels behind is on their head.
    member("Pipwick", 248, 189);
    expect(seatFree(s, null)).toBe(false);
  });

  test("a tapped seat somebody stands on sends the member to the nearest free seat instead", () => {
    const s = seatAt(248, 201);
    const me = member("Tester", 256, 170, true);
    G.player = me;
    member("Pipwick", 248, 190);
    expect(goSit(s)).toBe(true);
    expect(me.goal).not.toBe(s);
    run(4);
    expect(me.seat?.at).toBe("fire");
    expect(me.seat).not.toBe(s);
  });

  test("somebody on a seat's place by the time a walker gets there: the next seat, or stand beside it", () => {
    const s = seatAt(248, 236);
    const other = seatAt(264, 236);
    const a = member("Quillon", 248, 290);
    let sat: Seat | null | undefined;
    goToSeat(
      a,
      s,
      () => null,
      (got) => (sat = got),
    );
    member("Pipwick", 248, 232);
    run(4);
    expect(sat).toBeNull();
    expect(a.seat).toBeNull();
    expect(s.taken).toBe(false);

    const b = member("Wrenly", 248, 290);
    goToSeat(
      b,
      s,
      () => other,
      (got) => (sat = got),
    );
    run(4);
    expect(sat).toBe(other);
    expect(b.seat).toBe(other);
    expect(s.taken).toBe(false);
  });

  test("a seat somebody dozes on is not the member's to take: tapped, they sit on another by the fire", () => {
    const s = seatAt(248, 201);
    dozer("Fernhollow", s);
    const me = member("Tester", 256, 170, true);
    G.player = me;
    expect(seatFree(s, me)).toBe(false);
    expect(goSit(s)).toBe(true);
    expect(me.goal).not.toBe(s);
    run(4);
    expect(me.seat?.at).toBe("fire");
    expect(me.seat).not.toBe(s);
  });
});

describe("hops", () => {
  test("a hop timed by Leaf's clock is as far along as the clock has it, however late it is played", () => {
    const a = member("Quillon", 256, 170);
    // Three hops begun 0.4 seconds ago: the first is over, and the second a third done.
    hop(a, 3, HOP + 0.1);
    expect(a.hop).toBeCloseTo(HOP - 0.1);
    expect(a.hops).toBe(1);
    // All of them over by now: nothing.
    const b = member("Wrenly", 256, 170);
    hop(b, 3, 3 * HOP);
    expect([b.hop, b.hops]).toEqual([0, 0]);
  });
});

describe("where a walk ends", () => {
  test("on somebody: the nearest clear place, not round the corner", () => {
    const me = member("Tester", 200, 160);
    member("Pipwick", 156, 101);
    const end = stopAt(me, { x: 156, y: 106 });
    expect(dist(end.x, end.y, 156, 106)).toBeLessThanOrEqual(7);
  });

  test("two walking to one spot side by side, arriving together, stop apart", () => {
    const a = member("Quillon", 300, 160);
    const b = member("Wrenly", 300, 160);
    walkTo(a, { x: 256, y: 160 });
    walkTo(b, { x: 256, y: 160 });
    run(3);
    expect(a.moving || b.moving).toBe(false);
    expect(onTop(a, b)).toBe(false);
  });

  test("somebody stopping where a walk ends after it set out: the walker stops beside them", () => {
    const a = member("Quillon", 360, 160);
    walkTo(a, { x: 256, y: 160 });
    run(0.5);
    const b = member("Wrenly", 256, 160);
    // The way round is 136 pixels, and the slowest walker goes 30 a second.
    run(6);
    expect(dist(b.x, b.y, 256, 160)).toBe(0);
    expect(onTop(a, b)).toBe(false);
  });
});

describe("what somebody's feet are doing", () => {
  test("a walk ends standing at its end, and what was to happen there happens once", () => {
    const a = member("Quillon", 200, 160);
    let done = 0;
    walkTo(a, { x: 300, y: 160 }, () => done++);
    expect(a.move.kind).toBe("walking");
    // Somebody not the member walks at 30 to 40 pixels a second.
    run(4);
    expect(a.move.kind).toBe("still");
    expect(dist(a.x, a.y, 300, 160)).toBeLessThan(2);
    expect(done).toBe(1);
  });

  test("a walk set off on from a seat stands up first, and lets the seat go", () => {
    const s = seatAt(248, 236);
    const a = member("Quillon", 248, 290);
    sit(a, s);
    expect(a.seat).toBe(s);
    walkTo(a, { x: 300, y: 160 });
    expect(a.seat).toBeNull();
    expect(s.taken).toBe(false);
    expect(a.move.kind).toBe("walking");
  });

  test("stopping drops the walk and what was to happen at its end, and the seat kept on the way", () => {
    const s = seatAt(248, 236);
    const a = member("Quillon", 248, 290);
    let told: Seat | null | undefined;
    walkToSeat(a, s, (sat) => (told = sat));
    expect(a.goal).toBe(s);
    expect(s.taken).toBe(true);
    run(0.2);
    stop(a);
    expect(a.move).toEqual({ kind: "still" });
    expect(a.goal).toBeNull();
    expect(a.path).toEqual([]);
    expect(s.taken).toBe(false);
    run(4);
    expect(a.seat).toBeNull();
    expect(told).toBeUndefined();
  });

  test("stopping on a seat stands somebody up on the ground before it", () => {
    const s = seatAt(248, 236);
    const a = member("Quillon", 248, 290);
    sit(a, s);
    stop(a);
    expect(a.move.kind).toBe("still");
    expect({ x: a.x, y: a.y }).toEqual(s.from);
    expect(s.taken).toBe(false);
  });

  test("a new walk takes the place of the old: only the new one's end happens", () => {
    const a = member("Quillon", 200, 160);
    const ends: string[] = [];
    walkTo(a, { x: 300, y: 160 }, () => ends.push("first"));
    run(0.3);
    walkTo(a, { x: 220, y: 170 }, () => ends.push("second"));
    run(4);
    expect(ends).toEqual(["second"]);
  });

  test("sitting on one seat while another was kept lets the other go", () => {
    const s = seatAt(248, 236);
    const other = seatAt(264, 236);
    const a = member("Quillon", 248, 290);
    walkToSeat(a, s);
    sit(a, other);
    expect(s.taken).toBe(false);
    expect(other.taken).toBe(true);
    expect(a.seat).toBe(other);
    expect(a.goal).toBeNull();
  });

  test("somebody put where others say is moved by nobody else: not walked, not stopped", () => {
    const own: Seat = { x: 230, y: 180, dir: 0, from: { x: 230, y: 180 }, at: "fire", taken: false };
    const a = member("Birchwood", 230, 180);
    putAs(a, own);
    stop(a);
    stepActor(a, 1);
    expect(a.move).toEqual({ kind: "puppet", seat: own });
    expect(a.seat).toBe(own);
    expect({ x: a.x, y: a.y }).toEqual({ x: 230, y: 180 });
    putAs(a, null);
    expect(a.seat).toBeNull();
  });

  // Bug C: a figure fenced in by a camp's rebuild was hopped out with its way emptied and what was
  // to happen at the end kept: the end was never reached, so a caller walking off never went. Hopped
  // out now, they walk on to the same end, and it happens.
  test("hopped out of somewhere shut in, a walker goes on to the same end, and what was to happen there does", () => {
    const a = member("Fernwhistle", 200, 160);
    let gone = false;
    walkTo(a, { x: 300, y: 160 }, () => (gone = true));
    run(0.3);
    hopTo(a, { x: 240, y: 172 });
    expect(a.hop).toBeGreaterThan(0);
    expect(a.move.kind).toBe("walking");
    run(5);
    expect(gone).toBe(true);
    expect(dist(a.x, a.y, 300, 160)).toBeLessThan(2);
  });
});
