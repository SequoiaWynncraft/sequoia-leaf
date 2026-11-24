import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";

import { restart, start } from "@sequoia-leaf/kit/live.ts";
import { forgetLedger } from "@sequoia-leaf/kit/purse.ts";
import { HELLO, type Standin, standin, TESTER } from "@sequoia-leaf/kit/standin.ts";
import { dozing, HOME, SITS_AFTER } from "@sequoia-leaf/town/clock.ts";
import { TOWN } from "@sequoia-leaf/town/map/map.ts";

import { HOP, hop, makeActor, peopleOn, seatFree, sit, stop, walkToSeat } from "./actors.ts";
import type * as Events from "./events.ts";
import { type Actor, G, SEATS } from "./game.ts";
import type * as Guild from "./guild.ts";
import type { Moment, Rester, Visitor } from "./guild.ts";
import { prepare, unprepare } from "./live.ts";
import type * as Visitors from "./visitors.ts";

/** Noon, by Leaf's clock. */
const T0 = Date.UTC(2026, 10, 25, 12);

/** The town's members as the page draws them, with the guild saying what a test has it say. */
let world: Standin | null = null;
let town: { guild: typeof Guild.guild; visitors: typeof Visitors; events: typeof Events } | null = null;
let visiting: Visitor[] = [];
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
  guild.visitors = () => visiting;
  guild.resting = () => resting;
  guild.deeds = () => ({ moments, day: { from: 0, party: 0, war: 0 } });
  town = { guild, visitors: await import("./visitors.ts"), events: await import("./events.ts") };
  town.visitors.followLive({ ids: () => live, actor: () => null });
  // Whoever is drawn stands on the town's ground, for whether a seat is free.
  peopleOn(TOWN, () => G.visitors);
});

afterAll(() => {
  world?.done();
  restart();
  forgetLedger();
  unprepare();
  Object.assign(globalThis, { document: undefined, Image: undefined, HTMLImageElement: undefined });
});

/** How long a fade takes, in seconds, and a little more: one step that long puts a fade through. */
const FADED = 0.51;

beforeEach(() => {
  visiting = [];
  resting = [];
  moments = [];
  live = new Set();
  G.t = 100;
  G.now = T0;
  G.visitors = [];
  // Nobody sits anywhere, as far as the town's seats go.
  for (const s of SEATS) s.taken = false;
  // Whoever an earlier test drew fades out and is taken away.
  step(FADED);
});

/** A step of the town's members, `dt` seconds on, `awake` being whoever else may sit on its seats; then whoever is in the gateway fades. */
function step(dt = 0, awake: readonly Actor[] = []): void {
  G.t += dt;
  town?.visitors.stepVisitors(dt, awake);
  town?.events.stepEvents();
}
const figure = (id: string): Actor => {
  const a = town?.visitors.drawnAs(id);
  if (!a) throw new Error(`${id} is not drawn`);
  return a;
};
/** Somebody gone `ago` milliseconds, or since `seen`, who stays. */
const rester = (id: string, at: Rester["at"], ago: number, seen = G.now - ago): Rester => ({
  id,
  name: id,
  rank: null,
  at,
  skin: "",
  seen,
  stays: true,
});
/** So many people, each named for what they do and their number. */
const names = (n: number, what: string): string[] => Array.from({ length: n }, (_, i) => `${what}${i}`);
/** Somebody busy at one of the games, who last did something `ago` milliseconds back. */
const visitor = (id: string, at: Visitor["at"], ago = 0): Visitor => ({
  id,
  name: id,
  rank: null,
  at,
  skin: "",
  acted: G.now - ago,
});

