import { afterEach, describe, expect, test } from "bun:test";

import { DAY_MS, isAct, readToClient } from "@sequoia-leaf/core";
import { hiding, STRETCH, stretchOf } from "@sequoia-leaf/town/clock.ts";

import { G, hooks, SEED } from "./game.ts";
import { makeProp, type Prop, propUnder } from "./props.ts";
import { STRINGS, wire } from "./strings.ts";
import { type Crab, crabAt, crabs, lastTouches, placeCrabs, props, thingName, touchedBy, touchThing } from "./town.ts";

/** A crab that has been running off this many seconds is no longer seen. */
const BOLTED = 1.2;

/** Every touch a thing standing answered: which, and whether it was the member's own. */
let answered: string[] = [];
const thing = (kind: string, x: number, y: number, hit: { x: number; y: number; w: number; h: number }): Prop =>
  makeProp(kind, null, x, y, {
    hit,
    tap: (p, _x, _y, own) => answered.push(`${p.kind} ${p.x},${p.y}${own ? " own" : ""}`),
  });

const crab = (n: number, x: number, y: number): Crab => ({
  n,
  hx: x,
  hy: y,
  x,
  y,
  aside: 0,
  shyTo: x,
  shyUntil: 0,
  moving: false,
  hop: 0,
  clack: 0,
  lost: false,
  bolt: 0,
  z: y,
  perched: false,
});

/** A little of the town: a lantern post with flowers at its foot, close enough that their edges meet, and a trunk behind. */
function lay(): void {
  props.push(
    thing("trunk", 160, 140, { x: 140, y: 40, w: 40, h: 100 }),
    thing("post", 174, 126, { x: 171, y: 92, w: 6, h: 34 }),
    thing("flower", 170, 130, { x: 168, y: 124, w: 5, h: 6 }),
    thing("flower", 176, 133, { x: 174, y: 127, w: 5, h: 6 }),
  );
  crabs.push(crab(3, 384, 266));
}

afterEach(() => {
  props.length = 0;
  crabs.length = 0;
  answered = [];
  hooks.tell = () => undefined;
});

/** Somebody else's page: hears the act from Leaf and plays it, as the town's room does. */
function overTheWire(name: string): string | null {
  if (!isAct("touch", name)) return null;
  const heard = readToClient(JSON.stringify({ t: "act", id: 2, kind: "touch", arg: name }));
  return heard?.t === "act" ? heard.arg : null;
}

describe("a touch's name", () => {
  test("is one Leaf passes, survives the wire, and means on another page the thing it was made on", () => {
    lay();
    let checked = 0;
    for (let x = 136.25; x < 184; x += 0.75)
      for (let y = 36.5; y < 142; y += 0.75) {
        const p = propUnder(props, x, y);
        if (!p) continue;
        const name = overTheWire(thingName(p.kind, x, y));
        if (name === null) throw new Error(`${thingName(p.kind, x, y)} did not pass`);
        answered = [];
        touchedBy(name)?.play(false);
        expect(answered).toEqual([`${p.kind} ${p.x},${p.y}`]);
        checked++;
      }
    // The trunk, the post and both flowers, at points on their edges too.
    expect(checked).toBeGreaterThan(7000);
  });

  test("names the water, a string of lights, the sky and the roll call by a point, and a crab by its number", () => {
    lay();
    const bulb = wire(STRINGS[0] ?? { from: { x: 0, y: 0 }, to: { x: 0, y: 0 }, sag: 0 })[3] ?? { x: 0, y: 0 };
    const names = [
      thingName("water", 404.6, 295.2),
      thingName("lights", bulb.x + 0.4, bulb.y + 1.2),
      thingName("sky", 256.5, -40.5),
      thingName("crab", 3),
      thingName("roll"),
    ];
    expect(names).toEqual(["water:404,295", `lights:${bulb.x},${bulb.y + 1}`, "sky:256,-41", "crab:3", "roll"]);
    expect(names.map((n) => touchedBy(overTheWire(n) ?? "") !== null)).toEqual([true, true, true, true, true]);
    // Where nothing is, or nothing like it: no page knows the name, and Leaf passes no word it does not know.
    expect(["water:20,20", "lights:300,300", "sky:256,300", "crab:12", "post:20,20"].map(touchedBy)).toEqual([
      null,
      null,
      null,
      null,
      null,
    ]);
    expect(["you_are_dumb", "post:1,2,3", "post:1234,5", "crab:three"].map((n) => isAct("touch", n))).toEqual([
      false,
      false,
      false,
      false,
    ]);
  });
});

