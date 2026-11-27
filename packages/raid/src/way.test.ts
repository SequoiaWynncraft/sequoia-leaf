import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";

import { type Ctx, isRefused, LOGGED, type Logged, SLOT, talliedFrom, type TallyStat } from "@sequoia-leaf/core";

import { STORED } from "../review/golden.ts";
import { SENSIBLE } from "./bot.ts";
import type { RaidCommand } from "./command.ts";
import { TRAILS } from "./content/rooms.ts";
import { reached } from "./depths.ts";
import { meets, planCommands, RAID, type RaidNote, readCommand, type Table } from "./game.ts";
import { decodeSitting } from "./sitting/keep.ts";
import { TRAIL } from "./sitting/sitting.ts";
import { runKeptBefore } from "./testkit.ts";
import {
  counts,
  lanes,
  offered,
  oldRunWay,
  onTrail,
  payKey,
  readWay,
  slotOf,
  type Way,
  wayLogged,
  wayOfLogged,
  wayOn,
  wayWords,
} from "./way.ts";
import { readNotes } from "./wire.ts";

const ROSTER = { crab7: 2, greg: 0 };
const TRAIL_FAIR = onTrail(1);
const TRAIL_OWN = onTrail(2, ROSTER);
const WILDS = wayOn({ id: "wilds" });
const DEEP = wayOn({ id: "deep" });
const WILDS_OWN = wayOn({ id: "wilds" }, ROSTER);
const DEEP_OWN = wayOn({ id: "deep" }, ROSTER);
/** Every way that can be written: three courses, two pools. */
const EVERY = [TRAIL_FAIR, TRAIL_OWN, WILDS, DEEP, WILDS_OWN, DEEP_OWN];
/** A way's lanes at room 5 (4 from 0) and room 17 (16), and its depths. */
const laneSlots = (way: Way): (string | null)[] => {
  const l = lanes(way);
  return [l.board(4), l.held(16), l.depth("ever"), l.depth("week")];
};

