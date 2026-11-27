import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { type PlayerId, playerId } from "@sequoia-leaf/core";
import {
  eraAt,
  figureIn,
  LEGACY_ERA,
  planCommands,
  type RaidCommand,
  readNotes,
  readView,
  SENSIBLE,
  type TableView,
} from "@sequoia-leaf/raid";
import { type FightRecord, readFight } from "@sequoia-leaf/raid/fought.ts";
import { CAT, EVERYONES } from "@sequoia-leaf/raid/testkit.ts";
import { Schema } from "effect";

import { fightLines, rowOf } from "../scripts/fight-lines.ts";
import { GAMES } from "../src/play/games.ts";
import { FIGHTS_KEPT_MS, LOGGED_A_DAY } from "../src/play/logs.ts";
import { Play } from "../src/play/service.ts";
import { PlayStore } from "../src/play/store.ts";
import { DAY, fakeBackend, type LogLine, steadyDice, testLeaf } from "./support.ts";

const alice = playerId("10000000-0000-0000-0000-000000000001");
const bob = playerId("10000000-0000-0000-0000-000000000002");
/** Thursday 26 November 2026, 12:00 UTC. */
const T0 = Date.UTC(2026, 10, 26, 12);
const clock = { now: T0 };
let services: ReturnType<typeof testLeaf>;
let logged: LogLine[] = [];

beforeEach(() => {
  clock.now = T0;
  logged = [];
  services = testLeaf(clock, fakeBackend().fetcher, {}, { dice: steadyDice(7), logged });
});
afterEach(() => services.dispose());

let made = 0;
/** Sends a batch of commands to a player's raid, a second after the last, each with an id of its own unless it has one. */
async function send(commands: readonly (RaidCommand & { readonly id?: string })[], player: PlayerId = alice) {
  clock.now += 1000;
  const sent = commands.map((c) => ({ id: `c-${++made}`, ...c }));
  const done = await services.run(Play.use((play) => play.send({ playerId: player, guest: false }, GAMES.raid, sent)));
  if (done.status !== "done") throw new Error(`the batch was ${done.status}`);
  const view = readView(done.view);
  if (!view) throw new Error("not a raid table");
  return { results: done.results, view };
}

/** The room that is up at a player's table, planned as the bot plays it. */
async function planned(table: TableView, player: PlayerId = alice): Promise<TableView> {
  let view = table;
  for (let guard = 0; guard < 30; guard++) {
    const commands = planCommands(view, SENSIBLE);
    if (commands.length === 0) break;
    // oxlint-disable-next-line no-await-in-loop -- each batch is planned from Leaf's answer to the last
    view = (await send(commands, player)).view;
  }
  return view;
}
/** A player's table set out on, and its first room planned. */
const ready = async (player: PlayerId = alice, own = false): Promise<TableView> =>
  planned((await send([own ? { do: "start", trail: 0, own } : { do: "start", trail: 0 }], player)).view, player);

/** The party a fight was decided with, as its answer's note says. */
function partyOf(results: readonly unknown[]) {
  const notes = results.flatMap((r) =>
    typeof r === "object" && r !== null && "notes" in r ? (readNotes(r.notes) ?? []) : [],
  );
  const fight = notes.find((n) => n.t === "fight");
  if (fight?.t !== "fight") throw new Error("no fight");
  return fight.setup.sides[0];
}

const Row = Schema.Struct({
  playerId: Schema.String,
  at: Schema.Number,
  rules: Schema.String,
  way: Schema.String,
  room: Schema.Number,
  party: Schema.fromJsonString(Schema.Unknown),
  against: Schema.NullOr(Schema.String),
});
const rows = async () =>
  Schema.decodeUnknownSync(Schema.Array(Row))(
    await services.query(
      (sql) => sql`SELECT player_id AS playerId, at, rules, way, room, party, against FROM raid_fights ORDER BY at, id`,
    ),
  );

/** A fight of Bob's written at `at`, as a script would. */
const old = (at: number) =>
  services.query(
    (sql) => sql`
      INSERT INTO raid_fights (player_id, at, rules, run, way, trail, room, kind, across, result, margin, seconds,
        resolve, level, acorns, party, against)
      VALUES (${bob}, ${at}, 'old', 1, 'main', 0, 0, 'trouble', 'plan:0', 'win', 0.5, 10, 20, 1, 2,
        '{"figures":[],"traits":{},"boons":[]}', NULL)
    `,
  );

