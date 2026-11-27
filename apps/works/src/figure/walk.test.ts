/**
 * Being somebody in the yard: walking and running at the town's pace, a tapped way round machines,
 * walking over belts and round a mill, being put aside off a tile something is built on, and the
 * view going with the figure, let go by a drag and taken hold of again by walking.
 */
import { describe, expect, test } from "bun:test";

import {
  build as built,
  create,
  kind,
  type KindName,
  LAND,
  type Place,
  RUN,
  type Solid,
  unsound,
  WALK,
  type Yard,
  yardSolid,
} from "@sequoia-leaf/factory";

import { Character, type Footing } from "./character.ts";
import { Dust, trodden } from "./dust.ts";
import { GAIT } from "./feel.ts";
import { Follow } from "./follow.ts";
import { findWay } from "./way.ts";

/** A yard at tier 4, where everything the slice builds is open. Every tile below is counted east and south of the depot's middle. */
const yard = (): Yard => create({ seed: 4, tier: 4 });
const [DX, DY] = LAND.depot;
/** Builds a piece facing east, as far east and south of the depot, which must be built. */
function build(y: Yard, name: KindName, x: number, z: number): void {
  const did = built(y, kind(name), DX + x, DY + z, 0, Infinity);
  if (!did.ok) throw new Error(`no ${name} at ${x}, ${z} from the depot`);
}
/** The middle of a tile as far east and south of the depot, in pixels of the art. */
const mid = (x: number, y: number): Place => ({ x: (DX + x) * 16 + 8, y: (DY + y) * 16 + 8 });
/** The tile a figure stands on, as far east and south of the depot. */
const tileOf = (c: Character): { x: number; y: number } => ({ x: c.tile.x - DX, y: c.tile.y - DY });
/** What the feet did, counted. */
function feet(): Footing & { steps: number; asides: number; bumps: number } {
  const f = {
    steps: 0,
    asides: 0,
    bumps: 0,
    step: () => void f.steps++,
    pullUp: () => {},
    bump: () => void f.bumps++,
    aside: () => void f.asides++,
  };
  return f;
}
/** A figure at a place, and where it is told it is. */
function figure(at: Place): { c: Character; told: Place[]; feet: ReturnType<typeof feet> } {
  const told: Place[] = [];
  const f = feet();
  const c = new Character(at.x, at.y, (x, y) => told.push({ x, y }), f);
  return { c, told, feet: f };
}
/** So many seconds of frames at 60 a second. */
function run(c: Character, solid: Solid, seconds: number, hz = 60): void {
  for (let k = 0; k < Math.round(seconds * hz); k++) c.step(1 / hz, solid);
}

describe("walking and running", () => {
  test("by the keys, a figure walks at 64 pixels a second at once, and runs at 128 after 0.7 seconds", () => {
    const y = yard();
    const solid = yardSolid(y);
    const { c } = figure(mid(-7, -5));
    c.steer(1, 0);
    run(c, solid, 0.5);
    expect(c.x - mid(-7, -5).x).toBeCloseTo(WALK * 0.5, 0);
    expect(c.running).toBe(false);
    run(c, solid, GAIT.runAfter - 0.5 + GAIT.runUp + 0.05);
    expect(c.speed).toBe(RUN);
    expect(c.running).toBe(true);
    // A run is pulled up in a step or two, never a slide.
    c.steer(0, 0);
    const x = c.x;
    run(c, solid, 0.2);
    expect(c.x - x).toBeLessThan(16);
    expect(c.moving).toBe(false);
  });

  test("goes as far at 30, 60 or 144 frames a second", () => {
    const y = yard();
    const ends = [30, 60, 144].map((hz) => {
      const { c } = figure(mid(-7, -5));
      c.steer(1, 0);
      run(c, yardSolid(y), 1.5, hz);
      return c.x;
    });
    for (const x of ends) expect(Math.abs(x - (ends[1] ?? 0))).toBeLessThan(2);
  });

  test("setting off, a foot comes down at once, then every 10 pixels of a walk; the figure faces the way it goes", () => {
    const y = yard();
    const { c, feet: f } = figure(mid(-7, -5));
    c.steer(0, 1);
    run(c, yardSolid(y), 0.5);
    expect(c.way).toBe(0);
    // 32 pixels: a foot at the first step and a half, then at 11.5, 21.5 and 31.5.
    expect(f.steps).toBe(4);
    c.steer(-1, 0);
    run(c, yardSolid(y), 0.1);
    expect(c.way).toBe(1);
  });

  test("at rest it breathes now and then, and blinks", () => {
    const { c } = figure(mid(-7, -5));
    const poses = new Set<number>();
    for (let k = 0; k < 600; k++) {
      c.step(1 / 60, yardSolid(yard()));
      poses.add(c.pose);
    }
    // Standing, a breath, a blink: the kit's poses 0, 7 and 8.
    expect([...poses].toSorted((a, b) => a - b)).toEqual([0, 7, 8]);
  });
});

