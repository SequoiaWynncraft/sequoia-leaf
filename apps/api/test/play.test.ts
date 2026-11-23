import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { type Game, leaf, MOST_COMMANDS, type PlayerId, playerId } from "@sequoia-leaf/core";
import { PULLS } from "@sequoia-leaf/pulls";
import {
  planCommands,
  RAID,
  type RaidCommand,
  readNotes,
  readView,
  SENSIBLE,
  type TableView,
} from "@sequoia-leaf/raid";
import { decodeTown, readView as readTownView, type TownView } from "@sequoia-leaf/town";
import {
  check,
  clockOf,
  deliver,
  isFilled,
  ITEMS,
  LEAD,
  play as playWorks,
  readAnswer,
  readView as readYardView,
  route,
  stepTo,
  swapRefusal,
  TICK_MS,
  WORKS,
  type World,
} from "@sequoia-leaf/yard";
import mid from "@sequoia-leaf/yard/yards/mid.json";
import { Effect, Exit, Fiber, Logger, Option, References, Schema } from "effect";
import { SqlClient } from "effect/sql";

import { Banners, Person, Standings } from "../src/api/schemas.ts";
import type { Settings } from "../src/config.ts";
import { knownAmong } from "../src/game/known.ts";
import { PlayerNames } from "../src/game/names.ts";
import { Coins } from "../src/play/coins.ts";
import { GAMES, type Played, played } from "../src/play/games.ts";
import { Play, TEND_AFTER } from "../src/play/service.ts";
import { ACTIVITY_KEPT_MS, ANSWERS_KEPT, BOARD_MOST, IDLE_MS, LOGGED_A_DAY, PlayStore } from "../src/play/store.ts";
import { DAY, fakeBackend, fakeMojang, type Fakes, noNetwork, sessionOf, steadyDice, testLeaf } from "./support.ts";

const alice = playerId("10000000-0000-0000-0000-000000000001");
const bob = playerId("10000000-0000-0000-0000-000000000002");
const carol = playerId("10000000-0000-0000-0000-000000000003");
const dave = playerId("10000000-0000-0000-0000-000000000004");
/** Wednesday 25 November 2026, 12:00 UTC. */
const T0 = Date.UTC(2026, 10, 25, 12);
const ORIGIN = "https://leaf.seqwawa.com";
const SESSIONS: Record<PlayerId, string> = { [alice]: "alice-token", [bob]: "bob-token", [carol]: "carol-token" };

const clock = { now: T0 };
let services: ReturnType<typeof testLeaf>;
let app: ReturnType<(typeof services)["app"]>;

function start(fakes: Fakes = {}, config: Partial<Settings> = {}) {
  clock.now = T0;
  const fake = fakeBackend({
    "alice-token": () => Response.json(sessionOf(alice, "Alice", "CAPTAIN")),
    "bob-token": () => Response.json(sessionOf(bob, "Bob", "RECRUIT")),
    "carol-token": () => Response.json(sessionOf(carol, "Carol", null)),
    // A website admin, the guild's staff, for the report of who played.
    "dave-token": () => Response.json({ ...sessionOf(dave, "Dave", null), website_admin: true }),
  });
  services = testLeaf(clock, fake.fetcher, config, { dice: steadyDice(7), ...fakes });
  app = services.app();
}

beforeEach(() => start());
afterEach(async () => {
  await app.dispose();
});

/**
 * A request as the game's page sends it: the website's cookie, from Leaf's own page, and in a body
 * that is an object, the player the page believes it is (unless the body names one itself).
 */
function send(method: string, path: string, body?: unknown, player: PlayerId = alice): Promise<Response> {
  const sent = typeof body === "object" && body !== null && !Array.isArray(body) ? { player, ...body } : body;
  return Promise.resolve(
    app.request(path, {
      method,
      headers: { Cookie: `seq_session=${SESSIONS[player]}`, Origin: ORIGIN, "Content-Type": "application/json" },
      ...(sent === undefined ? {} : { body: typeof sent === "string" ? sent : JSON.stringify(sent) }),
    }),
  );
}

const Shown = Schema.Struct({ rev: Schema.Number, now: Schema.String, state: Schema.Unknown });
const Answered = Schema.Struct({
  ...Shown.fields,
  results: Schema.Array(
    Schema.Union([
      Schema.Struct({ id: Schema.String, notes: Schema.Array(Schema.Unknown) }),
      Schema.Struct({ id: Schema.String, refused: Schema.String }),
    ]),
  ),
});
const ErrorAnswer = Schema.Struct({ code: Schema.String });

/** The raid's state as Leaf shows it, read back by the rules. */
function viewOf(state: unknown): TableView {
  const view = readView(state);
  if (!view) throw new Error(`Not a raid table: ${JSON.stringify(state)}`);
  return view;
}

async function opened(player: PlayerId = alice) {
  const response = await send("GET", "/v1/game/play/raid", undefined, player);
  expect(response.status).toBe(200);
  const body = Schema.decodeUnknownSync(Shown)(await response.json());
  return { ...body, view: viewOf(body.state) };
}

let made = 0;
/** Commands with ids of their own, as the page gives them. */
const ided = (commands: readonly RaidCommand[]) => commands.map(command);
/** One command with an id of its own. */
const command = (c: RaidCommand) => ({ id: `c-${++made}`, ...c });
/** As many rustles as asked, each with an id of its own. */
const rustles = (n: number) => ided(Array.from({ length: n }, () => ({ do: "rustle" }) as const));

async function commanded(commands: readonly unknown[], player: PlayerId = alice) {
  // A player at the table sends a batch now and then, well inside what Leaf lets them: ten commands a second.
  clock.now += Math.max(1, commands.length) * 100;
  const response = await send("POST", "/v1/game/play/raid", { commands }, player);
  expect(response.status).toBe(200);
  const body = Schema.decodeUnknownSync(Answered)(await response.json());
  return { ...body, view: viewOf(body.state) };
}

async function codeOf(response: Response): Promise<string> {
  return Schema.decodeUnknownSync(ErrorAnswer)(await response.json()).code;
}

const coinsOf = async (player: PlayerId) =>
  Schema.decodeUnknownSync(Schema.Struct({ coins: Schema.Number }))(
    await (await send("GET", "/v1/game/me", undefined, player)).json(),
  ).coins;

const entries = (player: PlayerId) =>
  services.query(
    (sql) => sql`SELECT amount, reason, game, key FROM coin_entries WHERE player_id = ${player} ORDER BY id`,
  );
const stored = (player: PlayerId, game = "raid") =>
  services.query((sql) => sql`SELECT rev, state FROM play_state WHERE player_id = ${player} AND game = ${game}`);

/** A shop where each lantern costs what the command says: a game that spends Coins, which the raid never does. */
const SHOP: Game<{ bought: number }, { price: number }, { bought: number }, string> = {
  id: "town",
  create: () => ({ bought: 0 }),
  advance: (state) => state,
  apply: (state, bought) => ({
    state: { bought: state.bought + 1 },
    notes: ["a lantern"],
    coins: [{ amount: -bought.price, reason: "A lantern", key: `lantern:${state.bought + 1}` }],
  }),
  view: (state) => state,
  decode: (text) => {
    const v: unknown = JSON.parse(text);
    return typeof v === "object" && v !== null && "bought" in v && typeof v.bought === "number"
      ? { bought: v.bought }
      : null;
  },
  encode: (state) => JSON.stringify(state),
  command: (v) =>
    typeof v === "object" && v !== null && "price" in v && typeof v.price === "number" ? { price: v.price } : null,
};

describe("a new player", () => {
  it("gets a new table, untouched, and 300 Coins, once", async () => {
    const first = await opened();
    expect(first.rev).toBe(0);
    expect(first.view.run).toBeNull();
    expect(first.now).toBe(new Date(clock.now).toISOString());
    const again = await opened();
    expect(again.state).toEqual(first.state);
    expect(await coinsOf(alice)).toBe(300);
    expect(await coinsOf(alice)).toBe(300);
    expect(await entries(alice)).toEqual([
      { amount: 300, reason: "Welcome to Guild Town", game: null, key: `welcome:${alice}` },
    ]);
    expect(await stored(alice)).toEqual([{ rev: 0, state: expect.any(String) }]);
  });

  it("is a guest as readily as a member", async () => {
    const table = await opened(carol);
    expect(table.view.run).toBeNull();
    const done = await commanded(ided([{ do: "start", trail: 0 }]), carol);
    expect(done.view.run?.choices[0]?.kind).toBe("starter");
    expect(await coinsOf(carol)).toBe(300);
  });
});

/**
 * Plays a whole run by commands, from setting out to its end, each batch planned from Leaf's answer
 * to the last. Answers the Coins it paid, the last batch sent, the table after it and its `rev`.
 */
async function playRun(player: PlayerId = alice) {
  let view = (await opened(player)).view;
  let rev = 0;
  const take = (answer: Awaited<ReturnType<typeof commanded>>) => {
    expect(answer.rev).toBeGreaterThan(rev);
    rev = answer.rev;
    view = answer.view;
    return answer;
  };
  take(await commanded(ided([{ do: "start", trail: 0 }]), player));
  let paid = 0;
  let last: unknown[] = [];
  for (let room = 0; room < 40 && view.run; room++) {
    for (let again = 0; again < 30; again++) {
      const commands = planCommands(view, SENSIBLE);
      if (commands.length === 0) break;
      // oxlint-disable-next-line no-await-in-loop -- each batch is planned from Leaf's answer to the last
      take(await commanded(ided(commands), player));
    }
    last = ided([{ do: "fight" }, { do: "take" }]);
    // oxlint-disable-next-line no-await-in-loop -- the next room is planned from Leaf's answer
    const answer = take(await commanded(last, player));
    const notes = answer.results.flatMap((r) => ("notes" in r ? (readNotes(r.notes) ?? []) : []));
    for (const note of notes) if (note.t === "ended") paid = note.paid.coins;
  }
  return { paid, last, view, rev };
}

describe("a whole run, played by commands through HTTP", () => {
  it("goes from a new table to its end, paying its Coins once and logging what happened", async () => {
    const { paid, last, view, rev } = await playRun();
    expect(view.run).toBeNull();
    expect(paid).toBeGreaterThan(0);
    expect(await coinsOf(alice)).toBe(300 + paid);
    expect(await entries(alice)).toEqual([
      { amount: 300, reason: "Welcome to Guild Town", game: null, key: `welcome:${alice}` },
      { amount: paid, reason: "The Little Raid", game: "raid", key: `raid:${alice}:run:1` },
    ]);
    // The last batch sent again is answered the same, and pays nothing more.
    const repeat = await commanded(last);
    expect(repeat.rev).toBe(rev);
    expect(await coinsOf(alice)).toBe(300 + paid);

    // What the run did is in the activity, in order.
    const activity = await services.run(PlayStore.use((store) => store.activity(alice)));
    const kinds = activity.map((a) => a.kind);
    expect(kinds[0]).toBe("raid_started");
    expect(kinds.at(-1)).toBe("raid_ended");
    expect(kinds.slice(1, -1).every((k) => k === "raid_room")).toBe(true);
    expect(activity.every((a) => a.game === "raid" && a.playerId === alice && a.at > T0)).toBe(true);
    expect(activity.map((a) => a.at)).toEqual(activity.map((a) => a.at).toSorted((a, b) => a - b));
    const rooms = activity.filter((a) => a.kind === "raid_room").map((a) => JSON.parse(a.data));
    expect(rooms[0]).toEqual({
      room: 1,
      kind: "trouble",
      won: expect.any(Boolean),
      resolve: expect.any(Number),
      seconds: expect.any(Number),
    });
    expect(JSON.parse(activity.at(-1)?.data ?? "{}")).toEqual({
      trail: 0,
      rooms_won: expect.any(Number),
      ended: expect.stringMatching(/^(won|lost)$/),
      coins: paid,
    });
    expect(JSON.parse(activity[0]?.data ?? "{}")).toEqual({ trail: 0 });
  });
});

/** The report of who played, as the staff read it. */
async function report() {
  const response = await app.request("/v1/game/admin/activity", { headers: { Authorization: "Bearer dave-token" } });
  expect(response.status).toBe(200);
  return Schema.decodeUnknownSync(
    Schema.Struct({
      raid: Schema.Struct({
        began: Schema.Number,
        runs: Schema.Array(Schema.Struct({ rooms_won: Schema.Number, runs: Schema.Number })),
      }),
      odd: Schema.Array(
        Schema.Struct({ id: Schema.String, rule: Schema.String, at: Schema.String, value: Schema.Number }),
      ),
    }),
  )(await response.json());
}

describe("the staff's report", () => {
  it("shows the runs begun and how far they got, from what a played run logged", async () => {
    await playRun();
    // A second run, set out on and one room fought, still going.
    let view = (await commanded(ided([{ do: "start", trail: 0 }]))).view;
    for (let again = 0; again < 30; again++) {
      const commands = planCommands(view, SENSIBLE);
      if (commands.length === 0) break;
      // oxlint-disable-next-line no-await-in-loop -- each batch is planned from Leaf's answer to the last
      view = (await commanded(ided(commands))).view;
    }
    await commanded(ided([{ do: "fight" }, { do: "take" }]));

    // How many rooms each run won, as the raid logged them.
    const activity = await services.run(PlayStore.use((store) => store.activity(alice)));
    const won: number[] = [];
    for (const a of activity) {
      if (a.kind === "raid_started") won.push(0);
      else if (a.kind === "raid_room" && JSON.parse(a.data).won === true) won[won.length - 1] = (won.at(-1) ?? 0) + 1;
    }
    const ended = activity.find((a) => a.kind === "raid_ended");
    expect(won).toHaveLength(2);
    expect(JSON.parse(ended?.data ?? "{}").rooms_won).toBe(won[0]);
    const runs = [...new Set(won)]
      .toSorted((a, b) => a - b)
      .map((n) => ({ rooms_won: n, runs: won.filter((w) => w === n).length }));
    expect((await report()).raid).toEqual({ began: 2, runs });
  });

  it("counts each player's commands done and refused by the day, once each, and lists a day with more refused", async () => {
    await commanded(ided([{ do: "start", trail: 0 }]));
    const refusals = ided([{ do: "take" }, { do: "take" }, { do: "fight" }]);
    const refused = await commanded(refusals);
    expect(refused.results.every((r) => "refused" in r)).toBe(true);
    // Sent again, they are answered from before and not counted again; a batch that is not commands counts nothing.
    await commanded(refusals);
    clock.now += 100;
    expect((await send("POST", "/v1/game/play/raid", { commands: [{ id: "x-1", do: "win" }] })).status).toBe(400);
    expect(
      await services.query((sql) => sql`SELECT player_id, day, done, refused FROM command_days ORDER BY player_id`),
    ).toEqual([{ player_id: alice, day: Date.UTC(2026, 10, 25), done: 1, refused: 3 }]);
    expect((await report()).odd).toEqual([
      { id: alice, rule: "refused_in_a_day", at: new Date(Date.UTC(2026, 10, 25)).toISOString(), value: 3 },
    ]);
    // Done as often as refused is not worth a look.
    await commanded(ided([{ do: "choose", option: 0 }, { do: "rustle" }]));
    expect((await report()).odd).toEqual([]);
  });
});

