/**
 * The Wilds and the Deep Woods with the member's own figures: setting out takes their roster, their
 * boards and holders are their own lane's, their deepest rooms are kept apart and start again each
 * week as everyone's figures' do, and they pay as a run with everyone's figures does.
 */
import { describe, expect, test } from "bun:test";

import { type Ctx, type Done, isRefused, LOGGED, type Logged } from "@sequoia-leaf/core";

import { SENSIBLE } from "./bot.ts";
import type { RaidCommand } from "./command.ts";
import type { FigureId, Stars } from "./content/figures.ts";
import { LEGACY_ERA } from "./content/releases.ts";
import { paidFor, reached, weekAt } from "./depths.ts";
import { roomAt } from "./endless.ts";
import { foeOf } from "./foe.ts";
import { meets, planCommands, RAID, type RaidNote, type Table } from "./game.ts";
import { payout } from "./outside.ts";
import { isParty } from "./party.ts";
import { foughtOf, type Run, startRun, summariseRun } from "./run.ts";
import { type Way, wayOn } from "./way.ts";

const ME = "10000000-0000-0000-0000-000000000001";
/** Friday 15 January 2027, 08:00 UTC. */
const NOW = 1_800_000_000_000;
/** The Monday after it, 00:00 UTC. */
const MONDAY = Date.UTC(2027, 0, 18);
const AWARDS = ["pull:figure:greg", "copies:figure:greg:4", "pull:figure:heron"];
const ROSTER = { greg: 3, heron: 0 };
const ctx = (seed = 7, more: Partial<Ctx> = {}): Ctx => ({
  now: NOW,
  player: { id: ME, guest: false },
  seed,
  room: 1e9,
  awards: AWARDS,
  postcards: {},
  ...more,
});
const isDone = (d: Done<Table, RaidNote> | { refused: string }): d is Done<Table, RaidNote> => !("refused" in d);
function must(state: Table, c: RaidCommand, at: Ctx = ctx()): Done<Table, RaidNote> {
  const done = RAID.apply(state, c, at);
  if (!isDone(done)) throw new Error(`${c.do} was refused: ${done.refused}`);
  return done;
}

const DEEP = wayOn({ id: "deep" });
const DEEP_OWN = wayOn({ id: "deep" }, ROSTER);
const WILDS_OWN = wayOn({ id: "wilds" }, ROSTER);

/** A run on a way brought to a room, its board three stars of the best there are, at the top level: one that wins. */
function strong(way: Way, room: number): Run {
  const run = startRun(4, { era: LEGACY_ERA, way });
  const best: FigureId[] = ["greg", "whitefox", "hearthcat", "badger", "crab40", "fogowl", "heron", "apothecary"];
  run.board = run.board.map(() => null);
  best.forEach((kind, i) => {
    const stars: Stars = 3;
    run.board[i < 5 ? i + 1 : 14 + i] = { id: 100 + i, kind, stars, items: [], fed: 0, fights: 0 };
  });
  run.level = 8;
  run.room = room;
  run.stage = { phase: "plan", picks: [] };
  run.foe = foeOf(run, 99);
  return run;
}
/** A table with an endless run in hand. */
const table = (run: Run): Table => {
  const t = RAID.create(ctx());
  return { ...t, held: { ...t.held, endless: run }, begun: { ...t.begun, endless: 1 } };
};
/** What a fight in a run's room leaves with Leaf, fought at the table. */
const keptBy = (run: Run, at: Ctx = ctx()): { slot: string; held?: boolean }[] =>
  (must(table(run), { do: "fight", slot: "endless" }, at).keep ?? []).map(({ slot, held }) =>
    held ? { slot, held } : { slot },
  );

