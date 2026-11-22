import { afterEach, describe, expect, test } from "bun:test";

import { isAct, readToClient } from "@sequoia-leaf/core";

import { hooks } from "./game.ts";
import { makeProp, type Prop, propUnder } from "./props.ts";
import { STRINGS, wire } from "./strings.ts";
import { type Crab, crabs, lastTouches, props, thingName, touchedBy, touchThing } from "./town.ts";

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
  tx: x,
  wait: 9,
  hop: 0,
  clack: 0,
  lost: false,
  hide: 0,
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

  test("on crab No. 7 from the room makes it hop and run there too", () => {
    crabs.push({ ...crab(7, 198, 121), lost: true });
    touchThing(thingName("crab", 7), false);
    expect(crabs.map((c) => [c.hop, c.bolt > 0])).toEqual([[0.3, true]]);
  });
});
