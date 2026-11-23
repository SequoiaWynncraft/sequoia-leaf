import { describe, expect, test } from "bun:test";

import {
  at,
  BELT,
  BENCH,
  build,
  create,
  DEADFALL,
  deliver,
  GATHERER,
  item,
  type ItemName,
  litOf,
  MILL,
  NONE,
  PYLON,
  refusal,
  route,
  stand,
  step,
  type Yard,
} from "@sequoia-leaf/factory";

import { nudge } from "./teach.ts";

const none = new Set<string>();
const run = (w: Yard, ticks: number): void => {
  for (let k = 0; k < ticks; k++) step(w);
};
/** A new yard with its first lessons filled at the depot, as their deliveries would fill them. */
function past(lessons: number): Yard {
  const w = create({ seed: 3 });
  const wants: [ItemName, number][][] = [
    [["plank", 12]],
    [
      ["ingot", 12],
      ["brick", 12],
    ],
  ];
  for (const lesson of wants.slice(0, lessons)) for (const [name, n] of lesson) deliver(w, item(name), n);
  return w;
}

/** Lays `n` belts on the first clear tiles of a yard. */
const belts = (w: Yard, n: number): void => {
  const free = [...w.kind.keys()].flatMap((i) => {
    const [x, y] = [i % w.land.w, Math.floor(i / w.land.w)];
    return w.kind[i] === NONE && refusal(w, BELT, x, y, 999) === null ? [{ x, y }] : [];
  });
  for (const t of free.slice(0, n)) build(w, BELT, t.x, t.y, 0, 999);
};

describe("teaching", () => {
  test("a new yard is shown its first line a piece at a time, each where it goes", () => {
    const w = create();
    const first = nudge(w, none, false);
    expect(first?.id).toBe("gatherer");
    expect(first?.tool).toBe(GATHERER);
    // On deadfall, on the yard's own land, where the depot's power reaches.
    const i = at(w, first?.x ?? -1, first?.y ?? -1);
    expect(w.land.deposit[i]).toBe(DEADFALL);
    expect(litOf(w)[i]).toBe(1);

    build(w, GATHERER, first?.x ?? 0, first?.y ?? 0, 0, 0);
    const second = nudge(w, none, false);
    expect(second?.id).toBe("mill");
    expect([second?.x, second?.y]).toEqual([(first?.x ?? 0) + 1, first?.y]);

    build(w, MILL, second?.x ?? 0, second?.y ?? 0, 0, 0);
    const third = nudge(w, none, false);
    expect(third?.id).toBe("belt");
    expect(third?.tool).toBe(BELT);
    expect(third?.text).toContain("Drag");
    expect(nudge(w, none, true)?.text).toContain("Tap here");
    expect([third?.x, third?.y]).toEqual([(first?.x ?? 0) + 2, first?.y]);

    const legs = route(w, [third?.x ?? 0, third?.y ?? 0], w.land.depot);
    if (!legs) throw new Error("no way to the depot");
    expect(stand(w, legs, 0).ok).toBe(true);
    // Until a plank has arrived the belt lesson has nothing more to point at, and says nothing.
    expect(nudge(w, none, false)).toBeNull();
    run(w, 120);
    const fourth = nudge(w, none, false);
    expect(fourth?.id).toBe("planks");
    expect(fourth?.lasting).toBe(false);
    expect(nudge(w, new Set(["planks"]), false)).toBeNull();
  });

  test("the second lesson points a pylon towards the ore, and the third a bench near the depot", () => {
    const w = past(1);
    const pylon = nudge(w, none, false);
    expect(pylon?.id).toBe("pylon");
    expect(pylon?.tool).toBe(PYLON);
    // Where it points, a pylon would carry power to ore.
    build(w, PYLON, pylon?.x ?? 0, pylon?.y ?? 0, 0, 99);
    const lit = litOf(w);
    expect(w.land.deposit.some((d, i) => d === item("ore") && lit[i] === 1)).toBe(true);
    expect(nudge(w, none, false)).toBeNull();

    const later = past(2);
    const bench = nudge(later, none, false);
    expect(bench?.id).toBe("bench");
    expect(litOf(later)[at(later, bench?.x ?? -1, bench?.y ?? -1)]).toBe(1);
    expect(nudge(later, new Set(["bench"]), false)).toBeNull();
  });

  test("later it speaks up once for the board, for a shortage of power, and for a machine that has jammed", () => {
    const w = create({ seed: 4, tier: 1 });
    expect(nudge(w, none, false)?.id).toBe("board");
    const taught = new Set(["board"]);
    expect(nudge(w, taught, false)).toBeNull();
    // Six benches beside the depot draw more than it gives.
    for (let k = 0; k < 6; k++) build(w, BENCH, 21, 14 + k, 0, 999);
    expect(nudge(w, taught, false)?.id).toBe("short");
    taught.add("short");
    // Planks sawn straight into the second bench, and nothing else: it fills with planks.
    build(w, GATHERER, 19, 15, 0, 999);
    build(w, MILL, 20, 15, 0, 999);
    run(w, 600);
    const stuck = nudge(w, taught, false);
    expect(stuck?.id).toBe("starved");
    expect([stuck?.x, stuck?.y]).toEqual([21, 15]);
    taught.add("starved");
    expect(nudge(w, taught, false)).toBeNull();
    deliver(w, item("plank"), 1);
    expect(nudge(w, taught, false)).toBeNull();
  });

  test("once the yard passes 60 pieces it says, once, what Select is for, but not before it has Select", () => {
    const taught = new Set(["board"]);
    const early = create({ seed: 5, tier: 1 });
    belts(early, 61);
    expect(nudge(early, taught, false)).toBeNull();

    const w = create({ seed: 5, tier: 3 });
    belts(w, 60);
    expect(nudge(w, taught, false)).toBeNull();
    belts(w, 1);
    expect(nudge(w, taught, false)).toMatchObject({ id: "select", tool: "select", lasting: false });
    expect(nudge(w, new Set(["board", "select"]), false)).toBeNull();
  });
});
