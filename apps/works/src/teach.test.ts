import { describe, expect, test } from "bun:test";

import { at, build, create, deliver, refusal, repower, route, stand, step, type World } from "@sequoia-leaf/yard";

import { nudge } from "./teach.ts";

const none = new Set<string>();
const run = (w: World, ticks: number): void => {
  for (let k = 0; k < ticks; k++) step(w);
};

describe("teaching", () => {
  test("a new yard is shown its first line a piece at a time, each where it goes", () => {
    const w = create();
    const first = nudge(w, none, false);
    expect(first?.id).toBe("gatherer");
    expect(first?.tool).toBe("gatherer");
    // On deadfall, on the yard's own land, where the depot's power reaches.
    const i = at(w, first?.x ?? -1, first?.y ?? -1);
    expect(w.land.deposit[i]).toBe("deadfall");
    expect((w.power ?? repower(w))[i]).toBe(1);

    build(w, "gatherer", first?.x ?? 0, first?.y ?? 0, 0, 0);
    const second = nudge(w, none, false);
    expect(second?.id).toBe("mill");
    expect([second?.x, second?.y]).toEqual([(first?.x ?? 0) + 1, first?.y]);

    build(w, "mill", second?.x ?? 0, second?.y ?? 0, 0, 0);
    const third = nudge(w, none, false);
    expect(third?.id).toBe("belt");
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
  test("the second order points a pylon towards the ore, and the third a bench near the depot", () => {
    const w = create({ story: 1 });
    const pylon = nudge(w, none, false);
    expect(pylon?.id).toBe("pylon");
    expect(pylon?.tool).toBe("pylon");
    // Where it points, a pylon would carry power to ore.
    build(w, "pylon", pylon?.x ?? 0, pylon?.y ?? 0, 0, 99);
    const power = w.power ?? repower(w);
    const lit = w.land.deposit.some((d, i) => d === "ore" && power[i] === 1);
    expect(lit).toBe(true);
    expect(nudge(w, none, false)).toBeNull();

    const later = create({ story: 2 });
    const bench = nudge(later, none, false);
    expect(bench?.id).toBe("bench");
    expect((later.power ?? repower(later))[at(later, bench?.x ?? -1, bench?.y ?? -1)]).toBe(1);
    expect(nudge(later, new Set(["bench"]), false)).toBeNull();
  });
  test("later it speaks up once for the board, for a shortage of power, and for a machine that has jammed", () => {
    const w = create({ story: 4 });
    expect(nudge(w, none, false)?.id).toBe("board");
    const taught = new Set(["board"]);
    expect(nudge(w, taught, false)).toBeNull();
    // Six benches round the depot draw more than it gives.
    for (let k = 0; k < 6; k++) build(w, "bench", 21, 14 + k, 0, 999);
    expect(nudge(w, taught, false)?.id).toBe("short");
    taught.add("short");
    const bench = w.cells[at(w, 21, 14)];
    if (!bench) throw new Error("no bench");
    bench.buf.plank = 4;
    bench.kinds = 1;
    bench.count = 4;
    const stuck = nudge(w, taught, false);
    expect(stuck?.id).toBe("starved");
    expect([stuck?.x, stuck?.y]).toEqual([21, 14]);
    taught.add("starved");
    expect(nudge(w, taught, false)).toBeNull();
    deliver(w, "plank", 1);
    expect(nudge(w, taught, false)).toBeNull();
  });
  test("once the yard passes 60 pieces it says, once, what Select is for", () => {
    const w = create({ story: 4 });
    const taught = new Set(["board"]);
    const free = w.cells.flatMap((_, i) => {
      const [x, y] = [i % w.land.w, Math.floor(i / w.land.w)];
      return refusal(w, "belt", x, y, 999) === null ? [{ x, y }] : [];
    });
    for (const t of free.slice(0, 60)) build(w, "belt", t.x, t.y, 0, 999);
    expect(nudge(w, taught, false)).toBeNull();
    build(w, "belt", free[60]?.x ?? 0, free[60]?.y ?? 0, 0, 999);
    expect(nudge(w, taught, false)).toMatchObject({ id: "select", tool: "select", lasting: false });
    expect(nudge(w, new Set(["board", "select"]), false)).toBeNull();
  });
});
