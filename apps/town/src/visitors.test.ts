import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";

import { restart, start } from "@sequoia-leaf/kit/live.ts";
import { forgetLedger } from "@sequoia-leaf/kit/purse.ts";
import { HELLO, type Standin, standin, TESTER } from "@sequoia-leaf/kit/standin.ts";
import { dozing, HOME, homecoming, SITS_AFTER } from "@sequoia-leaf/town/clock.ts";

import { HOP, hop, makeActor, walkAt } from "./actors.ts";
import type * as Events from "./events.ts";
import { type Actor, G, SEED } from "./game.ts";
import type * as Guild from "./guild.ts";
import type { Moment, Rester } from "./guild.ts";
import { prepare, unprepare } from "./live.ts";
import type * as Visitors from "./visitors.ts";
import { SEATS } from "./world.ts";

/** Noon, by Leaf's clock. */
const T0 = Date.UTC(2026, 10, 25, 12);

/** The town's members as the page draws them, with the guild saying what a test has it say. */
let world: Standin | null = null;
let town: { guild: typeof Guild.guild; visitors: typeof Visitors; events: typeof Events } | null = null;
let resting: Rester[] = [];
let moments: Moment[] = [];
let live = new Set<string>();

beforeAll(async () => {
  // No page here: a canvas that takes any drawing and gives back blank pixels, and a picture that never loads.
  const pen: object = new Proxy(
    {},
    {
      get: (_, name) =>
        name === "getImageData"
          ? (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) })
          : () => undefined,
      set: () => true,
    },
  );
  class Picture {
    src = "";
    addEventListener(): void {}
  }
  Object.assign(globalThis, {
    document: { createElement: () => ({ width: 1, height: 1, getContext: () => pen }) },
    Image: Picture,
    HTMLImageElement: Picture,
  });
  world = standin({
    "GET /v1/game/hello": HELLO,
    "GET /v1/game/me": { status: 200, body: TESTER },
    "GET /v1/me/quests": { status: 200, body: { quests: [], recently_completed: [] } },
    "GET /v1/me/events": { status: 200, body: { events: [] } },
  });
  await start();
  expect(await prepare(null)).toBe(true);
  const { guild } = await import("./guild.ts");
  guild.visitors = () => [];
  guild.resting = () => resting;
  guild.deeds = () => ({ moments, day: { from: 0, party: 0, war: 0 } });
  town = { guild, visitors: await import("./visitors.ts"), events: await import("./events.ts") };
  town.visitors.followLive({ ids: () => live, actor: () => null });
});

afterAll(() => {
  world?.done();
  restart();
  forgetLedger();
  unprepare();
  Object.assign(globalThis, { document: undefined, Image: undefined, HTMLImageElement: undefined });
});

beforeEach(() => {
  resting = [];
  moments = [];
  live = new Set();
  G.t = 100;
  G.now = T0;
  G.visitors = [];
  // Whoever an earlier test drew is taken away.
  step();
});

/** A step of the town's members, `awake` being whoever else may sit on its seats; then whoever is in the gateway fades. */
function step(dt = 0, awake: readonly Actor[] = []): void {
  town?.visitors.stepVisitors(dt, awake);
  town?.events.stepEvents();
}
const figure = (id: string): Actor => {
  const a = town?.visitors.drawnAs(id);
  if (!a) throw new Error(`${id} is not drawn`);
  return a;
};
const whereIs = (id: string): [number, number] => [figure(id).x, figure(id).y];
/** Somebody gone `ago` milliseconds, who stays. */
const rester = (id: string, at: Rester["at"], ago: number): Rester => ({
  id,
  name: id,
  rank: null,
  at,
  skin: "",
  seen: T0 - ago,
  stays: true,
});

describe("members dozing", () => {
  test("somebody last seen about the town is on their seat, and seen, from the first frame of a page that opens", () => {
    resting = [rester("Fernhollow", "town", 3 * 3_600_000)];
    step();
    const a = figure("Fernhollow");
    const seat = dozing(resting, SEATS).get("Fernhollow");
    expect(seat).toBeDefined();
    expect(a.seat).toBe(seat ?? null);
    expect([a.x, a.y, a.dir]).toEqual([seat?.from.x ?? 0, seat?.from.y ?? 0, seat?.dir ?? 0]);
    expect(a.alpha).toBe(1);
    // Sitting already, not seen to sit down.
    expect(G.t - a.sat).toBeGreaterThan(1);
    expect(a.dozing).toBe(T0 - 3 * 3_600_000);
  });

  test("a member sitting down on the seat somebody dozes on has it, and the dozer is on the next seat in its order", () => {
    resting = [rester("Fernhollow", "works", SITS_AFTER + 600_000)];
    step();
    const first = figure("Fernhollow").seat;
    if (!first) throw new Error("not on a seat");
    const me = makeActor({ name: "Tester", rank: "", level: 1, voice: 1 }, null, first.from.x, first.from.y, true);
    me.seat = first;
    step(0, [me]);
    const next = dozing(
      resting,
      SEATS.filter((s) => s !== first),
    ).get("Fernhollow");
    expect(next).toBeDefined();
    expect(figure("Fernhollow").seat).toBe(next ?? null);
    // And back, once the member gets up.
    step();
    expect(figure("Fernhollow").seat).toBe(first);
  });
});

describe("hops", () => {
  test("a hop on somebody the clock puts where they are runs and is over", () => {
    resting = [rester("Quillon", "works", 60_000)];
    step();
    const a = figure("Quillon");
    hop(a, 2);
    expect(a.hop).toBe(HOP);
    step(0.1);
    expect(a.hop).toBeCloseTo(HOP - 0.1);
    for (let i = 0; i < 10; i++) step(0.1);
    expect([a.hop > 0, a.hops]).toEqual([false, 0]);
  });
});

describe("a raid party home", () => {
  test("each keeps one place in it from its start to its end, whoever else of it can walk or not", () => {
    const who = ["Alderwick", "Sedgewren", "Mossling"].map((id) => ({ id, name: id, you: false }));
    moments = [{ kind: "party", what: "Nest of the Grootslangs", who, happened: T0 - 40_000, at: T0 }];
    /** Where the walk of the party's `i`th place has somebody at this moment. */
    const placeOf = (i: number): [number, number] => {
      const walk = homecoming(SEED, T0, i, G.now);
      if (!walk) throw new Error("the walk is over");
      const p = walkAt(walk, 32, G.now);
      return [p.x, p.y];
    };
    // The first of them is in town, live: nobody walks in their place.
    live = new Set(["Alderwick"]);
    G.now = T0 + HOME.part + 2000;
    step();
    expect(town?.visitors.drawnAs("Alderwick")).toBeNull();
    expect(whereIs("Sedgewren")).toEqual(placeOf(1));
    expect(whereIs("Mossling")).toEqual(placeOf(2));
    // They leave the town's room part-way through: the others walk on as they were, and they are in their own place.
    live = new Set();
    G.now += 1000;
    step();
    expect(whereIs("Alderwick")).toEqual(placeOf(0));
    expect(whereIs("Sedgewren")).toEqual(placeOf(1));
    expect(whereIs("Mossling")).toEqual(placeOf(2));
    expect(placeOf(0)).not.toEqual(placeOf(1));
  });
});