describe("commands", () => {
  it("are done once: one sent again answers what it answered then and changes nothing", async () => {
    const batch = ided([
      { do: "start", trail: 0 },
      { do: "choose", option: 0 },
    ]);
    const first = await commanded(batch);
    expect(first.rev).toBe(1);
    const again = await commanded(batch);
    expect(again.results).toEqual(first.results);
    expect(again.rev).toBe(1);
    expect(again.state).toEqual(first.state);
    // Even beside a new command in the same batch.
    const rustle = command({ do: "rustle" });
    const mixed = await commanded([...batch, rustle]);
    expect(mixed.results.slice(0, 2)).toEqual([...first.results]);
    expect(mixed.results[2]).toMatchObject({ id: rustle.id, notes: [{ t: "rustled" }] });
    expect(mixed.rev).toBe(2);
    // Sent again after that, it answers what it did then, with the state as it stands now.
    const later = await commanded(batch);
    expect(later.results).toEqual(first.results);
    expect(later.rev).toBe(2);
    expect(later.state).toEqual(mixed.state);
  });

  it("refused say why and change nothing", async () => {
    const begun = await commanded(ided([{ do: "start", trail: 0 }]));
    const take = command({ do: "take" });
    const refused = await commanded([take]);
    expect(refused.results).toEqual([{ id: take.id, refused: "no_fight" }]);
    expect(refused.rev).toBe(begun.rev);
    expect(refused.state).toEqual(begun.state);
    // One refused does not stop the rest.
    const bad = command({ do: "buy", offer: 0 });
    const good = command({ do: "choose", option: 1 });
    const both = await commanded([bad, good]);
    expect(both.results[0]).toEqual({ id: bad.id, refused: "pick_starter" });
    expect(both.results[1]).toMatchObject({ id: good.id, notes: [{ t: "starter" }] });
  });

  it("have only each player's newest 256 answers to a game kept, each as its notes or refusal and never the state", async () => {
    const setOut = command({ do: "start", trail: 0 });
    const first = [setOut];
    await commanded(first);
    // 288 more, each refused (the starter is still to be picked), in batches of 32, at the pace Leaf allows.
    for (let batch = 0; batch < 9; batch++) {
      clock.now += 4000;
      // oxlint-disable-next-line no-await-in-loop -- in order
      await commanded(rustles(MOST_COMMANDS));
    }
    const kept = await services.query(
      (sql) =>
        sql`SELECT command_id, result FROM play_commands WHERE player_id = ${alice} AND game = 'raid' ORDER BY id`,
    );
    expect(kept).toHaveLength(ANSWERS_KEPT);
    expect(kept.at(-1)).toEqual({ command_id: `c-${made}`, result: '{"refused":"pick_starter"}' });
    expect(kept.some((row) => Object(row).command_id === setOut.id)).toBe(false);
    // The first is no longer known: sent again it is done again (and setting out again, with no room fought, changes nothing).
    clock.now += 4000;
    const again = await commanded(first);
    expect(again.results).toEqual([{ id: setOut.id, notes: [] }]);
    expect(again.rev).toBe(1);
  });

  it("are all done in one transaction: a failure in the middle of a batch leaves nothing half done", async () => {
    await app.dispose();
    let logs = 0;
    start({
      play: (real) => ({
        ...real,
        log: (player, game, logged, now) =>
          Effect.suspend(() => {
            logs += 1;
            return logs === 1 ? Effect.die(new Error("the disk is full")) : real.log(player, game, logged, now);
          }),
      }),
    });
    // What setting out logs is written after the commands are done and the state is: and that fails.
    const batch = ided([{ do: "start", trail: 0 }, { do: "choose", option: 0 }, { do: "rustle" }]);
    const failed = await send("POST", "/v1/game/play/raid", { commands: batch });
    expect(failed.status).toBe(500);
    expect(await codeOf(failed)).toBe("internal_error");
    expect(await stored(alice)).toEqual([]);
    // Her Coins opened with the welcome as her first table was made, before the batch was done to it.
    expect(await entries(alice)).toEqual([
      { amount: 300, reason: "Welcome to Guild Town", game: null, key: `welcome:${alice}` },
    ]);
    expect(await services.query((sql) => sql`SELECT count(*) AS n FROM activity`)).toEqual([{ n: 0 }]);
    expect(await services.query((sql) => sql`SELECT count(*) AS n FROM play_commands`)).toEqual([{ n: 0 }]);
    // Sent again once the disk has room, the batch is done whole, as if for the first time.
    const done = await commanded(batch);
    expect(done.results.map((r) => ("notes" in r ? "done" : r.refused))).toEqual(["done", "done", "done"]);
    expect(done.view.runs).toBe(1);
    expect(done.view.run?.rustles).toBe(0);
    expect(await services.query((sql) => sql`SELECT kind FROM activity`)).toEqual([{ kind: "raid_started" }]);
  });

  it("that are not the game's, or a batch that is not one, are refused whole and do nothing", async () => {
    await opened();
    const cases: unknown[] = [
      { commands: [{ id: "x-1", do: "win" }] },
      { commands: [{ do: "rustle" }] },
      { commands: [{ id: "has space", do: "rustle" }] },
      {
        commands: [
          { id: "x-2", do: "start", trail: 0 },
          { id: "x-2", do: "rustle" },
        ],
      },
      { commands: Array.from({ length: MOST_COMMANDS + 1 }, (_, i) => ({ id: `x-${i + 3}`, do: "rustle" })) },
      { orders: [] },
      "not json",
      [],
    ];
    const answers = await Promise.all(cases.map((body) => send("POST", "/v1/game/play/raid", body)));
    expect(answers.map((response) => response.status)).toEqual(cases.map(() => 400));
    expect(await Promise.all(answers.map(codeOf))).toEqual(cases.map(() => "invalid_command"));
    expect(await stored(alice)).toEqual([{ rev: 0, state: expect.any(String) }]);
  });

  it("go only to a game Leaf plays", async () => {
    const paths = ["/v1/game/play/chess", "/v1/game/play/lobby"];
    const answers = await Promise.all(
      paths.flatMap((path) => [send("GET", path), send("POST", path, { commands: [] })]),
    );
    expect(answers.map((response) => response.status)).toEqual(answers.map(() => 404));
    expect(await Promise.all(answers.map(codeOf))).toEqual(answers.map(() => "no_such_game"));
  });
});

describe("a stored state that does not read", () => {
  it("answers 409 state_unreadable to the page, changes nothing, and logs whose it is", async () => {
    await commanded(ided([{ do: "start", trail: 0 }]));
    // As a rules change that forgot the stored version would leave it.
    await services.query((sql) => sql`UPDATE play_state SET state = '{"game":"little-raid-table","v":0}'`);
    const before = await stored(alice);
    const opening = await send("GET", "/v1/game/play/raid");
    expect([opening.status, await codeOf(opening)]).toEqual([409, "state_unreadable"]);
    const batch = await send("POST", "/v1/game/play/raid", { commands: ided([{ do: "rustle" }]) });
    expect([batch.status, await codeOf(batch)]).toEqual([409, "state_unreadable"]);
    expect(await stored(alice)).toEqual(before);
    expect(await services.query((sql) => sql`SELECT count(*) AS n FROM play_commands`)).toEqual([{ n: 1 }]);
    // What the staff find in the log.
    const logs: unknown[] = [];
    const capture = Logger.layer([Logger.make(({ message }) => void logs.push(message))]);
    const sent = await services.run(
      Play.use((play) =>
        play.send({ playerId: alice, guest: false }, played(RAID), [{ id: "u-1", do: "rustle" }]),
      ).pipe(Effect.provide(capture), Effect.provideService(References.MinimumLogLevel, "All")),
    );
    expect(sent).toEqual({ status: "unreadable" });
    expect(logs).toEqual([[`The raid state stored for ${alice} does not read; it is kept as it is`]]);
  });
});

describe("one player's game", () => {
  it("cannot be read or commanded by another: each has their own, by their session", async () => {
    await commanded(
      ided([
        { do: "start", trail: 0 },
        { do: "choose", option: 0 },
      ]),
      alice,
    );
    const bobs = await opened(bob);
    expect(bobs.view.run).toBeNull();
    expect(bobs.rev).toBe(0);
    // The same command id from Bob is Bob's own command, not an echo of Alice's answer.
    const shared = [{ id: "c-shared", do: "start", trail: 0 }];
    const fromAlice = await commanded(shared, alice);
    const fromBob = await commanded(shared, bob);
    expect(fromBob.results[0]).toMatchObject({ notes: [{ t: "started", run: 1 }] });
    // Alice's raid has fought no room yet, so setting out again leaves it as it is.
    expect(fromAlice.results[0]).toEqual({ id: "c-shared", notes: [] });
    expect((await opened(alice)).view.run?.choices).toEqual([]);
    expect((await opened(bob)).view.run?.choices[0]?.kind).toBe("starter");
  });

  it("is commanded only by a page that is the session's player: another gets 409 not_you, and nothing is done", async () => {
    await opened();
    const fromBobsPage = await send("POST", "/v1/game/play/raid", {
      player: bob,
      commands: ided([{ do: "start", trail: 0 }]),
    });
    expect(fromBobsPage.status).toBe(409);
    expect(await codeOf(fromBobsPage)).toBe("not_you");
    const unnamed = await app.request("/v1/game/play/raid", {
      method: "POST",
      headers: { Cookie: "seq_session=alice-token", Origin: ORIGIN, "Content-Type": "application/json" },
      body: JSON.stringify({ commands: ided([{ do: "start", trail: 0 }]) }),
    });
    expect(unnamed.status).toBe(400);
    expect(await codeOf(unnamed)).toBe("invalid_command");
    expect(await stored(alice)).toEqual([{ rev: 0, state: expect.any(String) }]);
    expect(await services.query((sql) => sql`SELECT count(*) AS n FROM play_commands`)).toEqual([{ n: 0 }]);
  });

  it("needs a session, and a write with the cookie must come from Leaf's own pages", async () => {
    expect((await app.request("/v1/game/play/raid")).status).toBe(401);
    const elsewhere = await app.request("/v1/game/play/raid", {
      method: "POST",
      headers: {
        Cookie: "seq_session=alice-token",
        Origin: "https://evil.example",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ player: alice, commands: [{ id: "c-x", do: "start", trail: 0 }] }),
    });
    expect(elsewhere.status).toBe(403);
    expect(await codeOf(elsewhere)).toBe("bad_origin");
    expect(await stored(alice)).toEqual([]);
  });
});

describe("the limits", () => {
  it("are ten batches a second, in bursts of twenty: more gets slow_down and does nothing", async () => {
    await opened();
    const burst = await Promise.all(
      Array.from({ length: 20 }, () => send("POST", "/v1/game/play/raid", { commands: [] })),
    );
    expect(burst.map((response) => response.status)).toEqual(burst.map(() => 200));
    const tooMany = await send("POST", "/v1/game/play/raid", { commands: ided([{ do: "start", trail: 0 }]) });
    expect(tooMany.status).toBe(429);
    expect(await codeOf(tooMany)).toBe("slow_down");
    expect(await stored(alice)).toEqual([{ rev: 0, state: expect.any(String) }]);
    // A tenth of a second later there is room for one more.
    clock.now += 100;
    expect((await send("POST", "/v1/game/play/raid", { commands: [] })).status).toBe(200);
    expect((await send("POST", "/v1/game/play/raid", { commands: [] })).status).toBe(429);
    // Another player has their own allowance.
    expect((await send("POST", "/v1/game/play/raid", { commands: [] }, bob)).status).toBe(200);
  });

  it("are ten commands a second done, in bursts of forty, across all games: a batch past it is refused whole", async () => {
    await opened();
    const post = (commands: readonly unknown[], player: PlayerId = alice) =>
      send("POST", "/v1/game/play/raid", { commands }, player);
    clock.now += 100;
    expect((await post(rustles(MOST_COMMANDS))).status).toBe(200);
    // Eight are left: a batch of nine, setting out first, is refused whole, and nothing is done.
    const nine = [command({ do: "start", trail: 0 }), ...rustles(8)];
    const past = await post(nine);
    expect(past.status).toBe(429);
    expect(await codeOf(past)).toBe("slow_down");
    expect(await stored(alice)).toEqual([{ rev: 0, state: expect.any(String) }]);
    // A tenth of a second later there is room for nine.
    clock.now += 100;
    expect((await post(nine)).status).toBe(200);
    expect(await stored(alice)).toEqual([{ rev: 1, state: expect.any(String) }]);
    // And none left for another game's command either.
    const elsewhere = await services.run(
      Play.use((play) => play.send({ playerId: alice, guest: false }, played(SHOP), [{ id: "l-1", price: 1 }])),
    );
    expect(elsewhere).toEqual({ status: "slow" });
    // Another player has their own.
    expect((await post(rustles(MOST_COMMANDS), bob)).status).toBe(200);
  });

  it("read no body over 16 KiB", async () => {
    const big = { commands: [{ id: "c-big", do: "start", trail: 0, padding: "x".repeat(17 * 1024) }] };
    const response = await send("POST", "/v1/game/play/raid", big);
    expect(response.status).toBe(413);
    expect(await codeOf(response)).toBe("body_too_large");
  });
});

describe("the view", () => {
  it("never holds the stream, though Leaf keeps one", async () => {
    const done = await commanded(ided([{ do: "start", trail: 0 }, { do: "choose", option: 0 }, { do: "fight" }]));
    const shown = JSON.stringify(done.state);
    const [row] = await stored(alice);
    const kept = Schema.decodeUnknownSync(Schema.Struct({ state: Schema.String }))(row).state;
    expect(kept).toContain('"rng"');
    expect(shown).not.toContain('"rng"');
    // The fight's seed is shown, now that the boards are locked; the run's own seed never is.
    const run = done.view.run;
    expect(run && "seed" in run).toBe(false);
    expect(Object.keys(Object(Object(done.state).run))).not.toContain("seed");
    expect(run?.fight?.setup.seed).toEqual(expect.any(Number));
  });
});

describe("Coins", () => {
  it("are taken by a command only while the balance covers them; otherwise it is refused, in the same transaction", async () => {
    const shop = played(SHOP);
    const batch = await services.run(
      Play.use((play) =>
        play.send({ playerId: alice, guest: false }, shop, [
          { id: "l-1", price: 200 },
          { id: "l-2", price: 200 },
          { id: "l-3", price: 100 },
        ]),
      ),
    );
    expect(batch).toMatchObject({
      status: "done",
      rev: 1,
      results: [
        { id: "l-1", notes: ["a lantern"] },
        { id: "l-2", refused: "not_enough_coins" },
        { id: "l-3", notes: ["a lantern"] },
      ],
      view: { bought: 2 },
    });
    expect(await coinsOf(alice)).toBe(0);
    expect(await entries(alice)).toEqual([
      { amount: 300, reason: "Welcome to Guild Town", game: null, key: `welcome:${alice}` },
      { amount: -200, reason: "A lantern", game: "town", key: `town:${alice}:lantern:1` },
      { amount: -100, reason: "A lantern", game: "town", key: `town:${alice}:lantern:2` },
    ]);
  });
});

/** A stall that sells for what the command says: a game that pays Coins in, as much as it is told to. */
const STALL: typeof SHOP = {
  ...SHOP,
  id: "works",
  apply: (state, sold) => ({
    state: { bought: state.bought + 1 },
    notes: ["sold"],
    coins: [{ amount: sold.price, reason: "A sale", key: `sale:${state.bought + 1}` }],
  }),
};

