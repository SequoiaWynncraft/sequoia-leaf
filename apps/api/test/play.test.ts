import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { type Game, MOST_COMMANDS, type PlayerId, playerId } from "@sequoia-leaf/core";
import { planCommands, type RaidCommand, readNotes, readView, SENSIBLE, type TableView } from "@sequoia-leaf/raid";
import { Effect, Schema } from "effect";

import { played } from "../src/play/games.ts";
import { Play } from "../src/play/service.ts";
import { ACTIVITY_KEPT_MS, ANSWERS_KEPT, LOGGED_A_DAY, PlayStore } from "../src/play/store.ts";
import { DAY, fakeBackend, type Fakes, sessionOf, steadyDice, testLeaf } from "./support.ts";

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

function start(fakes: Fakes = {}) {
  clock.now = T0;
  const fake = fakeBackend({
    "alice-token": () => Response.json(sessionOf(alice, "Alice", "CAPTAIN")),
    "bob-token": () => Response.json(sessionOf(bob, "Bob", "RECRUIT")),
    "carol-token": () => Response.json(sessionOf(carol, "Carol", null)),
    // A website admin, the guild's staff, for the report of who played.
    "dave-token": () => Response.json({ ...sessionOf(dave, "Dave", null), website_admin: true }),
  });
  services = testLeaf(clock, fake.fetcher, {}, { dice: steadyDice(7), ...fakes });
  app = services.app();
}

beforeEach(() => start());
afterEach(async () => {
  await app.dispose();
});

/** A request as the game's page sends it: the website's cookie, from Leaf's own page. */
function send(method: string, path: string, body?: unknown, player: PlayerId = alice): Promise<Response> {
  return Promise.resolve(
    app.request(path, {
      method,
      headers: { Cookie: `seq_session=${SESSIONS[player]}`, Origin: ORIGIN, "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }),
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
const stored = (player: PlayerId) =>
  services.query((sql) => sql`SELECT rev, state FROM play_state WHERE player_id = ${player} AND game = 'raid'`);

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
    const paths = ["/v1/game/play/chess", "/v1/game/play/works", "/v1/game/play/town"];
    const answers = await Promise.all(
      paths.flatMap((path) => [send("GET", path), send("POST", path, { commands: [] })]),
    );
    expect(answers.map((response) => response.status)).toEqual(answers.map(() => 404));
    expect(await Promise.all(answers.map(codeOf))).toEqual(answers.map(() => "no_such_game"));
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

  it("needs a session, and a write with the cookie must come from Leaf's own pages", async () => {
    expect((await app.request("/v1/game/play/raid")).status).toBe(401);
    const elsewhere = await app.request("/v1/game/play/raid", {
      method: "POST",
      headers: {
        Cookie: "seq_session=alice-token",
        Origin: "https://evil.example",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ commands: [{ id: "c-x", do: "start", trail: 0 }] }),
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
