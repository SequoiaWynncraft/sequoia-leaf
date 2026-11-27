import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { EARNINGS, type PlayerId, playerId } from "@sequoia-leaf/core";
import { payout, summariseRun } from "@sequoia-leaf/raid";
import { advance } from "@sequoia-leaf/raid/sitting/clock.ts";
import { decodeSitting, SITTING_VERSION } from "@sequoia-leaf/raid/sitting/keep.ts";
import { CLOCK, type Sitting } from "@sequoia-leaf/raid/sitting/sitting.ts";
import { Effect, Option, Schema } from "effect";
import type { SqlClient } from "effect/sql";

import { SittingShown } from "../src/api/sittings.ts";
import type { Settings } from "../src/config.ts";
import { Coins } from "../src/play/coins.ts";
import { Sittings } from "../src/sittings/service.ts";
import { LOGGED_SITTING, MOST_NOT_OVER } from "../src/sittings/writes.ts";
import { playThrough, type Reach, type Seated } from "./sittings-drive.ts";
import { asPage, fakeBackend, fakeMojang, type Fakes, MINUTE, sessionOf, steadyDice, testLeaf } from "./support.ts";

const alice = playerId("10000000-0000-0000-0000-000000000001");
const bob = playerId("10000000-0000-0000-0000-000000000002");
const carol = playerId("10000000-0000-0000-0000-000000000003");
/** Wednesday 25 November 2026, 12:00 UTC. */
const T0 = Date.UTC(2026, 10, 25, 12);
const ORIGIN = "https://leaf.seqwawa.com";
const SESSIONS: Record<PlayerId, string> = { [alice]: "alice-token", [bob]: "bob-token", [carol]: "carol-token" };
const sessions = fakeBackend({
  "alice-token": () => Response.json(sessionOf(alice, "Alice", "CAPTAIN")),
  "bob-token": () => Response.json(sessionOf(bob, "Bob", "RECRUIT")),
  // Not in the guild: a guest, who sits at tables all the same.
  "carol-token": () => Response.json(sessionOf(carol, "Carol", null)),
});

const clock = { now: T0 };
let services: ReturnType<typeof testLeaf>;
let app: ReturnType<(typeof services)["app"]>;

function start(fakes: Fakes = {}, config: Partial<Settings> = {}) {
  clock.now = T0;
  services = testLeaf(clock, sessions.fetcher, config, { dice: steadyDice(7), ...fakes });
  app = services.app();
}
async function restart(fakes: Fakes = {}, config: Partial<Settings> = {}) {
  await app.dispose();
  start(fakes, config);
}

beforeEach(() => start());
afterEach(async () => {
  await app.dispose();
});

interface Answered {
  readonly status: number;
  readonly body: unknown;
}