describe("what play pays", () => {
  it("is at most 5,000 Coins in any hour and 20,000 in a UTC day, whatever the games: past it a command is done all the same and pays what is left", async () => {
    clock.now = Date.UTC(2026, 10, 25, 1);
    const stall = played(STALL);
    const sold = async (id: string, price: number) => {
      const batch = await services.run(
        Play.use((play) => play.send({ playerId: alice, guest: false }, stall, [{ id, price }])),
      );
      expect(batch).toMatchObject({ status: "done", results: [{ id, notes: ["sold"] }] });
      return coinsOf(alice);
    };

    expect(await sold("s-1", 4000)).toBe(4300);
    expect(await sold("s-2", 4000)).toBe(5300);
    expect(await sold("s-3", 50)).toBe(5300);
    expect(await entries(alice)).toEqual([
      { amount: 300, reason: "Welcome to Guild Town", game: null, key: `welcome:${alice}` },
      { amount: 4000, reason: "A sale", game: "works", key: `works:${alice}:sale:1` },
      { amount: 1000, reason: "A sale", game: "works", key: `works:${alice}:sale:2` },
    ]);
    // An hour on, the hour's room is back; the day's 20,000 still stands.
    for (const hour of [3, 5, 7]) {
      clock.now = Date.UTC(2026, 10, 25, hour);
      // oxlint-disable-next-line no-await-in-loop -- in order
      await sold(`h-${hour}`, 9000);
    }
    expect(await coinsOf(alice)).toBe(20_300);
    clock.now = Date.UTC(2026, 10, 25, 23);
    expect(await sold("s-4", 9000)).toBe(20_300);
    clock.now = Date.UTC(2026, 10, 26);
    expect(await sold("s-5", 9000)).toBe(25_300);
  });
});

/**
 * A till like the Works': each command pays in what it is told, free of the cap or not, and then
 * takes a price.
 */
const TILL: Game<{ bought: number }, { pay: number; price: number; free: boolean }, { bought: number }, string> = {
  ...SHOP,
  id: "works",
  apply: (state, c) => ({
    state: { bought: state.bought + 1 },
    notes: ["paid"],
    coins: [
      ...(c.pay > 0
        ? [
            {
              amount: c.pay,
              reason: "The till",
              key: `till:${state.bought}`,
              ...(c.free ? { free: true as const } : {}),
            },
          ]
        : []),
      ...(c.price > 0 ? [{ amount: -c.price, reason: "A price", key: `price:${state.bought}` }] : []),
    ],
  }),
  command: (v) =>
    typeof v === "object" &&
    v !== null &&
    "pay" in v &&
    typeof v.pay === "number" &&
    "price" in v &&
    typeof v.price === "number" &&
    "free" in v &&
    typeof v.free === "boolean"
      ? { pay: v.pay, price: v.price, free: v.free }
      : null,
};

describe("a command's Coins", () => {
  const till = played(TILL);
  const paid = (id: string, pay: number, price: number, free = true) =>
    services.run(Play.use((play) => play.send({ playerId: alice, guest: false }, till, [{ id, pay, price, free }])));

  it("are worked out in order from the balance: a till paid in and then a price taken is done; a price without it is refused, and nothing of it kept", async () => {
    expect(await paid("t-1", 500, 700)).toMatchObject({
      results: [{ id: "t-1", notes: ["paid"] }],
      view: { bought: 1 },
    });
    expect(await coinsOf(alice)).toBe(100);
    expect(await paid("t-2", 0, 200)).toMatchObject({ results: [{ id: "t-2", refused: "not_enough_coins" }] });
    expect(await paid("t-3", 50, 400)).toMatchObject({
      results: [{ id: "t-3", refused: "not_enough_coins" }],
      view: { bought: 1 },
    });
    expect(await coinsOf(alice)).toBe(100);
    expect(await entries(alice)).toEqual([
      { amount: 300, reason: "Welcome to Guild Town", game: null, key: `welcome:${alice}` },
      { amount: 500, reason: "The till", game: "works", key: `works:${alice}:till:0` },
      { amount: -700, reason: "A price", game: "works", key: `works:${alice}:price:0` },
    ]);
  });

  it("that are free are paid past the cap, and leave what may still be earned as it was", async () => {
    clock.now = Date.UTC(2026, 10, 25, 1);
    const room = () => services.run(Coins.use((coins) => coins.room(alice, clock.now)));
    await paid("t-1", 4000, 0, false);
    expect(await room()).toBe(1000);
    await paid("t-2", 3000, 0);
    expect(await coinsOf(alice)).toBe(7300);
    expect(await room()).toBe(1000);
    await paid("t-3", 3000, 0, false);
    expect(await coinsOf(alice)).toBe(8300);
    expect(await room()).toBe(0);
    expect(
      await services.query((sql) => sql`SELECT amount, earned FROM coin_entries WHERE game = 'works' ORDER BY id`),
    ).toEqual([
      { amount: 4000, earned: 1 },
      { amount: 3000, earned: 0 },
      { amount: 1000, earned: 1 },
    ]);
  });
});

/** A player's entries on the Leaf ledger. */
const ledgerOf = (player: PlayerId) =>
  services.query(
    (sql) => sql`
      SELECT kind, origin, idempotency_key AS key, balance_delta AS delta, xp_delta AS xp, memo
      FROM ledger_entries WHERE player_id = ${player} ORDER BY id
    `,
  );
/** Leaf earned by a player, as a raid would pay it. */
const raided = (player: PlayerId, amount: number) =>
  services.post(
    { kind: "earn", playerId: player, amount: leaf(amount), source: "raid", idempotencyKey: `raid:${player}` },
    clock.now,
  );
/** Leaf with its spending on, as `GAME_LEAF_SPENDING` sets it. */
async function spending() {
  await app.dispose();
  start({}, { gameLeafSpending: true });
}
/** What a refused command must leave as it was: the state, the ledger and the Coins. */
const untouched = async (player: PlayerId, game = "raid") => [
  await stored(player, game),
  await ledgerOf(player),
  await entries(player),
];
const buyCloth = (look: string) => command({ do: "buyLook", kind: "cloth", look });

describe("Leaf a command takes", () => {
  it("buys a look through HTTP once: taken from the ledger as a spend on the shop sink, logged, with no XP or Coins", async () => {
    await spending();
    await raided(alice, 30_000);
    await opened();
    const buy = buyCloth("plum");
    const done = await commanded([buy]);
    expect(done.results).toEqual([{ id: buy.id, notes: [{ t: "look", kind: "cloth", id: "plum" }] }]);
    expect(done.view.looks).toEqual({ cloth: "plum", lantern: "iron", bases: "plain", owned: ["plum"] });
    expect(await services.account(alice)).toEqual({ playerId: alice, balance: 2000, xp: 30_000 });
    const spent = {
      kind: "spend",
      origin: "shop",
      key: `play:raid:${alice}:look:plum`,
      delta: -28_000,
      xp: 0,
      memo: "Raid table look: Dusk velvet",
    };
    expect(await ledgerOf(alice)).toEqual([
      { kind: "earn", origin: "raid", key: `raid:${alice}`, delta: 30_000, xp: 30_000, memo: null },
      spent,
    ]);
    // The same command sent again answers as before and takes nothing; buying it again is refused.
    expect((await commanded([buy])).results).toEqual(done.results);
    const again = buyCloth("plum");
    expect((await commanded([again])).results).toEqual([{ id: again.id, refused: "owned" }]);
    expect((await ledgerOf(alice)).slice(1)).toEqual([spent]);
    expect(await coinsOf(alice)).toBe(300);
    expect(await services.run(Coins.use((coins) => coins.room(alice, clock.now)))).toBe(5000);
    const activity = await services.run(PlayStore.use((store) => store.activity(alice)));
    expect(activity.map((a) => [a.kind, JSON.parse(a.data)])).toEqual([
      ["leaf_spent", { leaf: 28_000, reason: "Raid table look: Dusk velvet" }],
    ]);
  });

  it("is refused, changing nothing, for too little Leaf, for a guest, and while spending is off", async () => {
    await spending();
    await raided(alice, 20);
    await opened();
    const before = await untouched(alice);
    const dear = command({ do: "buyLook", kind: "bases", look: "gilt" });
    expect((await commanded([dear])).results).toEqual([{ id: dear.id, refused: "not_enough_leaf" }]);
    expect(await untouched(alice)).toEqual(before);
    expect(await services.account(alice)).toMatchObject({ balance: 20 });

    // Carol is signed in but not in the guild: a guest has no Leaf to spend.
    await opened(carol);
    const guest = await untouched(carol);
    const theirs = buyCloth("baize");
    expect((await commanded([theirs], carol)).results).toEqual([{ id: theirs.id, refused: "leaf_closed" }]);
    expect(await untouched(carol)).toEqual(guest);

    await app.dispose();
    start();
    await raided(alice, 100);
    await opened();
    const off = await untouched(alice);
    const shut = buyCloth("baize");
    expect((await commanded([shut])).results).toEqual([{ id: shut.id, refused: "leaf_closed" }]);
    expect(await untouched(alice)).toEqual(off);
  });
});

/**
 * A market whose every sale takes Leaf and pays Coins, each as the command says, with keys the
 * command names: a game that takes Leaf, which the raid does only for its looks.
 */
const MARKET: Game<
  { bought: number },
  { leaf: readonly number[]; keys: readonly string[]; pay: number },
  { bought: number },
  string
> = {
  id: "works",
  create: (ctx) => SHOP.create(ctx),
  advance: (state, ctx) => SHOP.advance(state, ctx),
  view: (state, ctx) => SHOP.view(state, ctx),
  decode: (text) => SHOP.decode(text),
  encode: (state) => SHOP.encode(state),
  apply: (state, c) => ({
    state: { bought: state.bought + 1 },
    notes: ["sold"],
    leaf: c.leaf.map((amount, i) => ({ amount, reason: "A stall", key: c.keys[i] ?? `stall:${i}` })),
    coins: c.pay > 0 ? [{ amount: c.pay, reason: "A sale", key: `sale:${state.bought}` }] : [],
  }),
  command: (v) =>
    typeof v === "object" &&
    v !== null &&
    "leaf" in v &&
    Array.isArray(v.leaf) &&
    v.leaf.every((n) => typeof n === "number") &&
    "keys" in v &&
    Array.isArray(v.keys) &&
    v.keys.every((k) => typeof k === "string") &&
    "pay" in v &&
    typeof v.pay === "number"
      ? { leaf: v.leaf, keys: v.keys, pay: v.pay }
      : null,
};

describe("a command's Leaf", () => {
  const market = played(MARKET);
  const sold = (id: string, leafTaken: readonly number[], keys: readonly string[], pay = 0) =>
    services.run(
      Play.use((play) => play.send({ playerId: alice, guest: false }, market, [{ id, leaf: leafTaken, keys, pay }])),
    );

  it("is weighed with the Coins in the batch's transaction: taken and paid together, added up against the balance", async () => {
    await spending();
    await raided(alice, 100);
    expect(await sold("m-1", [30, 20], ["a", "b"], 500)).toMatchObject({
      results: [{ id: "m-1", notes: ["sold"] }],
      view: { bought: 1 },
    });
    expect(await services.account(alice)).toEqual({ playerId: alice, balance: 50, xp: 100 });
    expect(await coinsOf(alice)).toBe(800);
    // Two spends that come to more than the balance, though each alone would not.
    expect(await sold("m-2", [30, 30], ["c", "d"], 500)).toMatchObject({
      results: [{ id: "m-2", refused: "not_enough_leaf" }],
      view: { bought: 1 },
    });
    expect(await coinsOf(alice)).toBe(800);
    // A key the ledger has seen is not taken again, and the command stands.
    expect(await sold("m-3", [30], ["a"])).toMatchObject({
      results: [{ id: "m-3", notes: ["sold"] }],
      view: { bought: 2 },
    });
    expect(await services.account(alice)).toMatchObject({ balance: 50 });
    expect((await ledgerOf(alice)).map((e) => [e.key, e.delta])).toEqual([
      [`raid:${alice}`, 100],
      [`play:works:${alice}:a`, -30],
      [`play:works:${alice}:b`, -20],
    ]);
  });

  it("that is not a whole number above 0 is the game's defect: the batch is undone whole, and nothing credited", async () => {
    await spending();
    await raided(alice, 100);
    await sold("m-1", [10], ["a"]);
    const before = [await ledgerOf(alice), await entries(alice)];
    for (const [n, bad] of [-50, 0, 2.5].entries()) {
      // oxlint-disable-next-line no-await-in-loop -- one after another
      const exit = await services.run(
        Effect.exit(
          Play.use((play) =>
            play.send({ playerId: alice, guest: false }, market, [
              { id: `x-${n}`, leaf: [bad], keys: [`x-${n}`], pay: 100 },
            ]),
          ),
        ),
      );
      expect(Exit.isFailure(exit)).toBe(true);
    }
    expect([await ledgerOf(alice), await entries(alice)]).toEqual(before);
    expect(await services.account(alice)).toMatchObject({ balance: 90 });
  });
});

const standings = () => services.query((sql) => sql`SELECT * FROM standings`);

describe("a standing", () => {
  // The till, with a board: ten points for each thing bought.
  const till = played({ ...TILL, standing: (state) => ({ score: state.bought * 10, also: { bought: state.bought } }) });
  const paid = (id: string, price: number, playing = { playerId: alice, guest: false }) =>
    services.run(Play.use((play) => play.send(playing, till, [{ id, pay: 0, price, free: true }])));

  it("is written in the transaction of a batch that changed the state, and not by one that changed nothing", async () => {
    expect(await paid("t-1", 1000)).toMatchObject({ results: [{ id: "t-1", refused: "not_enough_coins" }] });
    expect(await standings()).toEqual([]);
    clock.now += 1000;
    await paid("t-2", 100);
    const written = {
      player_id: alice,
      game: "works",
      score: 10,
      also: '{"bought":1}',
      guest: 0,
      updated_at: clock.now,
    };
    expect(await standings()).toEqual([written]);
    clock.now += 1000;
    await paid("t-3", 1000);
    expect(await standings()).toEqual([written]);
    // A guest's says so.
    await paid("t-4", 100, { playerId: carol, guest: true });
    expect(await standings()).toContainEqual({ ...written, player_id: carol, guest: 1, updated_at: clock.now });
  });
});

/** Writes where a player's yard stands, as the play service would have at `at`. */
const stand = (player: PlayerId, score: number, at: number, guest = false) =>
  services.run(
    PlayStore.use((store) => store.stand(player, "works", { score, also: { story: score % 16 } }, guest, at)),
  );
const named = (player: PlayerId, name: string) =>
  services.run(PlayerNames.use((names) => names.remember(player, name, clock.now)));
const boardOf = async (game = "works", player: PlayerId = alice) => {
  const response = await send("GET", `/v1/game/play/${game}/standings`, undefined, player);
  expect(response.status).toBe(200);
  return Schema.decodeUnknownSync(Standings)(await response.json());
};
/** A player nobody has named, nor Leaf knows. */
const stranger = (n: number) => playerId(`20000000-0000-0000-0000-${String(n).padStart(12, "0")}`);
/** A line of the Works' board, as the route answers it. */
const row = (place: number, id: PlayerId, name: string, score: number, more: object = {}) => ({
  place,
  id,
  name,
  guest: false,
  score,
  also: { story: score % 16 },
  you: false,
  ...more,
});

