import { beforeEach, describe, expect, test } from "bun:test";

import { HOP, hop, makeActor, stepActor } from "./actors.ts";
import { G, show } from "./game.ts";
import { makeGround } from "./grid.ts";
import { makeProp } from "./props.ts";
import type { Steer } from "./stage.ts";
import { type Door, makeTouch } from "./touch.ts";

const who = (name: string): { name: string; rank: string; level: number; voice: number } => ({
  name,
  rank: "",
  level: 1,
  voice: 1,
});
const me = makeActor(who("Tester"), null, 0, 0, true);
const friend = makeActor(who("Wrenly"), null, 200, 200);
const other = makeActor(who("Pipwick"), null, 206, 206);
const ground = makeGround(40, 30, () => 0);
// The counter is solid: walking on into it, the member stays at it.
ground.fill(11, 9, 13, 11, 1);
let used: string[] = [];
/** A way out at the east edge, with ground beyond it that is the way out too. */
const out: Door = {
  id: "out",
  name: "Out",
  stand: { x: 280, y: 120 },
  face: 2,
  prompt: { x: 280, y: 90 },
  reach: 20,
  box: { x: 285, y: 105, w: 30, h: 30 },
  use: () => used.push("out"),
};
/** A game behind a counter: using it opens its card, walking on into it goes in. */
const game: Door = {
  id: "game",
  name: "Game",
  stand: { x: 100, y: 100 },
  face: 3,
  prompt: { x: 100, y: 60 },
  reach: 20,
  use: () => used.push("card"),
  enter: () => used.push("in"),
};
const counter = makeProp("counter", null, 100, 92, {
  hit: { x: 90, y: 72, w: 20, h: 20 },
  place: "game",
  tap: () => used.push("ring"),
});
const touch = makeTouch({
  ground,
  doors: () => [out, game],
  people: () => [me, friend, other],
  greet: (a) => used.push(`hello ${a.who.name}`),
  own: () => false,
  ownAt: () => null,
  props: () => [counter],
  sky: (_x, y) => y < 10,
  awake: () => true,
  halt: () => {
    me.path = [];
    me.arrive = null;
  },
});

/** Time passing, with the member steered that way or left to walk. */
function run(seconds: number, dx = 0, dy = 0): void {
  const steer: Steer | null = dx === 0 && dy === 0 ? null : { dx, dy, toward: null };
  for (let t = 0; t < seconds; t += 1 / 30) {
    stepActor(me, 1 / 30, ground);
    touch.step(1 / 30, steer);
  }
}
/** The member standing at a door with its prompt up, written where `draw.ts` would write it. */
function at(d: Door): void {
  me.x = d.stand.x;
  me.y = d.stand.y;
  run(0.5);
  show.sign = { x: d.prompt.x - 15, y: d.prompt.y, w: 30, h: 8 };
}

beforeEach(() => {
  G.player = me;
  G.panel = null;
  used = [];
  me.x = 160;
  me.y = 160;
  me.path = [];
  show.promptT = 0;
  show.sign = null;
});

