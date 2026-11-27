import { describe, expect, test } from "bun:test";

import type { Ctx, Done, Met } from "@sequoia-leaf/core";

import type { RaidCommand } from "./command.ts";
import { catalogAt } from "./content/catalog.ts";
import { ENDLESS } from "./content/endless.ts";
import type { FigureId, Stars } from "./content/figures.ts";
import { eraOf, LEGACY_ERA } from "./content/releases.ts";
import { ROOM_COUNT, ROOMS } from "./content/rooms.ts";
import { depthSlot, paidFor, reached, weekAt } from "./depths.ts";
import { heldRoom, heldSlot, roomAt, sparAt } from "./endless.ts";
import { boardMet, foeOf, opposition } from "./foe.ts";
import { meets, RAID, type RaidNote, readCommand, type Table, TABLE_VERSION } from "./game.ts";
import { payout } from "./outside.ts";
import {
  beginFight,
  endingOf,
  fieldCap,
  foughtOf,
  partyOf,
  type RoomRecord,
  type Run,
  startRun,
  summariseRun,
  takenTo,
  takeTakings,
} from "./run.ts";

const ME = "10000000-0000-0000-0000-000000000001";
const OTHER = "10000000-0000-0000-0000-000000000002";
/** Friday 15 January 2027, 08:00 UTC. */
const NOW = 1_800_000_000_000;
const ctx = (seed = 7, more: Partial<Ctx> = {}): Ctx => ({
  now: NOW,
  player: { id: ME, guest: false },
  seed,
  room: 1e9,
  awards: [],
  postcards: {},
  ...more,
});
const isDone = (d: Done<Table, RaidNote> | { refused: string }): d is Done<Table, RaidNote> => !("refused" in d);
function must(state: Table, c: RaidCommand, at: Ctx = ctx()): Done<Table, RaidNote> {
  const done = RAID.apply(state, c, at);
  if (!isDone(done)) throw new Error(`${c.do} was refused: ${done.refused}`);
  return done;
}

/** A run brought to a room, its board three stars of the best there are, at the top level: one that wins. */
function strong(run: Run, room: number): Run {
  const best: FigureId[] = ["greg", "whitefox", "hearthcat", "badger", "crab40", "fogowl", "heron", "apothecary"];
  run.board = run.board.map(() => null);
  best.forEach((kind, i) => {
    const stars: Stars = 3;
    run.board[i < 5 ? i + 1 : 14 + i] = { id: 100 + i, kind, stars, items: [], fed: 0 };
  });
  run.level = 8;
  run.room = room;
  run.stage = { phase: "plan", picks: [] };
  run.foe = foeOf(run, 99);
  return run;
}
const boss = (room: number, won: boolean): RoomRecord => ({
  room,
  kind: "boss",
  result: won ? "win" : "loss",
  standing: [1, 1],
  boss: "oldbramble",
});

/** A room won, as a run's record keeps it. */
const won = (room: number) => ({
  room,
  kind: roomAt(room)?.kind ?? "spar",
  result: "win" as const,
  standing: [1, 0] as [number, number],
  boss: roomAt(room)?.kind === "boss" ? ("oldbramble" as const) : null,
});
/** A member's board, as Leaf hands it over. */
const board = (who: string): Met => ({
  player: who,
  name: who,
  data: partyOf(strong(startRun(2, { era: LEGACY_ERA }), 3)),
  of: 1,
});
/** The fight a run sets out to, as decided. */
const fought = (run: Run) => {
  beginFight(run);
  const f = foughtOf(run);
  if (!f) throw new Error("no fight");
  return f;
};
/** A table with an endless run in hand. */
const table = (run: Run): Table => ({ ...RAID.create(ctx()), endless: run, ventures: 1 });