describe("the board", () => {
  it("lists the highest scores first, a tie going to whoever reached it first, guests too, with each place and the caller's own", async () => {
    await named(alice, "Alice");
    await named(bob, "Bob");
    await named(carol, "Carol");
    await stand(bob, 500, T0 + 2);
    await stand(carol, 500, T0 + 1, true);
    await stand(alice, 200, T0);
    await stand(stranger(1), 300, T0);
    // Nothing earned yet: not listed.
    await stand(dave, 0, T0);
    expect(await boardOf()).toEqual({
      top: [
        row(1, carol, "Carol", 500, { guest: true }),
        row(1, bob, "Bob", 500),
        row(3, stranger(1), "Someone", 300),
        row(4, alice, "Alice", 200, { you: true }),
      ],
      you: { place: 4, score: 200, also: { story: 8 } },
    });
    // Bob's yard changed without earning: he reached 500 when he did, and stays second.
    await stand(bob, 500, T0 + 9);
    expect((await boardOf()).top.map((r) => r.name)).toEqual(["Carol", "Bob", "Someone", "Alice"]);
  });

  it("keeps whoever is on a board known to Leaf, so a guest long gone still has their name and face looked up", async () => {
    await stand(stranger(2), 700, T0, true);
    const known = await services.run(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* knownAmong(sql, [stranger(2), stranger(3)], T0 + 3 * DAY);
      }),
    );
    expect([...known]).toEqual([stranger(2)]);
  });

  it(`shows only the top ${BOARD_MOST}, and the caller's place among everyone when they are not in it`, async () => {
    for (let n = 1; n <= BOARD_MOST + 2; n++) {
      // oxlint-disable-next-line no-await-in-loop -- one after another
      await stand(stranger(n), 1000 - n * 10, T0);
    }
    // Level with the twentieth, but later.
    await stand(alice, 1000 - BOARD_MOST * 10, T0 + 1);
    const board = await boardOf();
    expect(board.top).toHaveLength(BOARD_MOST);
    expect(board.top.at(-1)).toMatchObject({ place: BOARD_MOST, score: 1000 - BOARD_MOST * 10, you: false });
    expect(board.top.some((r) => r.you)).toBe(false);
    expect(board.you).toMatchObject({ place: BOARD_MOST, score: 1000 - BOARD_MOST * 10 });
  });

  it("is empty for a game nobody stands in yet, has no place for a player not on it, and is only for a game Leaf plays", async () => {
    await stand(bob, 500, T0);
    expect(await boardOf("raid")).toEqual({ top: [], you: null });
    expect((await boardOf()).you).toBeNull();
    const chess = await send("GET", "/v1/game/play/chess/standings");
    expect([chess.status, await codeOf(chess)]).toEqual([404, "no_such_game"]);
    const signedOut = await app.request("/v1/game/play/works/standings");
    expect(signedOut.status).toBe(401);
  });
});

describe("setting out afresh", () => {
  it("before a room is fought changes nothing: no new opening, nothing paid, nothing logged", async () => {
    const begun = await commanded(
      ided([
        { do: "start", trail: 0 },
        { do: "choose", option: 0 },
      ]),
    );
    const again = await commanded(ided([{ do: "start", trail: 0 }, { do: "abandon" }, { do: "start", trail: 0 }]));
    expect(again.results.map((r) => ("notes" in r ? r.notes : r.refused))).toEqual([[], [], []]);
    expect(again.rev).toBe(begun.rev);
    expect(again.state).toEqual(begun.state);
    expect(await services.query((sql) => sql`SELECT kind FROM activity`)).toEqual([{ kind: "raid_started" }]);
    expect(await entries(alice)).toHaveLength(1);
  });
});

/** As many things done as asked, as a game logs them. */
const logged = (n: number) => Array.from({ length: n }, (_, i) => ({ kind: "raid_room", data: { room: i } }));
/** Logs that many things done by Alice, at a time. */
const log = (n: number, now = clock.now) =>
  services.run(PlayStore.use((store) => store.log(alice, "raid", logged(n), now)));
/** How many things a player did are written down. */
const count = async (player: PlayerId = alice) =>
  Object((await services.query((sql) => sql`SELECT count(*) AS n FROM activity WHERE player_id = ${player}`))[0]).n;

describe("what players did", () => {
  it("is logged up to 1,000 a player a UTC day, and past that not, while the play goes on", async () => {
    await log(LOGGED_A_DAY - 2);
    await log(5);
    expect(await count()).toBe(LOGGED_A_DAY);
    // Setting out is still done; it is only not written down.
    const begun = await commanded(ided([{ do: "start", trail: 0 }]));
    expect(begun.view.runs).toBe(1);
    expect(await count()).toBe(LOGGED_A_DAY);
    // Another player, and the next UTC day, have their own.
    await commanded(ided([{ do: "start", trail: 0 }]), bob);
    expect(await count(bob)).toBe(1);
    await log(3, Date.UTC(2026, 10, 26));
    expect(await count()).toBe(LOGGED_A_DAY + 3);
  });

  it("is kept 180 days: older rows go when new ones are written", async () => {
    await log(1, T0 - ACTIVITY_KEPT_MS - 1);
    await log(1, T0 - ACTIVITY_KEPT_MS + DAY);
    expect(await count()).toBe(2);
    await log(1);
    expect(await services.query((sql) => sql`SELECT at FROM activity ORDER BY at`)).toEqual([
      { at: T0 - ACTIVITY_KEPT_MS + DAY },
      { at: T0 },
    ]);
  });
});

/** The yard as a page reads it from what Leaf answered. */
function yardOf(state: unknown) {
  const view = readYardView(state);
  const yard = view && WORKS.decode(view.yard);
  if (!view || !yard) throw new Error(`Not a yard: ${JSON.stringify(state)}`);
  return { clock: view.clock, yard };
}
/** What Leaf answered a batch of the Works' commands with. */
function answerOf(state: unknown) {
  const answer = readAnswer(state);
  if (!answer) throw new Error(`Not an answer: ${JSON.stringify(state)}`);
  return answer;
}

describe("the Works", () => {
  const MINUTE = 60_000;

  it("is Leaf's: a yard opened, built on, worked a minute by Leaf's clock, and its till paid into the ledger", async () => {
    const opening = await send("GET", "/v1/game/play/works");
    const { clock: tick, yard } = yardOf(Schema.decodeUnknownSync(Shown)(await opening.json()).state);
    expect(yard.seed).toBeNull();
    // The starter gatherer and mill on the deadfall by the depot, and a run of belt to it.
    const legs = route(yard, [22, 15], [23, 17]) ?? [];
    expect(legs.length).toBeGreaterThan(0);
    const built = await send("POST", "/v1/game/play/works", {
      commands: [
        { id: "w-1", do: "build", kind: "gatherer", x: 20, y: 15, dir: 0, tick },
        { id: "w-2", do: "build", kind: "mill", x: 21, y: 15, dir: 0, tick },
        { id: "w-3", do: "lay", legs, tick },
      ],
    });
    const after = Schema.decodeUnknownSync(Answered)(await built.json());
    expect(after.results).toEqual([
      { id: "w-1", notes: [] },
      { id: "w-2", notes: [] },
      { id: "w-3", notes: [] },
    ]);
    expect(await coinsOf(alice)).toBe(300);
    // A minute on Leaf's clock: the first story order (twelve planks) is filled and paid into the till.
    clock.now += MINUTE;
    const collected = await send("POST", "/v1/game/play/works", {
      commands: [{ id: "w-4", do: "collect", tick: tick + 600 }],
    });
    expect(collected.status).toBe(200);
    const yardNow = yardIn((await storedYard()).state);
    expect(yardNow.story).toBe(1);
    expect(yardNow.till).toBeLessThan(1);
    expect(await coinsOf(alice)).toBeGreaterThanOrEqual(380);
    expect(await entries(alice)).toEqual([
      { amount: 300, reason: "Welcome to Guild Town", game: null, key: `welcome:${alice}` },
      {
        amount: (await coinsOf(alice)) - 300,
        reason: "Earned in the Works",
        game: "works",
        key: `works:${alice}:bank:0`,
      },
    ]);
    expect(await services.query((sql) => sql`SELECT kind FROM activity WHERE game = 'works'`)).toEqual([
      { kind: "works_story" },
    ]);
    // On the board: what the yard has earned, and the story order done.
    const earned = (await coinsOf(alice)) - 300;
    expect(await boardOf()).toEqual({
      top: [{ place: 1, id: alice, name: "Alice", guest: false, score: earned, also: { story: 1 }, you: true }],
      you: { place: 1, score: earned, also: { story: 1 } },
    });

    // Bob visits a minute on: he is given the yard as Alice's own page is. The minute the yard ran is
    // kept, and nothing else of hers is written.
    clock.now += MINUTE;
    const coinsBefore = await entries(alice);
    const visited = Schema.decodeUnknownSync(Shown)(await (await visit(alice, "works", bob)).json());
    const own = Schema.decodeUnknownSync(Shown)(await (await send("GET", "/v1/game/play/works")).json());
    expect(visited).toEqual(own);
    expect(yardOf(visited.state).yard.tick).toBeGreaterThan(yardNow.tick);
    expect((await storedPlay(alice)).map((found) => found.rev)).toEqual([visited.rev]);
    expect(await entries(alice)).toEqual(coinsBefore);
    // Her card: where her yard stands, and the two minutes she has had it open.
    expect(await personOf(alice, bob)).toEqual({
      id: alice,
      name: "Alice",
      games: { works: { place: 1, score: earned, also: { story: 1 }, played: 120 } },
      played: 120,
    });
  });
});

describe("a batch's answer", () => {
  it("for the Works holds no yard: Leaf's clock, and the yard's tick, check and orders hung that do not count yet, as the page works them out", async () => {
    const opening = Schema.decodeUnknownSync(Shown)(await (await send("GET", "/v1/game/play/works")).json());
    const { clock: tick, yard: copy } = yardOf(opening.state);
    const built = await send("POST", "/v1/game/play/works", {
      commands: [{ id: "w-1", do: "build", kind: "gatherer", x: 20, y: 15, dir: 0, tick }],
    });
    // The page's copy, with the same command done to it at the same tick.
    expect("refused" in playWorks(copy, { do: "build", kind: "gatherer", x: 20, y: 15, dir: 0, tick })).toBe(false);
    const { state } = Schema.decodeUnknownSync(Answered)(await built.json());
    expect(state).toEqual({ clock: tick, tick, check: check(copy), hung: [] });
    // An opening, a visit and an opening after a time away are each given the yard, the last with its letter.
    expect(
      yardOf(Schema.decodeUnknownSync(Shown)(await (await send("GET", "/v1/game/play/works")).json()).state).yard.cells,
    ).toEqual(copy.cells);
    expect((await shownYard(await visit(alice, "works", bob))).yard.cells).toEqual(copy.cells);
    clock.now += 60 * 60_000;
    expect((await shownYard(await send("GET", "/v1/game/play/works"))).yard.away?.seconds).toBe(3600 - LEAD / 10);
  });

  it("once its page found its copy not Leaf's, is followed by an opening that says the tick, which Leaf logs with whose and which game, once a minute", async () => {
    const lines: { message: unknown; annotations: unknown }[] = [];
    const capture = Logger.layer([
      Logger.map(Logger.formatStructured, ({ message, annotations }) => void lines.push({ message, annotations })),
    ]);
    const opening = await services.run(
      Play.use((play) => play.open({ playerId: alice, guest: false }, GAMES.works, 1234)).pipe(
        Effect.provide(capture),
        Effect.provideService(References.MinimumLogLevel, "All"),
      ),
    );
    expect(opening.status).toBe("open");
    // However often the page says so, once a minute for a player and a game.
    const again = (tick: number) =>
      services.run(
        Play.use((play) => play.open({ playerId: alice, guest: false }, GAMES.works, tick)).pipe(
          Effect.provide(capture),
          Effect.provideService(References.MinimumLogLevel, "All"),
        ),
      );
    await again(1235);
    clock.now += 59_000;
    await again(1236);
    clock.now += 1_000;
    await again(1237);
    expect(lines.filter((l) => JSON.stringify(l.message).includes("not Leaf's")).map((l) => l.annotations)).toEqual([
      { player: alice, game: "works", tick: 1234 },
      { player: alice, game: "works", tick: 1237 },
    ]);
    expect(lines.filter((l) => JSON.stringify(l.message).includes("not Leaf's")).slice(0, 1)).toEqual([
      {
        message: "A page's copy of the works state was not Leaf's",
        annotations: { player: alice, game: "works", tick: 1234 },
      },
    ]);
    // As the page asks it.
    expect((await send("GET", "/v1/game/play/works?differs=1234")).status).toBe(200);
  });

  it("for the other games is their state, as an opening gives it", async () => {
    for (const game of ["raid", "town", "pulls"]) {
      // oxlint-disable-next-line no-await-in-loop -- one game after another
      const shown = Schema.decodeUnknownSync(Shown)(await (await send("GET", `/v1/game/play/${game}`)).json());
      // oxlint-disable-next-line no-await-in-loop -- one game after another
      const sent = await send("POST", `/v1/game/play/${game}`, { commands: [] });
      // oxlint-disable-next-line no-await-in-loop -- one game after another
      expect([game, Schema.decodeUnknownSync(Answered)(await sent.json()).state]).toEqual([game, shown.state]);
    }
  });
});

/** Leaf's call to a game at a moment of its clock, as Alice's. */
const ctxAt = (now: number) => ({ now, player: { id: alice, guest: false }, seed: 0, room: 0, awards: [] });
/** Leaf's sweep of these games' states, and the wait for every tend it put in a line to end. */
const sweep = (games: readonly Played[]) => Play.use((play) => Effect.flatten(play.tend(games)));
/** Leaf tending every game's states. */
const tendAll = sweep(Object.values(GAMES));
/** A yard read from its text, or the test fails. */
function yardIn(text: string) {
  const w = WORKS.decode(text);
  if (!w) throw new Error("not a yard");
  return w;
}
/** Puts the kept mid-story yard in Alice's place, or `owner`'s (`shape`d so): standing at Leaf's clock now, written now, its owner there now. */
async function keepMid(on = services, shape: (w: World) => void = () => undefined, owner: PlayerId = alice) {
  const w = yardIn(JSON.stringify(mid));
  shape(w);
  w.at = clock.now;
  const text = WORKS.encode(w);
  await on.query(
    (sql) => sql`
      INSERT INTO play_state (player_id, game, rev, state, updated_at) VALUES (${owner}, 'works', 1, ${text}, ${clock.now})
    `,
  );
  return text;
}
/** A yard as running every tick to Leaf's clock now, in one go, leaves it. */
const ranOn = (text: string) => WORKS.encode(WORKS.advance(yardIn(text), ctxAt(clock.now)));
/** Alice's yard as Leaf stores it. */
async function storedYard(on = services) {
  const [found] = await on.query(
    (sql) =>
      sql<{
        rev: number;
        state: string;
      }>`SELECT rev, state FROM play_state WHERE player_id = ${alice} AND game = 'works'`,
  );
  if (!found) throw new Error("no yard stored");
  return found;
}
/** The yard an answer shows its page. */
const shownYard = async (response: Response) => yardOf(Schema.decodeUnknownSync(Shown)(await response.json()).state);
/** Leaf with `then` done, and waited for, after each read of a stored state: something happening while Leaf works on what it read. */
async function afterEachRead(then: () => Promise<void>) {
  await app.dispose();
  start({
    play: (real) => ({
      ...real,
      read: (player, game) => real.read(player, game).pipe(Effect.tap(() => Effect.promise(then))),
    }),
  });
}
/** Leaf with its first read of a stored state held, once made, until the test lets it go. */
async function holdingFirstRead() {
  let reads = 0;
  const gate = Promise.withResolvers<void>();
  const held = Promise.withResolvers<void>();
  await afterEachRead(() => {
    if (++reads !== 1) return Promise.resolve();
    held.resolve();
    return gate.promise;
  });
  return { held: held.promise, release: () => gate.resolve() };
}
/** Alice's page painting a belt in her yard as its copy stood at Leaf's clock now, and the yard once both that and running on are done. */
function painting(text: string) {
  const w = yardIn(text);
  const belt = w.cells.findIndex((b) => b?.kind === "belt");
  const paint = {
    do: "paint",
    x: belt % w.land.w,
    y: Math.floor(belt / w.land.w),
    tint: 3,
    tick: clockOf(w, clock.now),
  };
  const twin = WORKS.advance(yardIn(text), ctxAt(clock.now));
  const read = WORKS.command(paint);
  if (!read) throw new Error("not a command");
  WORKS.apply(twin, read, ctxAt(clock.now));
  return { paint, after: WORKS.encode(twin) };
}