describe("a touch", () => {
  test("the member makes answers here and is told to the room; one from the room answers and is not told again", () => {
    lay();
    const told: string[] = [];
    hooks.tell = (name) => told.push(name);
    const name = thingName("post", 174.5, 100.5);

    expect(touchThing(name)).toBe(true);
    expect(touchThing(name, false)).toBe(true);
    expect(touchThing("post:20,20")).toBe(false);

    expect(answered).toEqual(["post 174,126 own", "post 174,126"]);
    expect(told).toEqual(["post:174,100"]);
    expect(lastTouches.slice(-2)).toEqual([
      { name, own: true },
      { name, own: false },
    ]);
  });

  test("on crab No. 7 from the room makes it hop here too, and it stays to be found", () => {
    crabs.push({ ...crab(7, 198, 121), lost: true });
    touchThing(thingName("crab", 7), false);
    expect(crabs.map((c) => [c.hop, c.bolt > 0])).toEqual([[0.3, false]]);
  });
});

/** The crabs as they are at a moment of Leaf's clock. */
function at(now: number): Crab[] {
  G.now = now;
  placeCrabs();
  return crabs;
}

describe("the crabs, by Leaf's clock", () => {
  /** Noon to noon, so that the UTC day turns in the middle. */
  const T0 = Date.UTC(2026, 10, 25, 12);

  test("over a whole day none goes faster than 12 pixels a second, or further from home than it ever did", () => {
    crabs.push(crab(3, 384, 266), { ...crab(8, 432, 284), perched: true });
    let was = at(T0).map((c) => c.x);
    for (let now = T0 + 500; now <= T0 + DAY_MS; now += 500) {
      const xs = at(now).map((c) => c.x);
      const [three = 0, eight = 0] = xs;
      const stepped = Math.max(...xs.map((x, i) => Math.abs(x - (was[i] ?? x))));
      if (stepped > 6 + 1e-6 || Math.abs(three - 384) > 6 || Math.abs(eight - 432) > 2)
        throw new Error(`at ${now}: ${was.join(", ")} to ${xs.join(", ")}`);
      was = xs;
    }
  });

  test("No. 7 hides where the clock has it, bolts when found, is gone for the stretch, and hides somewhere else in the next", () => {
    crabs.push({ ...crab(7, 0, 0), lost: true });
    const from = stretchOf(T0) * STRETCH;
    const here = hiding(SEED, from + 20_000).at;
    const [c] = at(from + 20_000);
    expect([c?.x, c?.y, c?.z, c?.bolt]).toEqual([here.x, here.y, here.z, 0]);

    touchThing(thingName("crab", 7));
    expect(at(from + 20_500)[0]?.bolt).toBe(0.5);
    expect(Math.abs((c?.x ?? 0) - here.x)).toBeCloseTo(45);
    // Gone, and a second touch finds nothing.
    expect(at(from + 59_000)[0]?.bolt).toBeGreaterThan(BOLTED);
    expect(crabAt(here.x, here.y)).toBeNull();

    const next = hiding(SEED, from + STRETCH).at;
    expect(next).not.toEqual(here);
    expect([at(from + STRETCH)[0]?.x, c?.y, c?.bolt]).toEqual([next.x, next.y, 0]);
    // Left alone, it runs off from there as the stretch turns, and is hiding in its next place just after.
    expect(at(from + 2 * STRETCH + 600)[0]?.bolt).toBe(0.6);
    expect(Math.abs((c?.x ?? 0) - next.x)).toBeCloseTo(54);
    const last = hiding(SEED, from + 2 * STRETCH).at;
    expect([at(from + 2 * STRETCH + 1200)[0]?.x, c?.y, c?.bolt]).toEqual([last.x, last.y, 0]);
  });
});
