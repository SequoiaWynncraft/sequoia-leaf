import { afterEach, describe, expect, test } from "bun:test";

import { gameContract } from "../../../contracts/game.ts";
import { restart, start } from "./live.ts";
import { isRecord } from "./net.ts";
import {
  askAgain,
  askNow,
  forgetPresence,
  heardAbout,
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

/** A row of Leaf's lists for Alice, with these fields. */
const aliceRow = (fields: Record<string, unknown>) => ({
  id: "a",
  username: "Alice",
  live: false,
  since: "2026-11-25T09:30:00.000Z",
  seen_at: "2026-11-25T10:00:00.000Z",
  ...fields,
});

/** Bob's camp, as Leaf names it. */
const BOBS = { id: "10000000-0000-0000-0000-000000000002", name: "Bob" };

/** What Leaf's game routes really answer, from the contract its own tests write. */
const GAME: unknown = gameContract();

describe("who is here", () => {
  test("reads what Leaf really answers: who is here, and who is resting", () => {
    const r = isRecord(GAME) ? GAME["PUT /v1/game/presence"] : null;
    expect(readPresent(isRecord(r) ? r.body : null)).toEqual([
      {
        id: "10000000-0000-0000-0000-000000000001",
        name: "Alice",
        place: "town",
        camp: null,
        rank: null,
        guest: false,
        live: false,
        since: Date.UTC(2026, 10, 25, 12, 54, 30),
        acted: null,
      },
      {
        id: "10000000-0000-0000-0000-000000000003",
        name: "Visitor",
        place: "town",
        camp: null,
        rank: null,
        guest: true,
        live: false,
        since: Date.UTC(2026, 10, 25, 12, 55),
        acted: null,
      },
    ]);
    expect(readResting(isRecord(r) ? r.body : null)).toEqual([
      {
        id: "10000000-0000-0000-0000-000000000002",
        name: "Bob",
        place: "works",
        camp: null,
        seen: Date.UTC(2026, 10, 25, 12, 40),
        guest: false,
      },
    ]);
  });

  test("reads whose camp somebody is at, as Leaf really answers it", () => {
    const r = isRecord(GAME) ? GAME["PUT /v1/game/presence, visiting a camp"] : null;
    const body = isRecord(r) ? r.body : null;
    expect(readPresent(body).map((p) => [p.name, p.place, p.camp])).toEqual([
      ["Alice", "table", null],
      ["Visitor", "camp", BOBS],
    ]);
  });

  test("reads whose camp only at a camp, and only with its owner's id and name", () => {
    const camps = readPresent({
      present: [
        aliceRow({ place: "camp", camp_owner: "b", camp_owner_name: "Bob" }),
        aliceRow({ place: "town", camp_owner: "b", camp_owner_name: "Bob" }),
        aliceRow({ place: "camp", camp_owner: "b" }),
        aliceRow({ place: "camp", camp_owner: 7, camp_owner_name: "Bob" }),
        aliceRow({ place: "camp" }),
      ],
    }).map((p) => p.camp);
    expect(camps).toEqual([{ id: "b", name: "Bob" }, null, null, null, null]);
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
    ).toEqual([{ id: "a", name: "Alice", place: "table", camp: null, seen: Date.UTC(2026, 10, 25, 10), guest: false }]);
    expect(readResting({ present: [] })).toEqual([]);
    // Those whose characters do not stay come in a list of their own, read the same way.
    expect(
      readResting({ gone: [{ id: "z", username: "Zed", place: "town", seen_at: "2026-11-25T10:00:00.000Z" }] }, "gone"),
    ).toEqual([{ id: "z", name: "Zed", place: "town", camp: null, seen: Date.UTC(2026, 10, 25, 10), guest: false }]);
  });

  test("leaves out anybody who makes no sense", () => {
    expect(
      readPresent({
        present: [
          aliceRow({ place: "works", rank: "chief" }),
          aliceRow({ id: "b", username: "Bob", place: "the moon" }),
          aliceRow({ id: 3, username: "Cleo", place: "town" }),
          "nobody",
        ],
      }),
    ).toEqual([
      {
        id: "a",
        name: "Alice",
        place: "works",
        camp: null,
        rank: "chief",
        guest: false,
        live: false,
        since: Date.UTC(2026, 10, 25, 9, 30),
        acted: null,
      },
    ]);
    expect(readPresent(null)).toEqual([]);
  });

  test("reads a row of a Leaf from before it said since when, or whether a live room has them, as somebody there", () => {
    // What Leaf answered until it said them: for the moment of a deploy, a page may still be given it.
    const older = { id: "d", username: "Dan", place: "town", guest: false, seen_at: "2026-11-25T10:00:00.000Z" };
    expect(
      readPresent({
        present: [
          { ...older, acted_at: "2026-11-25T09:58:00.000Z" },
          { ...older, id: "e", username: "Eve", place: "works", acted_at: null },
          aliceRow({ id: "f", username: "Fay", place: "town", live: "yes", since: "a while" }),
        ],
      }).map((p) => [p.name, p.place, p.live, p.since, p.acted]),
    ).toEqual([
      ["Dan", "town", null, null, Date.UTC(2026, 10, 25, 9, 58)],
      ["Eve", "works", null, null, null],
      // Neither said in a way that can be read: not made up either.
      ["Fay", "town", null, null, null],
    ]);
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

  test("says whose camp at a camp, at once when it is another camp, and never anywhere else", async () => {
    world = standin(routes);
    await start();
    here("camp", "b");
    here("camp", "b");
    await Bun.sleep(10);
    here("camp", "c");
    await Bun.sleep(10);
    here("town", "c");
    await Bun.sleep(10);
    here("camp");
    await Bun.sleep(10);
    expect(said(world)).toEqual([
      { place: "camp", camp_owner: "b", device: "desktop" },
      { place: "camp", camp_owner: "c", device: "desktop" },
      { place: "town", device: "desktop" },
      { place: "camp", device: "desktop" },
    ]);
  });

  test("asks Leaf who is about at once when a page is to count from it, saying where the member is as ever", async () => {
    world = standin(routes);
    await start();
    here("camp", "b");
    await Bun.sleep(10);
    const heard: number[] = [];
    const stop = hearPresent((present) => heard.push(present.length));
    await askNow();
    stop();
    expect(said(world)).toEqual([
      { place: "camp", camp_owner: "b", device: "desktop" },
      { place: "camp", camp_owner: "b", device: "desktop" },
    ]);
    expect(heard).toEqual([0]);
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
/** Leaf's lists with Alice at `place`, made at `made` by Leaf's clock. */
const aliceAt = (place: string, made = "2026-11-25T10:00:01.000Z") => ({
  status: 200,
  body: {
    at: made,
    present: [aliceRow({ place, acted_at: "2026-11-25T09:58:00.000Z" })],
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

  test("keeps the lists Leaf made last: an answer that comes after later lists is dropped", async () => {
    let calls = 0;
    world = standin({
      ...routes,
      // The first answer is slow, and says what was so before the second was asked.
      "GET /v1/game/presence": async () => {
        calls++;
        if (calls === 1) {
          await Bun.sleep(30);
          return aliceAt("town", "2026-11-25T10:00:01.000Z");
        }
        return aliceAt("works", "2026-11-25T10:00:02.000Z");
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
    expect([heard[0]?.[0]?.since, heard[0]?.[0]?.acted]).toEqual([
      Date.UTC(2026, 10, 25, 9, 30),
      Date.UTC(2026, 10, 25, 9, 58),
    ]);
  });

  test("in a live room of the place, takes the lists the room tells, the newest, and asks nothing more", async () => {
    world = standin({ ...routes, "GET /v1/game/presence": aliceAt("town", "2026-11-25T10:00:02.000Z") });
    await start();
    const heard: string[][] = [];
    const stop = hearPresent((present) => heard.push(present.map((m) => m.place)));
    inRoom("town");
    here("town");
    await Bun.sleep(10);
    heardAbout(aliceAt("works", "2026-11-25T10:00:03.000Z").body);
    // Made before the lists already heard, as a frame sent before the answer was: dropped.
    heardAbout(aliceAt("table", "2026-11-25T10:00:00.000Z").body);
    stop();

    expect(heard).toEqual([["town"], ["works"]]);
    expect(world.sent.filter((s) => s.path === "/v1/game/presence").map((s) => s.method)).toEqual(["GET"]);
  });
});
