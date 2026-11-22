import { afterEach, beforeEach, describe, expect, it } from "bun:test";

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
import { decodeTown, readNotes as readTownNotes, readView as readTownView, type TownView } from "@sequoia-leaf/town";
import { deliver, readView as readYardView, route, WORKS } from "@sequoia-leaf/yard";
import { Effect, Exit, Logger, References, Schema } from "effect";
import { SqlClient } from "effect/sql";

import { Banners, Person, Standings } from "../src/api/schemas.ts";
import type { Settings } from "../src/config.ts";
import { knownAmong } from "../src/game/known.ts";
import { PlayerNames } from "../src/game/names.ts";
import { Coins } from "../src/play/coins.ts";
import { played } from "../src/play/games.ts";
import { Play } from "../src/play/service.ts";
import { ACTIVITY_KEPT_MS, ANSWERS_KEPT, BOARD_MOST, LOGGED_A_DAY, PlayStore } from "../src/play/store.ts";
import { DAY, fakeBackend, fakeMojang, type Fakes, sessionOf, steadyDice, testLeaf } from "./support.ts";

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
    expect(await entries(alice)).toEqual([]);
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
  ...SHOP,
  id: "works",
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
    const yardNow = yardOf(Schema.decodeUnknownSync(Answered)(await collected.json()).state).yard;
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

    // Bob visits a minute on: he is given the yard as Alice's own page is, and nothing of it is written.
    clock.now += MINUTE;
    const before = { state: await storedWorks(alice), coins: await entries(alice), stood: await standings() };
    const visited = Schema.decodeUnknownSync(Shown)(await (await visit(alice, "works", bob)).json());
    const own = Schema.decodeUnknownSync(Shown)(await (await send("GET", "/v1/game/play/works")).json());
    expect(visited).toEqual(own);
    expect(yardOf(visited.state).yard.tick).toBeGreaterThan(yardNow.tick);
    expect({ state: await storedWorks(alice), coins: await entries(alice), stood: await standings() }).toEqual(before);
    // Her card: where her yard stands.
    expect(await personOf(alice, bob)).toEqual({
      id: alice,
      name: "Alice",
      games: { works: { place: 1, score: earned, also: { story: 1 } } },
    });
  });
});

const storedWorks = (player: PlayerId) =>
  services.query((sql) => sql`SELECT rev, state FROM play_state WHERE player_id = ${player} AND game = 'works'`);
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
    const { view } = await playRun(bob);
    await stand(stranger(1), 900, T0);
    await stand(bob, 500, T0);
    const bosses = view.almanac.bosses.flat().length;
    expect(await personOf(bob)).toEqual({
      id: bob,
      name: "Bob",
      games: {
        raid: { place: 1, score: bosses, also: { runs: 1, room: Math.max(...view.almanac.best) } },
        works: { place: 2, score: 500, also: { story: 500 % 16 } },
      },
    });
  });

  it("name one Leaf knows but cannot name Someone, and list no games for one who has played none", async () => {
    await stand(stranger(4), 0, T0);
    expect(await personOf(stranger(4))).toEqual({
      id: stranger(4),
      name: "Someone",
      games: { works: { place: 1, score: 0, also: { story: 0 } } },
    });
    // Carol, a guest, asks about herself before she has played.
    expect(await personOf(carol, carol)).toEqual({ id: carol, name: "Someone", games: {} });
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

    // The town is told of them on its next call, and sends each by the trail to the camp, once.
    await townDid([{ id: "t-1", do: "readMail" }]);
    await townDid([{ id: "t-2", do: "readMail" }]);
    const camp = decodeTown((await storedIn("town"))[0]?.state ?? "")?.camp;
    expect(camp?.parcels).toEqual(["trophy-hoardmagpie", "trophy-oldbramble", "model-crab"]);
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
  it("opens a new member's camp, welcomes them, sells, unpacks, moves and puts away by id, and pays the chest once a day", async () => {
    const first = await townNow();
    expect([first.arrival.first, first.camp.placed.length, first.camp.letters]).toEqual([true, 9, []]);

    const { results, view } = await townDid([
      { id: "a-1", do: "welcome", cursor: null },
      { id: "a-2", do: "buy", stall: "plants", thing: "pumpkin" },
      { id: "a-3", do: "unpack", x: 30, y: 20, t: 0 },
    ]);
    const landed = readTownNotes(results.flatMap((r) => ("notes" in r ? r.notes : [])));
    expect(landed).toEqual([{ t: "landed", thing: "pumpkin", n: nOf(view, "pumpkin") }]);
    expect(view.camp.letters.map((l) => [l.from, l.gift])).toEqual([["Tindra", "toadstool"]]);
    expect(await coinsOf(alice)).toBe(300 - 180);

    const pumpkin = nOf(view, "pumpkin");
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
    expect([away.view.camp.tray, away.view.camp.parcels]).toEqual([{ pumpkin: 1 }, []]);

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
    const dates = { id: "banner-1", from: "2026-11-24T00:00:00.000Z", until: "2026-12-08T00:00:00.000Z" };
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