/** Where a run going on from a room (counting from 0) is met, once its fight there is decided. */
function metGoingOn(way: Way, room: number) {
  const done = must(table(strong(way, room)), { do: "fight", slot: "endless" });
  return meets(done.state, { do: "take", slot: "endless" });
}
/** The levels on the boards a fight left as a room's holder: `greg 3`. */
const heldLevels = (d: Done<Table, RaidNote>): string[] =>
  (d.keep ?? [])
    .flatMap((k) => (k.held && isParty(k.data) ? k.data.figures : []))
    .flatMap((p) => (p.level ? [`${p.kind} ${p.level}`] : []));

/** Sets out with the member's own figures and plays rooms, as the sensible bot plans them, until the run is over or `rooms` are fought. */
function playOwn(course: "wilds" | "deep", rooms: number) {
  let t = RAID.create(ctx(1));
  const log: Logged[] = [];
  const coins: { key: string; amount: number }[] = [];
  let n = 2;
  const send = (c: RaidCommand): boolean => {
    const done = RAID.apply(t, c, ctx(n++));
    if (isRefused(done)) return false;
    t = done.state;
    log.push(...(done.log ?? []));
    coins.push(...(done.coins ?? []));
    return true;
  };
  send({ do: "start", course, own: true });
  for (let room = 0; room < rooms; room++) {
    for (let ask = 0; ask < 8; ask++) {
      const planned = planCommands(RAID.view(t, ctx(0)), SENSIBLE, "endless");
      if (planned.length === 0 || !planned.every(send)) break;
    }
    if (!send({ do: "fight", slot: "endless" }) || !send({ do: "take", slot: "endless" })) break;
  }
  send({ do: "abandon", slot: "endless" });
  return { log, coins, table: t };
}
/** A run on a way that won thirty rooms and then lost. */
function wonThirty(way: Way): Run {
  const run = startRun(8, { era: LEGACY_ERA, way });
  run.record = Array.from({ length: 30 }, (_, room) => ({
    room,
    kind: roomAt(room)?.kind ?? "spar",
    result: "win" as const,
    standing: [1, 0] as [number, number],
    boss: roomAt(room)?.kind === "boss" ? ("oldbramble" as const) : null,
  }));
  run.stage = { phase: "over", ending: "lost" };
  return run;
}
const paidOn = (way: Way) => payout(paidFor(wonThirty(way), summariseRun(wonThirty(way))));

describe("setting out on an endless way with the member's own figures", () => {
  test.each(["wilds", "deep"] as const)("%s: takes their roster as it is now, in the endless slot", (course) => {
    const s = must(RAID.create(ctx()), { do: "start", course, own: true }).state;
    expect(s.held.endless?.way).toEqual(wayOn({ id: course }, ROSTER));
    expect(s.held.main).toBeNull();
    expect(RAID.view(s, ctx()).held.endless?.way.figures).toEqual({ pool: "own", roster: ROSTER });
  });
  test("is refused to a member who has pulled nothing", () => {
    const none = ctx(7, { awards: [] });
    for (const course of ["wilds", "deep"] as const)
      expect(RAID.apply(RAID.create(none), { do: "start", course, own: true }, none)).toEqual({
        refused: "nothing_pulled",
      });
  });
});

describe("the Deep Woods' rooms held, each pool apart", () => {
  test("a fair run and an own run hold the same room apart: each is left in its own lane", () => {
    const fair = keptBy(strong(DEEP, 17));
    const own = keptBy(strong(DEEP_OWN, 17));
    expect(fair).toEqual([{ slot: "deep:17", held: true }, { slot: "depth:deep:ever" }, { slot: "depth:deep:week" }]);
    expect(own).toEqual([
      { slot: "deep.own:17", held: true },
      { slot: "depth:own.deep:ever" },
      { slot: "depth:own.deep:week" },
    ]);
  });
  test("a run going into a held room meets the holder of its own lane: a fair run never meets an own board", () => {
    expect(metGoingOn(DEEP, 16)).toEqual({ slot: "deep:17", avoid: [], held: true });
    expect(metGoingOn(DEEP_OWN, 16)).toEqual({ slot: "deep.own:17", avoid: [], held: true });
  });
  test("a level never reaches a fair lane: nothing an own run leaves is in one, in either way", () => {
    for (const way of [DEEP_OWN, WILDS_OWN])
      for (const room of [3, 15, 16, 17, 20, 21])
        for (const { slot } of keptBy(strong(way, room)))
          expect(slot.startsWith("deep.own:") || slot.startsWith("depth:own.")).toBe(true);
  });
  test("an own run's board, levels and all, is kept as it fought; a fair run's has no level to keep", () => {
    const own = must(table(strong(DEEP_OWN, 17)), { do: "fight", slot: "endless" });
    const fair = must(table(strong(DEEP, 17)), { do: "fight", slot: "endless" });
    expect(heldLevels(own)).toEqual(["greg 3"]);
    expect(heldLevels(fair)).toEqual([]);
  });
});