describe("what a touch means", () => {
  test("a touch on the prompt uses its door, and nothing under it is touched or walked to", () => {
    at(out);
    expect(show.prompt).toBe(out);
    friend.x = 280;
    friend.y = 100;
    expect(touch.tap(280, 94, true)).toBe(false);
    expect(used).toEqual(["out"]);
    expect(me.path).toEqual([]);
    friend.x = 200;
    friend.y = 200;
  });

  test("a touch on the door's own ground walks the member up to it, and then uses it", () => {
    expect(touch.tap(300, 120, true)).toBe(false);
    expect(used).toEqual([]);
    expect(me.path.length).toBeGreaterThan(0);
    run(3);
    expect(used).toEqual(["out"]);
    expect(Math.round(me.x)).toBe(280);
  });

  test("a touch on a thing that is part of a door: the thing answers, and the member goes there", () => {
    touch.tap(100, 80, false);
    expect(used).toEqual(["ring"]);
    run(3);
    expect(used).toEqual(["ring", "card"]);
    // Standing at it, the same touch uses it at once.
    touch.tap(92, 75, false);
    expect(used).toEqual(["ring", "card", "ring", "card"]);
  });

  test("walking on into a door for a moment goes through it; walking past it does not", () => {
    at(out);
    run(0.2, 0, 1);
    run(0.2, 1, 0);
    expect(used).toEqual([]);
    // On past the stand and out over the door's own ground, it is still walking into it.
    run(0.4, 1, 0);
    expect(used).toEqual(["out"]);
    // A game's door goes further than its prompt: in, not its card.
    at(game);
    run(0.4, 0.3, -1);
    expect(used).toEqual(["out", "in"]);
  });

  test("the key uses the door whose prompt is up, and only while it is", () => {
    at(game);
    touch.act();
    expect(used).toEqual(["card"]);
    me.x = 160;
    run(1);
    touch.act();
    expect(used).toEqual(["card"]);
    expect(me.hop).toBeGreaterThan(0);
  });

  test("with a panel open no prompt is up, so a touch where it was is a touch on the ground", () => {
    G.panel = "game";
    at(out);
    expect(show.promptT).toBe(0);
    G.panel = null;
    expect(touch.tap(280, 94, true)).toBe(true);
    expect(used).toEqual([]);
  });

  test("a touch on somebody greets them, on the sky is the sky's, and on bare ground walks there", () => {
    expect(touch.tap(200, 195, true)).toBe(false);
    expect(touch.tap(150, 5, true)).toBe(false);
    expect(used).toEqual(["hello Wrenly"]);
    expect(touch.tap(60, 200, true)).toBe(true);
    expect(show.dest).toEqual({ x: 60, y: 200 });
  });

  test("of two figures a touch is on, it means the one whose middle is nearest, in front or behind", () => {
    // Pipwick stands in front of Wrenly and 6 across; both touches are on both of them.
    touch.tap(201, 188, false);
    touch.tap(205, 198, false);
    expect(used).toEqual(["hello Wrenly", "hello Pipwick"]);
  });

  test("a finger is on a figure from 10 across, the mouse from 7; further off, the member walks there", () => {
    expect(touch.tap(191, 190, false)).toBe(true);
    expect(touch.tap(191, 190, true)).toBe(false);
    expect(used).toEqual(["hello Wrenly"]);
    expect(touch.tap(189, 190, true)).toBe(true);
    expect(show.dest).toEqual({ x: 189, y: 190 });
  });

  test("somebody behind a thing is touched before the thing in front of them", () => {
    friend.x = 100;
    friend.y = 90;
    touch.tap(100, 80, false);
    expect(used).toEqual(["hello Wrenly"]);
    friend.x = 200;
    friend.y = 200;
  });
});

/** How long somebody keeps hopping once nothing more is asked of them, in seconds. */
const hopsOn = (a: typeof me): number => {
  let t = 0;
  while ((a.hop > 0 || a.hops > 0) && t < 60) {
    stepActor(a, 0.05, ground);
    t += 0.05;
  }
  return t;
};

describe("a hop", () => {
  test("is not saved up: asked a hundred times while hopping, somebody hops once and stops", () => {
    const a = makeActor(who("Hopper"), null, 100, 100);
    for (let k = 0; k < 100; k++) hop(a);
    expect(hopsOn(a)).toBeLessThanOrEqual(HOP + 0.1);
  });

  test("three in a row are three, and asking for one more meanwhile adds none", () => {
    const a = makeActor(who("Hopper"), null, 100, 100);
    hop(a, 3);
    hop(a);
    const t = hopsOn(a);
    expect(t).toBeGreaterThan(HOP * 2);
    expect(t).toBeLessThan(HOP * 4);
  });
});