describe("an endless run's rooms", () => {
  test("after the fifteenth the fifteen come round again, in the same order, for ever", () => {
    for (let room = ROOM_COUNT; room < ROOM_COUNT * 4; room++) {
      expect(roomAt(room)?.kind).toBe(ROOMS[room % ROOM_COUNT]?.kind);
    }
  });
  test("the forest after the fifteenth is 5% stronger for each room past it, compounding", () => {
    const run = startRun(3, { era: LEGACY_ERA, endless: "wilds" });
    for (const room of [15, 16, 19, 29, 42]) {
      run.room = room;
      const foe = foeOf(run, 99);
      expect(foe.who).toBe("The forest");
      expect(foe.might).toBe(Math.round(100 * (1 + ENDLESS.grows / 100) ** (room - ROOM_COUNT + 1)));
      const plans = roomAt(room)?.plans.map((plan) => plan.name) ?? [];
      expect(plans).toContain(foe.title);
    }
  });
  test("a regular after the fifteenth fields the top level, and a chair for each boss on the way", () => {
    expect([17, 18, 20, 23, 25, 28, 30, 60].map((room) => sparAt(room).level)).toEqual([8, 8, 9, 9, 10, 10, 11, 11]);
    expect(sparAt(18).spent).toBeGreaterThan(sparAt(17).spent);
    expect(sparAt(13)).toEqual(ROOMS[13]?.spar ?? { level: 0, spent: 0, components: 0 });
    const run = startRun(3, { era: LEGACY_ERA, endless: "wilds" });
    run.room = 33;
    expect(foeOf(run, 5).figures).toHaveLength(11);
  });
  test("a run of fifteen rooms meets exactly what it always did", () => {
    const met: Met = {
      player: OTHER,
      name: "Mossback",
      data: partyOf(strong(startRun(1, { era: LEGACY_ERA }), 3)),
      of: 2,
    };
    for (let room = 0; room < ROOM_COUNT; room++) {
      const run = startRun(4, { era: LEGACY_ERA, trail: 1 });
      run.room = room;
      expect(foeOf(run, 77, met)).toEqual(opposition(catalogAt(LEGACY_ERA), 77, room, 1, met));
    }
  });
});

describe("an endless run goes on", () => {
  test("winning the fifteenth room moves it on to the sixteenth, and only resolve ends it", () => {
    const run = strong(startRun(5, { era: LEGACY_ERA, endless: "wilds" }), ROOM_COUNT - 1);
    expect(beginFight(run).ok).toBe(true);
    expect(foughtOf(run)?.outcome.result).toBe("win");
    expect(takenTo(run)).toBe(ROOM_COUNT);
    expect(takeTakings(run).ok).toBe(true);
    expect(run.room).toBe(ROOM_COUNT);
    expect(run.stage.phase).toBe("plan");
    // A party of one Moth, with 1 resolve left, deep down: the room is lost and the run is over.
    run.board = run.board.map((_, i) => (i === 3 ? { id: 1, kind: "moth", stars: 1, items: [], fed: 0 } : null));
    run.resolve = 1;
    run.room = 40;
    run.stage = { phase: "plan", picks: [] };
    run.foe = foeOf(run, 3);
    beginFight(run);
    expect(takeTakings(run).ok).toBe(true);
    expect(endingOf(run)).toBe("lost");
  });
  test("a run of fifteen rooms still ends when the fifteenth is won", () => {
    const run = strong(startRun(5, { era: LEGACY_ERA }), ROOM_COUNT - 1);
    beginFight(run);
    expect(takenTo(run)).toBeNull();
    takeTakings(run);
    expect(endingOf(run)).toBe("won");
  });
});

describe("chairs", () => {
  test("each boss beaten after the fifteenth room is one more figure fielded, three at most", () => {
    const run = startRun(6, { era: LEGACY_ERA, endless: "deep" });
    run.level = 8;
    expect(fieldCap(run)).toBe(8);
    run.record.push(boss(4, true), boss(19, false));
    expect(fieldCap(run)).toBe(8);
    run.record.push(boss(19, true));
    expect(fieldCap(run)).toBe(9);
    run.record.push(boss(24, true), boss(29, true), boss(34, true));
    expect(fieldCap(run)).toBe(8 + ENDLESS.chairs);
    run.boons.push("extrachair");
    expect(fieldCap(run)).toBe(9 + ENDLESS.chairs);
  });
  test("a run of fifteen rooms has none", () => {
    const run = startRun(6, { era: LEGACY_ERA });
    run.level = 8;
    run.record.push(boss(19, true), boss(24, true));
    expect(fieldCap(run)).toBe(8);
  });
});

describe("Coins for an endless run", () => {
  test("only rooms 1 to 15 pay, as a first-trail run that won them pays", () => {
    const deep = startRun(8, { era: LEGACY_ERA, endless: "deep" });
    deep.record = Array.from({ length: 40 }, (_, room) => won(room));
    deep.stage = { phase: "over", ending: "lost" };
    const first = startRun(8, { era: LEGACY_ERA });
    first.record = Array.from({ length: ROOM_COUNT }, (_, room) => won(room));
    first.stage = { phase: "over", ending: "won" };
    expect(payout(paidFor(deep, summariseRun(deep)))).toEqual(payout(summariseRun(first)));
    expect(payout(summariseRun(first)).coins).toBe(16 * 15 + 50 + 120);
  });
  test("one that did not win the fifteenth room is not paid the win", () => {
    const deep = startRun(8, { era: LEGACY_ERA, endless: "wilds" });
    deep.record = Array.from({ length: 10 }, (_, room) => won(room));
    deep.stage = { phase: "over", ending: "lost" };
    expect(paidFor(deep, summariseRun(deep)).ending).toBe("lost");
  });
});