/**
 * The Works as Leaf plays it, counting what Leaf does: each tick it runs a yard on while tending, each
 * slice that ran any (whose yard, when it began and ended), each tick `advance` and `apply` run
 * themselves, and each visit it shows. A slice of a yard whose owner `fails` fails a hundred ticks in.
 */
function counted(fails: (owner: string) => boolean = () => false) {
  const run = {
    ticks: 0,
    advanced: 0,
    applied: 0,
    visits: 0,
    slices: [] as { owner: string; began: number; ended: number }[],
  };
  const game = played({
    ...WORKS,
    advance: (w, ctx) => {
      const from = w.tick;
      const out = WORKS.advance(w, ctx);
      run.advanced += out.tick - from;
      return out;
    },
    apply: (w, c, ctx) => {
      const from = w.tick;
      const out = WORKS.apply(w, c, ctx);
      run.applied += w.tick - from;
      return out;
    },
    tend: (w, ctx, more, c) => {
      const began = performance.now();
      let ticks = 0;
      const further =
        WORKS.tend?.(
          w,
          ctx,
          () => {
            if (!more()) return false;
            if (++ticks === 100 && fails(ctx.player.id)) throw new Error("A yard that cannot be run");
            run.ticks++;
            return true;
          },
          c,
        ) ?? false;
      if (ticks > 0) run.slices.push({ owner: ctx.player.id, began, ended: performance.now() });
      return further;
    },
    visit: (w, ctx) => {
      run.visits++;
      return WORKS.visit?.(w, ctx) ?? WORKS.view(w, ctx);
    },
  });
  return { game, run };
}
/** The longest the thread was held while `job` ran, in milliseconds, by a timer due every millisecond. */
async function longestHold(job: () => Promise<unknown>): Promise<number> {
  let last = performance.now();
  let longest = 0;
  const beat = setInterval(() => {
    const now = performance.now();
    longest = Math.max(longest, now - last);
    last = now;
  }, 1);
  try {
    await job();
  } finally {
    clearInterval(beat);
  }
  return Math.max(longest, performance.now() - last);
}
/** Waits until a condition holds, a millisecond at a time. */
async function until(ok: () => boolean, tries = 5000): Promise<void> {
  if (ok() || tries === 0) return;
  await Bun.sleep(1);
  await until(ok, tries - 1);
}
/** The first tick after the moment `from` at which a standing order fills, as a yard runs on from `text` with nobody there, and the order. */
function nextFill(text: string, from: number) {
  const w = yardIn(text);
  stepTo(w, clockOf(w, from));
  for (let n = 0; n < 36_000; n++) {
    const open = w.board.filter((o) => !isFilled(o.want, o.filled));
    stepTo(w, w.tick + 1);
    const filled = open.find((o) => isFilled(o.want, o.filled));
    if (filled) return { order: filled.id, tick: w.tick };
  }
  throw new Error("No order fills");
}
/** Whether an order of a yard run on from `text` can be swapped at a tick. */
function swapped(text: string, order: number, tick: number) {
  const w = yardIn(text);
  stepTo(w, tick);
  return swapRefusal(w, order) === null;
}

/** Leaf tends every game's states, as it does once a minute. */
const tending = () => services.run(tendAll);
/** How a job Leaf was asked for ended: finished, or stopped. */
const outcome = (job: Promise<unknown>) =>
  job.then(
    () => "finished",
    () => "stopped",
  );

