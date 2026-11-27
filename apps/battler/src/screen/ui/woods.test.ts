import { afterEach, describe, expect, jest, test } from "bun:test";

import { restart, start } from "@sequoia-leaf/kit/live.ts";
import { HELLO, type Reply, type Standin, standin, TESTER } from "@sequoia-leaf/kit/standin.ts";
import { newAlmanac } from "@sequoia-leaf/raid";

import { type At, THE_DEEP_WOODS } from "./modes.ts";
import { frontShown, READ_EVERY_MS, readTaken, readWoods, seenKey, whileShown, woodsAway } from "./woods.ts";

let world: Standin | null = null;
afterEach(() => {
  frontShown(false);
  jest.useRealTimers();
  woodsAway();
  world?.done();
  world = null;
  restart();
});

/** A room of the Deep Woods (from 0) taken from the member, as their events give it. */
const taken = (id: number, room: number, by: string): unknown => ({
  id,
  type: "held_taken",
  created_at: "2026-11-26T12:00:00Z",
  data: { game: "raid", slot: `deep:${room}`, by: { id: `id-${by}`, username: by } },
});
const at: At = {
  run: null,
  endless: null,
  almanac: newAlmanac(),
  trail: 0,
  own: false,
  standings: null,
  week: { at: 0, deepest: { wilds: 0, deep: 0 } },
  apart: { deepest: { wilds: 0, deep: 0 }, week: { at: 0, deepest: { wilds: 0, deep: 0 } } },
  depths: new Map(),
  span: "ever",
};
/** Lets every answer on its way land. */
async function landed(): Promise<void> {
  // oxlint-disable-next-line no-await-in-loop -- one turn of the microtasks at a time
  for (let i = 0; i < 40; i++) await Promise.resolve();
}
/** The paths the page asked Leaf for, without the sign-in. */
const asked = (): string[] => (world?.sent ?? []).map((s) => s.path).filter((p) => !p.startsWith("/v1/game/me"));

describe("the news of a room taken", () => {
  test("is each member's own: a second member on the same browser still hears theirs, and each hears it once", async () => {
    const events: Record<string, unknown> = { a: { events: [taken(7, 21, "Mossling")] } };
    const whose = { now: "a" };
    world = standin({ "GET /v1/me/events": (): Reply => ({ status: 200, body: events[whose.now] }) });
    const drawn: string[] = [];
    await readTaken("member-a", () => drawn.push("a"));
    // Member b's only news is older than a's newest: kept under one name for the browser, it was never said.
    events.b = { events: [taken(3, 24, "Birchwood")] };
    whose.now = "b";
    woodsAway();
    await readTaken("member-b", () => drawn.push("b"));
    expect(drawn).toEqual(["a", "b"]);
    expect([world.store.map.get(seenKey("member-a")), world.store.map.get(seenKey("member-b"))]).toEqual(["7", "3"]);
    // Read again, each from their own newest: nothing more is said.
    woodsAway();
    whose.now = "a";
    await readTaken("member-a", () => drawn.push("a"));
    whose.now = "b";
    await readTaken("member-b", () => drawn.push("b"));
    expect(drawn).toEqual(["a", "b"]);
    expect(asked()).toEqual(["/v1/me/events", "/v1/me/events", "/v1/me/events?after=7", "/v1/me/events?after=3"]);
  });
});

describe("the front page's minute", () => {
  test("starts once while the page is shown, stops when it goes, and starts again when it is back", () => {
    const started: number[] = [];
    const stopped: number[] = [];
    const ticks: (() => void)[] = [];
    const shown = whileShown(
      (ms, tick) => {
        started.push(ms);
        ticks.push(tick);
        return () => stopped.push(ms);
      },
      () => started.push(0),
    );
    shown(true);
    shown(true);
    expect([started, stopped]).toEqual([[READ_EVERY_MS], []]);
    ticks[0]?.();
    expect(started).toEqual([READ_EVERY_MS, 0]);
    shown(false);
    shown(false);
    expect(stopped).toEqual([READ_EVERY_MS]);
    shown(true);
    expect(started).toEqual([READ_EVERY_MS, 0, READ_EVERY_MS]);
  });

  test("while the front page is up, the news, the rooms held and the board are read again each minute, drawn again only when they change", async () => {
    jest.useFakeTimers();
    const held = { rooms: [22] };
    const board = { top: [{ place: 1, id: "x", name: "Birchwood", room: 25, at: "x", you: false }], you: null };
    world = standin({
      "GET /v1/game/hello": HELLO,
      "GET /v1/game/me": { status: 200, body: TESTER },
      "GET /v1/me/events": { status: 200, body: { events: [taken(9, 21, "Mossling")] } },
      "GET /v1/game/raid/held": () => ({ status: 200, body: { rooms: held.rooms } }),
      "GET /v1/game/raid/depths/deep/week": { status: 200, body: board },
    });
    await start();
    const drawn: number[] = [];
    readWoods(THE_DEEP_WOODS, at, () => drawn.push(1));
    frontShown(true);
    await landed();
    // As it is drawn: the news, the rooms held and the board, each new.
    expect(drawn).toHaveLength(3);
    const first = asked().length;
    // A minute on, all of it is asked for again; nothing changed, so nothing is drawn.
    jest.advanceTimersByTime(READ_EVERY_MS);
    await landed();
    expect(asked().slice(first).toSorted()).toEqual([
      "/v1/game/raid/depths/deep/week",
      "/v1/game/raid/held",
      `/v1/me/events?after=9`,
    ]);
    expect(drawn).toHaveLength(3);
    // Another minute, and a room held now: drawn again, once.
    held.rooms = [22, 25];
    jest.advanceTimersByTime(READ_EVERY_MS);
    await landed();
    expect(drawn).toHaveLength(4);
    // The front page has gone: nothing more is asked.
    frontShown(false);
    const before = asked().length;
    jest.advanceTimersByTime(READ_EVERY_MS * 3);
    await landed();
    expect(asked()).toHaveLength(before);
  });
});
