import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";

import { type Game, type Met, type PlayerId, playerId } from "@sequoia-leaf/core";
import { isParty, RAID, readView, type Roster, type TableView } from "@sequoia-leaf/raid";
import { keptBoard } from "@sequoia-leaf/raid/foe.ts";
import { wayOn } from "@sequoia-leaf/raid/way.ts";
import { Schema } from "effect";

import { RaidDepths, RaidHeld } from "../src/api/schemas.ts";
import { Events } from "../src/events/store.ts";
import { PlayerNames } from "../src/game/names.ts";
import { played } from "../src/play/games.ts";
import { Play } from "../src/play/service.ts";
import { PlayStore } from "../src/play/store.ts";
import { asPage, fakeBackend, sessionOf, steadyDice, testLeaf } from "./support.ts";

const alice = playerId("10000000-0000-0000-0000-000000000001");
const bob = playerId("10000000-0000-0000-0000-000000000002");
const carol = playerId("10000000-0000-0000-0000-000000000003");
/** Wednesday 25 November 2026, 12:00 UTC; its week started on Monday the 23rd. */
const T0 = Date.UTC(2026, 10, 25, 12);
const MONDAY = Date.UTC(2026, 10, 30);
const ORIGIN = "https://leaf.seqwawa.com";
const SESSIONS: Record<PlayerId, string> = { [alice]: "alice-token", [bob]: "bob-token", [carol]: "carol-token" };

const clock = { now: T0 };
let services: ReturnType<typeof testLeaf>;
let app: ReturnType<(typeof services)["app"]>;
beforeEach(() => {
  clock.now = T0;
  const fake = fakeBackend({
    "alice-token": () => Response.json(sessionOf(alice, "Alice", "CAPTAIN")),
    "bob-token": () => Response.json(sessionOf(bob, "Bob", "RECRUIT")),
    "carol-token": () => Response.json(sessionOf(carol, "Carol", null)),
  });
  services = testLeaf(clock, fake.fetcher, {}, { dice: steadyDice(7) });
  app = services.app();
});
afterEach(async () => {
  await app.dispose();
});

const get = (path: string, player: PlayerId) =>
  app.request(path, { headers: { Cookie: `seq_session=${SESSIONS[player]}`, Origin: ORIGIN } });
const named = (player: PlayerId, name: string) =>
  services.run(PlayerNames.use((names) => names.remember(player, name, clock.now)));
const keptAt = (slot: string) =>
  services.query(
    (sql) =>
      sql`SELECT player_id AS player, data, updated_at AS at FROM play_kept WHERE slot = ${slot} ORDER BY player_id`,
  );
const takenFrom = (player: PlayerId) =>
  services
    .run(Events.use((events) => events.latest(player, 50)))
    .then((rows) => rows.filter((row) => row.type === "held_taken").map((row) => JSON.parse(row.data)));

/** A holding command: it leaves its text at `slot` as the slot's holder, and meets the holder of `meet`, if any. */
interface Holding {
  readonly slot: string;
  readonly text: string;
  readonly meet: string | null;
}
const isHolding = (v: unknown): v is Holding =>
  typeof v === "object" &&
  v !== null &&
  "slot" in v &&
  typeof v.slot === "string" &&
  "text" in v &&
  typeof v.text === "string" &&
  "meet" in v &&
  (v.meet === null || typeof v.meet === "string");
/** A game whose every command holds the slot it names, and meets the holder of the slot it says: its note is what Leaf gave it. */
const HOLDER: Game<{ n: number }, Holding, { n: number }, Met | null> = {
  id: "town",
  create: () => ({ n: 0 }),
  advance: (state) => state,
  meets: (_, c) => (c.meet === null ? null : { slot: c.meet, avoid: [], held: true }),
  apply: (state, c, ctx) => ({
    state: { n: state.n + 1 },
    notes: [ctx.met ?? null],
    keep: [{ slot: c.slot, data: c.text, held: true }],
  }),
  view: (state) => state,
  decode: (text) => {
    const v: unknown = JSON.parse(text);
    return typeof v === "object" && v !== null && "n" in v && typeof v.n === "number" ? { n: v.n } : null;
  },
  encode: (state) => JSON.stringify(state),
  command: (v) => (isHolding(v) ? { slot: v.slot, text: v.text, meet: v.meet } : null),
};
let made = 0;
/** A player's holding command, through the play service: what it met. */
async function holds(player: PlayerId, c: Partial<Holding>): Promise<unknown> {
  clock.now += 100;
  const sent = [{ id: `h-${++made}`, slot: c.slot ?? "deep:20", text: c.text ?? "", meet: c.meet ?? null }];
  const batch = await services.run(
    Play.use((play) => play.send({ playerId: player, guest: false }, played(HOLDER), sent)),
  );
  const [result] = batch.status === "done" ? batch.results : [];
  return result && "notes" in result ? result.notes[0] : "refused";
}

