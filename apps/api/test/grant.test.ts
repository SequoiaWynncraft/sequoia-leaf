import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { playerId } from "@sequoia-leaf/core";
import { readView } from "@sequoia-leaf/pulls/wire.ts";
import { Schema } from "effect";

import { fakeBackend, sessionOf, testLeaf } from "./support.ts";

const alice = playerId("10000000-0000-0000-0000-000000000001");
const dave = playerId("10000000-0000-0000-0000-000000000004");
/** Wednesday 25 November 2026, 12:00 UTC: the first banner is open. */
const T0 = Date.UTC(2026, 10, 25, 12);

const clock = { now: T0 };
let services: ReturnType<typeof testLeaf>;
let app: ReturnType<(typeof services)["app"]>;

beforeEach(async () => {
  clock.now = T0;
  const fake = fakeBackend({
    "alice-token": () => Response.json(sessionOf(alice, "Alice", "CAPTAIN")),
    // A website admin, the guild's staff.
    "dave-token": () => Response.json({ ...sessionOf(dave, "Dave", null), website_admin: true }),
  });
  services = testLeaf(clock, fake.fetcher);
  app = services.app();
  // Leaf has seen Alice: she is in town.
  const seen = await request("alice", "PUT", "/v1/game/presence", { place: "town" });
  expect(seen.status).toBe(200);
});

afterEach(async () => {
  await app.dispose();
  await services.dispose();
});

function request(who: "alice" | "dave", method: string, path: string, body?: unknown) {
  return app.request(path, {
    method,
    headers: { Authorization: `Bearer ${who}-token`, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

const grant = (body: unknown, who: "alice" | "dave" = "dave") => request(who, "POST", "/v1/game/admin/grants", body);

const Opened = Schema.Struct({ state: Schema.Unknown });
const Table = Schema.Struct({ state: Schema.Struct({ roster: Schema.Record(Schema.String, Schema.Number) }) });
const Report = Schema.Struct({
  players: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      done: Schema.Array(Schema.Struct({ kind: Schema.String, data: Schema.Unknown })),
    }),
  ),
});

/** What Alice holds, as the Grove reads it (the pulls' own state) and as the raid reads it (her roster, from the awards). */
async function held() {
  const opened = Schema.decodeUnknownSync(Opened)(await (await request("alice", "GET", "/v1/game/play/pulls")).json());
  const pulls = readView(opened.state);
  const raid = Schema.decodeUnknownSync(Table)(await (await request("alice", "GET", "/v1/game/play/raid")).json());
  return { have: pulls?.have, pulls: pulls?.pulls, seeds: pulls?.seeds, roster: raid.state.roster };
}

describe("POST /v1/game/admin/grants", () => {
  it("gives a figure as a pull would, so the Grove and the raid agree, and records who gave it", async () => {
    const dry = await grant({ player: alice, figure: "crab40", copies: 2, dry: true });
    expect(dry.status).toBe(200);
    const said = {
      player: { id: alice, name: "Alice" },
      prize: "figure:crab40",
      rarity: "Druid",
      copies: 2,
      had: 0,
      have: 2,
      awards: ["pull:figure:crab40", "copies:figure:crab40:2"],
      by: { id: dave, name: "Dave" },
      at: new Date(T0).toISOString(),
    };
    expect(await dry.json()).toEqual({ dry: true, ...said });
    // A dry run writes nothing.
    expect((await held()).have).toEqual({});

    const made = await grant({ player: alice, figure: "crab40", copies: 2 });
    expect(made.status).toBe(200);
    expect(await made.json()).toEqual({ dry: false, ...said });
    // One more, and a banner's headliner.
    const more = await grant({ player: alice, figure: "crab40" });
    expect(await more.json()).toMatchObject({ had: 2, have: 3, awards: ["copies:figure:crab40:3"] });
    const headliner = await grant({ player: alice, banner: "banner-1" });
    expect(await headliner.json()).toMatchObject({ prize: "headliner:banner-1", rarity: "Yggdrasil", have: 1 });

    // The Grove shows what the pulls hold; the raid's roster has the same, each a copy's level; and no pull was made.
    expect(await held()).toEqual({
      have: { "figure:crab40": 3, "headliner:banner-1": 1 },
      pulls: 0,
      seeds: 0,
      roster: { crab40: 2, "banner-1": 0 },
    });
    // Recorded as the staff's, in the activity the staff's report shows.
    const report = Schema.decodeUnknownSync(Report)(
      await (await request("dave", "GET", "/v1/game/admin/activity")).json(),
    );
    const done = report.players.find((p) => p.id === alice)?.done.filter((d) => d.kind === "pulls_granted");
    expect(done?.map((d) => d.data)).toEqual([
      { prize: "headliner:banner-1", copies: 1, have: 1, by: dave, name: "Dave" },
      { prize: "figure:crab40", copies: 1, have: 3, by: dave, name: "Dave" },
      { prize: "figure:crab40", copies: 2, have: 2, by: dave, name: "Dave" },
    ]);
  });

  it("refuses a prize not released yet, and gives nothing", async () => {
    // Before the first banner opens on 23 November.
    clock.now = Date.UTC(2026, 10, 20, 12);
    for (const dry of [true, false]) {
      // oxlint-disable-next-line no-await-in-loop -- one after another
      const refused = await grant({ player: alice, banner: "banner-1", dry });
      expect(refused.status).toBe(409);
      // oxlint-disable-next-line no-await-in-loop -- one after another
      expect(await refused.json()).toEqual({ code: "not_released", message: "Not released until 23 November." });
    }
    expect((await held()).have).toEqual({});
  });

  it("refuses a prize no release has, a player Leaf does not know, and a body that names no prize", async () => {
    const nothing = await grant({ player: alice, figure: "no-such-figure" });
    expect(nothing.status).toBe(409);
    expect(await nothing.json()).toMatchObject({ code: "no_such_prize" });
    const stranger = await grant({ player: playerId("10000000-0000-0000-0000-000000000009"), figure: "crab40" });
    expect(stranger.status).toBe(404);
    expect(await stranger.json()).toMatchObject({ code: "no_such_player" });
    for (const body of [
      { player: alice },
      { player: alice, figure: "crab40", banner: "banner-1" },
      { player: alice, figure: "crab40", copies: 8 },
    ]) {
      // oxlint-disable-next-line no-await-in-loop -- one after another
      const invalid = await grant(body);
      expect(invalid.status).toBe(400);
      // oxlint-disable-next-line no-await-in-loop -- one after another
      expect(await invalid.json()).toMatchObject({ code: "invalid_grant" });
    }
  });

  it("is for the staff only", async () => {
    const refused = await grant({ player: alice, figure: "crab40" }, "alice");
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({ code: "staff_only" });
    expect((await held()).have).toEqual({});
  });
});