describe("everything keyed from a way, pinned as it is stored and sent", () => {
  test("the slot a table keeps it in", () => {
    expect(EVERY.map(slotOf)).toEqual(["main", "main", "endless", "endless", "endless", "endless"]);
  });
  test("its lanes: boards by trail and room, depths and holders by course, each pool's apart", () => {
    expect(EVERY.map(laneSlots)).toEqual([
      ["board:1:4", null, null, null],
      ["own:2:4", null, null, null],
      [null, null, "depth:wilds:ever", "depth:wilds:week"],
      [null, "deep:16", "depth:deep:ever", "depth:deep:week"],
      [null, null, "depth:own.wilds:ever", "depth:own.wilds:week"],
      [null, "deep.own:16", "depth:own.deep:ever", "depth:own.deep:week"],
    ]);
    for (const way of EVERY) for (const slot of laneSlots(way)) if (slot !== null) expect(SLOT.test(slot)).toBe(true);
  });
  test("a holder's slot names its room in its own lane only", () => {
    expect(lanes(DEEP).heldRoom("deep:21")).toBe(21);
    expect(lanes(DEEP_OWN).heldRoom("deep.own:21")).toBe(21);
    for (const slot of ["deep.own:21", "deep:x", "deep:", "board:0:3", "depth:deep:ever", "deep:12345"])
      expect(lanes(DEEP).heldRoom(slot)).toBeNull();
    expect(lanes(DEEP_OWN).heldRoom("deep:21")).toBeNull();
    expect(lanes(WILDS).heldRoom("deep:21")).toBeNull();
  });
  test("the key its Coins are paid under", () => {
    expect(payKey({ at: "table", slot: "main" }, 3)).toBe("run:3");
    expect(payKey({ at: "table", slot: "endless" }, 4)).toBe("endless:4");
    expect(payKey({ at: "sitting", id: "s-1" }, 2)).toBe("sitting:s-1:seat:2");
  });
  test("what it is written into", () => {
    // almanac, tally, deepest, levels met
    expect(EVERY.map((way) => Object.values(counts(way)))).toEqual([
      [true, true, false, false],
      [false, false, false, true],
      [false, true, true, false],
      [false, true, true, false],
      [false, false, true, true],
      [false, false, true, true],
    ]);
  });
  test("what the page calls it", () => {
    expect(EVERY.map(wayWords)).toEqual([
      { name: TRAILS[1]?.name ?? "", figures: "All figures" },
      { name: TRAILS[2]?.name ?? "", figures: "Your figures" },
      { name: "The Wilds", figures: "All figures" },
      { name: "The Deep Woods", figures: "All figures" },
      { name: "The Wilds", figures: "Your figures" },
      { name: "The Deep Woods", figures: "Your figures" },
    ]);
  });
  test("what a log line says of it, read back as it says it now and as it once did", () => {
    expect(EVERY.map(wayLogged)).toEqual([
      { course: "trail", trail: 1, pool: "fair" },
      { course: "trail", trail: 2, pool: "own" },
      { course: "wilds", trail: 0, pool: "fair" },
      { course: "deep", trail: 0, pool: "fair" },
      { course: "wilds", trail: 0, pool: "own" },
      { course: "deep", trail: 0, pool: "own" },
    ]);
    for (const way of EVERY) expect(wayOfLogged({ ...wayLogged(way) })).toEqual(wayLogged(way));
    expect(wayOfLogged({ way: "own", trail: 2 })).toEqual({ course: "trail", trail: 2, pool: "own" });
    expect(wayOfLogged({ way: "deep", trail: 0 })).toEqual({ course: "deep", trail: 0, pool: "fair" });
    expect(wayOfLogged({ trail: 1 })).toEqual({ course: "trail", trail: 1, pool: "fair" });
    expect(wayOfLogged({ endless: "wilds", trail: 0 })).toEqual({ course: "wilds", trail: 0, pool: "fair" });
    // A room's line never said its trail.
    expect(wayOfLogged({ own: true, room: 3 })).toEqual({ course: "trail", trail: null, pool: "own" });
    expect(wayOfLogged({ course: "versus", pool: "fair" })).toBeNull();
  });
  test("a way is kept as itself, and a run kept before it kept one reads its way from its three fields", () => {
    for (const way of EVERY) expect(readWay(JSON.parse(JSON.stringify(way)))).toEqual(way);
    expect(readWay({ course: { id: "trail", trail: 1.5 }, figures: { pool: "fair" } })).toBeNull();
    expect(readWay({ course: { id: "wilds" }, figures: { pool: "own" } })).toBeNull();
    expect(oldRunWay(1, null, null)).toEqual(TRAIL_FAIR);
    expect(oldRunWay(2, ROSTER, undefined)).toEqual(TRAIL_OWN);
    expect(oldRunWay(0, undefined, "deep")).toEqual(DEEP);
    expect(oldRunWay(0, ROSTER, "deep")).toBeNull();
    expect(oldRunWay(0, null, "sideways")).toBeNull();
  });
});

describe("whose figures each course offers", () => {
  test("every course offers everyone's figures and the member's own", () => {
    expect(EVERY.map(offered)).toEqual([true, true, true, true, true, true]);
  });
  test("setting out with the member's own figures is a command on every course", () => {
    expect(readCommand({ do: "start", course: "wilds", own: true })).toEqual({
      do: "start",
      course: "wilds",
      own: true,
    });
    expect(readCommand({ do: "start", course: "deep", own: true })).toEqual({ do: "start", course: "deep", own: true });
    expect(readCommand({ do: "start", course: "deep" })).toEqual({ do: "start", course: "deep" });
    expect(readCommand({ do: "start", trail: 2, own: true })).toEqual({ do: "start", trail: 2, own: true });
  });
});

// ---------- old rows ----------

const rows = (shape: string): [string, string][] =>
  readdirSync(STORED)
    .filter((name) => name.startsWith(`${shape}-v`))
    .map((name): [string, string] => [name, readFileSync(new URL(name, STORED), "utf8")]);

describe("every stored row the goldens keep reads to the way it was", () => {
  test.each(rows("table"))("%s", (name, text) => {
    const table = RAID.decode(text);
    if (!table) throw new Error("does not read");
    const kept = /-(main|own|wilds|deep)\.json$/.exec(name)?.[1];
    const { main, endless } = table.held;
    if (kept === "main" || kept === "own") {
      expect(main?.way.course.id).toBe("trail");
      expect(main?.way.figures.pool).toBe(kept === "own" ? "own" : "fair");
    } else {
      expect(endless?.way).toEqual(wayOn({ id: kept === "wilds" ? "wilds" : "deep" }));
    }
    for (const run of [main, endless]) if (run) expect(slotOf(run.way)).toBe(run === main ? "main" : "endless");
  });
  test.each(rows("sitting"))("%s: every seat's run is on the sitting's trail, with everyone's figures", (_, text) => {
    const t = decodeSitting(text);
    for (const seat of t?.seats ?? []) expect(seat.run.way).toEqual(onTrail(TRAIL));
  });
});