describe("a held slot", () => {
  it("is met by whoever left a piece there last, the player too; with nobody holding it, nothing is", async () => {
    await named(alice, "Alice");
    expect(await holds(bob, { slot: "x", meet: "deep:20" })).toBeNull();
    await holds(alice, { text: "Alice's" });
    expect(await holds(bob, { slot: "x", meet: "deep:20" })).toEqual({
      player: alice,
      name: "Alice",
      data: "Alice's",
      of: 1,
    });
    expect(await holds(alice, { slot: "y", meet: "deep:20" })).toMatchObject({ player: alice, data: "Alice's" });
  });

  it("taken, lets go of the holder's piece and tells them once, by name; held again, tells nobody", async () => {
    await named(bob, "Bob");
    await named(alice, "Alice");
    await holds(alice, { text: "Alice's" });
    await holds(bob, { text: "Bob's" });
    expect(await keptAt("deep:20")).toEqual([{ player: bob, data: '"Bob\'s"', at: clock.now }]);
    const told = { game: "town", slot: "deep:20", by: { id: bob, username: "Bob" } };
    expect(await takenFrom(alice)).toEqual([told]);
    await holds(bob, { text: "Bob's again" });
    expect(await takenFrom(alice)).toEqual([told]);
    expect(await takenFrom(bob)).toEqual([]);
    await holds(alice, { text: "Alice's again" });
    expect(await takenFrom(bob)).toEqual([{ game: "town", slot: "deep:20", by: { id: alice, username: "Alice" } }]);
    expect(await takenFrom(alice)).toEqual([told]);
  });

  it("held last week is held by nobody: met by nobody, and its holder is told nothing when it is taken", async () => {
    await holds(alice, { text: "Alice's" });
    clock.now = MONDAY;
    expect(await holds(bob, { slot: "x", meet: "deep:20" })).toBeNull();
    await holds(bob, { text: "Bob's" });
    expect(await takenFrom(alice)).toEqual([]);
    expect(await keptAt("deep:20")).toEqual([{ player: bob, data: '"Bob\'s"', at: clock.now }]);
  });
});

/** A table mid-fight in a room held in the Deep Woods, its fight undone and its party made unbeatable; with `roster`, the member's own figures. */
function poised(roster: Roster | null = null): string {
  const text = readFileSync(new URL("../../../packages/raid/stored/endless-deep.json", import.meta.url), "utf8");
  const table = RAID.decode(text);
  const run = table?.held.endless;
  if (!table || !run) throw new Error("the fixture has no endless run");
  run.board = run.board.map((_, seat) =>
    seat < 5 ? { id: 900 + seat, kind: "greg", stars: 3, items: [], fed: 0, fights: 0 } : null,
  );
  run.nextId = 1000;
  run.level = 8;
  run.stage = { phase: "plan", picks: [] };
  run.way = wayOn({ id: "deep" }, roster);
  table.almanac.deepest = { wilds: 0, deep: 0 };
  table.week = { at: 0, deepest: { wilds: 0, deep: 0 } };
  return RAID.encode(table);
}
async function raided(player: PlayerId, commands: readonly object[]): Promise<TableView> {
  clock.now += 100;
  const response = await app.request("/v1/game/play/raid", {
    method: "POST",
    headers: { Cookie: `seq_session=${SESSIONS[player]}`, Origin: ORIGIN, "Content-Type": "application/json" },
    body: JSON.stringify(
      asPage("/v1/game/play/raid", { player, commands: commands.map((c) => ({ id: `r-${++made}`, ...c })) }),
    ),
  });
  const body = Schema.decodeUnknownSync(Schema.Struct({ state: Schema.Unknown }))(await response.json());
  const view = readView(body.state);
  if (!view) throw new Error("not a raid table");
  return view;
}