describe("Leaf tending the Works", () => {
  const SECOND = 1000;
  const MINUTE = 60_000;
  const HOUR = 60 * MINUTE;

  it("runs a yard no page keeps up tick for tick, and keeps where it stands as a batch would; a watched one is left be", async () => {
    const kept = await keepMid();
    clock.now += 10 * MINUTE;
    await tending();
    const first = await storedYard();
    expect(first).toEqual({ rev: 2, state: ranOn(kept) });
    expect(yardIn(first.state).tick).toBe(yardIn(kept).tick + 6000 - LEAD);
    const scored = (await boardOf()).you?.score ?? 0;
    expect(scored).toBe(Math.floor(yardIn(first.state).sold + yardIn(first.state).paid));
    // Its owner's page would have sent something within the minute: a yard written that lately is the page's.
    clock.now += MINUTE;
    await tending();
    expect((await storedYard()).rev).toBe(2);
    clock.now += 9 * MINUTE;
    await tending();
    expect((await storedYard()).state).toBe(ranOn(first.state));
    expect((await boardOf()).you?.score).toBeGreaterThan(scored);
  });

  it("is seen by a visitor: one nobody watches moves, and one left behind is brought up before it is shown", async () => {
    const kept = await keepMid();
    const before = (await shownYard(await visit(alice, "works", bob))).yard.tick;
    clock.now += 10 * MINUTE;
    const behind = await shownYard(await visit(alice, "works", bob));
    expect(behind.yard.tick).toBe(before + 6000 - LEAD);
    expect(await storedYard()).toEqual({ rev: 2, state: ranOn(kept) });
    clock.now += 10 * MINUTE;
    await tending();
    const moved = await storedYard();
    expect(moved.rev).toBe(3);
    expect((await shownYard(await visit(alice, "works", bob))).yard.tick).toBe(before + 12_000 - LEAD);
    // The visit itself wrote nothing.
    expect(await storedYard()).toEqual(moved);
  });

  it("tells its owner, back after an hour, what it did, counted; and their next command puts that away", async () => {
    const kept = yardIn(await keepMid());
    clock.now += HOUR;
    const opening = await shownYard(await send("GET", "/v1/game/play/works"));
    const now = yardIn((await storedYard()).state);
    const takenIn = Object.fromEntries(
      ITEMS.flatMap((k) => {
        const n = (now.depot[k] ?? 0) - (kept.depot[k] ?? 0);
        return n > 0 ? [[k, n]] : [];
      }),
    );
    expect(Object.keys(takenIn).length).toBeGreaterThan(0);
    expect(opening.yard.away).toEqual({
      seconds: 3600 - LEAD / 10,
      coins: Math.floor(now.till) - Math.floor(kept.till),
      made: takenIn,
    });
    // Opened again, the yard is not run or written again.
    const rev = (await storedYard()).rev;
    expect((await shownYard(await send("GET", "/v1/game/play/works"))).yard.away).toEqual(opening.yard.away);
    expect((await storedYard()).rev).toBe(rev);
    const back = await send("POST", "/v1/game/play/works", {
      commands: [{ id: "w-1", do: "collect", tick: opening.clock }],
    });
    expect(back.status).toBe(200);
    expect((await shownYard(await send("GET", "/v1/game/play/works"))).yard.away).toBeNull();
    expect(await coinsOf(alice)).toBeGreaterThanOrEqual(opening.yard.away?.coins ?? Infinity);
  });

  it("gives a page left open while Leaf tended its yard Leaf's yard for its next command, never a refusal", async () => {
    const kept = await keepMid();
    const tick = clockOf(yardIn(kept), clock.now);
    clock.now += 10 * MINUTE;
    await tending();
    const late = await send("POST", "/v1/game/play/works", { commands: [{ id: "w-1", do: "collect", tick }] });
    const body = Schema.decodeUnknownSync(Answered)(await late.json());
    expect(body.results).toEqual([{ id: "w-1", notes: [] }]);
    expect(body.rev).toBe(3);
    expect(answerOf(body.state).tick).toBe(yardIn(kept).tick + 6000 - LEAD);
  });

  it("and a batch for the same yard: the tend first, the batch waits for it, and both are kept", async () => {
    const { held, release } = await holdingFirstRead();
    const kept = await keepMid();
    clock.now += 10 * MINUTE;
    const { paint, after } = painting(kept);
    // Leaf has read the yard to tend it when Alice's page paints a belt: the paint waits.
    const tend = tending();
    await held;
    let answered = false;
    const sending = send("POST", "/v1/game/play/works", { commands: [{ id: "p-1", ...paint }] }).then((r) => {
      answered = true;
      return r;
    });
    await Bun.sleep(20);
    expect(answered).toBe(false);
    release();
    await tend;
    const painted = Schema.decodeUnknownSync(Answered)(await (await sending).json());
    expect(painted.results).toEqual([{ id: "p-1", notes: [] }]);
    // One copy in the lane: what the tend ran on and the paint are kept by the batch, in one write.
    expect(await storedYard()).toEqual({ rev: 2, state: after });
  });

  it("and a batch for the same yard: the batch first, the tend waits for it, and both are kept", async () => {
    const { held, release } = await holdingFirstRead();
    const kept = await keepMid();
    clock.now += 10 * MINUTE;
    const { paint, after } = painting(kept);
    // Alice's page has sent the paint when Leaf's background tend comes to her yard: the tend waits.
    const sending = send("POST", "/v1/game/play/works", { commands: [{ id: "p-1", ...paint }] });
    await held;
    let tended = false;
    const tend = (async () => {
      await tending();
      tended = true;
    })();
    await Bun.sleep(20);
    expect(tended).toBe(false);
    release();
    const painted = Schema.decodeUnknownSync(Answered)(await (await sending).json());
    expect(painted.results).toEqual([{ id: "p-1", notes: [] }]);
    await tend;
    // The tend after it found the yard where the batch left it: nothing more to run, or to write.
    expect(await storedYard()).toEqual({ rev: 2, state: after });
  });

  it("does a batch at the moment it arrived, however long the yard took to catch up: a swap made just before an order filled stands", async () => {
    // Five seconds pass on Leaf's clock while it brings the yard up, after it first read it.
    let reads = 0;
    await afterEachRead(() => {
      if (++reads === 1) clock.now += 5 * SECOND;
      return Promise.resolve();
    });
    // A standing order for the kits the yard makes, which it fills by itself some ten minutes on.
    const kept = await keepMid(services, (w) => {
      const [first] = w.board;
      if (first) w.board[0] = { ...first, want: { kit: 40 }, filled: {} };
    });
    const { order, tick } = nextFill(kept, clock.now);
    // The page swaps the order half a second before it would fill: at that tick it may, fifty ticks on it may not.
    const at = tick - 5;
    expect(swapped(kept, order, at)).toBe(true);
    expect(swapped(kept, order, at + 50 - LEAD)).toBe(false);
    clock.now += (at - yardIn(kept).tick) * TICK_MS;
    const answer = await send("POST", "/v1/game/play/works", {
      commands: [{ id: "s-1", do: "swap", order, tick: at }],
    });
    const body = Schema.decodeUnknownSync(Answered)(await answer.json());
    expect(body.results).toEqual([{ id: "s-1", notes: [] }]);
    expect(answerOf(body.state).tick).toBe(at);
  });

  it("brings a yard up once however many ask for it at once, in slices each followed by a rest as long", async () => {
    const { game, run } = counted();
    await keepMid();
    clock.now += 8 * HOUR;
    const visits = await services.run(
      Play.use((play) =>
        Effect.all(
          [bob, carol, dave, bob].map((caller) => play.visit(alice, game, { playerId: caller, guest: false })),
          { concurrency: "unbounded" },
        ),
      ),
    );
    expect(run.ticks).toBe(8 * 36_000 - LEAD);
    // Each is shown the one copy; the last leaves the line empty, and is answered once the copy is kept.
    expect(visits.map((v) => ("rev" in v ? v.rev : null))).toEqual([1, 1, 1, 2]);
    expect((await storedYard()).rev).toBe(2);
    expect(run.slices.length).toBeGreaterThan(1);
    // The thread's own clock, read inside each slice: what is between two is at least as long as the first.
    const short = run.slices.slice(1).filter((next, n) => {
      const last = run.slices[n];
      return last !== undefined && next.began - last.ended < last.ended - last.began;
    });
    expect(short).toEqual([]);
  });

  it("brings a yard written lately up once for its whole line: fifty visitors, and its owner's command behind them", async () => {
    const { game, run } = counted();
    await keepMid();
    // Written a little under two minutes ago, by its owner's page: Leaf has not kept it since.
    clock.now += TEND_AFTER - 4 * SECOND;
    const visitors = Array.from({ length: 50 }, (_, n) =>
      playerId(`30000000-0000-0000-0000-${String(n).padStart(12, "0")}`),
    );
    const [visits, sent] = await services.run(
      Play.use((play) =>
        Effect.all(
          [
            Effect.all(
              visitors.map((v) => play.visit(alice, game, { playerId: v, guest: false })),
              { concurrency: "unbounded" },
            ),
            play.send({ playerId: alice, guest: false }, game, [{ id: "w-1", do: "collect", tick: 0 }]),
          ],
          { concurrency: "unbounded" },
        ),
      ),
    );
    expect(run.ticks).toBe((TEND_AFTER - 4 * SECOND) / TICK_MS - LEAD);
    expect(new Set(visits.map((v) => ("rev" in v ? v.rev : v.status)))).toEqual(new Set([1]));
    expect(sent.status === "done" && sent.rev).toBe(2);
  });

  it("drops a visit let go of while it waits in the line, and does a batch let go of all the same", async () => {
    const { held, release } = await holdingFirstRead();
    const { game, run } = counted();
    await keepMid();
    clock.now += 10 * MINUTE;
    const owner = { playerId: alice, guest: false };
    // Alice opens her yard, which Leaf has read and not yet brought up, when Bob visits and her page sends a batch.
    const opening = services.run(Play.use((play) => play.open(owner, game)));
    await held;
    const after = await services.run(
      Play.use((play) =>
        Effect.gen(function* () {
          const now = { startImmediately: true } as const;
          const visit = yield* Effect.forkChild(play.visit(alice, game, { playerId: bob, guest: false }), now);
          const batch = yield* Effect.forkChild(play.send(owner, game, [{ id: "w-1", do: "collect", tick: 0 }]), now);
          yield* Effect.yieldNow;
          // Both pages close.
          yield* Fiber.interrupt(visit);
          yield* Fiber.interrupt(batch);
          yield* Effect.sync(release);
          // Carol, behind them, finds the batch done and nobody else's visit shown.
          return yield* play.visit(alice, game, { playerId: carol, guest: false });
        }),
      ),
    );
    // The open is shown the yard run on, not yet kept: the batch behind it keeps that and its own.
    expect(await opening).toEqual(expect.objectContaining({ status: "open", rev: 1 }));
    expect(after).toEqual(expect.objectContaining({ status: "open", rev: 2 }));
    expect(run.visits).toBe(1);
    expect(await services.query((sql) => sql`SELECT command_id AS id FROM play_commands`)).toEqual([{ id: "w-1" }]);
  });

  it("shares one budget: a batch waits behind at most one slice of Leaf tending others at a time, and the tending goes on", async () => {
    const { game, run } = counted();
    // Bob's and Carol's yards left eight hours ago, for Leaf to tend; Alice's two hours ago, for her page to bring up.
    clock.now -= 8 * HOUR;
    await keepMid(services, undefined, bob);
    await keepMid(services, undefined, carol);
    clock.now += 6 * HOUR;
    await keepMid();
    clock.now += 2 * HOUR;
    const tend = services.run(sweep([game]));
    await until(() => run.slices.length > 0);
    const before = run.slices.length;
    const sent = await services.run(
      Play.use((play) => play.send({ playerId: alice, guest: false }, game, [{ id: "w-1", do: "collect", tick: 0 }])),
    );
    const meanwhile = run.slices.slice(before);
    await tend;
    expect(sent.status).toBe("done");
    // From her yard's first slice to its last: one of Leaf's own after every three of hers, never two in a row.
    const hers = meanwhile.flatMap((s, n) => (s.owner === alice ? [n] : []));
    const between = meanwhile.slice(hers[0], (hers.at(-1) ?? 0) + 1).map((s) => (s.owner === alice ? "a" : "t"));
    expect(hers.length).toBeGreaterThan(8);
    expect(between.join("")).not.toContain("tt");
    expect(between.join("")).not.toContain("aaaa");
    expect(between.filter((s) => s === "t").length).toBeGreaterThan(1);
    // Leaf went on tending the others after.
    expect(run.slices.length).toBeGreaterThan(before + meanwhile.length);
  });

  it("logs a yard it cannot tend, whose and of which game, and tends the others all the same", async () => {
    const { game } = counted((owner) => owner === bob);
    await keepMid(services, undefined, bob);
    clock.now += SECOND;
    await keepMid();
    clock.now += 10 * MINUTE;
    const lines: { message: unknown; annotations: unknown }[] = [];
    const capture = Logger.layer([
      Logger.map(Logger.formatStructured, ({ message, annotations }) => void lines.push({ message, annotations })),
    ]);
    await services.run(
      sweep([game]).pipe(Effect.provide(capture), Effect.provideService(References.MinimumLogLevel, "All")),
    );
    expect(await storedPlay(bob)).toEqual([expect.objectContaining({ rev: 1 })]);
    expect((await storedYard()).rev).toBe(2);
    const failed = lines.filter((l) => JSON.stringify(l.message).includes("failed"));
    expect(failed).toEqual([
      {
        message: [`Tending the works state of ${bob} failed`, expect.anything()],
        annotations: { player: bob, game: "works" },
      },
    ]);
    expect(JSON.stringify(failed)).not.toContain('"cells"');
  });

  it("never holds the thread for more than a moment, however far behind the yard: opened, sent to, visited, tended, or written meanwhile", async () => {
    let written: (() => Promise<void>) | null = null;
    await afterEachRead(() => {
      const write = written;
      written = null;
      return write?.() ?? Promise.resolve();
    });
    /** Alice's yard put back eight hours behind, as if she left then. */
    const behind = async () => {
      await services.query((sql) => sql`DELETE FROM play_state WHERE player_id = ${alice}`);
      const now = clock.now;
      clock.now -= 8 * HOUR;
      await keepMid();
      clock.now = now;
    };
    const paths: Record<string, () => Promise<unknown>> = {
      opened: () => send("GET", "/v1/game/play/works"),
      sent: () => send("POST", "/v1/game/play/works", { commands: [{ id: `c-${++made}`, do: "collect", tick: 0 }] }),
      visited: () => visit(alice, "works", bob),
      tended: tending,
    };
    const holds: Record<string, number> = {};
    for (const [name, path] of Object.entries(paths)) {
      // oxlint-disable-next-line no-await-in-loop -- one after another, each timed alone
      await behind();
      // oxlint-disable-next-line no-await-in-loop -- one after another, each timed alone
      holds[name] = await longestHold(path);
    }
    // Read, and then written over from elsewhere with a yard eight hours further behind: the open cannot
    // keep what it ran on, and is done again from what was written, run on in slices.
    await behind();
    const moved = yardIn((await storedYard()).state);
    moved.at -= 8 * HOUR;
    written = () =>
      services
        .query(
          (sql) =>
            sql`UPDATE play_state SET rev = rev + 1, state = ${WORKS.encode(moved)}, updated_at = ${clock.now - 9 * HOUR} WHERE player_id = ${alice}`,
        )
        .then(() => undefined);
    let again = 0;
    holds.written = await longestHold(async () => {
      again = (await send("GET", "/v1/game/play/works")).status;
    });
    expect(again).toBe(200);
    expect((await storedYard()).rev).toBe(3);
    // Eight hours of the yard is 270 ms of work on the development machine; a slice is 5.
    expect(Object.entries(holds).filter(([, ms]) => ms > 60)).toEqual([]);
  }, 20_000);

  it("runs nothing in a transaction: a yard far behind is run on in slices first, whoever asks, and opening it finds nothing left", async () => {
    const { game, run } = counted();
    const owner = { playerId: alice, guest: false };
    const paths = {
      opened: Play.use((play) => play.open(owner, game)),
      sent: Play.use((play) => play.send(owner, game, [{ id: "w-1", do: "collect", tick: 0 }])),
      visited: Play.use((play) => play.visit(alice, game, { playerId: bob, guest: false })),
      tended: sweep([game]),
    };
    const ran: Record<string, unknown> = {};
    for (const [name, path] of Object.entries(paths)) {
      // oxlint-disable-next-line no-await-in-loop -- one after another, each from a yard eight hours behind
      await services.query((sql) => sql`DELETE FROM play_state`);
      clock.now -= 8 * HOUR;
      // oxlint-disable-next-line no-await-in-loop -- as above
      await keepMid();
      clock.now += 8 * HOUR;
      run.ticks = 0;
      run.advanced = 0;
      run.applied = 0;
      // oxlint-disable-next-line no-await-in-loop -- as above
      await services.run(path);
      ran[name] = { ticks: run.ticks, advanced: run.advanced, applied: run.applied };
    }
    const each = { ticks: 8 * 36_000 - LEAD, advanced: 0, applied: 0 };
    expect(ran).toEqual({ opened: each, sent: each, visited: each, tended: each });
  }, 20_000);

  it("puts a job in its line as it arrives: a batch sent just before a visit is done first, at the tick it arrived at", async () => {
    const { game } = counted();
    const kept = await keepMid();
    clock.now += 10 * MINUTE;
    const tick = clockOf(yardIn(kept), clock.now) - LEAD;
    const [sent, seen] = await services.run(
      Play.use((play) =>
        Effect.gen(function* () {
          const now = { startImmediately: true } as const;
          const owner = { playerId: alice, guest: false };
          const batch = yield* Effect.forkChild(play.send(owner, game, [{ id: "w-1", do: "collect", tick: 0 }]), now);
          // Bob's visit comes ten seconds after the batch, while neither has been done.
          yield* Effect.sync(() => void (clock.now += 10 * SECOND));
          const visit = yield* Effect.forkChild(play.visit(alice, game, { playerId: bob, guest: false }), now);
          return [yield* Fiber.join(batch), yield* Fiber.join(visit)] as const;
        }),
      ),
    );
    if (sent.status !== "done" || seen.status !== "open") throw new Error(`${sent.status}, ${seen.status}`);
    expect([sent.rev, answerOf(sent.view).tick]).toEqual([2, tick]);
    expect([seen.rev, yardOf(seen.view).yard.tick]).toEqual([3, tick + 100]);
  });

  it("keeps what two visits either side of the sweep's two minutes ran, finds it not standing still, and tends it next time", async () => {
    const { game, run } = counted();
    const { held, release } = await holdingFirstRead();
    const kept = await keepMid();
    // Bob's visit two minutes after the yard was written, and Carol's a millisecond later, both in its line.
    clock.now += TEND_AFTER;
    const first = services.run(Play.use((play) => play.visit(alice, game, { playerId: bob, guest: false })));
    await held;
    clock.now += 1;
    const second = services.run(Play.use((play) => play.visit(alice, game, { playerId: carol, guest: false })));
    release();
    await Promise.all([first, second]);
    const visited = await storedYard();
    expect([visited.rev, yardIn(visited.state).tick]).toEqual([2, yardIn(kept).tick + TEND_AFTER / TICK_MS - LEAD]);
    // Two minutes and more on, the sweep finds it behind, and tends it.
    clock.now += TEND_AFTER + MINUTE;
    run.ticks = 0;
    await services.run(sweep([game]));
    expect((await storedYard()).rev).toBe(3);
    expect(run.ticks).toBe((TEND_AFTER + MINUTE) / TICK_MS);
  });

  it("ends a sweep though one yard has a steady line of visits, and tends the one nobody watches meanwhile", async () => {
    const { game } = counted();
    // Bob's yard left forty minutes ago, and Alice's thirty: the sweep comes to Bob's first.
    clock.now -= 40 * MINUTE;
    const bobs = await keepMid(services, undefined, bob);
    clock.now += 10 * MINUTE;
    const alices = await keepMid();
    clock.now += 30 * MINUTE;
    // Three visitors at a time keep Alice's yard asked for until the sweep has ended.
    const ended = { sweep: false };
    let visits = 0;
    const visitor = async (): Promise<void> => {
      while (!ended.sweep) {
        const caller = { playerId: stranger(10 + (visits++ % 200)), guest: false };
        // oxlint-disable-next-line no-await-in-loop -- one visit after another, as a page makes them
        await services.run(Play.use((play) => play.visit(alice, game, caller)));
      }
    };
    const visitors = [visitor(), visitor(), visitor()];
    await until(() => visits > 3);
    await services.run(sweep([game]));
    ended.sweep = true;
    await Promise.all(visitors);
    expect(visits).toBeGreaterThan(6);
    expect(await storedPlay(bob)).toEqual([{ rev: 2, state: ranOn(bobs) }]);
    // Once its line is empty, what Alice's visitors ran is kept too.
    expect(await storedYard()).toEqual({ rev: 2, state: ranOn(alices) });
  });

  it("drops its copy when a batch fails: nothing of the batch is in what the next job is shown, or Leaf keeps", async () => {
    await app.dispose();
    let fails = 1;
    start({
      play: (real) => ({
        ...real,
        answer: (...args) => (fails-- > 0 ? Effect.die(new Error("the disk is full")) : real.answer(...args)),
      }),
    });
    const kept = await keepMid();
    clock.now += 10 * MINUTE;
    const { paint } = painting(kept);
    const [failed, seen] = await services.run(
      Play.use((play) =>
        Effect.gen(function* () {
          const now = { startImmediately: true } as const;
          const owner = { playerId: alice, guest: false };
          // Alice's page paints a belt, and Bob's visit comes right behind it in the line.
          const batch = yield* Effect.forkChild(play.send(owner, GAMES.works, [{ id: "p-1", ...paint }]), now);
          const visit = yield* Effect.forkChild(play.visit(alice, GAMES.works, { playerId: bob, guest: false }), now);
          return [yield* Fiber.await(batch), yield* Fiber.join(visit)] as const;
        }),
      ),
    );
    expect(Exit.isFailure(failed)).toBe(true);
    // Bob is shown the yard run on without the paint, and that is what is kept.
    expect(seen).toEqual(expect.objectContaining({ status: "open", rev: 2 }));
    expect(await storedYard()).toEqual({ rev: 2, state: ranOn(kept) });
    expect(await services.query((sql) => sql`SELECT command_id FROM play_commands`)).toEqual([]);
  });

  it("notices a state written behind its back: the next job in the line reads what was written", async () => {
    let reads = 0;
    const staged = yardIn(JSON.stringify(mid));
    staged.at = clock.now + 10 * MINUTE;
    staged.bank += 5;
    const text = WORKS.encode(staged);
    // Leaf has read Alice's yard for Bob's visit when a staging step writes another over it.
    await afterEachRead(async () => {
      if (++reads !== 1) return;
      await services.query(
        (sql) =>
          sql`UPDATE play_state SET rev = rev + 1, state = ${text}, updated_at = ${clock.now} WHERE player_id = ${alice}`,
      );
    });
    const kept = await keepMid();
    clock.now += 10 * MINUTE;
    const [bobs, carols] = await services.run(
      Play.use((play) =>
        Effect.all(
          [bob, carol].map((caller) => play.visit(alice, GAMES.works, { playerId: caller, guest: false })),
          { concurrency: "unbounded" },
        ),
      ),
    );
    if (bobs?.status !== "open" || carols?.status !== "open") throw new Error("not shown");
    expect([bobs.rev, yardOf(bobs.view).yard.tick]).toEqual([1, yardIn(kept).tick + 6000 - LEAD]);
    expect([carols.rev, yardOf(carols.view).yard.bank]).toEqual([2, staged.bank]);
    // What Bob's job ran on, from the yard written over, is not kept over what was staged.
    expect(await storedYard()).toEqual({ rev: 2, state: text });
  });

  it("keeps a guest's yard a guest's, though they left it before their first command", async () => {
    // Carol is not in the guild.
    expect((await send("GET", "/v1/game/play/works", undefined, carol)).status).toBe(200);
    clock.now += 10 * MINUTE;
    await tending();
    expect(await storedPlay(carol)).toEqual([expect.objectContaining({ rev: 1 })]);
    expect(await services.query((sql) => sql`SELECT guest FROM standings WHERE player_id = ${carol}`)).toEqual([
      { guest: 1 },
    ]);
  });

  it("after a deploy, runs a yard kept before it knew its owner's last command eight hours on from its last tick, once; its owner opening it meanwhile waits", async () => {
    const { game, run } = counted();
    const w = yardIn(JSON.stringify(mid));
    w.at = clock.now;
    const text = WORKS.encode(w).replace(`,"seen":${JSON.stringify(w.seen)}`, "");
    expect(text).not.toContain('"seen"');
    await services.query(
      (sql) =>
        sql`INSERT INTO play_state (player_id, game, rev, state, updated_at) VALUES (${alice}, 'works', 1, ${text}, ${clock.now})`,
    );
    clock.now += 20 * HOUR;
    const owner = { playerId: alice, guest: false };
    const tend = services.run(sweep([game]));
    await until(() => run.ticks > 0);
    const opening = await services.run(Play.use((play) => play.open(owner, game)));
    await tend;
    expect(run.ticks).toBe(8 * 36_000);
    if (opening.status !== "open") throw new Error(opening.status);
    const { yard } = yardOf(opening.view);
    expect(yard.tick).toBe(w.tick + 8 * 36_000);
    expect(yard.away?.seconds).toBe(8 * 3600);
    expect((await storedYard()).rev).toBe(2);
  });

  it("stopped part-way, with jobs waiting, leaves the yard as it was, only behind, and the next Leaf runs it on from there", async () => {
    const directory = join(tmpdir(), `leaf-tend-${crypto.randomUUID()}`);
    const path = `${directory}.db`;
    try {
      const first = testLeaf(clock, noNetwork, { databasePath: path });
      const kept = await keepMid(first);
      clock.now += 8 * HOUR;
      // A deploy stops Leaf a moment into eight hours of the yard, a visit and a batch waiting behind
      // it, and it stops at once.
      const owner = { playerId: alice, guest: false };
      const cut = outcome(first.run(tendAll));
      await Bun.sleep(100);
      const waiting = [
        outcome(first.run(Play.use((play) => play.visit(alice, GAMES.works, { playerId: bob, guest: false })))),
        outcome(first.run(Play.use((play) => play.send(owner, GAMES.works, [{ id: "w-1", do: "collect", tick: 0 }])))),
      ];
      const stopping = performance.now();
      await first.dispose();
      expect(performance.now() - stopping).toBeLessThan(100);
      expect(await Promise.all([cut, ...waiting])).toEqual(["stopped", "stopped", "stopped"]);
      const next = testLeaf(clock, noNetwork, { databasePath: path });
      expect(await storedYard(next)).toEqual({ rev: 1, state: kept });
      expect(await next.query((sql) => sql`SELECT command_id FROM play_commands`)).toEqual([]);
      await next.run(tendAll);
      expect(await storedYard(next)).toEqual({ rev: 2, state: ranOn(kept) });
      await next.dispose();
    } finally {
      for (const end of ["", "-wal", "-shm"]) rmSync(`${path}${end}`, { force: true });
    }
  });

  it("does a batch's commands to its copy before its transaction, each tick once: thirty-two refused a tick ahead run on once, in slices, and none in the transaction", async () => {
    const { game, run } = counted();
    const ran = () => run.ticks + run.advanced + run.applied;
    // The ticks run so far at the batch's transaction's first check, and at its last write.
    const during: number[] = [];
    const note = () => Effect.sync(() => void during.push(ran()));
    await app.dispose();
    start({
      play: (real) => ({
        ...real,
        isAt: (...args) => Effect.tap(real.isAt(...args), note),
        count: (...args) => Effect.tap(real.count(...args), note),
      }),
    });
    const kept = await keepMid();
    clock.now += 10 * MINUTE;
    const tick = clockOf(yardIn(kept), clock.now) + LEAD;
    const commands = Array.from({ length: MOST_COMMANDS }, (_, n) => ({
      id: `h-${n}`,
      do: "handOver",
      order: 999,
      tick,
    }));
    const sent = await services.run(Play.use((play) => play.send({ playerId: alice, guest: false }, game, commands)));
    if (sent.status !== "done") throw new Error(sent.status);
    expect(new Set(sent.results.map((r) => ("refused" in r ? r.refused : "done")))).toEqual(new Set(["not_filled"]));
    // Run on to three seconds short of the clock, and then to the commands' tick three seconds past it.
    expect([run.ticks, run.advanced, run.applied]).toEqual([6000 + LEAD, 0, 0]);
    expect(during).toEqual([6000 + LEAD, 6000 + LEAD]);
    expect(yardIn((await storedYard()).state).tick).toBe(tick);
  });

  it("checks the stored rev before it writes anything: a batch whose copy went stale is done again from what was written, and keeps its answer at that rev", async () => {
    // Leaf has read Alice's yard, a belt taken away, for her batch when a staging step writes it back.
    const w = yardIn(JSON.stringify(mid));
    const belt = w.cells.findIndex((b) => b?.kind === "belt");
    const spot = { x: belt % w.land.w, y: Math.floor(belt / w.land.w) };
    w.at = clock.now;
    const staged = WORKS.encode(w);
    let reads = 0;
    await afterEachRead(async () => {
      if (++reads !== 1) return;
      await services.query(
        (sql) =>
          sql`UPDATE play_state SET rev = rev + 1, state = ${staged}, updated_at = ${clock.now} WHERE player_id = ${alice}`,
      );
    });
    const kept = await keepMid(
      services,
      (y) => void WORKS.apply(y, { do: "remove", ...spot, tick: y.tick }, ctxAt(clock.now)),
    );
    // Painting the belt: refused in the yard read, done in the one written.
    const paint = { id: "p-1", do: "paint", ...spot, tint: 3, tick: clockOf(yardIn(kept), clock.now) };
    const painted = async () =>
      Schema.decodeUnknownSync(Answered)(
        await (await send("POST", "/v1/game/play/works", { commands: [paint] })).json(),
      );
    const first = await painted();
    expect([first.rev, first.results]).toEqual([3, [{ id: "p-1", notes: [] }]]);
    expect(await services.query((sql) => sql`SELECT command_id AS id, rev, result FROM play_commands`)).toEqual([
      { id: "p-1", rev: 3, result: JSON.stringify({ notes: [] }) },
    ]);
    // Sent again, it answers what it answered then.
    const again = await painted();
    expect([again.rev, again.results]).toEqual([3, first.results]);
  });

  it("lets the row decide between two Leafs on one database: a batch read in one while the other's tend writes is done once, over what was written, and answered", async () => {
    const path = join(tmpdir(), `leaf-two-${crypto.randomUUID()}.db`);
    try {
      // A deploy: the Leaf starting tends Alice's yard once the one stopping has read it for her batch, and
      // has written her call. (Two Leafs in one process: one's write in the other's transaction would hold both.)
      const starting = testLeaf(clock, noNetwork, { databasePath: path });
      await starting.query((sql) => sql`SELECT 1`);
      let reads = 0;
      let heard = false;
      const tend = async () => {
        await until(() => heard);
        await starting.run(tendAll);
      };
      const stopping = testLeaf(
        clock,
        noNetwork,
        { databasePath: path },
        {
          play: (real) => ({
            ...real,
            read: (player, game) =>
              real.read(player, game).pipe(Effect.tap(() => (++reads === 1 ? Effect.promise(tend) : Effect.void))),
            heard: (...args) => Effect.tap(real.heard(...args), () => Effect.sync(() => void (heard = true))),
          }),
        },
      );
      const kept = await keepMid(stopping);
      clock.now += 10 * MINUTE;
      const { paint, after } = painting(kept);
      const owner = { playerId: alice, guest: false };
      const sent = await stopping.run(Play.use((play) => play.send(owner, GAMES.works, [{ id: "p-1", ...paint }])));
      if (sent.status !== "done") throw new Error(sent.status);
      expect(sent.results).toEqual([{ id: "p-1", notes: [] }]);
      // The tend kept the yard run on as rev 2; the batch, done again over it, as rev 3.
      expect([sent.rev, await storedYard(starting)]).toEqual([3, { rev: 3, state: after }]);
      expect(await starting.query((sql) => sql`SELECT command_id AS id, rev FROM play_commands`)).toEqual([
        { id: "p-1", rev: 3 },
      ]);
      await Promise.all([starting.dispose(), stopping.dispose()]);
    } finally {
      for (const end of ["", "-wal", "-shm"]) rmSync(`${path}${end}`, { force: true });
    }
  });

  it("puts a tend in the line of every yard due and is done, waiting for none, though the first is eight hours behind; a sweep meanwhile adds none", async () => {
    const { game, run } = counted();
    // Bob's yard left eight hours ago, first in the sweep's order, and Alice's ten minutes ago.
    clock.now -= 8 * HOUR;
    const bobs = await keepMid(services, undefined, bob);
    clock.now += 8 * HOUR - 10 * MINUTE;
    const alices = await keepMid();
    clock.now += 10 * MINUTE;
    const tended = await services.run(Play.use((play) => play.tend([game])));
    expect(run.ticks).toBeLessThan(8 * 36_000 - LEAD);
    const expected = [[{ rev: 2, state: ranOn(bobs) }], { rev: 2, state: ranOn(alices) }];
    // A minute on, the next sweep finds a tend in both lines.
    clock.now += MINUTE;
    const next = await services.run(Play.use((play) => play.tend([game])));
    await services.run(Effect.andThen(tended, next));
    expect(run.ticks).toBe(8 * 36_000 - LEAD + 6000 - LEAD);
    expect([await storedPlay(bob), await storedYard()]).toEqual(expected);
  });

  it("shows a visitor behind its owner's first open the yard that open made, before it is stored", async () => {
    await app.dispose();
    const gate = Promise.withResolvers<void>();
    // Whether a state was stored at each read: the open's, held, and the visit's behind it.
    const found: boolean[] = [];
    start({
      play: (real) => ({
        ...real,
        read: (player, game) =>
          real.read(player, game).pipe(
            Effect.tap((state) => Effect.sync(() => void found.push(Option.isSome(state)))),
            Effect.tap(() => (found.length === 1 ? Effect.promise(() => gate.promise) : Effect.void)),
          ),
      }),
    });
    const opening = services.run(Play.use((play) => play.open({ playerId: alice, guest: false }, GAMES.works)));
    await until(() => found.length === 1);
    const visiting = services.run(Play.use((play) => play.visit(alice, GAMES.works, { playerId: bob, guest: false })));
    gate.resolve();
    const [owners, seen] = await Promise.all([opening, visiting]);
    expect(found).toEqual([false, false]);
    expect(owners.status).toBe("open");
    expect(seen).toEqual(owners);
    // Kept once its line was empty, untouched.
    expect((await storedYard()).rev).toBe(0);
  });
});