describe("solid ground", () => {
  test("a belt is walked over, a mill is not: the keys slide the figure along it", () => {
    const y = yard();
    for (let x = -6; x <= -2; x++) build(y, "belt", x, -5);
    const { c } = figure(mid(-7, -5));
    c.steer(1, 0);
    run(c, yardSolid(y), 1.2);
    expect(tileOf(c).x).toBeGreaterThanOrEqual(-2);
    build(y, "mill", 2, -5);
    const { c: d, feet: f } = figure(mid(0, -5));
    d.steer(1, 0);
    run(d, yardSolid(y), 1.5);
    expect(d.x).toBeLessThan(mid(2, -5).x - 8);
    expect(unsound(yardSolid(y), d.x, d.y)).toBeNull();
    // Into it at a walk, no bump is said; only a run that runs into something says so.
    expect(f.bumps).toBe(0);
  });

  test("a figure something is built on is put aside, with a hop, onto the clear ground nearest", () => {
    const y = yard();
    const { c, told, feet: f } = figure(mid(-4, -4));
    build(y, "mill", -4, -4);
    c.step(1 / 60, yardSolid(y));
    expect(f.asides).toBe(1);
    expect(tileOf(c)).not.toEqual({ x: -4, y: -4 });
    expect(unsound(yardSolid(y), c.x, c.y)).toBeNull();
    expect(told.at(-1)).toEqual({ x: c.x, y: c.y });
    run(c, yardSolid(y), 0.1);
    expect(c.lift).toBeGreaterThan(0);
  });
});

/** A wall of mills 3 west of the depot, from the yard's top row down to the row above the depot's, between where the figure stands and where it is sent. */
function walled(): Yard {
  const y = yard();
  for (let z = -6; z <= -1; z++) build(y, "mill", -3, z);
  return y;
}

/** What feet raise on a floor all of one colour, or with no floor at all. */
const dustOn = (rgb: readonly [number, number, number] | null): Dust => new Dust(() => rgb);

describe("what feet raise", () => {
  const EARTH = [150, 108, 74] as const;
  const GRASS = [75, 140, 60] as const;
  const at = { x: 100, y: 200 };

  test("bare earth: a pixel of dust at a walk, three at a run (one of them two across), four pulling up", () => {
    const d = dustOn(EARTH);
    d.footfall(at, false);
    expect(d.bits.length).toBe(1);
    d.footfall(at, true);
    expect(d.bits.length).toBe(4);
    expect(d.bits.filter((b) => b.size === 2).length).toBe(1);
    d.pullUp(at);
    expect(d.bits.length).toBe(8);
    // Dust drifts up from the row it rose from, and is gone within its life.
    expect(d.bits.every((b) => !b.lands && b.row === at.y && b.vy < 0)).toBe(true);
    for (let k = 0; k < 30; k++) d.step(1 / 60);
    expect(d.bits.every((b) => b.y < at.y)).toBe(true);
    for (let k = 0; k < 30; k++) d.step(1 / 60);
    expect(d.bits.length).toBe(0);
  });

  test("grass: nothing at a walk, a blade at a run that falls back to its row", () => {
    const d = dustOn(GRASS);
    d.footfall(at, false);
    expect(d.bits.length).toBe(0);
    d.footfall(at, true);
    expect(d.bits.map((b) => b.lands)).toEqual([true]);
    for (let k = 0; k < 60 && d.bits.length > 0; k++) d.step(1 / 60);
    expect(d.bits.length).toBe(0);
  });

  test("is the floor's own colour a tone lighter, so that it shows; nothing where there is no floor", () => {
    expect(trodden(EARTH)).toEqual({ colour: "rgb(192,162,127)", grass: false });
    expect(trodden(GRASS).grass).toBe(true);
    const d = dustOn(null);
    d.footfall(at, true);
    expect(d.bits.length).toBe(0);
  });
});

describe("shut in", () => {
  test("with no clear ground left, a figure stays put, and looks for some again only when what is solid changes", () => {
    // Everything solid but, once opened, the ground east of x = 200; the solid counts how often it is asked.
    const ground = { version: 0, open: false, asked: 0 };
    const solid: Solid = {
      at: (x) => {
        ground.asked++;
        return ground.open && x > 200 ? null : "in-the-way";
      },
      version: () => ground.version,
    };
    const { c, feet: f } = figure({ x: 100, y: 100 });
    c.step(1 / 60, solid);
    expect([f.asides, c.x, c.y]).toEqual([0, 100, 100]);
    // Idle frames ask only whether it still stands on something: no search for clear ground.
    ground.asked = 0;
    run(c, solid, 1);
    expect(ground.asked).toBeLessThanOrEqual(60 * 6);
    // Something is taken away: the yard changes, and it is put on the ground that opened.
    ground.open = true;
    ground.version++;
    c.step(1 / 60, solid);
    expect(f.asides).toBe(1);
    expect(c.x).toBeGreaterThan(200);
  });
});