/** A depth left at a slot of the raid's boards, as a won room leaves it. */
const left = (player: PlayerId, slot: string, room: number, at: number) =>
  services.query(
    (sql) =>
      sql`INSERT INTO play_kept (player_id, game, slot, data, updated_at) VALUES (${player}, 'raid', ${slot}, ${JSON.stringify({ room })}, ${at})`,
  );

describe("the Deep Woods at Leaf", () => {
  it("keep the board that wins a held room for the next to meet, and the room on the winner's front page", async () => {
    await named(alice, "Alice");
    await services.run(PlayStore.use((store) => store.create(alice, "raid", poised(), false, clock.now, null)));
    const view = await raided(alice, [{ do: "fight", endless: true }]);
    const fight = view.held.endless?.stage.phase === "fight" ? view.held.endless.stage.fight : null;
    expect(fight?.outcome.result).toBe("win");
    expect(await keptAt("deep:17")).toEqual([
      { player: alice, data: JSON.stringify(fight ? keptBoard(fight.setup) : undefined), at: clock.now },
    ]);
    const held = await get("/v1/game/raid/held", alice);
    expect(Schema.decodeUnknownSync(RaidHeld)(await held.json())).toEqual({ rooms: [18] });
    expect(Schema.decodeUnknownSync(RaidHeld)(await (await get("/v1/game/raid/held", bob)).json())).toEqual({
      rooms: [],
    });
    const week = Schema.decodeUnknownSync(RaidDepths)(await (await get("/v1/game/raid/depths/deep/week", bob)).json());
    expect(week).toEqual({
      top: [{ place: 1, id: alice, name: "Alice", room: 18, at: new Date(clock.now).toISOString(), you: false }],
      you: null,
    });
  });

  it("list the deepest rooms won, then who won them first; this week's board starts again on Monday", async () => {
    await Promise.all([named(alice, "Alice"), named(bob, "Bob"), named(carol, "Carol")]);
    await left(alice, "depth:wilds:ever", 31, T0 - 9 * 86_400_000);
    await left(bob, "depth:wilds:ever", 24, T0 - 1000);
    await left(carol, "depth:wilds:ever", 24, T0 - 2000);
    await left(bob, "depth:wilds:week", 24, T0 - 1000);
    await left(alice, "depth:wilds:week", 31, T0 - 9 * 86_400_000);
    const board = async (path: string, player: PlayerId) =>
      Schema.decodeUnknownSync(RaidDepths)(await (await get(path, player)).json());
    const ever = await board("/v1/game/raid/depths/wilds/ever", bob);
    expect(ever.top.map((row) => [row.place, row.name, row.room, row.you])).toEqual([
      [1, "Alice", 31, false],
      [2, "Carol", 24, false],
      [3, "Bob", 24, true],
    ]);
    expect(ever.you).toEqual({ place: 3, room: 24, at: new Date(T0 - 1000).toISOString() });
    const week = await board("/v1/game/raid/depths/wilds/week", alice);
    expect(week.top.map((row) => [row.place, row.name, row.room])).toEqual([[1, "Bob", 24]]);
    expect(week.you).toBeNull();
    clock.now = MONDAY;
    expect((await board("/v1/game/raid/depths/wilds/week", alice)).top).toEqual([]);
    expect((await get("/v1/game/raid/depths/somewhere/week", alice)).status).toBe(400);
  });

  it("leave nothing of a guest's", async () => {
    await services.run(PlayStore.use((store) => store.create(carol, "raid", poised(), true, clock.now, null)));
    clock.now += 100;
    await services.run(
      Play.use((play) =>
        play.send({ playerId: carol, guest: true }, played(RAID), [{ id: "g-1", do: "fight", endless: true }]),
      ),
    );
    expect(await keptAt("deep:17")).toEqual([]);
    expect(await services.query((sql) => sql`SELECT * FROM play_kept WHERE player_id = ${carol}`)).toEqual([]);
  });
});