// ---------- one run of each mode ----------

const NOW = Date.UTC(2026, 10, 28, 12);
const AWARDS = ["pull:figure:crab7", "pull:figure:greg", "copies:figure:crab7:3"];
const ctx = (seed: number): Ctx => ({
  now: NOW,
  player: { id: "00000000-0000-4000-8000-0000000a11ce", guest: false },
  seed,
  room: 1e9,
  awards: AWARDS,
  postcards: {},
});

/** The keys every line had before ways were logged, and what they said, worked out as the rules then did. */
function asBefore(way: Way, l: Logged): Readonly<Record<string, unknown>> {
  const { course, pool, tallied, ...rest } = l.data;
  const said: Record<string, unknown> = { ...rest };
  // A room's line said no trail; the other lines said theirs.
  if (l.kind === LOGGED.raidRoom) delete said.trail;
  expect([course, pool, tallied]).toEqual([wayLogged(way).course, wayLogged(way).pool, counts(way).tally]);
  return said;
}
/** What the Tally counted of a line before it read `tallied`: everything but what said `own: true`. */
const talliedBefore = (l: Logged): TallyStat[] =>
  l.kind === LOGGED.raidRoom
    ? l.data.own === true
      ? []
      : ["raid_rooms"]
    : l.kind === LOGGED.raidEnded && l.data.ended === "won" && l.data.own !== true
      ? ["raid_wins"]
      : [];

/** Sets out on a way and plays three rooms as the sensible bot plans them, then walks home: every line logged, every Coin paid. */
function playOne(start: RaidCommand, slot: "main" | "endless") {
  let t: Table = RAID.create(ctx(1));
  // Every trail open.
  t.almanac.bosses = [["bigcrab"], ["bigcrab"], []];
  const log: Logged[] = [];
  const notes: RaidNote[] = [];
  const coins: { key: string }[] = [];
  let n = 2;
  const send = (c: RaidCommand): boolean => {
    const done = RAID.apply(t, c, ctx(n++));
    if (isRefused(done)) return false;
    t = done.state;
    log.push(...(done.log ?? []));
    notes.push(...done.notes);
    coins.push(...(done.coins ?? []));
    return true;
  };
  if (!send(start)) throw new Error("did not set out");
  const aim = slot === "main" ? {} : { slot };
  for (let room = 0; room < 3; room++) {
    for (let ask = 0; ask < 8; ask++) {
      const planned = planCommands(RAID.view(t, ctx(0)), SENSIBLE, slot);
      if (planned.length === 0 || !planned.every(send)) break;
    }
    if (!send({ do: "fight", ...aim }) || !send({ do: "take", ...aim })) break;
  }
  send({ do: "abandon", ...aim });
  return { log, coins, notes };
}

/** Today's four modes at a table: how each sets out, its way, and its slot. */
const MODES: [string, RaidCommand, Way, "main" | "endless"][] = [
  ["a trail, everyone's figures", { do: "start", trail: 1 }, TRAIL_FAIR, "main"],
  [
    "a trail, the member's own figures",
    { do: "start", trail: 2, own: true },
    onTrail(2, { crab7: 2, greg: 0 }),
    "main",
  ],
  ["the Wilds", { do: "start", course: "wilds" }, WILDS, "endless"],
  ["the Deep Woods", { do: "start", course: "deep" }, DEEP, "endless"],
];