describe("a tapped way", () => {
  test("goes round the machines in the way, never through one, and gets there", () => {
    const y = walled();
    const solid = yardSolid(y);
    const from = mid(-5, -4);
    const to = mid(-1, -4);
    const way = findWay(solid, from, to);
    expect(way.whole).toBe(true);
    expect(way.points.length).toBeGreaterThan(1);
    const { c } = figure(from);
    expect(c.goTo(solid, to.x, to.y)).toBe(true);
    for (let k = 0; k < 600 && c.going; k++) {
      c.step(1 / 60, solid);
      expect(unsound(solid, c.x, c.y)).toBeNull();
    }
    expect(c.going).toBe(false);
    expect(Math.hypot(c.x - to.x, c.y - to.y)).toBeLessThan(1);
  });

  test("a long way is run, and comes down to a walk to arrive", () => {
    const y = yard();
    const solid = yardSolid(y);
    const { c } = figure(mid(-7, -5));
    const to = mid(6, -5);
    c.goTo(solid, to.x, to.y);
    let fastest = 0;
    let last = 0;
    for (let k = 0; k < 600 && c.going; k++) {
      c.step(1 / 60, solid);
      fastest = Math.max(fastest, c.speed);
      last = c.speed;
    }
    expect(fastest).toBe(RUN);
    expect(last).toBe(WALK);
  });

  test("a place on a machine is walked to the clear ground nearest it", () => {
    const y = walled();
    const solid = yardSolid(y);
    const { c } = figure(mid(-5, -4));
    const on = mid(-3, -4);
    c.goTo(solid, on.x, on.y);
    run(c, solid, 3);
    expect(c.going).toBe(false);
    expect(unsound(solid, c.x, c.y)).toBeNull();
    expect(Math.hypot(c.x - on.x, c.y - on.y)).toBeLessThan(16);
  });

  test("steering lets go of the way", () => {
    const y = yard();
    const { c } = figure(mid(-7, -5));
    c.goTo(yardSolid(y), mid(6, -5).x, mid(6, -5).y);
    c.steer(0, 1);
    expect(c.going).toBe(false);
  });
});

describe("the view going with the figure", () => {
  const clear = { w: 320, h: 200 };

  test("starts on the figure, follows it a few pixels behind a walk, and is the same at any frame rate", () => {
    const f = new Follow();
    expect(f.track(100, 100, 0, false, clear)).toEqual({ x: 100, y: 100 });
    const behind = [30, 60, 144].map((hz) => {
      const g = new Follow();
      g.track(100, 100, 0, false, clear);
      let at = { x: 0, y: 0 };
      for (let k = 1; k <= hz; k++) at = g.track(100 + (WALK * k) / hz, 100, 1 / hz, true, clear) ?? at;
      return 100 + WALK - at.x;
    });
    for (const b of behind) expect(b).toBeGreaterThanOrEqual(6);
    for (const b of behind) expect(b).toBeLessThanOrEqual(9);
  });

  test("keeps a whole number of pixels from the pixel the figure is drawn on", () => {
    const f = new Follow();
    f.track(100.3, 50.6, 0, false, clear);
    for (let k = 1; k < 90; k++) {
      const x = 100.3 + k * 1.07;
      const at = f.track(x, 50.6, 1 / 60, true, clear);
      expect(Number.isInteger((at?.x ?? 0) - Math.round(x))).toBe(true);
    }
  });

  test("lets go on a drag, and walking takes hold again from where the view is, then closes on the figure", () => {
    const f = new Follow();
    f.track(100, 100, 0, false, clear);
    f.letGo();
    expect(f.track(110, 100, 1 / 60, true, clear)).toBeNull();
    // The view was dragged to 200, 100, the figure still in sight: taking hold moves nothing at that moment.
    f.hold({ x: 200, y: 100 });
    expect(f.track(110, 100, 1 / 60, false, clear)).toEqual({ x: 200, y: 100 });
    // Standing, in sight, nothing closes unasked; walking, it closes.
    expect(f.track(110, 100, 1 / 60, false, clear)?.x).toBe(200);
    let at = { x: 200, y: 100 };
    // Half of it in about a third of a second, all of it in three.
    for (let k = 0; k < 180; k++) at = f.track(110, 100, 1 / 60, true, clear) ?? at;
    expect(at.x).toBe(110);
  });

  test("asked for back, it closes on a figure standing still", () => {
    const f = new Follow();
    f.track(100, 100, 0, false, clear);
    f.letGo();
    f.home({ x: 180, y: 100 });
    let at = { x: 180, y: 100 };
    for (let k = 0; k < 90; k++) at = f.track(100, 100, 1 / 60, false, clear) ?? at;
    expect(at.x).toBe(100);
  });

  test("a figure off the screen is brought into sight even standing still", () => {
    const f = new Follow();
    f.track(100, 100, 0, false, clear);
    f.letGo();
    f.hold({ x: 600, y: 100 });
    let at = { x: 600, y: 100 };
    for (let k = 0; k < 40; k++) at = f.track(100, 100, 1 / 60, false, clear) ?? at;
    expect(Math.abs(at.x - 100)).toBeLessThan(clear.w / 2);
  });
});
