import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { type PlayerId, playerId } from "@sequoia-leaf/core";
import { Schema } from "effect";

import { DAY, fakeBackend, sessionOf, testLeaf } from "./support.ts";

const alice = playerId("10000000-0000-0000-0000-000000000001");
const bob = playerId("10000000-0000-0000-0000-000000000002");
const carol = playerId("10000000-0000-0000-0000-000000000003");
const dave = playerId("10000000-0000-0000-0000-000000000004");
/** Wednesday 25 November 2026, 12:00 UTC: its week began on Monday the 23rd. */
const T0 = Date.UTC(2026, 10, 25, 12);

const clock = { now: T0 };
let services: ReturnType<typeof testLeaf>;
let app: ReturnType<(typeof services)["app"]>;

beforeEach(async () => {
  clock.now = T0;
  const fake = fakeBackend({
    "alice-token": () => Response.json(sessionOf(alice, "Alice", "CAPTAIN")),
    "bob-token": () => Response.json(sessionOf(bob, "Bob", "RECRUIT")),
    // Not in the guild: a guest.
    "carol-token": () => Response.json(sessionOf(carol, "Carol", null)),
    "dave-token": () => Response.json(sessionOf(dave, "Dave", "RECRUIT")),
  });
  services = testLeaf(clock, fake.fetcher);
  app = services.app();
  await services.query(
    (sql) => sql`
      INSERT INTO player_names (player_id, username, updated_at, asked_at)
      VALUES (${alice}, 'Alice', ${T0}, ${T0}), (${bob}, 'Bob', ${T0}, ${T0}), (${carol}, 'Carol', ${T0}, ${T0}),
             (${dave}, 'Dave', ${T0}, ${T0})
    `,
  );
  // Each of them has opened the town, so each has a camp, and Leaf has seen them.
  for (const who of ["alice", "bob", "carol", "dave"]) {
    // oxlint-disable-next-line no-await-in-loop -- one after another
    await call(who, "GET", "/v1/game/play/town");
    // oxlint-disable-next-line no-await-in-loop -- one after another
    await app.request("/v1/game/presence", {
      method: "PUT",
      headers: { Authorization: `Bearer ${who}-token`, "Content-Type": "application/json" },
      body: JSON.stringify({ place: "camp" }),
    });
  }
});

afterEach(async () => {
  await app.dispose();
  await services.dispose();
});

async function call(who: string, method: string, path: string) {
  const response = await app.request(path, { method, headers: { Authorization: `Bearer ${who}-token` } });
  const body: unknown = await response.json();
  return { status: response.status, body };
}

const Liked = Schema.Struct({ likes: Schema.Number, liked: Schema.Boolean });
const Listed = Schema.Struct({
  camps: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      name: Schema.String,
      guest: Schema.Boolean,
      set_out: Schema.Number,
      likes: Schema.Number,
      liked: Schema.Boolean,
    }),
  ),
});
const Caller = Schema.Struct({ id: Schema.String, name: Schema.String, guest: Schema.Boolean, at: Schema.String });
const Visitors = Schema.Struct({ likes: Schema.Array(Caller), stays: Schema.Array(Caller) });

/** `who` likes (`on`) or takes back their like of `whose` camp, and is answered so. */
async function like(who: string, whose: PlayerId, on = true) {
  const answer = await call(who, on ? "PUT" : "DELETE", `/v1/game/camps/${whose}/like`);
  expect(answer.status).toBe(200);
  return Schema.decodeUnknownSync(Liked)(answer.body);
}

async function camps(who = "alice") {
  const answer = await call(who, "GET", "/v1/game/camps");
  expect(answer.status).toBe(200);
  return Schema.decodeUnknownSync(Listed)(answer.body).camps;
}

/** Who stayed in `owner`'s camp this week, by name. */
const stayed = async (owner: string) =>
  Schema.decodeUnknownSync(Visitors)((await call(owner, "GET", "/v1/game/camps/visitors")).body).stays.map(
    (s) => s.name,
  );

/** The camp likes in `who`'s own news, oldest first. */
async function news(who: string) {
  const answer = await call(who, "GET", "/v1/me/events");
  const events = Schema.decodeUnknownSync(
    Schema.Struct({ events: Schema.Array(Schema.Struct({ type: Schema.String, data: Schema.Unknown })) }),
  )(answer.body).events;
  return events.filter((e) => e.type === "camp_liked").map((e) => e.data);
}