const storedPlay = (player: PlayerId, game = "works") =>
  services.query((sql) => sql`SELECT rev, state FROM play_state WHERE player_id = ${player} AND game = ${game}`);
/** Somebody's state in a game, as a visitor asks for it. */
const visit = (player: string, game: string, visitor: PlayerId = alice) =>
  send("GET", `/v1/game/play/${game}/of/${player}`, undefined, visitor);
/** Somebody's card's numbers, as the people route answers them. */
async function personOf(player: string, asker: PlayerId = alice) {
  const response = await send("GET", `/v1/game/people/${player}`, undefined, asker);
  expect(response.status).toBe(200);
  return Schema.decodeUnknownSync(Person)(await response.json());
}

describe("a visit", () => {
  it("finds nothing in a game that cannot be visited, nor of a player with no state there, and makes none", async () => {
    await opened(bob);
    const raid = await visit(bob, "raid");
    expect([raid.status, await codeOf(raid)]).toEqual([404, "nothing_to_visit"]);
    for (const nobody of [carol, "not-a-player"]) {
      // oxlint-disable-next-line no-await-in-loop -- one after another
      const none = await visit(nobody, "works");
      // oxlint-disable-next-line no-await-in-loop -- one after another
      expect([none.status, await codeOf(none)]).toEqual([404, "nothing_to_visit"]);
    }
    expect(await services.query((sql) => sql`SELECT player_id FROM play_state WHERE player_id = ${carol}`)).toEqual([]);
    expect(await entries(carol)).toEqual([]);
    const chess = await visit(bob, "chess");
    expect([chess.status, await codeOf(chess)]).toEqual([404, "no_such_game"]);
  });

  it("takes one of the visitor's batches: past twenty at once, slow_down", async () => {
    await send("GET", "/v1/game/play/works", undefined, bob);
    const answers = await Promise.all(Array.from({ length: 21 }, () => visit(bob, "works")));
    expect(answers.map((a) => a.status).toSorted((a, b) => a - b)).toEqual([
      ...Array.from({ length: 20 }, () => 200),
      429,
    ]);
    const slow = answers.find((a) => a.status === 429);
    expect(slow && (await codeOf(slow))).toBe("slow_down");
    // The batches are the visitor's own: a command of theirs is held back too, and Bob's are not.
    const held = await send("POST", "/v1/game/play/raid", { commands: ided([{ do: "start", trail: 0 }]) });
    expect(held.status).toBe(429);
    expect((await visit(alice, "works", bob)).status).toBe(404);
  });
});

describe("a person's numbers", () => {
  it("are where they stand in each game, placed as the board places them, the raid's written as their table changes", async () => {
    await named(bob, "Bob");
    const from = clock.now;
    const { view } = await playRun(bob);
    const seconds = Math.floor((clock.now - from) / 1000);
    await stand(stranger(1), 900, T0);
    await stand(bob, 500, T0);
    const bosses = view.almanac.bosses.flat().length;
    expect(await personOf(bob)).toEqual({
      id: bob,
      name: "Bob",
      games: {
        raid: { place: 1, score: bosses, also: { runs: 1, room: Math.max(...view.almanac.best) }, played: seconds },
        // A standing from before Leaf counted time.
        works: { place: 2, score: 500, also: { story: 500 % 16 }, played: 0 },
      },
      played: seconds,
    });
  });

  it("name one Leaf knows but cannot name Someone, and list no games for one who has played none", async () => {
    await stand(stranger(4), 0, T0);
    expect(await personOf(stranger(4))).toEqual({
      id: stranger(4),
      name: "Someone",
      games: { works: { place: 1, score: 0, also: { story: 0 }, played: 0 } },
      played: 0,
    });
    // Carol, a guest, asks about herself before she has played.
    expect(await personOf(carol, carol)).toEqual({ id: carol, name: "Someone", games: {}, played: 0 });
  });

  it("are not given of a player Leaf does not know", async () => {
    for (const nobody of [stranger(5), "not-a-player"]) {
      // oxlint-disable-next-line no-await-in-loop -- one after another
      const answer = await send("GET", `/v1/game/people/${nobody}`);
      // oxlint-disable-next-line no-await-in-loop -- one after another
      expect([answer.status, await codeOf(answer)]).toEqual([404, "no_such_player"]);
    }
  });
});

/** Alice's time in each game, in milliseconds, as Leaf keeps it. */
const playedMs = () =>
  services.run(PlayStore.use((store) => store.playedOf(alice))).then((games) => Object.fromEntries(games));
/** A call of Alice's to a game `after` milliseconds on: opening it. */
async function openAfter(after: number, game = "raid") {
  clock.now += after;
  expect((await send("GET", `/v1/game/play/${game}`)).status).toBe(200);
}

describe("time played", () => {
  const MINUTE = 60_000;

  it(`adds up the gaps between a player's calls to a game of up to ${IDLE_MS / MINUTE} minutes, from the second call`, async () => {
    await openAfter(0);
    expect(await playedMs()).toEqual({ raid: 0 });
    // A clock that does not move adds nothing.
    await openAfter(0);
    expect(await playedMs()).toEqual({ raid: 0 });
    // A batch is a call, as an opening is.
    clock.now += 2 * MINUTE;
    await commanded(ided([{ do: "start", trail: 0 }]));
    expect(await playedMs()).toEqual({ raid: 2 * MINUTE + 100 });
    await openAfter(IDLE_MS);
    expect(await playedMs()).toEqual({ raid: 2 * MINUTE + 100 + IDLE_MS });
    // Longer, and they were away: nothing, and the time counts again from there.
    await openAfter(IDLE_MS + 1);
    await openAfter(30_000);
    expect(await playedMs()).toEqual({ raid: 2 * MINUTE + 100 + IDLE_MS + 30_000 });
  });

  it("is each game's apart, and all games' together on the card, in whole seconds; a game with time and no standing has its entry", async () => {
    await openAfter(0, "raid");
    await openAfter(10_000, "town");
    await openAfter(50_000, "raid");
    await openAfter(MINUTE + 10_999, "town");
    expect(await playedMs()).toEqual({ raid: MINUTE, town: 2 * MINUTE + 999 });
    expect(await personOf(alice)).toEqual({
      id: alice,
      name: "Someone",
      games: { raid: { played: 60 }, town: { played: 120 } },
      played: 180,
    });
  });

  it("counts a visit for the visitor, in that game, and nothing for whoever is visited", async () => {
    await send("GET", "/v1/game/play/works", undefined, bob);
    await openAfter(0, "raid");
    for (const after of [MINUTE, 30_000, 30_000]) {
      clock.now += after;
      // oxlint-disable-next-line no-await-in-loop -- one after another
      expect((await visit(bob, "works")).status).toBe(200);
    }
    expect(await playedMs()).toEqual({ raid: 0, works: MINUTE });
    expect(Object.fromEntries(await services.run(PlayStore.use((store) => store.playedOf(bob))))).toEqual({
      works: 0,
    });
    // On her card, the raid she has opened and not played for a second is not listed.
    expect(await personOf(alice)).toEqual({
      id: alice,
      name: "Someone",
      games: { works: { played: 60 } },
      played: 60,
    });
  });

  it("counts a batch taken when it came, however it ends, and nothing for one refused whole", async () => {
    await app.dispose();
    // The first batch that has anything to log (setting out) fails as it writes it.
    let full = true;
    start({
      play: (real) => ({
        ...real,
        log: (player, game, what, now) =>
          Effect.suspend(() => {
            if (what.length === 0 || !full) return real.log(player, game, what, now);
            full = false;
            return Effect.die(new Error("the disk is full"));
          }),
      }),
    });
    await openAfter(0);
    await openAfter(MINUTE);
    clock.now += MINUTE;
    const refused = await send("POST", "/v1/game/play/raid", { commands: [{ id: "x-1", do: "win" }] });
    expect(refused.status).toBe(400);
    // A command the rules refuse is in a batch taken: it counts.
    clock.now += MINUTE;
    expect((await commanded(ided([{ do: "take" }]))).results).toMatchObject([{ refused: expect.any(String) }]);
    expect(await playedMs()).toEqual({ raid: 3 * MINUTE + 100 });
    // One taken that then fails was a call all the same.
    clock.now += MINUTE;
    const failed = await send("POST", "/v1/game/play/raid", { commands: ided([{ do: "start", trail: 0 }]) });
    expect(failed.status).toBe(500);
    expect(await playedMs()).toEqual({ raid: 4 * MINUTE + 100 });
    await openAfter(MINUTE);
    expect(await playedMs()).toEqual({ raid: 5 * MINUTE + 100 });
  });

  it("counts a visit at the moment it came, though it waits in a line: a later call joins on to it", async () => {
    const { game, run } = counted();
    await keepMid();
    clock.now += 480 * MINUTE;
    const bobs = { playerId: bob, guest: false };
    // Bob opens his own yard, and a minute later visits Alice's, which is brought up eight hours first.
    await services.run(Play.use((play) => play.open(bobs, game)));
    clock.now += MINUTE;
    const visiting = services.run(Play.use((play) => play.visit(alice, game, bobs)));
    await until(() => run.ticks > 0);
    // Two minutes on, while the visit still waits, he looks at his own again.
    clock.now += 2 * MINUTE + 1;
    await services.run(Play.use((play) => play.open(bobs, game)));
    expect(await visiting).toEqual(expect.objectContaining({ status: "open" }));
    expect(Object.fromEntries(await services.run(PlayStore.use((store) => store.playedOf(bob))))).toEqual({
      works: 3 * MINUTE + 1,
    });
  });

  it("counts a call though its caller goes while it is written: Leaf's own fiber writes it", async () => {
    await app.dispose();
    const gate = Promise.withResolvers<void>();
    let holding = false;
    let written = false;
    start({
      play: (real) => ({
        ...real,
        heard: (player, game, now) =>
          holding
            ? Effect.promise(() => gate.promise).pipe(
                Effect.andThen(real.heard(player, game, now)),
                Effect.andThen(Effect.sync(() => void (written = true))),
              )
            : real.heard(player, game, now),
      }),
    });
    await keepMid();
    const bobs = { playerId: bob, guest: false };
    // Bob opens his own yard, and a minute later visits Alice's: his page closes while that call is written.
    await services.run(Play.use((play) => play.open(bobs, GAMES.works)));
    clock.now += MINUTE;
    holding = true;
    await services.run(
      Play.use((play) =>
        Effect.gen(function* () {
          const visiting = yield* Effect.forkChild(play.visit(alice, GAMES.works, bobs), { startImmediately: true });
          yield* Fiber.interrupt(visiting);
        }),
      ),
    );
    gate.resolve();
    await until(() => written);
    expect(Object.fromEntries(await services.run(PlayStore.use((store) => store.playedOf(bob))))).toEqual({
      works: MINUTE,
    });
  });

  it("counts nothing for Leaf tending a yard while its owner is away", async () => {
    await keepMid();
    await openAfter(0, "works");
    // Within three minutes of her call, past the two after which Leaf keeps the yard itself.
    clock.now += TEND_AFTER + 30_000;
    await tending();
    expect((await storedYard()).rev).toBe(2);
    expect(await playedMs()).toEqual({ works: 0 });
    // Three and a half minutes after her own last call, she was away.
    await openAfter(MINUTE, "works");
    expect(await playedMs()).toEqual({ works: 0 });
  });
});