describe("rooms held in the Deep Woods", () => {
  test("from the sixteenth room a sparring room is the board of whoever holds it, the member's own too", () => {
    const run = startRun(9, { era: LEGACY_ERA, endless: "deep" });
    run.room = 17;
    expect(foeOf(run, 4, board(OTHER))).toMatchObject({ by: OTHER, who: OTHER, title: "their board at this room" });
    expect(foeOf(run, 4, board(ME)).by).toBe(ME);
  });
  test("is a regular while nobody holds it, before the sixteenth room, and in the Wilds", () => {
    const run = startRun(9, { era: LEGACY_ERA, endless: "deep" });
    run.room = 17;
    const regular = foeOf(run, 4);
    expect(regular.by).toBeUndefined();
    expect(regular.figures).toHaveLength(sparAt(17).level);
    run.room = 12;
    expect(foeOf(run, 4, board(OTHER)).by).toBeUndefined();
    const wilds = startRun(9, { era: LEGACY_ERA, endless: "wilds" });
    wilds.room = 17;
    expect(foeOf(wilds, 4, board(OTHER))).toEqual(regular);
  });
  test("a board is met only if each figure on it is open in the era of the run that meets it: else the regular stays", () => {
    const run = startRun(9, { era: LEGACY_ERA, endless: "deep" });
    run.room = 17;
    const seqwawa: Met = {
      ...board(OTHER),
      data: { ...partyOf(run), figures: [{ kind: "seqwawa", stars: 1, seat: 3, items: [], fed: 0 }] },
    };
    expect(foeOf(run, 4, seqwawa).by).toBe(OTHER);
    // A run of the base's era alone (made up: the expansion's first release opens with it) has no Seqwawa.
    const before = { ...run, era: eraOf("base") };
    expect(foeOf(before, 4, seqwawa)).toEqual(foeOf(before, 4));
    expect([boardMet(catalogAt(eraOf("base")), seqwawa), boardMet(catalogAt(LEGACY_ERA), seqwawa)?.by]).toEqual([
      null,
      OTHER,
    ]);
  });
  test("a held board may field its chairs, and no more", () => {
    const run = startRun(9, { era: LEGACY_ERA, endless: "deep" });
    run.room = 33;
    const wide = (n: number): Met => ({
      ...board(OTHER),
      data: {
        ...partyOf(startRun(1, { era: LEGACY_ERA })),
        figures: Array.from({ length: n }, (_, seat) => ({ kind: "moth", stars: 1, seat, items: [], fed: 0 })),
      },
    });
    expect(foeOf(run, 4, wide(9 + ENDLESS.chairs)).by).toBe(OTHER);
    expect(foeOf(run, 4, wide(10 + ENDLESS.chairs)).by).toBeUndefined();
  });
  test("a room's slot names the room", () => {
    expect(heldRoom(heldSlot(21))).toBe(21);
    expect(heldRoom("board:0:3")).toBeNull();
  });
});

