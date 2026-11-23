import { afterEach, describe, expect, test } from "bun:test";

import { restart, start } from "./live.ts";
import { isRecord } from "./net.ts";
import {
  askAgain,
  forgetPresence,
  hearPresent,
  here,
  inRoom,
  type Present,
  readPresent,
  readResting,
  stay,
} from "./presence.ts";
import { forgetLedger } from "./purse.ts";
import { HELLO, type Standin, standin, TESTER } from "./standin.ts";

/** What Leaf's game routes really answer, from the contract its own tests write. */
const GAME: unknown = await Bun.file(new URL("../../../contracts/leaf-game-v1.json", import.meta.url)).json();

describe("who is here", () => {
  test("reads what Leaf really answers: who is here, and who is resting", () => {
    const r = isRecord(GAME) ? GAME["PUT /v1/game/presence"] : null;
    expect(readPresent(isRecord(r) ? r.body : null)).toEqual([
      {
        id: "10000000-0000-0000-0000-000000000001",
        name: "Alice",
        place: "town",
        rank: null,
        guest: false,
        seen: Date.UTC(2026, 10, 25, 12, 55),
        acted: null,
      },
      {
        id: "10000000-0000-0000-0000-000000000003",
        name: "Visitor",
        place: "town",
        rank: null,
        guest: true,
        seen: Date.UTC(2026, 10, 25, 12, 55),
        acted: null,
      },
    ]);
    expect(readResting(isRecord(r) ? r.body : null)).toEqual([
      {
        id: "10000000-0000-0000-0000-000000000002",
        name: "Bob",
        place: "works",
        seen: Date.UTC(2026, 10, 25, 12, 40),
        guest: false,
      },
    ]);
  });

  test("leaves out anybody resting who makes no sense", () => {
    expect(
      readResting({
        resting: [
          { id: "a", username: "Alice", place: "table", seen_at: "2026-11-25T10:00:00.000Z" },
          { id: "b", username: "Bob", place: "town", seen_at: "yesterday-ish" },
          { id: "c", username: "Cleo", place: "the moon", seen_at: "2026-11-25T10:00:00.000Z" },
          { id: "d", username: "Dan", place: "town" },
        ],
      }),
    ).toEqual([{ id: "a", name: "Alice", place: "table", seen: Date.UTC(2026, 10, 25, 10), guest: false }]);
    expect(readResting({ present: [] })).toEqual([]);
    // Those whose characters do not stay come in a list of their own, read the same way.
    expect(
      readResting({ gone: [{ id: "z", username: "Zed", place: "town", seen_at: "2026-11-25T10:00:00.000Z" }] }, "gone"),
    ).toEqual([{ id: "z", name: "Zed", place: "town", seen: Date.UTC(2026, 10, 25, 10), guest: false }]);
  });

  test("leaves out anybody who makes no sense", () => {
    expect(
      readPresent({
        present: [
          { id: "a", username: "Alice", place: "works", rank: "chief" },
          { id: "b", username: "Bob", place: "the moon" },
          { id: 3, username: "Cleo", place: "town" },
          "nobody",
        ],
      }),
    ).toEqual([{ id: "a", name: "Alice", place: "works", rank: "chief", guest: false, seen: null, acted: null }]);
    expect(readPresent(null)).toEqual([]);
  });
});

const said = (w: Standin) => w.sent.filter((s) => s.path === "/v1/game/presence").map((s) => s.body);

describe("staying in town after going", () => {
  let world: Standin | null = null;
  afterEach(() => {
    forgetPresence();
    world?.done();
    world = null;
    restart();
    forgetLedger();
  });

  const routes = {
    "GET /v1/game/hello": HELLO,
    "GET /v1/game/me": { status: 200, body: TESTER },
    "PUT /v1/game/presence": { status: 200, body: { present: [], resting: [] } },
  };

  test("a page the town has not told says nothing of it, and Leaf keeps what it had", async () => {
    world = standin(routes);
    await start();
    here("works");
    await Bun.sleep(10);
    expect(said(world)).toEqual([{ place: "works", device: "desktop" }]);
  });

  test("the town's page says it as Leaf's town has it, at once when it changes, and with each saying after", async () => {
    world = standin(routes);
    await start();
    stay(false);
    here("town");
    await Bun.sleep(10);
    stay(false);
    stay(true);
    await Bun.sleep(10);
    expect(said(world)).toEqual([
      { place: "town", stay: false, device: "desktop" },
      { place: "town", stay: true, device: "desktop" },
    ]);
  });
});

/** Leaf's answer with Alice alone, at `place`. */
const aliceAt = (place: string) => ({
  status: 200,
  body: {
    present: [
      { id: "a", username: "Alice", place, seen_at: "2026-11-25T10:00:00.000Z", acted_at: "2026-11-25T09:58:00.000Z" },
    ],
    resting: [],
  },
});

describe("saying where the member is", () => {
  let world: Standin | null = null;
  afterEach(() => {
    forgetPresence();
    world?.done();
    world = null;
    restart();
    forgetLedger();
  });

  const routes = {
    "GET /v1/game/hello": HELLO,
    "GET /v1/game/me": { status: 200, body: TESTER },
    "PUT /v1/game/presence": { status: 200, body: { present: [], resting: [] } },
    "GET /v1/game/presence": { status: 200, body: { present: [], resting: [] } },
  };

  test("says the page is a phone's when its window was under 700 CSS pixels wide at sign-in", async () => {
    world = standin(routes, { width: 390 });
    await start();
    here("camp");
    await Bun.sleep(10);

    expect(world.sent.filter((s) => s.path === "/v1/game/presence").map((s) => [s.method, s.body])).toEqual([
      ["PUT", { place: "camp", device: "phone" }],
    ]);
  });

  test("in a live room of the place, only asks who is about, but still tells a change of staying", async () => {
    world = standin(routes);
    await start();
    inRoom("town");
    here("town");
    await Bun.sleep(10);
    stay(false);
    await Bun.sleep(10);
    // Out of the room, for the camp: said, as before.
    inRoom(null);
    here("camp");
    await Bun.sleep(10);

    expect(world.sent.filter((s) => s.path === "/v1/game/presence").map((s) => [s.method, s.body])).toEqual([
      ["GET", null],
      ["PUT", { place: "town", stay: false, device: "desktop" }],
      ["PUT", { place: "camp", stay: false, device: "desktop" }],
    ]);
  });

  test("takes Leaf's answers in the order they were asked for: one that comes after a later one is dropped", async () => {
    let calls = 0;
    world = standin({
      ...routes,
      // The first answer is slow, and says what was so before the second was asked.
      "GET /v1/game/presence": async () => {
        calls++;
        if (calls === 1) {
          await Bun.sleep(30);
          return aliceAt("town");
        }
        return aliceAt("works");
      },
    });
    await start();
    const heard: (readonly Present[])[] = [];
    const stop = hearPresent((present) => heard.push(present));
    inRoom("town");
    here("town");
    askAgain();
    await Bun.sleep(60);
    stop();

    expect(heard.map((p) => p.map((m) => m.place))).toEqual([["works"]]);
    expect([heard[0]?.[0]?.seen, heard[0]?.[0]?.acted]).toEqual([
      Date.UTC(2026, 10, 25, 10),
      Date.UTC(2026, 10, 25, 9, 58),
    ]);
  });
});