/** A request as the game's page sends it: the website's cookie, from Leaf's own page. */
async function call(method: string, path: string, body: unknown, who: PlayerId, on = app): Promise<Answered> {
  const response = await on.request(path, {
    method,
    headers: { Cookie: `seq_session=${SESSIONS[who]}`, Origin: ORIGIN, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.json() };
}
const open = (who: PlayerId, on = app) => call("POST", "/v1/game/sittings", { player: who }, who, on);
const act = (id: string, who: PlayerId, commands: readonly object[], on = app) =>
  call("POST", `/v1/game/sittings/${id}`, { player: who, commands }, who, on);
const look = (id: string, who: PlayerId, rev?: number) =>
  call("GET", `/v1/game/sittings/${id}${rev === undefined ? "" : `?rev=${rev}`}`, undefined, who);
const list = (who: PlayerId) => call("GET", "/v1/game/sittings", undefined, who);
const record = (who: PlayerId) => call("GET", "/v1/game/sittings/record", undefined, who);
const sweep = (on = services) => on.run(Sittings.use((sittings) => sittings.sweep));

/** The id of a sitting answered. */
const idOf = (answer: Answered): string => Schema.decodeUnknownSync(SittingShown)(answer.body).id;
/** Opens a sitting as `who`, and gives its id. */
async function opened(who: PlayerId = alice, on = app): Promise<string> {
  const answer = await open(who, on);
  expect(answer.status).toBe(200);
  return idOf(answer);
}

const Row = Schema.Struct({ state: Schema.String, rev: Schema.Int, stage: Schema.String });
/** A sitting as stored: its text, `rev` and stage, and the sitting the text is. */
async function stored(
  id: string,
  on = services,
): Promise<{ text: string; rev: number; stage: string; sitting: Sitting }> {
  const rows = await on.query((sql) => sql`SELECT state, rev, stage FROM raid_sittings WHERE id = ${id}`);
  const [row] = Schema.decodeUnknownSync(Schema.Array(Row))(rows);
  const sitting = row ? decodeSitting(row.state) : null;
  if (!row || !sitting) throw new Error(`No sitting ${id}`);
  return { text: row.state, rev: row.rev, stage: row.stage, sitting };
}
const rowsOf = <A>(statement: (sql: SqlClient.SqlClient) => Effect.Effect<ReadonlyArray<A>, unknown>, on = services) =>
  on.query(statement);
/** A sitting's whole row. */
const rowOf = (id: string) => rowsOf((sql) => sql`SELECT * FROM raid_sittings WHERE id = ${id}`);
/** Stores a sitting's text again as `change` leaves it. */
async function rewrite(id: string, change: (raw: Record<string, unknown>) => void) {
  const raw: Record<string, unknown> = JSON.parse((await stored(id)).text);
  change(raw);
  await services.query((sql) => sql`UPDATE raid_sittings SET state = ${JSON.stringify(raw)} WHERE id = ${id}`);
}
const seats = (on = services) =>
  rowsOf((sql) => sql`SELECT player_id AS player, sitting FROM raid_sitting_seats ORDER BY player_id`, on);
const sittingCoins = (on = services) =>
  rowsOf(
    (sql) => sql`SELECT player_id AS player, amount, key FROM coin_entries WHERE key LIKE 'sitting:%' ORDER BY key`,
    on,
  );

/** The driver's way to Leaf, in memory: the clock is the test's own, moved on to each deadline. */
const inMemory = (moved: (at: number) => Promise<void> = async () => {}): Reach => ({
  get: async (path, session) => (await app.request(path, { headers: { Cookie: `seq_session=${session}` } })).json(),
  post: async (path, body, session) =>
    (
      await app.request(path, {
        method: "POST",
        headers: { Cookie: `seq_session=${session}`, Origin: ORIGIN, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
    ).json(),
  to: async (at) => {
    // A second at least, so that the pages' allowances fill up again between deadlines.
    clock.now = Math.max(clock.now + 1000, at);
    await moved(at);
  },
});
const seated = (...who: PlayerId[]): Seated[] => who.map((player) => ({ player, session: SESSIONS[player] ?? "" }));

describe("Sittings through the routes", () => {
  it("opens one, lists it, and has people sit, leave and start it", async () => {
    const answer = await open(alice);
    expect(answer).toMatchObject({
      status: 200,
      body: {
        rev: 0,
        now: new Date(T0).toISOString(),
        state: { by: alice, stage: { at: "open", until: T0 + CLOCK.open, sat: [{ id: alice, name: "Alice" }] } },
        purse: { coins: 300 },
      },
    });
    const id = idOf(answer);
    const closes = new Date(T0 + CLOCK.open).toISOString();
    expect((await list(bob)).body).toEqual({
      now: new Date(T0).toISOString(),
      open: [{ id, by: { id: alice, name: "Alice" }, sat: 1, closes }],
      yours: null,
    });
    expect((await list(alice)).body).toMatchObject({ yours: id });

    // Bob sits, and again; he may not start it; he gets up and sits again.
    const sat = await act(id, bob, [{ id: "b-1", do: "sit" }]);
    expect(sat.body).toMatchObject({ rev: 1, results: [{ id: "b-1", notes: [] }], state: { stage: { at: "open" } } });
    expect(
      await act(id, bob, [
        { id: "b-2", do: "sit" },
        { id: "b-3", do: "start" },
      ]),
    ).toMatchObject({
      status: 200,
      body: {
        rev: 1,
        results: [
          { id: "b-2", refused: "seated", why: "You are at that table already." },
          { id: "b-3", refused: "not_opener", why: "Whoever opened the table starts it." },
        ],
      },
    });
    expect((await act(id, bob, [{ id: "b-4", do: "leave" }])).body).toMatchObject({
      rev: 2,
      state: { stage: { sat: [{ id: alice }] } },
    });
    await act(id, bob, [{ id: "b-5", do: "sit" }]);
    expect((await list(carol)).body).toMatchObject({ open: [{ id, sat: 2 }] });
    expect(await seats()).toEqual([
      { player: alice, sitting: id },
      { player: bob, sitting: id },
    ]);

    // Alice starts it: the regulars take the six seats left, and the first carousel is open.
    const started = await act(id, alice, [{ id: "a-1", do: "start" }]);
    expect(started.body).toMatchObject({
      rev: 4,
      results: [{ id: "a-1", notes: [] }],
      state: { stage: { at: "carousel", until: T0 + CLOCK.together }, you: 0 },
    });
    expect((await list(carol)).body).toMatchObject({ open: [] });
    // Somebody not seated is shown it all the same, with no seat or run of their own.
    const watched = await look(id, carol);
    expect(watched.body).toMatchObject({ rev: 4, state: { you: null, run: null } });
    expect(
      (await stored(id)).sitting.seats.map((seat) => (seat.who.is === "member" ? seat.who.name : seat.who.is)),
    ).toEqual(["Alice", "Bob", "regular", "regular", "regular", "regular", "regular", "regular"]);
  });

  it("logs a sitting opened, started and ended under whoever opened it", async () => {
    const id = await opened();
    await act(id, carol, [{ id: "c-1", do: "sit" }]);
    await act(id, alice, [{ id: "a-1", do: "start" }]);
    // Both get up: with no member left in, the regulars play straight to the end.
    await act(id, carol, [{ id: "c-2", do: "leave" }]);
    await act(id, alice, [{ id: "a-2", do: "leave" }]);
    const logged = await rowsOf(
      (sql) =>
        sql`SELECT player_id AS player, game, kind, data FROM activity WHERE kind LIKE 'raid_table_%' ORDER BY id`,
    );
    // The rooms the regulars fought to the end, the most of any seat.
    const { sitting } = await stored(id);
    const rooms = Math.max(...sitting.seats.map((seat) => seat.run.record.length));
    expect(rooms).toBeGreaterThan(0);
    expect(logged).toEqual([
      { player: alice, game: "raid", kind: LOGGED_SITTING.opened, data: JSON.stringify({ sitting: id }) },
      { player: alice, game: "raid", kind: LOGGED_SITTING.started, data: JSON.stringify({ sitting: id, members: 2 }) },
      {
        player: alice,
        game: "raid",
        kind: LOGGED_SITTING.ended,
        data: JSON.stringify({
          sitting: id,
          rooms,
          places: [
            { player: alice, place: 7 },
            { player: carol, place: 8 },
          ],
        }),
      },
    ]);
  });

  it("answers a page that has the sitting's rev unchanged, and brings it to the clock first", async () => {
    const id = await opened();
    expect((await look(id, alice, 0)).body).toEqual({
      id,
      rev: 0,
      now: new Date(T0).toISOString(),
      unchanged: true,
    });
    await act(id, bob, [{ id: "b-1", do: "sit" }]);
    expect((await look(id, alice, 0)).body).toMatchObject({ rev: 1, state: { stage: { at: "open" } } });
    expect((await look(id, alice, 1)).body).toMatchObject({ rev: 1, unchanged: true });
    await act(id, alice, [{ id: "a-1", do: "start" }]);
    // The first carousel ends: the same rev is a sitting that has moved on since.
    clock.now = T0 + CLOCK.together;
    expect((await look(id, alice, 2)).body).toMatchObject({ rev: 3, state: { stage: { at: "plan" } } });
    expect((await look(id, alice, 3)).body).toMatchObject({ rev: 3, unchanged: true });
    // A rev that is not one is no rev.
    expect((await call("GET", `/v1/game/sittings/${id}?rev=x`, undefined, alice)).body).toMatchObject({ rev: 3 });
    expect(await look("nosuchsitting", alice)).toEqual({
      status: 404,
      body: { code: "no_such_sitting", message: "There is no such table" },
    });
  });

  it("does a command sent twice once", async () => {
    const id = await opened();
    const sit = [{ id: "b-1", do: "sit" }];
    const first = await act(id, bob, sit);
    const again = await act(id, bob, sit);
    expect(again.body).toEqual(first.body);
    expect((await stored(id)).rev).toBe(1);
    await act(id, alice, [{ id: "a-1", do: "start" }]);
    clock.now = T0 + CLOCK.together;
    // The figure from the carousel stands in the front row's middle: benched, there is nobody there to bench again.
    const bench = [{ id: "a-2", do: "move", from: { on: "board", at: 3 }, to: { on: "bench", at: 0 } }];
    const moved = await act(id, alice, bench);
    expect(moved.body).toMatchObject({ results: [{ id: "a-2", notes: [{ t: "moved" }] }] });
    expect((await act(id, alice, bench)).body).toMatchObject({
      rev: Number(field(moved.body, "rev")),
      results: field(moved.body, "results"),
    });
    expect((await act(id, alice, [{ ...bench[0], id: "a-3" }])).body).toMatchObject({
      results: [{ id: "a-3", refused: "nobody_there", why: "Nobody is there." }],
    });
  });

  it("refuses what is not a command, and a page signed in as somebody else", async () => {
    const id = await opened();
    expect(await act(id, bob, [{ id: "b-1", do: "win" }])).toEqual({
      status: 400,
      body: { code: "invalid_command", message: "Command b-1 is not one of the table's" },
    });
    expect(await act(id, bob, [{ do: "sit" }])).toMatchObject({ status: 400, body: { code: "invalid_command" } });
    expect(await call("POST", `/v1/game/sittings/${id}`, { player: alice, commands: [] }, bob)).toMatchObject({
      status: 409,
      body: { code: "not_you" },
    });
    expect(await call("POST", "/v1/game/sittings", { nobody: true }, bob)).toMatchObject({
      status: 400,
      body: { code: "invalid_command" },
    });
    expect(await act("nosuchsitting", bob, [{ id: "b-2", do: "sit" }])).toMatchObject({ status: 404 });
  });
});

describe("One sitting a player", () => {
  it("refuses a player at one sitting another, opened or sat at; and so does the database", async () => {
    const first = await opened(alice);
    clock.now += MINUTE + 1;
    expect(await open(alice)).toEqual({
      status: 409,
      body: { code: "seated_elsewhere", message: "You are at another table." },
    });
    const second = await opened(bob);
    expect((await act(second, alice, [{ id: "a-1", do: "sit" }])).body).toMatchObject({
      results: [{ id: "a-1", refused: "seated_elsewhere", why: "You are at another table." }],
      state: { stage: { sat: [{ id: bob }] } },
    });
    expect(await seats()).toEqual([
      { player: alice, sitting: first },
      { player: bob, sitting: second },
    ]);
    // Whatever the code does, the database keeps one seat a player.
    const twice = services.query(
      (sql) => sql`INSERT INTO raid_sitting_seats (player_id, sitting, since) VALUES (${alice}, ${second}, ${T0})`,
    );
    expect(twice).rejects.toThrow();
  });

  it("holds it with two requests at once: the one written second is refused", async () => {
    // Carol's sit at Alice's sitting is let through Leaf's check, and then, before it is kept, her
    // other page opens a sitting of her own.
    let asked = 0;
    let other: Promise<Answered> | undefined;
    await restart({
      play: (real) => ({
        ...real,
        answered: (player, game, command) =>
          Effect.andThen(
            command === "c-race" && ++asked === 2 ? Effect.promise(() => (other = open(carol))) : Effect.void,
            real.answered(player, game, command),
          ),
      }),
    });
    const id = await opened(alice);
    const sat = await act(id, carol, [{ id: "c-race", do: "sit" }]);
    const hers = await other;
    expect(hers?.status).toBe(200);
    const theirs = hers ? idOf(hers) : "";
    expect(sat.body).toMatchObject({
      results: [{ id: "c-race", refused: "seated_elsewhere" }],
      state: { stage: { sat: [{ id: alice }] } },
    });
    expect(await seats()).toEqual([
      { player: alice, sitting: id },
      { player: carol, sitting: theirs },
    ]);
    expect((await stored(id)).rev).toBe(0);
  });

  it("seats a player at only one of two sittings sat at at once", async () => {
    const one = await opened(alice);
    const two = await opened(bob);
    const [a, b] = await Promise.all([
      act(one, carol, [{ id: "c-1", do: "sit" }]),
      act(two, carol, [{ id: "c-2", do: "sit" }]),
    ]);
    const done = [a, b].map((answer) => JSON.stringify(field(answer.body, "results")));
    expect(done.filter((r) => r.includes('"notes"'))).toHaveLength(1);
    expect(done.filter((r) => r.includes("seated_elsewhere"))).toHaveLength(1);
    expect((await seats()).filter((row) => field(row, "player") === carol)).toHaveLength(1);
  });

  it("frees a player once their sitting is over, whether or not anybody has looked at it since", async () => {
    const id = await opened(alice);
    clock.now = T0 + CLOCK.open;
    // Nobody brought it to the clock: Alice opening another brings it there first.
    expect(await open(alice)).toMatchObject({ status: 200 });
    expect((await stored(id)).stage).toBe("over");
  });
});

/** Alice alone at a sitting she starts at T0, brought to each moment one way; gives what is stored after each. */
async function brought(way: "read" | "command" | "sweep", moments: readonly number[]) {
  await restart();
  const id = await opened(alice);
  await act(id, alice, [{ id: "a-0", do: "start" }]);
  const after: unknown[] = [];
  for (const [n, at] of moments.entries()) {
    clock.now = at;
    // oxlint-disable-next-line no-await-in-loop -- one moment after another
    if (way === "read") await look(id, bob);
    // A command refused is the sitting brought to the moment, and nothing more.
    // oxlint-disable-next-line no-await-in-loop -- one moment after another
    else if (way === "command") expect((await act(id, alice, [{ id: `a-${n + 1}`, do: "start" }])).status).toBe(200);
    // oxlint-disable-next-line no-await-in-loop -- one moment after another
    else await sweep();
    // oxlint-disable-next-line no-await-in-loop -- one moment after another
    const { text, rev } = await stored(id);
    // oxlint-disable-next-line no-await-in-loop -- one moment after another
    after.push({ text, rev, seats: await seats(), coins: await sittingCoins() });
  }
  return after;
}

describe("The clock", () => {
  it("brings a sitting to a moment the same by a read, by a command and by the sweep", async () => {
    const moments = [T0 + 3 * MINUTE, T0 + 9 * MINUTE, T0 + 60 * MINUTE];
    const read = await brought("read", moments);
    expect(await brought("command", moments)).toEqual(read);
    expect(await brought("sweep", moments)).toEqual(read);
    // It went somewhere: by the hour Alice was out, and the regulars had played it to its end.
    expect(JSON.parse(String(field(read.at(-1), "text")))).toMatchObject({ stage: { at: "over" } });
  });

  it("closes an open sitting nobody starts, and frees its seats", async () => {
    const id = await opened(alice);
    await act(id, bob, [{ id: "b-1", do: "sit" }]);
    clock.now = T0 + CLOCK.open - 1;
    expect(await sweep()).toBe(0);
    clock.now = T0 + CLOCK.open;
    expect(await sweep()).toBe(1);
    expect((await stored(id)).sitting.stage).toEqual({ at: "over", ended: T0 + CLOCK.open });
    expect(await seats()).toEqual([]);
    expect((await list(carol)).body).toMatchObject({ open: [] });
    expect((await record(alice)).body).toEqual({ played: 0, won: 0, top_four: 0 });
    expect(await open(bob)).toMatchObject({ status: 200 });
    // A day after it ended, it is let go of; and a page asking for it is told there is none.
    clock.now = T0 + CLOCK.open + 24 * 60 * MINUTE + 1;
    await sweep();
    expect(await look(id, alice)).toMatchObject({ status: 404 });
  });

  it("has a sitting whose state does not read over, its seats freed, and says so", async () => {
    const id = await opened(alice);
    await services.query((sql) => sql`UPDATE raid_sittings SET state = '{}' WHERE id = ${id}`);
    expect(await look(id, alice)).toMatchObject({ status: 409, body: { code: "state_unreadable" } });
    expect(await seats()).toEqual([]);
    clock.now += MINUTE + 1;
    expect(await open(alice)).toMatchObject({ status: 200 });
  });

  it("leaves a sitting a newer Leaf stored as it is, through the sweep and a read; one of its own version that does not read it shelves", async () => {
    // Mid-play, as a newer Leaf beside this one in a deploy kept it; and one of this version spoilt.
    const newer = await opened(alice);
    await act(newer, alice, [{ id: "a-0", do: "start" }]);
    const spoilt = await opened(bob);
    await act(spoilt, carol, [{ id: "c-0", do: "sit" }]);
    await rewrite(newer, (raw) => (raw["v"] = SITTING_VERSION + 1));
    await rewrite(spoilt, (raw) => (raw["rng"] = -1));
    const before = await rowOf(newer);
    clock.now = T0 + 24 * 60 * MINUTE;
    expect(await sweep()).toBe(2);
    const updating = {
      status: 503,
      body: { code: "sitting_updating", message: "This table is being updated. Try again in a moment." },
    };
    expect(await look(newer, alice)).toEqual(updating);
    expect(await act(newer, alice, [{ id: "a-1", do: "start" }])).toEqual(updating);
    expect(await rowOf(newer)).toEqual(before);
    expect(await seats()).toEqual([{ player: alice, sitting: newer }]);
    expect(await rowsOf((sql) => sql`SELECT stage FROM raid_sittings WHERE id = ${spoilt}`)).toEqual([
      { stage: "over" },
    ]);
    expect(await look(spoilt, bob)).toMatchObject({ status: 409, body: { code: "state_unreadable" } });
  });
});

describe("Coins and places", () => {
  it("plays a whole sitting of one member and seven regulars, and pays the member once", async () => {
    const id = await opened(alice);
    await act(id, alice, [{ id: "a-0", do: "start" }]);
    const { end } = await playThrough(inMemory(), id, seated(alice));
    expect(end.at).toBe("over");
    const { sitting } = await stored(id);
    const mine = sitting.seats[0];
    if (!mine) throw new Error("no seat");
    const owed = payout(summariseRun(mine.run)).coins;
    expect(owed).toBeGreaterThan(0);
    expect(await sittingCoins()).toEqual([{ player: alice, amount: owed, key: `sitting:${id}:seat:0` }]);
    expect(sitting.owed).toEqual([]);
    const place = mine.place ?? 0;
    expect((await record(alice)).body).toEqual({
      played: 1,
      won: place === 1 ? 1 : 0,
      top_four: place <= 4 ? 1 : 0,
    });
    // Read again, swept again: nothing more is paid or kept.
    await look(id, alice);
    await sweep();
    expect(await sittingCoins()).toHaveLength(1);
    expect((await record(alice)).body).toMatchObject({ played: 1 });
  });

  it("pays each member seat once within what its member may still earn, a regular nothing, with the sweep and a read racing at every deadline", async () => {
    // Bob has earned all but 10 of the hour's Coins already.
    await services.run(Coins.use((coins) => coins.open(bob, clock.now)));
    const amount = EARNINGS.hourly - 10;
    await services.query(
      (sql) => sql`
        INSERT INTO coin_entries (player_id, amount, reason, game, key, at, earned)
        VALUES (${bob}, ${amount}, 'The Works', 'works', 'test:works', ${clock.now}, 1)
      `,
    );
    const id = await opened(alice);
    await act(id, bob, [{ id: "b-0", do: "sit" }]);
    await act(id, alice, [{ id: "a-0", do: "start" }]);
    const racing = inMemory(async () => {
      await Promise.all([sweep(), look(id, bob), sweep(), look(id, alice)]);
    });
    await playThrough(racing, id, seated(alice, bob));
    const { sitting } = await stored(id);
    const owed = sitting.seats.map((seat) => payout(summariseRun(seat.run)).coins);
    const [aliceOwed = 0, bobOwed = 0] = owed;
    expect(Math.min(aliceOwed, bobOwed)).toBeGreaterThan(10);
    expect(await sittingCoins()).toEqual([
      { player: alice, amount: aliceOwed, key: `sitting:${id}:seat:0` },
      { player: bob, amount: 10, key: `sitting:${id}:seat:1` },
    ]);
    // Places: one each, as the rules placed them, and counted on each one's record.
    const places = await rowsOf(
      (sql) => sql`SELECT player_id AS player, place, seats FROM raid_sitting_places ORDER BY player_id`,
    );
    expect(places).toEqual(
      sitting.seats.slice(0, 2).map((seat, i) => ({ player: [alice, bob][i], place: seat.place, seats: 8 })),
    );
    await sweep();
    expect(await sittingCoins()).toHaveLength(2);
    expect((await record(bob)).body).toMatchObject({ played: 1 });
  });

  it("pays nothing twice when another Leaf brings the sitting on while a command is being done", async () => {
    const path = join(tmpdir(), `leaf-sittings-${crypto.randomUUID()}.db`);
    // Leaf B's sweep, run once Leaf A's job has read the sitting and before it keeps what it did.
    let between: (() => Promise<unknown>) | null = null;
    // How often Leaf A asked whether the command was done before: as it came, and in each go at the job.
    let asked = 0;
    try {
      await restart(
        {
          play: (real) => ({
            ...real,
            answered: (player, game, command) =>
              Effect.andThen(
                command === "a-race" && ++asked === 2 && between
                  ? Effect.promise(() => {
                      const run = between;
                      between = null;
                      return run ? run() : Promise.resolve();
                    })
                  : Effect.void,
                real.answered(player, game, command),
              ),
          }),
        },
        { databasePath: path },
      );
      const other = testLeaf(clock, sessions.fetcher, { databasePath: path }, { dice: steadyDice(7) });
      const id = await opened(alice);
      await act(id, alice, [{ id: "a-0", do: "start" }]);
      let races = 0;
      const racing = inMemory(async (at) => {
        // At the deadline that has Alice owed Coins, Leaf B sweeps while Leaf A does her command.
        const { sitting } = await stored(id);
        if (races > 0 || advance(sitting, at).owed.length === 0) return;
        races++;
        between = () => sweep(other);
        // Started, or over by then: refused either way, so it only brings the sitting to the clock.
        const raced = await act(id, alice, [{ id: "a-race", do: "start" }]);
        expect(JSON.stringify(field(raced.body, "results"))).toMatch(/"refused":"(not_open|table_over)"/);
        expect(between).toBeNull();
      });
      await playThrough(racing, id, seated(alice));
      expect(races).toBe(1);
      // Leaf B wrote it first: Leaf A's go at it was not kept, and it did the job again from what was stored.
      expect(asked).toBe(3);
      expect(await sittingCoins()).toHaveLength(1);
      await other.dispose();
    } finally {
      for (const end of ["", "-wal", "-shm"]) rmSync(`${path}${end}`, { force: true });
    }
  });
});

/** `n` commands holding the stall, their ids counted from `from`. */
const holds = (from: number, n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `h-${from + i}`, do: "hold", on: true }));

describe("Limits", () => {
  it("opens one sitting a player a minute, and no more than may be going at once", async () => {
    const id = await opened(alice);
    await act(id, alice, [{ id: "a-1", do: "leave" }]);
    expect(await open(alice)).toEqual({
      status: 429,
      body: { code: "slow_down", message: "You opened a table a moment ago. Wait a minute" },
    });
    clock.now += MINUTE + 1;
    expect(await open(alice)).toMatchObject({ status: 200 });
    for (let n = 0; n < MOST_NOT_OVER; n++) {
      // oxlint-disable-next-line no-await-in-loop -- one after another
      await services.query(
        (sql) => sql`
          INSERT INTO raid_sittings (id, state, rev, opened_by, opened_at, stage, due_at)
          VALUES (${`busy-${n}`}, '{}', 0, ${carol}, ${T0}, 'plan', ${clock.now + MINUTE})
        `,
      );
    }
    expect(await open(bob)).toEqual({
      status: 409,
      body: { code: "sittings_full", message: "As many tables are going as there may be. Try again in a while" },
    });
  });

  it("opens only one of two sittings opened at once when one more may be going", async () => {
    // Each opening waits, as it names its opener, until the other has come that far too.
    const waiting: (() => void)[] = [];
    const meet = Effect.promise(
      () =>
        new Promise<void>((resolve) => {
          waiting.push(resolve);
          if (waiting.length === 2) for (const go of waiting) go();
        }),
    );
    const mojang = fakeMojang().service;
    await restart({ mojang: { ...mojang, profile: () => Effect.as(meet, Option.none()) } });
    // Players Leaf knows are named by Mojang.
    for (const [n, player] of [alice, bob].entries()) {
      // oxlint-disable-next-line no-await-in-loop -- one after another
      await services.query(
        (sql) => sql`INSERT INTO banner_people (banner, player_id) VALUES (${`banner-${n + 1}`}, ${player})`,
      );
    }
    for (let n = 0; n < MOST_NOT_OVER - 1; n++) {
      // oxlint-disable-next-line no-await-in-loop -- one after another
      await services.query(
        (sql) => sql`
          INSERT INTO raid_sittings (id, state, rev, opened_by, opened_at, stage, due_at)
          VALUES (${`busy-${n}`}, '{}', 0, ${carol}, ${T0}, 'plan', ${clock.now + MINUTE})
        `,
      );
    }
    const both = await Promise.all([open(alice), open(bob)]);
    expect(both.map((answer) => answer.status).toSorted((a, b) => a - b)).toEqual([200, 409]);
    expect(both.find((answer) => answer.status === 409)?.body).toMatchObject({ code: "sittings_full" });
    expect(await rowsOf((sql) => sql`SELECT count(*) AS n FROM raid_sittings WHERE ended_at IS NULL`)).toEqual([
      { n: MOST_NOT_OVER },
    ]);
    expect(await seats()).toHaveLength(1);
    expect(waiting).toHaveLength(2);
  });

  it("counts commands at a sitting against the player's allowance for every game", async () => {
    const id = await opened(alice);
    // Opening it was one command: 39 more are let through at once.
    expect((await act(id, alice, holds(0, 39))).status).toBe(200);
    // The play service's own allowance is the same one.
    const raid = await call(
      "POST",
      "/v1/game/play/raid",
      asPage("/v1/game/play/raid", { player: alice, commands: [{ id: "r-1", do: "trail", trail: 0 }] }),
      alice,
    );
    expect(raid).toMatchObject({ status: 429, body: { code: "slow_down" } });
    expect(await act(id, alice, holds(39, 1))).toMatchObject({ status: 429 });
    // Sent again, what was done before takes nothing of it.
    expect((await act(id, alice, holds(0, 39))).status).toBe(200);
  });
});

/** A field of a JSON object, or undefined when the value is not an object or lacks it. */
function field(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null ? Object.getOwnPropertyDescriptor(value, key)?.value : undefined;
}