describe("the endless run at the table", () => {
  test("sits beside the run in hand: setting out on either leaves the other as it is", () => {
    let s = must(RAID.create(ctx()), { do: "start", trail: 0 }).state;
    s = must(s, { do: "choose", option: 0 }).state;
    const run = s.run;
    const done = must(s, { do: "start", course: "wilds" });
    expect(done.notes).toContainEqual({ t: "started", trail: 0, run: 1, endless: "wilds" });
    s = done.state;
    expect(s.endless?.endless).toBe("wilds");
    expect(s.run?.board).toEqual(run?.board ?? []);
    expect(s.ventures).toBe(1);
    expect(s.runs).toBe(1);
  });
  test("a command for a run acts on the endless run when it says so, and on the run in hand when not", () => {
    let s = must(RAID.create(ctx()), { do: "start", trail: 0 }).state;
    s = must(s, { do: "start", course: "deep" }).state;
    s = must(s, { do: "choose", option: 1, slot: "endless" }).state;
    expect(s.endless?.board.some((p) => p !== null)).toBe(true);
    expect(s.run?.board.every((p) => p === null)).toBe(true);
    const predicted = RAID.view(s, ctx());
    expect(predicted.endless?.endless).toBe("deep");
  });
  test("an endless run that has fought no room is not put down, nor walked home from", () => {
    const s = must(RAID.create(ctx()), { do: "start", course: "wilds" }).state;
    expect(RAID.apply(s, { do: "start", course: "deep" }, ctx())).toEqual({ refused: "unfought" });
    expect(RAID.apply(s, { do: "abandon", slot: "endless" }, ctx())).toEqual({ refused: "unfought" });
    expect(isDone(RAID.apply(s, { do: "start", trail: 0 }, ctx()))).toBe(true);
  });
  test("is kept and read back, and a table kept before there were endless runs reads with none", () => {
    let s = must(RAID.create(ctx()), { do: "start", course: "deep" }).state;
    s = must(s, { do: "choose", option: 0, slot: "endless" }).state;
    expect(JSON.parse(RAID.encode(s))).toMatchObject({ v: TABLE_VERSION });
    expect(RAID.decode(RAID.encode(s))).toEqual(s);
    const old = { ...JSON.parse(RAID.encode(s)), v: 2, endless: undefined, ventures: undefined, week: undefined };
    expect(RAID.decode(JSON.stringify(old))).toMatchObject({ endless: null, ventures: 0, week: { at: 0 } });
  });
  test("reads the endless slot off the wire for a run's commands, and setting out on one, as either was ever said", () => {
    expect(readCommand({ do: "buy", offer: 2, slot: "endless" })).toEqual({ do: "buy", offer: 2, slot: "endless" });
    expect(readCommand({ do: "buy", offer: 2, endless: true })).toEqual({ do: "buy", offer: 2, slot: "endless" });
    expect(readCommand({ do: "buy", offer: 2, endless: "yes" })).toEqual({ do: "buy", offer: 2 });
    expect(readCommand({ do: "start", course: "wilds" })).toEqual({ do: "start", course: "wilds" });
    expect(readCommand({ do: "endless", way: "wilds" })).toEqual({ do: "start", course: "wilds" });
    expect(readCommand({ do: "endless", way: "lost" })).toBeNull();
    expect(readCommand({ do: "start", trail: 0, endless: true })).toEqual({ do: "start", trail: 0 });
  });
});

describe("what a room won in an endless run leaves", () => {
  test("a take into a held room meets whoever holds it; the Wilds and a run of fifteen rooms meet no holder", () => {
    const deep = strong(startRun(4, { era: LEGACY_ERA, endless: "deep" }), 16);
    fought(deep);
    expect(meets(table(deep), { do: "take", slot: "endless" })).toEqual({ slot: heldSlot(17), avoid: [], held: true });
    expect(meets(table(deep), { do: "take" })).toBeNull();
    const wilds = strong(startRun(4, { era: LEGACY_ERA, endless: "wilds" }), 16);
    fought(wilds);
    expect(meets(table(wilds), { do: "take", slot: "endless" })).toBeNull();
  });
  test("a room held and won is held by the board that won it; a depth past the best is left for the boards", () => {
    const run = strong(startRun(4, { era: LEGACY_ERA, endless: "deep" }), 17);
    const f = fought(run);
    const s = { ever: { wilds: 0, deep: 12 }, week: weekAt({ at: 0, deepest: { wilds: 0, deep: 0 } }, NOW) };
    expect(reached(s, run, f, false)).toEqual([
      { slot: heldSlot(17), data: f.setup.sides[0], held: true },
      { slot: depthSlot("deep", "ever"), data: { room: 18 } },
      { slot: depthSlot("deep", "week"), data: { room: 18 } },
    ]);
    expect(s.ever.deep).toBe(18);
    expect(reached(s, run, f, false)).toEqual([{ slot: heldSlot(17), data: f.setup.sides[0], held: true }]);
  });
  test("a guest's deepest are written down, and nothing is left", () => {
    const run = strong(startRun(4, { era: LEGACY_ERA, endless: "wilds" }), 20);
    const s = { ever: { wilds: 0, deep: 0 }, week: { at: 0, deepest: { wilds: 0, deep: 0 } } };
    expect(reached(s, run, fought(run), true)).toEqual([]);
    expect(s.ever.wilds).toBe(21);
  });
  test("a new week starts on Monday at 00:00 UTC with nothing won in it", () => {
    const week = { at: Date.UTC(2027, 0, 11), deepest: { wilds: 30, deep: 22 } };
    expect(weekAt(week, Date.UTC(2027, 0, 17, 23, 59))).toBe(week);
    expect(weekAt(week, Date.UTC(2027, 0, 18))).toEqual({ at: Date.UTC(2027, 0, 18), deepest: { wilds: 0, deep: 0 } });
  });
});