describe("a run of each of today's modes pays, records and logs as before", () => {
  test.each(MODES)("%s", (_, start, way, slot) => {
    const { log, coins } = playOne(start, slot);
    const before = (l: Logged) => asBefore(way, l);
    const old =
      way.course.id === "trail" ? (way.figures.pool === "own" ? { own: true } : {}) : { endless: way.course.id };
    const started = log.filter((l) => l.kind === LOGGED.raidStarted).map(before);
    expect(started).toEqual([{ trail: way.course.id === "trail" ? way.course.trail : 0, ...old }]);
    for (const room of log.filter((l) => l.kind === LOGGED.raidRoom).map(before))
      expect(Object.keys(room).toSorted()).toEqual(
        ["kind", "resolve", "room", "seconds", "won", ...Object.keys(old)].toSorted(),
      );
    const [ended] = log.filter((l) => l.kind === LOGGED.raidEnded).map(before);
    expect(Object.keys(ended ?? {}).toSorted()).toEqual(
      ["coins", "ended", "rooms_won", "trail", ...Object.keys(old)].toSorted(),
    );
    // Each fight's record says its way as the first records did, and the way beside it.
    const records = log.filter((l) => l.kind === LOGGED.raidFight).map((l) => l.data);
    expect(records.length).toBeGreaterThan(0);
    const first = way.course.id === "trail" ? (way.figures.pool === "own" ? "own" : "main") : way.course.id;
    for (const r of records)
      expect([r.way, r.course, r.trail, r.pool]).toEqual([first, ...Object.values(wayLogged(way))]);
    // The Tally counts what it counted, and the Coins are keyed as they were.
    expect(talliedFrom(log)).toEqual(log.flatMap(talliedBefore));
    expect(coins.map((c) => c.key)).toEqual(ended?.coins ? [slot === "main" ? "run:1" : "endless:1"] : []);
  });
});

describe("a command retried across a deploy is answered as the older Leaf answered it", () => {
  test.each(MODES)(
    "%s: the run its saved note ended, kept as an older Leaf kept it, reads to its way",
    (_, start, way, slot) => {
      const { notes } = playOne(start, slot);
      const ended = notes.find((n) => n.t === "ended");
      if (ended?.t !== "ended") throw new Error("no run ended");
      // Its run as an older Leaf said it: `trail`, `own` and `endless` in place of `way`.
      const saved = JSON.parse(JSON.stringify({ ...ended, run: runKeptBefore(ended.run) }));
      expect(saved.run.way).toBeUndefined();
      const [read] = readNotes([saved]) ?? [];
      expect(read?.t === "ended" ? read.run.way : null).toEqual(way);
      expect(readNotes([JSON.parse(JSON.stringify(ended))])).toEqual([ended]);
    },
  );
});

// ---------- built for the member's own figures in the endless courses ----------

/** A fight won, as a run keeps it. */
const WON: Parameters<typeof reached>[2] = {
  setup: {
    seed: 1,
    era: RAID.create(ctx(1)).era,
    sides: [
      { who: "You", title: "", figures: [], boons: [], might: 100 },
      { who: "", title: "", figures: [], boons: [], might: 100 },
    ],
  },
  outcome: { result: "win", ticks: 1, seconds: 1, standing: [1, 0], dusk: false, units: [] },
};
/** A table whose endless run on a way has won room 17 (16 from 0) of the Deep Woods' rooms, and is to take it. */
function wonIn(way: Way): Table {
  const table = must(RAID.create(ctx(1)), { do: "start", course: "deep" });
  const held = table.held.endless;
  if (!held) throw new Error("no run");
  held.way = way;
  held.room = 16;
  held.stage = { phase: "fight", fight: WON };
  return table;
}

describe("the member's own figures on an endless course, not offered yet, are kept apart", () => {
  // Room 18 (17 from 0) is a sparring room of the cycle, held in the Deep Woods.
  test("a room won in the Deep Woods is held, and written down, in the pool's own lanes and records", () => {
    const fair = { ever: { wilds: 0, deep: 0 }, week: { at: 0, deepest: { wilds: 0, deep: 0 } } };
    const own = structuredClone(fair);
    const slots = (way: Way, s: typeof fair) => reached(s, { room: 17, way }, WON, false).map((k) => k.slot);
    expect(slots(DEEP, fair)).toEqual(["deep:17", "depth:deep:ever", "depth:deep:week"]);
    expect(slots(DEEP_OWN, own)).toEqual(["deep.own:17", "depth:own.deep:ever", "depth:own.deep:week"]);
    expect([fair.ever.deep, own.ever.deep]).toEqual([18, 18]);
  });
  test("a run's take meets the holder of its own pool's lane", () => {
    expect(meets(wonIn(DEEP), { do: "take", slot: "endless" })?.slot).toBe("deep:17");
    expect(meets(wonIn(DEEP_OWN), { do: "take", slot: "endless" })?.slot).toBe("deep.own:17");
  });
});

function must(t: Table, c: RaidCommand): Table {
  const done = RAID.apply(t, c, ctx(9));
  if (isRefused(done)) throw new Error(done.refused);
  return done.state;
}
