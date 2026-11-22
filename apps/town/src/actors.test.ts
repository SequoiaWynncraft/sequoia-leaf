import { beforeEach, describe, expect, test } from "bun:test";

import { dist } from "@sequoia-leaf/kit/util.ts";

import { feet, goSit, goToSeat, headOf, makeActor, peopleOn, seatFree, stepActor, stopAt, walkTo } from "./actors.ts";
import { crowds } from "./apart.ts";
import { type Actor, G } from "./game.ts";
import { type Seat, SEATS, TOWN } from "./world.ts";

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