describe("the deepest rooms with the member's own figures", () => {
  test("are kept apart from the almanac's and the week's, and both start again on Monday", () => {
    let s = table(strong(DEEP_OWN, 17));
    s = must(s, { do: "fight", slot: "endless" }).state;
    expect(s.apart.deepest.deep).toBe(18);
    expect(s.apart.week.deepest.deep).toBe(18);
    expect(s.almanac.deepest.deep).toBe(0);
    expect(s.week.deepest.deep).toBe(0);
    s = { ...s, held: { ...s.held, endless: strong(DEEP, 17) } };
    s = must(s, { do: "fight", slot: "endless" }).state;
    expect([s.almanac.deepest.deep, s.week.deepest.deep, s.apart.deepest.deep]).toEqual([18, 18, 18]);
    const monday = RAID.view(s, ctx(7, { now: MONDAY }));
    expect(monday.week).toEqual({ at: MONDAY, deepest: { wilds: 0, deep: 0 } });
    expect(monday.apart).toEqual({
      deepest: { wilds: 0, deep: 18 },
      week: { at: MONDAY, deepest: { wilds: 0, deep: 0 } },
    });
    expect(monday.almanac.deepest.deep).toBe(18);
  });
  test("a room won after Monday is this week's best again, and left for this week's board", () => {
    const run = strong(DEEP_OWN, 17);
    const done = must(table(run), { do: "fight", slot: "endless" });
    const lastWeek = done.state.apart;
    const f = foughtOf(done.state.held.endless ?? run);
    if (!f) throw new Error("no fight");
    const week = weekAt(lastWeek.week, MONDAY);
    const left = reached({ ever: { ...lastWeek.deepest }, week }, done.state.held.endless ?? run, f, false);
    expect(left.map((k) => k.slot)).toEqual(["deep.own:17", "depth:own.deep:week"]);
    expect(week.deepest.deep).toBe(18);
  });
});

describe("an own run on an endless way is paid and logged", () => {
  test.each(["wilds", "deep"] as const)(
    "%s: under the endless slot's key, its lines saying its pool, the Tally not counting it",
    (course) => {
      const { log, coins, table: t } = playOwn(course, 3);
      expect(coins.map((c) => c.key)).toEqual(["endless:1"]);
      const lines = log.filter((l) => l.kind !== LOGGED.raidFight);
      expect(lines.length).toBeGreaterThan(0);
      for (const l of lines) expect([l.data.course, l.data.pool, l.data.tallied]).toEqual([course, "own", false]);
      for (const r of log.filter((l) => l.kind === LOGGED.raidFight)) expect(r.data.pool).toBe("own");
      expect(t.almanac.deepest).toEqual({ wilds: 0, deep: 0 });
    },
  );
  test("is paid for rooms 1 to 15 and the win at 15, as a fair run is", () => {
    for (const course of ["wilds", "deep"] as const) {
      expect(paidOn(wayOn({ id: course }, ROSTER))).toEqual(paidOn(wayOn({ id: course })));
      expect(paidOn(wayOn({ id: course }, ROSTER)).coins).toBeGreaterThan(0);
    }
  });
});