describe("a like of a camp", () => {
  it("counts once a person, can be taken back, and tells the owner only the first time", async () => {
    expect(await like("bob", alice)).toEqual({ likes: 1, liked: true });
    expect(await like("bob", alice)).toEqual({ likes: 1, liked: true });
    // A guest likes like anybody.
    expect(await like("carol", alice)).toEqual({ likes: 2, liked: true });
    expect(await like("bob", alice, false)).toEqual({ likes: 1, liked: false });
    clock.now = T0 + 60_000;
    expect(await like("bob", alice)).toEqual({ likes: 2, liked: true });
    expect(await news("alice")).toEqual([
      { by: { id: bob, username: "Bob" } },
      { by: { id: carol, username: "Carol" } },
    ]);
    // It pays nothing.
    const purse = await call("bob", "GET", "/v1/game/me");
    expect(purse.body).toMatchObject({ leaf: 0, coins: 300 });
  });

  it("is refused for one's own camp, for somebody with no camp, and for what is not a player", async () => {
    expect(await call("alice", "PUT", `/v1/game/camps/${alice}/like`)).toEqual({
      status: 409,
      body: { code: "own_camp", message: "That is your own camp" },
    });
    const nobody = playerId("20000000-0000-0000-0000-000000000009");
    expect((await call("alice", "PUT", `/v1/game/camps/${nobody}/like`)).body).toMatchObject({
      code: "nothing_to_visit",
    });
    expect((await call("alice", "DELETE", "/v1/game/camps/nobody/like")).body).toMatchObject({ code: "invalid_uuid" });
    expect((await camps()).every((c) => c.likes === 0)).toBe(true);
  });

  it("held down, is slowed once it comes faster than one a second", async () => {
    const answers = [];
    for (let i = 0; i < 7; i++) {
      // oxlint-disable-next-line no-await-in-loop -- one after another, as a held key sends them
      answers.push((await call("bob", i % 2 === 0 ? "PUT" : "DELETE", `/v1/game/camps/${alice}/like`)).status);
    }
    expect(answers).toEqual([200, 200, 200, 200, 200, 429, 429]);
    clock.now = T0 + 1000;
    expect((await call("bob", "PUT", `/v1/game/camps/${alice}/like`)).status).toBe(200);
  });
});

describe("the list of camps", () => {
  it("has every camp, past twenty, with things set out, likes, and the caller's own like", async () => {
    const many = Array.from({ length: 24 }, (_, i) => playerId(`20000000-0000-0000-0000-0000000000${10 + i}`));
    await services.query(
      (sql) => sql`
        INSERT INTO play_state (player_id, game, rev, state, updated_at, guest)
        VALUES ${sql.csv(many.map((p) => sql`(${p}, 'town', 1, '{}', ${T0}, 0)`))}
      `,
    );
    await services.query(
      (sql) => sql`
        INSERT INTO standings (player_id, game, score, also, guest, updated_at)
        VALUES ${sql.csv(many.map((p, i) => sql`(${p}, 'town', ${i + 5}, '{}', 0, ${T0})`))}
      `,
    );
    await like("bob", dave);
    await like("alice", dave);
    const listed = await camps();
    expect(listed.length).toBe(28);
    const most = playerId("20000000-0000-0000-0000-000000000033");
    expect(listed[0]).toEqual({ id: most, name: "Someone", guest: false, set_out: 28, likes: 0, liked: false });
    expect(listed.find((c) => c.id === dave)).toEqual({
      id: dave,
      name: "Dave",
      guest: false,
      set_out: 0,
      likes: 2,
      liked: true,
    });
    expect(listed.find((c) => c.id === carol)).toMatchObject({ name: "Carol", guest: true });
    expect((await camps("bob")).find((c) => c.id === dave)?.liked).toBe(true);
    expect((await camps("carol")).find((c) => c.id === dave)?.liked).toBe(false);
  });
});

describe("a camp's visitors", () => {
  it("are who likes it, newest first, and who stayed in it this week, to its owner alone", async () => {
    await like("bob", alice);
    clock.now = T0 + 1000;
    await like("carol", alice);
    await like("dave", bob);
    // Dave stayed this week, Bob last week.
    await services.query(
      (sql) => sql`
        INSERT INTO camp_visits (visitor_id, owner_id, first_at, last_at)
        VALUES (${dave}, ${alice}, ${T0 - DAY}, ${T0 - DAY}), (${bob}, ${alice}, ${T0 - 9 * DAY}, ${T0 - 9 * DAY})
      `,
    );
    const answer = await call("alice", "GET", "/v1/game/camps/visitors");
    expect(Schema.decodeUnknownSync(Visitors)(answer.body)).toEqual({
      likes: [
        { id: carol, name: "Carol", guest: true, at: new Date(T0 + 1000).toISOString() },
        { id: bob, name: "Bob", guest: false, at: new Date(T0).toISOString() },
      ],
      stays: [{ id: dave, name: "Dave", guest: false, at: new Date(T0 - DAY).toISOString() }],
    });
    expect(
      Schema.decodeUnknownSync(Visitors)((await call("bob", "GET", "/v1/game/camps/visitors")).body),
    ).toMatchObject({ likes: [{ id: dave }], stays: [] });
  });

  it("count a stay in each camp hopped to, and none in a camp passed through", async () => {
    // Alice goes from Bob's camp to Carol's and on to Dave's, reading each as her page does.
    for (const [whose, at] of [
      [bob, 0],
      [bob, 30_000],
      [carol, 31_000],
      [dave, 40_000],
      [dave, 70_000],
    ] as const) {
      clock.now = T0 + at;
      // oxlint-disable-next-line no-await-in-loop -- one after another
      expect((await call("alice", "GET", `/v1/game/play/town/of/${whose}`)).status).toBe(200);
    }
    expect([await stayed("bob"), await stayed("carol"), await stayed("dave")]).toEqual([["Alice"], [], ["Alice"]]);
  });
});