describe("members dozing", () => {
  test("somebody last seen about the town fades in on their seat, sitting already, as a page opens", () => {
    resting = [rester("Fernhollow", "town", 3 * 3_600_000)];
    step();
    const a = figure("Fernhollow");
    const seat = dozing(resting, SEATS).get("Fernhollow");
    expect(seat).toBeDefined();
    expect(a.seat).toBe(seat ?? null);
    expect([a.x, a.y, a.dir]).toEqual([seat?.from.x ?? 0, seat?.from.y ?? 0, seat?.dir ?? 0]);
    expect(a.alpha).toBe(0);
    step(FADED / 2);
    expect(a.alpha).toBeGreaterThan(0.4);
    step(FADED / 2);
    expect(a.alpha).toBe(1);
    // Sitting already, not seen to sit down.
    expect(G.t - a.sat).toBeGreaterThan(1);
    expect(a.dozing).toBe(T0 - 3 * 3_600_000);
  });

  test("nobody awake sits down where somebody dozes, and a member sitting down on another seat moves no dozer", () => {
    resting = [rester("Fernhollow", "works", SITS_AFTER + 600_000)];
    step(FADED);
    const theirs = figure("Fernhollow").seat;
    if (!theirs) throw new Error("not on a seat");
    const me = makeActor({ name: "Tester", rank: "", level: 1, voice: 1 }, null, theirs.from.x, theirs.from.y, true);
    expect(seatFree(theirs, me)).toBe(false);
    const other = SEATS.find((s) => s !== theirs && !s.yours && seatFree(s, me));
    if (!other) throw new Error("no other seat");
    sit(me, other);
    for (let i = 0; i < 10; i++) step(0.1, [me]);
    expect(figure("Fernhollow").seat).toBe(theirs);
    expect(figure("Fernhollow").alpha).toBe(1);
  });

  test("a seat the member has set off for is not given to somebody to doze on meanwhile", () => {
    resting = [rester("Fernhollow", "town", 3_600_000)];
    const wanted = dozing(resting, SEATS).get("Fernhollow");
    if (!wanted) throw new Error("no seat");
    const me = makeActor({ name: "Tester", rank: "", level: 1, voice: 1 }, null, 256, 170, true);
    walkToSeat(me, wanted);
    step(FADED, [me]);
    expect(figure("Fernhollow").seat).not.toBe(wanted);
    stop(me);
    expect(wanted.taken).toBe(false);
  });

  test("somebody gone from the Works stands in their spot, then fades out there and in on their seat", () => {
    visiting = [visitor("Quillon", "works")];
    step(FADED);
    const at = [figure("Quillon").x, figure("Quillon").y];
    visiting = [];
    resting = [rester("Quillon", "works", 0)];
    G.now = T0 + SITS_AFTER - 100;
    step(0.05);
    expect([figure("Quillon").x, figure("Quillon").y, figure("Quillon").alpha]).toEqual([...at, 1]);
    G.now = T0 + SITS_AFTER;
    step(FADED / 2);
    expect([figure("Quillon").x, figure("Quillon").y]).toEqual(at);
    expect(figure("Quillon").alpha).toBeLessThan(0.6);
    step(FADED / 2);
    const seat = figure("Quillon").seat;
    if (!seat) throw new Error("not on a seat");
    // A seat for somebody from the Works: by its bench, by the fire, or on the garden bench.
    expect(["works", "fire", "bench"]).toContain(seat.at);
    expect([figure("Quillon").x, figure("Quillon").y, figure("Quillon").alpha]).toEqual([seat.from.x, seat.from.y, 0]);
    step(FADED);
    expect(figure("Quillon").alpha).toBe(1);
  });

  test("somebody gone who has no seat fades out in their spot and is gone", () => {
    // Every seat a dozer may have is taken by somebody gone longer.
    resting = SEATS.filter((s) => !s.yours).map((_, i) => rester(`Sleeper${i}`, "town", 3_600_000 + i));
    resting.push(rester("Quillon", "grove", SITS_AFTER - 1000));
    step(FADED);
    expect(figure("Quillon").alpha).toBe(1);
    G.now += 1000;
    step(FADED);
    expect(town?.visitors.drawnAs("Quillon")).toBeNull();
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
  test("nobody of it is drawn for it, and whoever of it is busy at the Works stays at their spot", () => {
    const who = ["Alderwick", "Sedgewren", "Mossling", "Brackenby"].map((id) => ({ id, name: id, you: false }));
    moments = [{ kind: "party", what: "Nest of the Grootslangs", who, happened: T0 - 40_000, at: T0 }];
    visiting = [visitor("Alderwick", "works")];
    step(FADED);
    const at = [figure("Alderwick").x, figure("Alderwick").y];
    for (let now = T0; now <= T0 + HOME.over; now += 100) {
      G.now = now;
      step(0.1);
      for (const p of who.slice(1)) expect(town?.visitors.drawnAs(p.id)).toBeNull();
      expect([figure("Alderwick").x, figure("Alderwick").y]).toEqual(at);
    }
  });
});

describe("nobody drawn here walks", () => {
  test("over ten minutes of a crowd coming and going, nobody moves while they can be seen, and nobody is drawn who is nowhere", () => {
    const works = names(8, "Smith");
    const table = names(5, "Player");
    const grove = names(3, "Seeker");
    const sleepers = names(14, "Sleeper");
    const party = ["Wanderer0", "Wanderer1", "Wanderer2", works[0] ?? ""];
    /** Who has left the Works, and when Leaf last saw them. */
    const left = new Map<string, number>();
    const me = makeActor({ name: "Tester", rank: "", level: 1, voice: 1 }, null, 0, 0, true);
    const was = new Map<Actor, { x: number; y: number; alpha: number }>();
    for (let k = 0; k <= 6000; k++) {
      const now = T0 + k * 100;
      G.now = now;
      const s = k / 10;
      // One of the Works, in two pages at once, is in the town's room for ten seconds in every twenty.
      live = new Set(s % 20 >= 10 ? [works[1] ?? ""] : []);
      // Three leave the Works a minute in, and two more at four minutes.
      if (k === 600) for (const id of works.slice(5)) left.set(id, now);
      if (k === 2400) for (const id of works.slice(3, 5)) left.set(id, now);
      visiting = [
        ...works.filter((id) => !left.has(id)).map((id, i) => visitor(id, "works", i % 3 === 0 ? 600_000 : 0)),
        ...table.map((id, i) => visitor(id, "table", i === 2 ? 600_000 : 0)),
        ...grove.map((id) => visitor(id, "grove")),
      ];
      // Sleepers gone for hours, more than there are seats; the one gone longest leaves Leaf's list at five minutes.
      const asleep = s < 300 ? sleepers : sleepers.slice(1);
      resting = [
        ...asleep.map((id, i) => rester(id, "town", 0, T0 - 20 * 3_600_000 + i * 60_000)),
        ...[...left].map(([id, seen]) => rester(id, "works", 0, seen)),
      ];
      // A raid party is home at two minutes.
      moments = [
        {
          kind: "party",
          what: "The Canyon Colossus",
          who: party.map((id) => ({ id, name: id, you: false })),
          happened: T0,
          at: T0 + 120_000,
        },
      ];
      // The member sits on a free seat at 150 seconds and gets up at 250.
      if (k === 1500) {
        const free = SEATS.find((seat) => !seat.yours && seatFree(seat, me));
        if (free) sit(me, free);
      }
      if (k === 2500) stop(me);
      step(0.1, me.seat ? [me] : []);

      for (const a of G.visitors) {
        expect(a.moving).toBe(false);
        const before = was.get(a);
        if (before && before.alpha > 0 && a.alpha > 0) expect([a.x, a.y]).toEqual([before.x, before.y]);
        was.set(a, { x: a.x, y: a.y, alpha: a.alpha });
      }
      for (const id of party.slice(0, 3)) expect(town?.visitors.drawnAs(id)).toBeNull();
    }
    // In the end, everybody busy is at their spot (but the one in two pages, back from the room just now), and every seat for dozers has a dozer on it.
    const shown = town?.visitors.members() ?? [];
    for (const id of [works[0] ?? "", works[2] ?? "", ...table, ...grove])
      expect(shown.find((m) => m.name === id)).toMatchObject({ alpha: 1, walking: false });
    // The stump's log is for those from the table, and nobody here left it.
    const dozers = shown.filter((m) => m.dozing);
    expect(dozers.length).toBe(SEATS.filter((seat) => !seat.yours && seat.at !== "table").length);
    expect(dozers.every((m) => m.alpha === 1)).toBe(true);
  });
});