describe("each fight decided", () => {
  it("writes one row with the party it fought with, the rules it was fought by, and nothing in the activity", async () => {
    await ready();
    const fight = await send([{ do: "fight" }]);
    const party = partyOf(fight.results);
    expect(await rows()).toEqual([
      {
        playerId: alice,
        at: clock.now,
        rules: GAMES.raid.rules,
        way: "main",
        room: 0,
        party: expect.anything(),
        against: null,
      },
    ]);
    const [row] = await rows();
    expect(row?.party).toEqual({ figures: party.figures, traits: expect.any(Object), boons: [] });
    // Its takings write no more.
    await send([{ do: "take" }]);
    expect(await rows()).toHaveLength(1);
    const kinds = await services.query((sql) => sql`SELECT DISTINCT kind FROM activity ORDER BY kind`);
    expect(kinds).toEqual([{ kind: "raid_room" }, { kind: "raid_started" }]);
  });

  it("on the member's own figures, says so, with each figure's level", async () => {
    const tier1 = EVERYONES.filter((id) => figureIn(CAT, id).tier === 1);
    const awards = tier1.flatMap((id) =>
      [1, 2, 3, 4, 5, 6, 7].map((n) => (n === 1 ? `pull:figure:${id}` : `copies:figure:${id}:${n}`)),
    );
    await services.run(PlayStore.use((store) => store.award(bob, awards, T0)));
    await ready(bob, true);
    const party = partyOf((await send([{ do: "fight" }], bob)).results);
    expect(party.figures.every((p) => p.level === 6)).toBe(true);
    const [row] = await rows();
    expect(row).toMatchObject({ playerId: bob, way: "own", party: { figures: party.figures } });
  });

  it("is exported for the fight report with how its run set out and its era, and read back the same; a row an older Leaf wrote, as its way and moment say", async () => {
    const tier1 = EVERYONES.filter((id) => figureIn(CAT, id).tier === 1);
    await services.run(
      PlayStore.use((store) =>
        store.award(
          bob,
          tier1.map((id) => `pull:figure:${id}`),
          T0,
        ),
      ),
    );
    await ready();
    await send([{ do: "fight" }]);
    await ready(bob, true);
    await send([{ do: "fight" }], bob);
    await old(clock.now + 1);
    const lines = Schema.decodeUnknownSync(Schema.Array(Schema.Struct({ line: Schema.String })))(
      await services.query(fightLines),
    );
    const read = lines.map(({ line }) => rowOf(line));
    expect(read.map((r) => r && [r.player, r.fight.way, r.fight.course, r.fight.pool, r.fight.era])).toEqual([
      [alice, "main", "trail", "fair", eraAt(T0)],
      [bob, "own", "trail", "own", eraAt(T0)],
      // Written without them: its course and pool as its way says, its era the one live when it was written.
      [bob, "main", "trail", "fair", eraAt(clock.now + 1)],
    ]);
    // The line says what the row keeps: the same line read again is the same fight.
    expect(
      read.map((r) => r && rowOf(JSON.stringify({ ...r.fight, at: r.at, player: r.player, rules: r.rules }))),
    ).toEqual(read);
  });

  it("is written once for a command answered twice, and not at all for one refused", async () => {
    const { view } = await send([{ do: "start", trail: 0 }]);
    // A pick waits: the party cannot set out.
    const refused = await send([{ do: "fight" }]);
    expect(refused.results).toEqual([{ id: expect.any(String), refused: "pick_starter" }]);
    expect(await rows()).toEqual([]);
    await planned(view);
    const fight = { id: "the-fight", do: "fight" } as const;
    await send([fight]);
    await send([fight]);
    expect(await rows()).toHaveLength(1);
  });

  it("is kept a year: older rows go when a new one is written", async () => {
    await old(T0 - FIGHTS_KEPT_MS - 1);
    await old(T0 - FIGHTS_KEPT_MS + DAY);
    await ready();
    await send([{ do: "fight" }]);
    expect((await rows()).map((row) => row.at)).toEqual([T0 - FIGHTS_KEPT_MS + DAY, clock.now]);
  });
});

describe("the fights a player's day takes", () => {
  const record: FightRecord = {
    run: 1,
    way: "main",
    course: "trail",
    trail: 0,
    pool: "fair",
    era: LEGACY_ERA,
    room: 0,
    kind: "trouble",
    across: "plan:0",
    result: "win",
    margin: 0.5,
    seconds: 10,
    resolve: 20,
    level: 1,
    acorns: 2,
    party: { figures: [{ kind: "crab7", stars: 1, seat: 3, items: [], fed: 0 }], traits: {}, boons: [] },
    against: null,
  };
  const fights = (n: number, data: Readonly<Record<string, unknown>> = record) =>
    Array.from({ length: n }, () => ({ kind: "raid_fight", data }));
  const log = (n: number, now: number, data?: Readonly<Record<string, unknown>>) =>
    services.run(PlayStore.use((store) => store.log(alice, "raid", fights(n, data), now)));

  it("are 1,000, past which they are not written while the play goes on; and one that does not read is let go", async () => {
    await log(LOGGED_A_DAY + 2, T0);
    expect(await rows()).toHaveLength(LOGGED_A_DAY);
    await log(1, Date.UTC(2026, 10, 27));
    expect(await rows()).toHaveLength(LOGGED_A_DAY + 1);
    expect(readFight(JSON.parse(JSON.stringify(record)))).toEqual(record);
    await log(1, Date.UTC(2026, 10, 28), { ...record, result: "maybe" });
    expect(await rows()).toHaveLength(LOGGED_A_DAY + 1);
    expect(logged.map((line) => line.message)).toEqual(["A raid fight Leaf does not keep"]);
  });
});