/** What a player has won for good, in the order Leaf saw it. */
const awarded = (player: PlayerId) =>
  services.query((sql) => sql`SELECT id, at FROM awards WHERE player_id = ${player} ORDER BY at, id`);
/** Alice's state in a game, as stored. */
const storedIn = (game: string) =>
  services.query<{ state: string }>(
    (sql) => sql`SELECT state FROM play_state WHERE player_id = ${alice} AND game = ${game}`,
  );

describe("awards", () => {
  it("are written once, when the raid beats a boss and the Works' depot takes a capstone in, and reach the camp by the trail", async () => {
    // A whole run by the bot, as a player plays it: it beats The Magpie.
    await playRun();
    const won = await awarded(alice);
    expect(won).toEqual([{ id: "trophy-hoardmagpie", at: expect.any(Number) }]);
    // Another run beats Old Bramble too; the award already held keeps the moment it was won.
    await playRun();
    expect(await awarded(alice)).toEqual([...won, { id: "trophy-oldbramble", at: expect.any(Number) }]);

    // A yard whose depot has taken in a clockwork crab: the next batch that changes it (a few seconds on) awards the model.
    const { clock: tick } = yardOf(
      Schema.decodeUnknownSync(Shown)(await (await send("GET", "/v1/game/play/works")).json()).state,
    );
    const yard = WORKS.decode((await storedIn("works"))[0]?.state ?? "");
    if (!yard) throw new Error("no yard");
    deliver(yard, "crab", 1);
    await services.query(
      (sql) => sql`UPDATE play_state SET state = ${WORKS.encode(yard)} WHERE player_id = ${alice} AND game = 'works'`,
    );
    clock.now += 5000;
    await send("POST", "/v1/game/play/works", { commands: [{ id: "w-1", do: "collect", tick: tick + 50 }] });
    expect((await awarded(alice)).map((a) => a.id)).toEqual(["trophy-hoardmagpie", "trophy-oldbramble", "model-crab"]);

    // The town is told of them on its next call, and puts each in the camp's tray, new, once.
    await townDid([{ id: "t-1", do: "readMail" }]);
    await townDid([{ id: "t-2", do: "readMail" }]);
    const camp = decodeTown((await storedIn("town"))[0]?.state ?? "")?.camp;
    expect([camp?.tray, camp?.fresh]).toEqual([
      { "trophy-hoardmagpie": 1, "trophy-oldbramble": 1, "model-crab": 1 },
      { "trophy-hoardmagpie": 1, "trophy-oldbramble": 1, "model-crab": 1 },
    ]);
    expect(camp?.earned).toEqual(["trophy-hoardmagpie", "trophy-oldbramble", "model-crab"]);
    // A game that awards nothing writes none.
    expect(await awarded(alice)).toHaveLength(3);
  });
});

/** Alice's town as her page is shown it, after a batch of commands. */
async function townDid(commands: readonly unknown[]) {
  clock.now += 200;
  const response = await send("POST", "/v1/game/play/town", { commands });
  expect(response.status).toBe(200);
  const body = Schema.decodeUnknownSync(Answered)(await response.json());
  return { results: body.results, view: townOf(body.state) };
}
function townOf(state: unknown): TownView {
  const view = readTownView(state);
  if (!view) throw new Error(`Not a town: ${JSON.stringify(state)}`);
  return view;
}
const townNow = async () =>
  townOf(Schema.decodeUnknownSync(Shown)(await (await send("GET", "/v1/game/play/town")).json()).state);
const nOf = (view: TownView, id: string) => view.camp.placed.find((p) => p.id === id)?.n ?? -1;

describe("the town, played by commands through HTTP", () => {
  it("opens a new member's camp, welcomes them, sells into the tray, sets out, moves and puts away by id, and pays the chest once a day", async () => {
    const first = await townNow();
    expect([first.arrival.first, first.camp.placed.length, first.camp.letters]).toEqual([true, 9, []]);

    const { results, view } = await townDid([
      { id: "a-1", do: "welcome", cursor: null },
      { id: "a-2", do: "buy", stall: "plants", thing: "pumpkin" },
    ]);
    // Bought, it is in the tray, new, and nothing more stands in the camp; looked at, it is set out.
    expect(results.map((r) => ("notes" in r ? r.notes : r.refused))).toEqual([[], []]);
    expect([view.camp.tray, view.camp.fresh, view.camp.placed.length]).toEqual([{ pumpkin: 1 }, { pumpkin: 1 }, 9]);
    const { view: set } = await townDid([
      { id: "a-3", do: "looked" },
      { id: "a-3b", do: "setOut", thing: "pumpkin", x: 30, y: 20, t: 0 },
    ]);
    expect([set.camp.tray, set.camp.fresh, set.camp.placed.length]).toEqual([{}, {}, 10]);
    expect(view.camp.letters.map((l) => [l.from, l.gift])).toEqual([["Tindra", "toadstool"]]);
    expect(await coinsOf(alice)).toBe(300 - 180);

    const pumpkin = nOf(set, "pumpkin");
    const moved = await townDid([
      { id: "a-4", do: "move", n: pumpkin, x: 31, y: 33, t: 0 },
      { id: "a-5", do: "toggle", n: nOf(view, "lantern-post") },
    ]);
    expect(moved.view.camp.placed.find((p) => p.n === pumpkin)).toMatchObject({ x: 31, y: 33 });
    expect(moved.view.camp.placed.find((p) => p.id === "lantern-post")?.s).toBe(1);
    const away = await townDid([
      { id: "a-6", do: "putAway", n: pumpkin },
      { id: "a-7", do: "putAway", n: nOf(view, "cabin") },
      { id: "a-8", do: "buy", stall: "lamps", thing: "well" },
    ]);
    expect(away.results).toEqual([
      { id: "a-6", notes: [] },
      { id: "a-7", refused: "rooted" },
      { id: "a-8", refused: "not_enough_coins" },
    ]);
    expect([away.view.camp.tray, away.view.camp.fresh]).toEqual([{ pumpkin: 1 }, {}]);

    const chest = await townDid([
      { id: "c-1", do: "openChest" },
      { id: "c-2", do: "openChest" },
    ]);
    expect(chest.results).toEqual([
      { id: "c-1", notes: [] },
      { id: "c-2", refused: "opened_today" },
    ]);
    expect(await coinsOf(alice)).toBe(300 - 180 + 3);
  });

  it("sends a caller by Leaf's clock, who is greeted by id and leaves what they brought in the mailbox", async () => {
    await townDid([{ id: "w-1", do: "welcome", cursor: null }]);
    expect((await townNow()).visit).toBeNull();
    clock.now += 80_000;
    const waiting = await townNow();
    const caller = waiting.visit;
    if (!caller) throw new Error("nobody called");
    // Looked at again, it is the same caller: nothing is drawn again for a page asking.
    expect((await townNow()).visit).toEqual(caller);
    const { results, view } = await townDid([
      { id: "g-1", do: "greet", visit: caller.id },
      { id: "g-2", do: "greet", visit: caller.id },
    ]);
    expect(results).toEqual([
      { id: "g-1", notes: [] },
      { id: "g-2", refused: "no_such_visit" },
    ]);
    expect([view.visit, view.camp.greeted]).toEqual([null, 1]);
    expect(view.camp.letters.some((l) => l.id === `v-${caller.id}`)).toBe(caller.note !== "" || caller.gift !== "");
  });

  it("is visited as what stands there, the stored text, the rev and the Coins as before; a player with no camp, 404", async () => {
    const lantern = nOf(await townNow(), "lantern-post");
    const { view } = await townDid([
      { id: "v-1", do: "welcome", cursor: null },
      { id: "v-2", do: "choosePet", pet: "fox" },
      { id: "v-3", do: "toggle", n: lantern },
    ]);
    // A caller is due: the visit brings the camp to now in memory, and writes nothing of it.
    clock.now += 80_000;
    const before = { stored: await storedPlay(alice, "town"), coins: await entries(alice) };
    const answer = await visit(alice, "town", bob);
    expect(answer.status).toBe(200);
    const seen = townOf(Schema.decodeUnknownSync(Shown)(await answer.json()).state);
    expect(seen.camp).toEqual({ ...view.camp, letters: [], tray: {}, fresh: {}, greeted: 0, earned: [] });
    expect(seen.camp.placed.find((p) => p.id === "lantern-post")?.s).toBe(1);
    expect([seen.visit, seen.arrival.mail, seen.made]).toEqual([null, [], 0]);
    expect({ stored: await storedPlay(alice, "town"), coins: await entries(alice) }).toEqual(before);
    const none = await visit(bob, "town");
    expect([none.status, await codeOf(none)]).toEqual([404, "nothing_to_visit"]);
  });
});

/** A batch of commands to the pulls, as a player's page sends it, and Leaf's answer. */
async function pulled(commands: readonly unknown[], player: PlayerId = alice) {
  clock.now += Math.max(1, commands.length) * 100;
  const response = await send("POST", "/v1/game/play/pulls", { commands }, player);
  expect(response.status).toBe(200);
  return Schema.decodeUnknownSync(Answered)(await response.json());
}
const tenPulls = (id: string) => ({ id, do: "pull", pool: "grove", n: 10, with: "leaf" });

describe("pulls", () => {
  it("ten take 10,000 Leaf once, as one spend; sent again, they take nothing; and each prize won is awarded", async () => {
    await spending();
    await raided(alice, 25_000);
    const ten = tenPulls("p-1");
    const done = await pulled([ten]);
    expect(done.results.map((r) => ("notes" in r ? r.notes.length : r.refused))).toEqual([10]);
    expect(await services.account(alice)).toEqual({ playerId: alice, balance: 15_000, xp: 25_000 });
    const spent = {
      kind: "spend",
      origin: "shop",
      key: `play:pulls:${alice}:pull:0`,
      delta: -10_000,
      xp: 0,
      memo: "Pulls: 10 in grove",
    };
    expect((await ledgerOf(alice)).slice(1)).toEqual([spent]);
    expect((await pulled([ten])).results).toEqual(done.results);
    expect((await ledgerOf(alice)).slice(1)).toEqual([spent]);
    const have = PULLS.decode((await storedIn("pulls"))[0]?.state ?? "")?.have ?? {};
    expect(Object.values(have).reduce((sum, n) => sum + n, 0)).toBe(10);
    expect(new Set((await awarded(alice)).map((a) => a.id))).toEqual(
      new Set(Object.keys(have).map((id) => `pull:${id}`)),
    );
  });

  it("are refused, changing nothing, for too little Leaf and while spending is off", async () => {
    await spending();
    await raided(alice, 9_999);
    await send("GET", "/v1/game/play/pulls");
    const before = await untouched(alice, "pulls");
    expect((await pulled([tenPulls("p-1")])).results).toEqual([{ id: "p-1", refused: "not_enough_leaf" }]);
    expect(await untouched(alice, "pulls")).toEqual(before);

    await app.dispose();
    start();
    await raided(alice, 20_000);
    await send("GET", "/v1/game/play/pulls");
    const off = await untouched(alice, "pulls");
    expect((await pulled([tenPulls("p-2")])).results).toEqual([{ id: "p-2", refused: "leaf_closed" }]);
    expect(await untouched(alice, "pulls")).toEqual(off);
  });
});

/** The pull banners, as Leaf lists them. */
async function banners() {
  const response = await send("GET", "/v1/game/banners");
  expect(response.status).toBe(200);
  return Schema.decodeUnknownSync(Banners)(await response.json());
}

describe("the banners", () => {
  it("are listed with their dates and headliner, who Leaf then knows, so their name and face are looked up", async () => {
    await app.dispose();
    const mojang = fakeMojang();
    const headliner = stranger(5);
    mojang.profiles.set(headliner, { name: "Fernwhistle", skin: undefined });
    start({ mojang: mojang.service });
    const dates = { id: "banner-1", from: "2026-11-23T00:00:00.000Z", until: "2026-12-08T00:00:00.000Z" };
    expect(await banners()).toEqual({ banners: [{ ...dates, headliner: null }] });
    const known = () =>
      services.run(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          return [...(yield* knownAmong(sql, [headliner], clock.now))];
        }),
      );
    expect(await known()).toEqual([]);

    await services.query((sql) => sql`INSERT INTO banner_people (banner, player_id) VALUES ('banner-1', ${headliner})`);
    expect(await banners()).toEqual({ banners: [{ ...dates, headliner: { id: headliner, name: "Fernwhistle" } }] });
    expect(await known()).toEqual([headliner]);
    expect((await app.request("/v1/game/banners")).status).toBe(401);
  });
});