/** An endless board as Leaf answers a player. */
const boardAt = async (path: string, player: PlayerId) =>
  Schema.decodeUnknownSync(RaidDepths)(await (await get(path, player)).json());
/** The rooms Leaf says a player holds. */
const roomsAt = async (path: string, player: PlayerId) =>
  Schema.decodeUnknownSync(RaidHeld)(await (await get(path, player)).json()).rooms;
/** The levels on a kept board: `greg 3`. */
const levelsIn = (data: unknown): string[] => {
  const party: unknown = JSON.parse(String(data));
  return isParty(party) ? party.figures.flatMap((p) => (p.level ? [`${p.kind} ${p.level}`] : [])) : ["not a party"];
};
const namesOn = (b: typeof RaidDepths.Type) => b.top.map((row) => [row.name, row.room]);

describe("the Deep Woods with the members' own figures, at Leaf", () => {
  it("hold the same room apart from everyone's figures: their own lane, their own boards, a level never in a fair lane", async () => {
    await Promise.all([named(alice, "Alice"), named(bob, "Bob")]);
    await services.run(PlayStore.use((store) => store.create(alice, "raid", poised(), false, clock.now, null)));
    await services.run(
      PlayStore.use((store) => store.create(bob, "raid", poised({ greg: 3 }), false, clock.now, null)),
    );
    await raided(alice, [{ do: "fight", endless: true }]);
    await raided(bob, [{ do: "fight", endless: true }]);
    const fair = await keptAt("deep:17");
    const own = await keptAt("deep.own:17");
    expect(fair.map((row) => row.player)).toEqual([alice]);
    expect(own.map((row) => row.player)).toEqual([bob]);
    expect(levelsIn(own[0]?.data)).toEqual(Array.from({ length: 5 }, () => "greg 3"));
    expect(levelsIn(fair[0]?.data)).toEqual([]);
    // Neither took the other's room.
    expect([await takenFrom(alice), await takenFrom(bob)]).toEqual([[], []]);
    expect(await roomsAt("/v1/game/raid/held", alice)).toEqual([18]);
    expect(await roomsAt("/v1/game/raid/held?pool=own", alice)).toEqual([]);
    expect(await roomsAt("/v1/game/raid/held", bob)).toEqual([]);
    expect(await roomsAt("/v1/game/raid/held?pool=own", bob)).toEqual([18]);
    expect(namesOn(await boardAt("/v1/game/raid/depths/deep/week", bob))).toEqual([["Alice", 18]]);
    expect(namesOn(await boardAt("/v1/game/raid/depths/deep/week?pool=own", alice))).toEqual([["Bob", 18]]);
    expect(namesOn(await boardAt("/v1/game/raid/depths/deep/ever?pool=own", alice))).toEqual([["Bob", 18]]);
    expect((await boardAt("/v1/game/raid/depths/deep/week?pool=own", bob)).you).toMatchObject({ place: 1, room: 18 });
  });

  it("start again on Monday, everyone's and the members' own alike; the boards of every week keep them", async () => {
    await Promise.all([named(alice, "Alice"), named(bob, "Bob")]);
    await left(alice, "depth:wilds:week", 22, T0 - 1000);
    await left(bob, "depth:own.wilds:week", 27, T0 - 1000);
    await left(bob, "depth:own.wilds:ever", 27, T0 - 1000);
    await left(bob, "deep.own:20", 0, T0 - 1000);
    expect((await boardAt("/v1/game/raid/depths/wilds/week?pool=own", alice)).top.map((r) => r.name)).toEqual(["Bob"]);
    expect(await roomsAt("/v1/game/raid/held?pool=own", bob)).toEqual([21]);
    clock.now = MONDAY;
    expect((await boardAt("/v1/game/raid/depths/wilds/week", alice)).top).toEqual([]);
    expect((await boardAt("/v1/game/raid/depths/wilds/week?pool=own", alice)).top).toEqual([]);
    expect(await roomsAt("/v1/game/raid/held?pool=own", bob)).toEqual([]);
    expect((await boardAt("/v1/game/raid/depths/wilds/ever?pool=own", alice)).top.map((r) => r.room)).toEqual([27]);
  });
});
