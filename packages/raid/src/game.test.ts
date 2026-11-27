import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import {
  type CoinChange,
  type Ctx,
  type Done,
  type Logged,
  type Met,
  mix,
  type Refused,
  SLOT,
} from "@sequoia-leaf/core";

import { SENSIBLE } from "./bot.ts";
import { legal, type Predicted, type RaidCommand } from "./command.ts";
import { catalogAt } from "./content/catalog.ts";
import { figureIn } from "./content/figures.ts";
import { EMBLEM_IDS, grantOf } from "./content/items.ts";
import { newLooks } from "./content/looks.ts";
import { eraAt, LEGACY_ERA } from "./content/releases.ts";
import { LEVELS, MAX_LEVEL, regularOf, ROOMS } from "./content/rooms.ts";
import { resolveFight } from "./fight/engine.ts";
import { MET_APART, opposition } from "./foe.ts";
import { readFight } from "./fought.ts";
import {
  decodeTable,
  encodeTable,
  planCommands,
  predict,
  RAID,
  type RaidNote,
  readCommand,
  refusalText,
  runView,
  type Table,
  TABLE_VERSION,
  tableView,
} from "./game.ts";
import { beatenBosses, payout, recordRun, trailCleared, trailOpen } from "./outside.ts";
import { rosterOf } from "./own.ts";
import { isParty, type Party, traitSteps } from "./party.ts";
import {
  fieldCap,
  foughtOf,
  picksOf,
  pieces,
  playsAsKept,
  type RunSummary,
  spotOf,
  summariseRun,
  takenTo,
} from "./run.ts";
import { sparParty } from "./spar.ts";
import { RAID_STATS } from "./stats.ts";
import { CAT, EVERYONES, tableKeptAs } from "./testkit.ts";
import { onTrail, wayOn } from "./way.ts";
import { readNotes, readView } from "./wire.ts";

const PLAYER = { id: "10000000-0000-0000-0000-000000000001", guest: false };
let rolls = 0;
/** Leaf's word on each call: its clock, the player, and fresh dice (counted, so a test can repeat them). */
const ctx = (seed = (rolls += 0x9e3779b1) >>> 0): Ctx => ({
  now: 1_800_000_000_000,
  player: PLAYER,
  seed,
  room: 1e9,
  awards: [],
  postcards: {},
});

type Answer = Done<Table, RaidNote> | Refused;
/** The pick up at a table, and the fight being fought there. */
const pick = (state: Table) => (state.held.main ? picksOf(state.held.main)[0] : undefined);
const fought = (state: Table) => (state.held.main ? foughtOf(state.held.main) : null);
const isDone = (a: Answer): a is Done<Table, RaidNote> => !("refused" in a);

/** Does a command that must be done, and gives back what it did. */
function must(state: Table, command: RaidCommand, at: Ctx = ctx()): Done<Table, RaidNote> {
  const done = RAID.apply(state, command, at);
  if (!isDone(done)) throw new Error(`${command.do} was refused: ${done.refused}`);
  return done;
}
/** A table with a run laid out and its first figure picked. */
function started(seed = 7, trail = 0): Table {
  let state = RAID.create(ctx(seed));
  state = must(state, { do: "start", trail }).state;
  return must(state, { do: "choose", option: 0 }).state;
}
/** Plans the room that is up as the bot would, through commands, until there is nothing left to plan. */
function planned(state: Table): Table {
  let s = state;
  for (let guard = 0; guard < 40; guard++) {
    const commands = planCommands(RAID.view(s, ctx()), SENSIBLE);
    if (commands.length === 0) return s;
    for (const c of commands) {
      const done = RAID.apply(s, c, ctx());
      if (isDone(done)) s = done.state;
    }
  }
  return s;
}

describe("a new player's table", () => {
  test("has nothing laid out, an empty almanac and the plain looks", () => {
    const state = RAID.create(ctx(1));
    expect(state.held.main).toBeNull();
    expect(state.begun.main).toBe(0);
    expect(state.looks).toEqual(newLooks());
    // It is of the era Leaf's clock is in, and so is the page's view of it.
    expect(state.era).toBe(eraAt(ctx().now));
    expect(RAID.view(state, ctx())).toEqual({
      era: state.era,
      begun: { main: 0, endless: 0 },
      held: { main: null, endless: null },
      // The week Leaf's clock is in, Monday 00:00 UTC, with nothing won in it, and the same kept apart for the member's own figures.
      week: { at: Date.UTC(2027, 0, 11), deepest: { wilds: 0, deep: 0 } },
      apart: { deepest: { wilds: 0, deep: 0 }, week: { at: Date.UTC(2027, 0, 11), deepest: { wilds: 0, deep: 0 } } },
      almanac: state.almanac,
      trail: 0,
      looks: state.looks,
      roster: {},
    });
  });
  test("has its own stream from Leaf's dice", () => {
    expect(RAID.create(ctx(1)).rng).not.toBe(RAID.create(ctx(2)).rng);
    expect(RAID.create(ctx(1))).toEqual(RAID.create(ctx(1)));
  });
  test("waits for the player however long they are away", () => {
    const state = started();
    expect(RAID.advance(state, { ...ctx(), now: ctx().now + 30 * 86_400_000 })).toEqual(state);
  });
});

describe("the view", () => {
  test("never holds a stream, nor the run's seed", () => {
    const state = planned(started());
    const view = RAID.view(state, ctx());
    expect(Object.keys(view)).not.toContain("rng");
    expect(view.held.main).not.toBeNull();
    expect(Object.keys(view.held.main ?? {})).not.toContain("rng");
    expect(Object.keys(view.held.main ?? {})).not.toContain("seed");
  });
  test("shows only the first of the picks waiting; what the rest will offer is not shown", () => {
    const state = started();
    const run = state.held.main;
    if (!run) throw new Error("no run");
    run.stage = {
      phase: "plan",
      picks: [
        { kind: "component", options: ["thorn", "bark", "plume"] },
        { kind: "component", options: ["glowcap", "chestnut", "thorn"] },
        { kind: "boon", options: ["windfall", "regular", "quickstudy"], redraws: 1 },
      ],
    };
    const shown = picksOf(RAID.view(state, ctx()).held.main ?? run);
    expect(shown).toEqual([
      { kind: "component", options: ["thorn", "bark", "plume"] },
      { kind: "component", options: [] },
      { kind: "boon", options: [], redraws: 1 },
    ]);
  });
});

describe("every command a player has", () => {
  test("setting out lays a run out on the trail picked, with the first pick waiting", () => {
    const done = must(RAID.create(ctx(3)), { do: "start", trail: 0 });
    expect(done.state.begun.main).toBe(1);
    expect(pick(done.state)?.kind).toBe("starter");
    expect(done.notes).toEqual([{ t: "started", trail: 0, run: 1 }]);
    // The line as it always was, and beside it the way and whether the Tally counts it.
    expect(done.log).toEqual([
      { kind: "raid_started", data: { trail: 0, course: "trail", pool: "fair", tallied: true } },
    ]);
    expect(done.coins).toEqual([]);
  });
  test("picking, buying, selling, moving, benching, holding, rustling and experience", () => {
    let state = started(11);
    const run = (): NonNullable<Table["held"]["main"]> => {
      if (!state.held.main) throw new Error("no run");
      return state.held.main;
    };
    expect(pieces(run()).length).toBe(1);
    const offer = run().stall.findIndex((k) => k !== null);
    let done = must(state, { do: "buy", offer });
    expect(done.notes[0]).toMatchObject({ t: "bought", offer, to: { on: "bench", at: 0 } });
    state = done.state;
    // One may be fielded at level 1: the one bought changes places with the first.
    expect(RAID.apply(state, { do: "move", from: { on: "bench", at: 0 }, to: { on: "board", at: 2 } }, ctx())).toEqual({
      refused: "field_full",
    });
    done = must(state, { do: "move", from: { on: "bench", at: 0 }, to: { on: "board", at: 3 } });
    expect(done.notes[0]).toMatchObject({ t: "moved", from: { on: "bench", at: 0 }, to: { on: "board", at: 3 } });
    expect(
      RAID.apply(done.state, { do: "move", from: { on: "bench", at: 1 }, to: { on: "board", at: 1 } }, ctx()),
    ).toEqual({
      refused: "nobody_there",
    });
    state = done.state;
    done = must(state, { do: "bench", seat: 3 });
    expect(done.state.held.main?.board[3]).toBeNull();
    expect(done.state.held.main?.bench[1]).not.toBeNull();
    state = done.state;
    done = must(state, { do: "sell", from: { on: "bench", at: 1 } });
    expect(done.notes[0]).toMatchObject({ t: "sold" });
    state = done.state;
    done = must(state, { do: "hold", on: true });
    expect(done.state.held.main?.held).toBe(true);
    state = must(done.state, { do: "hold", on: false }).state;
    const before = state.held.main?.stall;
    done = must(state, { do: "rustle" });
    expect(done.notes[0]).toMatchObject({ t: "rustled", cost: 0 });
    expect(done.state.held.main?.stall).not.toEqual(before);
    state = done.state;
    if (state.held.main) state.held.main.acorns = 10;
    done = must(state, { do: "xp" });
    expect(done.notes[0]).toEqual({ t: "xp", gained: 4, cost: 4 });
  });
  test("a fight is decided when the party sets out, and its note carries both boards, the seed and the outcome", () => {
    const state = planned(started(5));
    const done = must(state, { do: "fight" });
    const note = done.notes[0];
    if (note?.t !== "fight") throw new Error("no fight note");
    expect(note.setup.sides[0].figures.length).toBeGreaterThan(0);
    expect(note.setup.sides[1]).toEqual(state.held.main?.foe ?? note.setup.sides[0]);
    expect(note.outcome).toEqual(resolveFight(note.setup));
    expect(fought(done.state)).toEqual({ setup: note.setup, outcome: note.outcome });
    // The boards are locked.
    expect(RAID.apply(done.state, { do: "buy", offer: 0 }, ctx())).toEqual({ refused: "fighting" });
    expect(RAID.apply(done.state, { do: "fight" }, ctx())).toEqual({ refused: "fighting" });
  });
  test("the takings are paid from the outcome Leaf kept, not from anything else", () => {
    const fighting = must(planned(started(5)), { do: "fight" }).state;
    const kept = fought(fighting)?.outcome.result;
    const taken = must(fighting, { do: "take" });
    expect(taken.notes[0]).toMatchObject({ t: "result", result: kept });
    // Had Leaf kept another outcome, that is what would be paid.
    const other = structuredClone(fighting);
    const fight = fought(other);
    if (!fight) throw new Error("no fight");
    fight.outcome.result = kept === "win" ? "loss" : "win";
    expect(must(other, { do: "take" }).notes[0]).toMatchObject({ t: "result", result: fight.outcome.result });
  });
  test("the outcome Leaf kept is kept across a restart: a table stored in a fight reads back with it, not one worked out again", () => {
    const fighting = must(planned(started(5)), { do: "fight" }).state;
    const run = fighting.held.main;
    const fight = fought(fighting);
    if (!run || !fight) throw new Error("no fight");
    // An outcome the rules loaded now would not give from that setup, as after a balance change.
    const kept = { ...fight.outcome, result: fight.outcome.result === "win" ? "loss" : "win", ticks: 4321 } as const;
    const stored = RAID.encode({
      ...fighting,
      held: { ...fighting.held, main: { ...run, stage: { phase: "fight", fight: { ...fight, outcome: kept } } } },
    });
    const read = RAID.decode(stored);
    expect(read && fought(read)?.outcome).toEqual(kept);
    if (!read) throw new Error("does not read");
    expect(must(read, { do: "take" }).notes[0]).toMatchObject({ t: "result", result: kept.result });
  });
  test("a room taken is logged: which, what kind, won or not, resolve left, how long the fight took", () => {
    const fighting = must(planned(started(5)), { do: "fight" }).state;
    const seconds = fought(fighting)?.outcome.seconds ?? -1;
    const won = fought(fighting)?.outcome.result === "win";
    const taken = must(fighting, { do: "take" });
    expect(taken.log).toEqual([
      {
        kind: "raid_room",
        data: {
          room: 1,
          kind: "trouble",
          won,
          resolve: taken.state.held.main?.resolve ?? 0,
          seconds: Math.round(seconds * 10) / 10,
          course: "trail",
          trail: 0,
          pool: "fair",
          tallied: true,
        },
      },
    ]);
  });
  test("handing over an item, and picking a component and a boon, with one redraw", () => {
    let state = planned(started(5));
    state = must(state, { do: "fight" }).state;
    state = must(state, { do: "take" }).state;
    // The first room is trouble: a component pick follows it.
    expect(pick(state)?.kind).toBe("component");
    let done = must(state, { do: "choose", option: 0 });
    expect(done.notes[0]).toMatchObject({ t: "component" });
    state = done.state;
    const seat = state.held.main?.board.findIndex((p) => p !== null) ?? -1;
    done = must(state, { do: "give", item: 0, to: { on: "board", at: seat } });
    expect(done.notes[0]).toMatchObject({ t: "gave", forged: null });
    state = done.state;
    // Play on to the boon after the second room.
    for (let guard = 0; guard < 6 && pick(state)?.kind !== "boon"; guard++) {
      state = planned(state);
      state = must(state, { do: "fight" }).state;
      state = must(state, { do: "take" }).state;
      if (pick(state)?.kind === "component") state = must(state, { do: "choose", option: 0 }).state;
    }
    expect(pick(state)?.kind).toBe("boon");
    const offered = pick(state)?.options;
    done = must(state, { do: "redraw" });
    expect(done.notes[0]).toMatchObject({ t: "redrawn" });
    expect(pick(done.state)?.options).not.toEqual(offered);
    expect(RAID.apply(done.state, { do: "redraw" }, ctx())).toEqual({ refused: "redrawn" });
    expect(must(done.state, { do: "choose", option: 0 }).notes[0]).toMatchObject({ t: "boon" });
  });
  test("walking home ends the run, pays for the rooms won under the run's number, and writes the almanac", () => {
    let state = planned(started(5));
    state = must(state, { do: "fight" }).state;
    state = must(state, { do: "take" }).state;
    const run = state.held.main;
    if (!run) throw new Error("no run");
    const paid = payout(summariseRun({ ...structuredClone(run), stage: { phase: "over", ending: "left" } })).coins;
    const done = must(state, { do: "abandon" });
    expect(done.state.held.main).toBeNull();
    expect(done.state.almanac.runs).toBe(1);
    expect(done.notes.map((n) => n.t)).toEqual(["over", "ended"]);
    expect(done.coins).toEqual(paid > 0 ? [{ amount: paid, reason: "The Little Raid", key: "run:1" }] : []);
    expect(done.log?.[0]).toMatchObject({ kind: "raid_ended", data: { trail: 0, ended: "left", coins: paid } });
    expect(RAID.apply(done.state, { do: "abandon" }, ctx())).toEqual({ refused: "no_run" });
  });
  test("a run worth more than the player may still earn is paid what is left, and says the purse is full", () => {
    let state = planned(started(5));
    state = must(state, { do: "fight" }).state;
    state = must(state, { do: "take" }).state;
    const run = state.held.main;
    if (!run) throw new Error("no run");
    const worth = payout(summariseRun({ ...structuredClone(run), stage: { phase: "over", ending: "left" } }));
    expect(worth.coins).toBeGreaterThan(3);
    const done = must(state, { do: "abandon" }, { ...ctx(), room: 3 });
    const paid = { coins: 3, lines: [...worth.lines, { why: "full", coins: 0 }] };
    expect(done.notes.find((n) => n.t === "ended")).toMatchObject({ paid });
    expect(readNotes(structuredClone(done.notes))?.find((n) => n.t === "ended")).toMatchObject({ paid });
    expect(done.coins).toEqual([{ amount: 3, reason: "The Little Raid", key: "run:1" }]);
    expect(done.log?.[0]).toMatchObject({ kind: "raid_ended", data: { coins: 3 } });
    // With no room at all nothing is paid, and the run ends all the same.
    const none = must(state, { do: "abandon" }, { ...ctx(), room: 0 });
    expect(none.coins).toEqual([]);
    expect(none.state.held.main).toBeNull();
  });
  test("setting out afresh puts down the run laid out, as walking home does", () => {
    let state = planned(started(5));
    state = must(state, { do: "fight" }).state;
    state = must(state, { do: "take" }).state;
    const done = must(state, { do: "start", trail: 0 });
    expect(done.state.begun.main).toBe(2);
    expect(done.notes.map((n) => n.t)).toEqual(["over", "ended", "started"]);
    expect(done.log?.map((l) => l.kind)).toEqual(["raid_ended", "raid_started"]);
    expect(done.coins?.every((c) => c.key === "run:1")).toBe(true);
  });
  test("the front page: a trail is picked only once open, and only owned looks go on the table", () => {
    const state = RAID.create(ctx(1));
    expect(RAID.apply(state, { do: "trail", trail: 1 }, ctx())).toEqual({ refused: "trail_closed" });
    expect(RAID.apply(state, { do: "start", trail: 2 }, ctx())).toEqual({ refused: "trail_closed" });
    expect(must(state, { do: "trail", trail: 0 }).notes).toEqual([{ t: "trail", trail: 0 }]);
    expect(RAID.apply(state, { do: "look", kind: "cloth", look: "baize" }, ctx())).toEqual({ refused: "not_owned" });
    expect(RAID.apply(state, { do: "look", kind: "cloth", look: "jar" }, ctx())).toEqual({ refused: "no_such_look" });
    const owner = structuredClone(state);
    owner.looks.owned = ["baize"];
    const worn = must(owner, { do: "look", kind: "cloth", look: "baize" });
    expect(worn.state.looks.cloth).toBe("baize");
    expect(worn.notes).toEqual([{ t: "look", kind: "cloth", id: "baize" }]);
    // A look bought is owned, on the table, and takes its price in Leaf; once owned it is not sold again.
    // (Dice of their own, so that the draws of the tests after are as they were.)
    expect(RAID.apply(state, { do: "buyLook", kind: "cloth", look: "bare" }, ctx(1))).toEqual({ refused: "owned" });
    expect(RAID.apply(state, { do: "buyLook", kind: "cloth", look: "jar" }, ctx(1))).toEqual({
      refused: "no_such_look",
    });
    const bought = must(state, { do: "buyLook", kind: "lantern", look: "jar" }, ctx(1));
    expect(bought.state.looks).toEqual({ ...newLooks(), lantern: "jar", owned: ["jar"] });
    expect(bought.notes).toEqual([{ t: "look", kind: "lantern", id: "jar" }]);
    expect(bought.leaf).toEqual([
      { amount: 28_000, reason: "Raid table look: Jar of fireflies", key: "look:jar", for: "everyone" },
    ]);
    expect(state.looks.owned).toEqual([]);
    expect(RAID.apply(bought.state, { do: "buyLook", kind: "lantern", look: "jar" }, ctx(1))).toEqual({
      refused: "owned",
    });
    expect(refusalText("not_enough_leaf")).toBe("Not enough Leaf.");
    // Once the first trail is cleared, the second may be picked.
    const cleared = structuredClone(state);
    cleared.almanac.bosses[0] = ["bigcrab"];
    expect(must(cleared, { do: "trail", trail: 1 }).state.trail).toBe(1);
  });
  test("a refused command says why and changes nothing", () => {
    const state = started(9);
    const copy = structuredClone(state);
    expect(RAID.apply(state, { do: "buy", offer: 14 }, ctx())).toEqual({ refused: "stall_empty" });
    expect(RAID.apply(state, { do: "take" }, ctx())).toEqual({ refused: "no_fight" });
    expect(RAID.apply(RAID.create(ctx(1)), { do: "rustle" }, ctx())).toEqual({ refused: "no_run" });
    expect(state).toEqual(copy);
    expect(refusalText("stall_empty")).toBe("That place on the stall is empty.");
    expect(refusalText("no_run")).toBe("There is no raid laid out.");
    expect(refusalText("field_full", RAID.view(state, ctx()))).toBe("You can field 1 figure for now.");
  });
});

describe("Leaf's dice", () => {
  test("decide what a command draws: the same dice draw the same, other dice draw otherwise", () => {
    const state = started(21);
    const a = must(state, { do: "rustle" }, ctx(1000)).state.held.main?.stall;
    const b = must(state, { do: "rustle" }, ctx(1000)).state.held.main?.stall;
    const others = [2000, 3000, 4000, 5000].map(
      (seed) => must(state, { do: "rustle" }, ctx(seed)).state.held.main?.stall,
    );
    expect(a).toEqual(b);
    expect(others.some((stall) => JSON.stringify(stall) !== JSON.stringify(a))).toBe(true);
  });
  test("decide each fight's seed, so a fight cannot be known before the party sets out", () => {
    const state = planned(started(21));
    const seeds = new Set(
      [1, 2, 3, 4].map((seed) => fought(must(state, { do: "fight" }, ctx(seed)).state)?.setup.seed),
    );
    expect(seeds.size).toBe(4);
  });
});

describe("a whole run, played by commands", () => {
  test("from a new table to its end, paying its Coins once, keyed by the run, and logging what happened", () => {
    let state = RAID.create(ctx(42));
    state = must(state, { do: "start", trail: 0 }).state;
    const coins: CoinChange[] = [];
    const log: Logged[] = [];
    const take = (done: Done<Table, RaidNote>) => {
      coins.push(...(done.coins ?? []));
      log.push(...(done.log ?? []));
      state = done.state;
    };
    let ended: RaidNote | undefined;
    for (let guard = 0; guard < 40 && state.held.main; guard++) {
      state = planned(state);
      take(must(state, { do: "fight" }));
      const taken = must(state, { do: "take" });
      ended = taken.notes.find((n) => n.t === "ended");
      take(taken);
    }
    expect(state.held.main).toBeNull();
    if (ended?.t !== "ended") throw new Error("the run did not end");
    const paid = payout(ended.summary).coins;
    expect(paid).toBeGreaterThan(0);
    expect(coins).toEqual([{ amount: paid, reason: "The Little Raid", key: "run:1" }]);
    const rooms = log.filter((l) => l.kind === "raid_room");
    expect(rooms.length).toBe(ended.run.record.length);
    expect(log.at(-1)).toEqual({
      kind: "raid_ended",
      data: {
        trail: 0,
        rooms_won: ended.summary.cleared,
        ended: ended.summary.ending ?? "",
        coins: paid,
        course: "trail",
        pool: "fair",
        tallied: true,
      },
    });
    expect(state.almanac.runs).toBe(1);
    expect(state.almanac.best[0]).toBe(ended.summary.reached);
    // Where the table stands, for the player's card: the bosses beaten, the runs done, the furthest room.
    expect(RAID.standing?.(RAID.create(ctx(42)))).toEqual({ score: 0, also: { runs: 0, room: 0 }, counts: [] });
    expect(RAID.standing?.(state)).toEqual({
      score: beatenBosses(state.almanac).size,
      also: { runs: 1, room: ended.summary.reached },
      counts: [...beatenBosses(state.almanac)].map((boss) => `trophy-${boss}`),
    });
  });
});

describe("keeping a table", () => {
  test("it is stored as text and read back the same, at any point of a run", () => {
    let state = RAID.create(ctx(4));
    expect(RAID.decode(RAID.encode(state))).toEqual(state);
    state = planned(must(state, { do: "start", trail: 0 }).state);
    expect(RAID.decode(RAID.encode(state))).toEqual(state);
    state = must(state, { do: "fight" }).state;
    expect(RAID.decode(RAID.encode(state))).toEqual(state);
    expect(encodeTable(decodeTable(encodeTable(state)) ?? RAID.create(ctx(1)))).toBe(encodeTable(state));
  });
  test("nonsense is no table", () => {
    const good = JSON.parse(RAID.encode(started())) as unknown;
    const changed = (change: (raw: Record<string, unknown>) => void): string => {
      const raw = structuredClone(good);
      if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new Error("not a table");
      const record: Record<string, unknown> = Object.fromEntries(Object.entries(raw));
      change(record);
      return JSON.stringify(record);
    };
    for (const text of [
      "",
      "nope",
      "{}",
      "[]",
      "null",
      changed((r) => (r.v = TABLE_VERSION + 1)),
      changed((r) => (r.game = "x")),
    ]) {
      expect(RAID.decode(text)).toBeNull();
    }
    expect(RAID.decode(changed((r) => (r.rng = -1)))).toBeNull();
    expect(
      RAID.decode(changed((r) => (r.looks = { cloth: "disco", lantern: "iron", bases: "plain", owned: [] }))),
    ).toBeNull();
    expect(RAID.decode(changed(() => undefined))).not.toBeNull();
    // What contradicts the rules now is put right, and a run that does not read is let go (`stored.test.ts`).
    expect(RAID.decode(changed((r) => (r.trail = 2)))?.trail).toBe(0);
    expect(RAID.decode(changed((r) => (r.begun = { main: 0, endless: 0 })))?.held.main).toBeNull();
    expect(RAID.decode(changed((r) => (r.held = { main: { phase: "plan" }, endless: null })))?.held.main).toBeNull();
    // A table of this version keeps both its counts and both its slots.
    expect(RAID.decode(changed((r) => (r.begun = { main: 1 })))).toBeNull();
    expect(RAID.decode(changed((r) => (r.held = null)))).toBeNull();
    expect(
      RAID.decode(changed((r) => (r.looks = { cloth: "plum", lantern: "iron", bases: "plain", owned: [] })))?.looks,
    ).toEqual(newLooks());
  });
  test("a table stored when a charm counted for its kin comes back with the charm's emblem on the item bench, once", () => {
    const state = planned(started(9));
    const run = state.held.main;
    if (!run) throw new Error("no run");
    const stored = tableKeptAs(RAID.encode(state), TABLE_VERSION - 1);
    // The charm among the boons, no emblem anywhere, and the foe with the old `charms`.
    const old = JSON.stringify({
      ...stored,
      run: { ...stored.run, boons: ["crabcharm"], foe: { ...run.foe, charms: [] } },
    });
    const once = RAID.decode(old);
    expect(once?.held.main?.items).toEqual([...run.items, "crabcharm"]);
    expect(once?.held.main?.foe).toMatchObject(run.foe);
    const twice = once ? RAID.decode(RAID.encode(once)) : null;
    expect(twice?.held.main?.items).toEqual([...run.items, "crabcharm"]);
  });
});

describe("commands off the wire", () => {
  test("are read with their fields checked, and anything else is no command", () => {
    expect(readCommand({ id: "c1", do: "buy", offer: 2 })).toEqual({ do: "buy", offer: 2 });
    expect(readCommand({ do: "move", from: { on: "bench", at: 0 }, to: { on: "board", at: 3 } })).toEqual({
      do: "move",
      from: { on: "bench", at: 0 },
      to: { on: "board", at: 3 },
    });
    expect(readCommand({ do: "hold", on: false })).toEqual({ do: "hold", on: false });
    expect(readCommand({ do: "fight", seed: 7 })).toEqual({ do: "fight" });
    expect(readCommand({ do: "start", trail: 1, own: true })).toEqual({ do: "start", trail: 1, own: true });
    expect(readCommand({ do: "start", trail: 1, own: "yes" })).toEqual({ do: "start", trail: 1 });
    // A command's id is its own: the look it names is `look`.
    expect(readCommand({ id: "c2", do: "buyLook", kind: "bases", look: "gilt" })).toEqual({
      do: "buyLook",
      kind: "bases",
      look: "gilt",
    });
    for (const bad of [
      null,
      "buy",
      [],
      {},
      { do: "cheat" },
      { do: "buy" },
      { do: "buy", offer: -1 },
      { do: "buy", offer: 1.5 },
      { do: "buy", offer: "1" },
      { do: "move", from: { on: "shelf", at: 0 }, to: { on: "board", at: 0 } },
      { do: "move", from: { on: "bench", at: 0 } },
      { do: "start", trail: 3 },
      { do: "hold" },
      { do: "look", kind: "hat", look: "bare" },
      { do: "buyLook", kind: "bases", id: "gilt" },
      { do: "give", item: 0 },
    ]) {
      expect(readCommand(bad)).toBeNull();
    }
  });
});

describe("what the page may show before Leaf answers", () => {
  test("moving, benching, selling, handing over, holding, buying and experience come out as Leaf does them", () => {
    let state = planned(started(5));
    state = must(state, { do: "fight" }).state;
    state = must(state, { do: "take" }).state;
    state = must(state, { do: "choose", option: 0 }).state;
    const seat = state.held.main?.board.findIndex((p) => p !== null) ?? -1;
    const offer = state.held.main?.stall.findIndex((k) => k !== null) ?? -1;
    const same = (c: RaidCommand): void => {
      const guessed = predict(RAID.view(state, ctx()), c);
      const done = must(state, c);
      expect(guessed).toEqual({ view: tableView(done.state, ctx()), notes: [...done.notes] });
      state = done.state;
    };
    same({ do: "give", item: 0, to: { on: "board", at: seat } });
    same({ do: "move", from: { on: "board", at: seat }, to: { on: "board", at: 20 } });
    same({ do: "hold", on: true });
    same({ do: "bench", seat: 20 });
    same({ do: "move", from: { on: "bench", at: 0 }, to: { on: "board", at: 4 } });
    // Whoever else the bot bought is sold, down to the last figure, which cannot be.
    for (let guard = 0; guard < 20; guard++) {
      const run = state.held.main;
      const other = run ? pieces(run).find((p) => p.id !== run.board[4]?.id) : undefined;
      const from = run && other ? spotOf(run, other.id) : null;
      if (!from) break;
      same({ do: "sell", from });
    }
    const sold = predict(RAID.view(state, ctx()), { do: "sell", from: { on: "board", at: 4 } });
    expect(sold).toEqual({ refused: "last_figure" });
    same({ do: "buy", offer });
    same({ do: "xp" });
    // The offer just bought has gone from the stall, as Leaf would say.
    expect(predict(RAID.view(state, ctx()), { do: "buy", offer })).toEqual({ refused: "stall_empty" });
    expect(predict(RAID.view(state, ctx()), { do: "rustle" })).toBeNull();
  });
});

describe("whether the rules would do a command", () => {
  test("is what doing it on a copy says, and the run is left as it was", () => {
    const run = planned(started(11)).held.main;
    if (!run) throw new Error("no run");
    const view = runView(run);
    const before = structuredClone(view);
    const commands: Predicted[] = [
      { do: "buy", offer: 0 },
      { do: "buy", offer: 9 },
      { do: "move", from: { on: "board", at: 3 }, to: { on: "bench", at: 8 } },
      { do: "sell", from: { on: "bench", at: 8 } },
      { do: "xp" },
      { do: "hold", on: true },
      { do: "give", item: 0, to: { on: "board", at: 3 } },
    ];
    for (const c of commands) {
      const blank = RAID.view(RAID.create(ctx(1)), ctx());
      const done = predict({ ...blank, held: { ...blank.held, main: structuredClone(view) } }, c);
      expect([c.do, legal(view, c)]).toEqual([c.do, done !== null && "view" in done]);
    }
    expect(view).toEqual(before);
  });
});

describe("an emblem handed to a figure of its kin already", () => {
  test("is refused on the page as Leaf refuses it, with the sentence the page shows", () => {
    const state = started(9);
    const run = state.held.main;
    const figure = run ? pieces(run)[0] : undefined;
    const spot = run && figure ? spotOf(run, figure.id) : null;
    if (!run || !figure || !spot) throw new Error("nobody to hand it to");
    const own = EMBLEM_IDS.find((id) => grantOf(CAT, id) === figureIn(CAT, figure.kind).kin);
    if (!own) throw new Error("no emblem of its kin");
    run.boons = [own];
    run.items = [own];
    const command: RaidCommand = { do: "give", item: 0, to: spot };
    expect(predict(RAID.view(state, ctx()), command)).toEqual({ refused: "already_kin" });
    expect(RAID.apply(state, command, ctx())).toEqual({ refused: "already_kin" });
    expect(refusalText("already_kin")).toBe("It is of that origin already.");
  });
});

/** Plain data as it comes off the wire. */
const wire = (v: unknown): unknown => JSON.parse(JSON.stringify(v));

describe("what Leaf sends the page", () => {
  test("every view and every note of a whole run reads back as it was", () => {
    let state = RAID.create(ctx(77));
    const check = (done: Done<Table, RaidNote>) => {
      expect(readNotes(wire(done.notes))).toEqual([...done.notes]);
      const view = RAID.view(done.state, ctx());
      expect(readView(wire(view))).toEqual(view);
      state = done.state;
    };
    check(must(state, { do: "start", trail: 0 }));
    for (let guard = 0; guard < 40 && state.held.main; guard++) {
      for (let again = 0; again < 40; again++) {
        const commands = planCommands(RAID.view(state, ctx()), SENSIBLE);
        if (commands.length === 0) break;
        for (const c of commands) {
          const done = RAID.apply(state, c, ctx());
          if (isDone(done)) check(done);
        }
      }
      check(must(state, { do: "fight" }));
      check(must(state, { do: "take" }));
    }
    expect(state.held.main).toBeNull();
  });
  test("a fight's outcome is read as Leaf sent it, in its note and in the view, never worked out again", () => {
    const done = must(planned(started(5)), { do: "fight" });
    const note = done.notes[0];
    if (note?.t !== "fight") throw new Error("no fight note");
    const other = { ...note.outcome, result: note.outcome.result === "win" ? "loss" : "win", ticks: 4321 } as const;
    expect(readNotes(wire([{ ...note, outcome: other }]))).toEqual([{ ...note, outcome: other }]);
    const view = RAID.view(done.state, ctx());
    const run = view.held.main;
    const fight = run && foughtOf(run);
    if (!run || !fight) throw new Error("no fight");
    const shown = {
      ...view,
      held: { ...view.held, main: { ...run, stage: { phase: "fight", fight: { ...fight, outcome: other } } } },
    };
    const read = readView(wire(shown))?.held.main;
    expect(read && foughtOf(read)?.outcome).toEqual(other);
    expect(readNotes(wire([{ ...note, outcome: { ...other, result: "maybe" } }]))).toBeNull();
  });
  test("the page's rules play a fight to the outcome Leaf kept, or say they do not, for the page to load again", () => {
    const fight = fought(must(planned(started(5)), { do: "fight" }).state);
    if (!fight) throw new Error("no fight");
    expect(playsAsKept(fight)).toBe(true);
    expect(playsAsKept({ ...fight, outcome: { ...fight.outcome, ticks: fight.outcome.ticks + 1 } })).toBe(false);
    const flipped = fight.outcome.result === "win" ? "loss" : "win";
    expect(playsAsKept({ ...fight, outcome: { ...fight.outcome, result: flipped } })).toBe(false);
  });
  test("anything else is not read", () => {
    const view = wire(RAID.view(started(), ctx()));
    expect(readView(view)).not.toBeNull();
    const held = { main: { phase: "plan" }, endless: null };
    // An endless run in the slot of the run in hand is no run this version could have sent.
    const misplaced = { main: Object(view).held.main && { ...Object(view).held.main, way: wayOn({ id: "wilds" }) } };
    for (const bad of [
      null,
      {},
      [],
      { ...Object(view), trail: 9 },
      { ...Object(view), held },
      { ...Object(view), held: { ...misplaced, endless: null } },
    ]) {
      expect(readView(bad)).toBeNull();
    }
    expect(readNotes([{ t: "bought", kind: "dragon", piece: 1, offer: 0, cost: 1, to: null }])).toBeNull();
    expect(readNotes([{ t: "teleported" }])).toBeNull();
    expect(readNotes("notes")).toBeNull();
    expect(readNotes([])).toEqual([]);
  });
});

// Last, so that the dice it rolls do not change how the tests above fall.
describe("a run that has fought no room", () => {
  test("setting out afresh, or walking home, before a room is fought is refused: no new opening for free", () => {
    for (const state of [RAID.create(ctx(5)), started(5)]) {
      // Laid out, and its starter picked or not: either way no room has been fought.
      const laid = state.held.main ? state : must(state, { do: "start", trail: 0 }).state;
      for (const command of [{ do: "start", trail: 0 }, { do: "abandon" }] as const) {
        expect(RAID.apply(laid, command, ctx())).toEqual({ refused: "unfought" });
      }
    }
    // Nor in the middle of the first fight, once it is decided.
    const fighting = must(planned(started(5)), { do: "fight" }).state;
    expect(RAID.apply(fighting, { do: "start", trail: 0 }, ctx())).toEqual({ refused: "unfought" });
    expect(RAID.apply(fighting, { do: "abandon" }, ctx())).toEqual({ refused: "unfought" });
    expect(RAID.apply(fighting, { do: "start", trail: 2 }, ctx())).toEqual({ refused: "trail_closed" });
    expect(refusalText("unfought")).toBe("The first room has not been fought yet.");
  });
});

describe("a table's numbers on its player's card", () => {
  test("are the bosses beaten, the runs and the furthest room", () => {
    expect(RAID_STATS.numbers({ place: 1, score: 3, also: { runs: 1200, room: 14 } })).toEqual([
      { label: "Bosses beaten", value: "3" },
      { label: "Runs", value: "1,200" },
      { label: "Furthest room", value: "14" },
    ]);
  });
});

/** A table as Leaf opens it for a player who holds these awards. */
const won = (state: Table, ...awards: string[]): Table => RAID.advance(state, { ...ctx(1), awards });

/** A raid begun, planned and fought with the same dice, at a table in the hall or in the clearing. */
const playedIn = (inHall: boolean) => {
  let state = RAID.create(ctx(7));
  if (inHall) state = { ...state, looks: { ...state.looks, place: "hall", owned: ["hall"] } };
  const notes: RaidNote[] = [];
  const act = (c: RaidCommand, seed: number): void => {
    const done = RAID.apply(state, c, ctx(seed));
    if (!isDone(done)) return;
    state = done.state;
    notes.push(...done.notes);
  };
  act({ do: "start", trail: 0 }, 1);
  act({ do: "choose", option: 0 }, 2);
  for (let step = 3; step < 12; step++) {
    for (const c of planCommands(RAID.view(state, ctx(step)), SENSIBLE)) act(c, step);
  }
  act({ do: "fight" }, 12);
  return { run: state.held.main, rng: state.rng, notes };
};

describe("the place the table stands", () => {
  const hall = { do: "buyLook", kind: "place", look: "hall" } as const;
  test("is bought with Leaf, chosen and kept like any look", () => {
    const state = RAID.create(ctx(1));
    expect(RAID.apply(state, { do: "look", kind: "place", look: "hall" }, ctx(1))).toEqual({ refused: "not_owned" });
    expect(RAID.apply(state, { do: "buyLook", kind: "place", look: "clearing" }, ctx(1))).toEqual({ refused: "owned" });
    const bought = must(state, hall, ctx(1));
    expect(bought.state.looks).toEqual({ ...newLooks(), place: "hall", owned: ["hall"] });
    expect(bought.notes).toEqual([{ t: "look", kind: "place", id: "hall" }]);
    expect(readNotes(wire(bought.notes))).toEqual([...bought.notes]);
    expect(bought.leaf).toEqual([
      { amount: 40_000, reason: "Raid table look: The guild hall", key: "look:hall", for: "everyone" },
    ]);
    expect(RAID.apply(bought.state, hall, ctx(1))).toEqual({ refused: "owned" });
    expect(RAID.decode(RAID.encode(bought.state))?.looks).toEqual(bought.state.looks);
    expect(readView(wire(RAID.view(bought.state, ctx(1))))?.looks.place).toBe("hall");
    const back = must(bought.state, { do: "look", kind: "place", look: "clearing" }, ctx(1));
    expect(back.state.looks).toEqual({ ...newLooks(), owned: ["hall"] });
    expect(back.leaf).toBeUndefined();
  });
  test("a table stored before there was a second place is in the clearing", () => {
    const stored: unknown = JSON.parse(RAID.encode(started()));
    if (typeof stored !== "object" || stored === null || !("looks" in stored)) throw new Error("not a table");
    stored.looks = { cloth: "bare", lantern: "iron", bases: "plain", owned: [] };
    expect(RAID.decode(JSON.stringify(stored))?.looks).toEqual(newLooks());
  });
  test("changes nothing of a run: the same dice play the same raid in the hall as in the clearing", () => {
    const there = playedIn(true);
    expect(there.run?.stage.phase).toBe("fight");
    expect(there).toEqual(playedIn(false));
  });
});

describe("a look won as a pull's prize", () => {
  test("is owned at the table, costs nothing, and may be put on", () => {
    const state = RAID.create(ctx(1));
    expect(won(state, "trophy-oldbramble", "pull:thing:rock", "pull:look:bare", "pull:look:nothing")).toBe(state);
    const owner = won(state, "pull:look:gilt", "pull:look:baize");
    expect(owner.looks).toEqual({ ...newLooks(), owned: ["gilt", "baize"] });
    expect(state.looks.owned).toEqual([]);
    expect(RAID.apply(owner, { do: "buyLook", kind: "bases", look: "gilt" }, ctx(1))).toEqual({ refused: "owned" });
    const worn = must(owner, { do: "look", kind: "bases", look: "gilt" }, ctx(1));
    expect(worn.state.looks.bases).toBe("gilt");
    expect(worn.leaf).toBeUndefined();
    expect(RAID.decode(RAID.encode(worn.state))?.looks).toEqual(worn.state.looks);
  });
  test("changes nothing when it was bought before", () => {
    const bought = must(RAID.create(ctx(1)), { do: "buyLook", kind: "lantern", look: "jar" }, ctx(1)).state;
    expect(won(bought, "pull:look:jar")).toBe(bought);
  });
});

describe("bosses beaten", () => {
  test("count each boss once, however many trails it was beaten on, with one trophy each and every trail still marked", () => {
    const state = RAID.create(ctx(1));
    // The same three bosses beaten on the first trail and then on the second.
    for (const trail of [0, 1]) {
      const run: RunSummary = {
        trail,
        ending: "won",
        cleared: 12,
        reached: 12,
        bosses: ["oldbramble", "hoardmagpie", "bigcrab"],
        fielded: [],
        threeStars: [],
        forged: [],
        topped: [],
      };
      state.almanac = recordRun(state.almanac, run).almanac;
    }
    expect(beatenBosses(state.almanac)).toEqual(new Set(["oldbramble", "hoardmagpie", "bigcrab"]));
    // The score counts the three trophies, reached as the last of them was first won.
    const trophies = ["trophy-oldbramble", "trophy-hoardmagpie", "trophy-bigcrab"];
    expect([RAID.standing?.(state)?.score, RAID.standing?.(state)?.counts]).toEqual([3, trophies]);
    expect(RAID.awards?.(state)).toEqual(trophies);
    expect([trailCleared(state.almanac, 0), trailCleared(state.almanac, 1), trailOpen(state.almanac, 2)]).toEqual([
      true,
      true,
      true,
    ]);
  });
});

describe("awards", () => {
  test("are a carved figure of each boss the almanac has beaten, on any trail, once", () => {
    const state = RAID.create(ctx(1));
    expect(RAID.awards?.(state)).toEqual([]);
    state.almanac.bosses[0] = ["oldbramble", "bigcrab"];
    state.almanac.bosses[1] = ["oldbramble"];
    expect(RAID.awards?.(state)).toEqual(["trophy-oldbramble", "trophy-bigcrab"]);
  });
});

/** Another member, whose board a table may meet. */
const MEMBER = "10000000-0000-0000-0000-000000000002";
/** A table taken on through its rooms as the bot plays them, each planned, fought and taken, until its run is in `room`. */
function reach(state: Table, room: number): Table {
  let s = state;
  for (let guard = 0; guard < 40 && s.held.main && s.held.main.room < room; guard++) {
    s = must(planned(s), { do: "fight" }).state;
    s = must(s, { do: "take" }).state;
  }
  if (s.held.main?.room !== room) throw new Error(`the run did not reach room ${room}`);
  return s;
}
/** A table fighting the room `room`, planned by the bot. */
const fighting = (room: number, seed = 5): Table => must(planned(reach(started(seed), room)), { do: "fight" }).state;
/** A member's board for room 2 as Leaf keeps it: what another table fought it with. */
function keptBoard(): Party {
  const data = must(planned(reach(started(11), 2)), { do: "fight" }).keep?.[0]?.data;
  if (!isParty(data)) throw new Error("no board was kept");
  return data;
}
/** A board another member left, as Leaf hands it to the command that meets it. */
const metOf = (data: unknown, of = 1000, more: Partial<Met> = {}): Met => ({
  player: MEMBER,
  name: "Fernwick",
  data,
  of,
  ...more,
});
/** Where a command meets another member's board, as Leaf asks the rules (undefined if it could not ask). */
const meets = (state: Table, c: RaidCommand) => RAID.meets?.(state, c);
/** A Greg of one star, at a seat. */
const greg = (seat: number) => ({ kind: "greg", stars: 1, seat, items: [], fed: 0 });
/** A table's run, which the test needs there. */
function runOf(state: Table) {
  if (!state.held.main) throw new Error("no run");
  return state.held.main;
}

describe("another member's board in a sparring room", () => {
  test("a fight there keeps the party it was decided from, exactly, at the trail and the room", () => {
    expect(ROOMS[2]?.kind).toBe("spar");
    const done = must(planned(reach(started(5), 2)), { do: "fight" });
    const side = fought(done.state)?.setup.sides[0];
    expect(side?.figures.length).toBeGreaterThan(0);
    expect(done.keep).toEqual([{ slot: "board:0:2", data: side }]);
    expect(SLOT.test("board:0:2")).toBe(true);
    // Its takings keep nothing more.
    expect(must(done.state, { do: "take" }).keep).toEqual([]);
  });
  test("a trouble room, a boss room, a guest and a refused command keep nothing", () => {
    const trouble = planned(started(5));
    expect(must(trouble, { do: "fight" }).keep).toEqual([]);
    const boss = structuredClone(trouble);
    runOf(boss).room = 4;
    expect(ROOMS[4]?.kind).toBe("boss");
    expect(must(boss, { do: "fight" }).keep).toEqual([]);
    const spar = planned(reach(started(5), 2));
    expect(must(spar, { do: "fight" }, { ...ctx(), player: { ...PLAYER, guest: true } }).keep).toEqual([]);
    const bare = structuredClone(spar);
    runOf(bare).board = runOf(bare).board.map(() => null);
    expect(RAID.apply(bare, { do: "fight" }, ctx())).toEqual({ refused: "board_empty" });
  });
  test("a take meets a board only where it moves the run on to a sparring room", () => {
    // Room 1 is trouble, after room 0; room 2 sparring, after room 1; room 4 a boss, after room 3.
    expect(meets(fighting(0), { do: "take" })).toBeNull();
    const into2 = fighting(1);
    expect(meets(into2, { do: "take" })).toEqual({ slot: "board:0:2", avoid: [] });
    expect(meets(fighting(2), { do: "take" })).toEqual({ slot: "board:0:3", avoid: [] });
    expect(meets(fighting(3), { do: "take" })).toBeNull();
    // Nothing else meets anything, nor a take with no fight to take, nor a table with no run.
    for (const c of [{ do: "fight" }, { do: "rustle" }, { do: "abandon" }] as const) expect(meets(into2, c)).toBeNull();
    expect(meets(planned(reach(started(5), 1)), { do: "take" })).toBeNull();
    expect(meets(RAID.create(ctx(1)), { do: "take" })).toBeNull();
    // A loss that ends the run moves it nowhere.
    const ending = structuredClone(into2);
    const fight = fought(ending);
    if (!fight) throw new Error("no fight");
    runOf(ending).resolve = 1;
    fight.outcome.result = "loss";
    expect(meets(ending, { do: "take" })).toBeNull();
    // The last room, lost, is fought again; won, the run is over.
    runOf(ending).resolve = 20;
    runOf(ending).room = ROOMS.length - 1;
    expect(takenTo(runOf(ending))).toBe(ROOMS.length - 1);
    fight.outcome.result = "win";
    expect(takenTo(runOf(ending))).toBeNull();
  });
  test("where a take moves the run on to is where the takings take it, room by room of a whole run", () => {
    let state = must(RAID.create(ctx(42)), { do: "start", trail: 0 }).state;
    for (let guard = 0; guard < 40 && state.held.main; guard++) {
      state = must(planned(state), { do: "fight" }).state;
      const to = takenTo(runOf(state));
      state = must(state, { do: "take" }).state;
      expect(state.held.main?.room ?? null).toBe(to);
    }
    expect(state.held.main).toBeNull();
  });
  test("met by 1,000 others, the foe is a member's board, signed with their name, and its fight plays from the kept figures", () => {
    const board = keptBoard();
    const taken = must(fighting(1), { do: "take" }, { ...ctx(), met: metOf(board) });
    const foe = runOf(taken.state).foe;
    expect(foe).toEqual({
      who: "Fernwick",
      by: MEMBER,
      title: "their board at this room",
      figures: board.figures,
      boons: board.boons,
      might: 100,
    });
    expect(regularOf(foe)).toBeNull();
    expect(taken.notes).toContainEqual({
      t: "room",
      room: 2,
      kind: "spar",
      who: "Fernwick",
      title: "their board at this room",
    });
    const fight = fought(must(planned(taken.state), { do: "fight" }).state);
    expect(fight?.setup.sides[1]).toEqual(foe);
    expect(fight && playsAsKept(fight)).toBe(true);
  });
  test("a room fought against a member's board is logged with whose it was, and one against a regular is not", () => {
    const met = must(fighting(1), { do: "take" }, { ...ctx(), met: metOf(keptBoard()) }).state;
    const against = must(must(planned(met), { do: "fight" }).state, { do: "take" });
    expect(against.log?.[0]).toMatchObject({ kind: "raid_room", data: { room: 3, kind: "spar", met: MEMBER } });
    const regular = must(fighting(2), { do: "take" });
    expect(regular.log?.[0]?.data).not.toHaveProperty("met");
  });
  test("a room fought against a member's board keeps whose it was, and the next sparring rooms meet somebody else", () => {
    // Room 2 is sparring against a member's board, and room 3 sparring after it.
    const met = must(fighting(1), { do: "take" }, { ...ctx(), met: metOf(keptBoard()) }).state;
    const against = must(planned(met), { do: "fight" }).state;
    // Leaf asks before the take that writes room 2 into the record: the member across now is left out already.
    expect(meets(against, { do: "take" })).toEqual({ slot: "board:0:3", avoid: [MEMBER] });
    const taken = must(against, { do: "take" }).state;
    expect(runOf(taken).record.at(-1)).toMatchObject({ room: 2, kind: "spar", met: MEMBER });
    // Of several met, only the last two are left out; a regular across now counts for nobody.
    const next = fighting(2);
    const sparred = runOf(taken).record.at(-1);
    if (!sparred) throw new Error("a room taken");
    const seen = ["m-1", "m-2", "m-3"].map((who, i) => Object.assign(structuredClone(sparred), { room: i, met: who }));
    runOf(next).record = seen;
    expect(meets(next, { do: "take" })?.avoid).toEqual(["m-2", "m-3"]);
    expect(MET_APART).toBe(2);
  });
  test("without a member's board, or with anything else, the foe is the regular's party it always was", () => {
    const into2 = fighting(1);
    const at = ctx();
    const plain = must(into2, { do: "take" }, at).state;
    expect(regularOf(runOf(plain).foe)).not.toBeNull();
    const board = keptBoard();
    const [first] = board.figures;
    if (!first) throw new Error("an empty board");
    const wrong: unknown[] = [
      null,
      "a board",
      { ...board, might: 5 },
      { ...board, figures: [] },
      { ...board, figures: Array.from({ length: 10 }, (_, seat) => greg(seat)) },
      { ...board, figures: [{ ...first, kind: "gnat" }] },
    ];
    for (const data of wrong) expect(must(into2, { do: "take" }, { ...at, met: metOf(data) }).state).toEqual(plain);
    // Nor signed with a name longer than a party may have.
    const long = metOf(board, 1000, { name: "x".repeat(81) });
    expect(must(into2, { do: "take" }, { ...at, met: long }).state).toEqual(plain);
    // Nine figures, as many as anybody can field, is a board.
    expect(
      fieldCap({
        room: 0,
        wing: null,
        level: MAX_LEVEL,
        boons: ["extrachair"],
        record: [],
        way: onTrail(0),
        era: CAT.era,
      }),
    ).toBe(9);
    const nine = { ...board, figures: Array.from({ length: 9 }, (_, seat) => greg(seat)) };
    expect(runOf(must(into2, { do: "take" }, { ...at, met: metOf(nine) }).state).foe.by).toBe(MEMBER);
  });
  test("the regular's party for a seed is the one it was before a member's board could be met", () => {
    for (const seed of [1, 77, 4242]) {
      for (const room of [2, 3, 5, 13]) {
        const before = sparParty(catalogAt(LEGACY_ERA), mix(seed, 700 + room), room, 1);
        expect(opposition(catalogAt(LEGACY_ERA), seed, room, 1)).toEqual(before);
        expect(opposition(catalogAt(LEGACY_ERA), seed, room, 1, metOf("not a board"))).toEqual(before);
      }
    }
  });
  test("the regular is one of the crowd: the board is a member's `of` times in `of + 1`", () => {
    const board = keptBoard();
    const share = (of: number): number => {
      const seeds = Array.from({ length: 600 }, (_, n) => n + 1);
      return (
        seeds.filter((seed) => opposition(catalogAt(LEGACY_ERA), seed, 2, 0, metOf(board, of)).by === MEMBER).length /
        seeds.length
      );
    };
    expect(Math.abs(share(1) - 1 / 2)).toBeLessThan(0.06);
    expect(Math.abs(share(3) - 3 / 4)).toBeLessThan(0.06);
    expect(share(1000)).toBeGreaterThan(0.99);
  });
  test("a table facing a member's board, and one that fought it, read back with whose it is", () => {
    const met = must(fighting(1), { do: "take" }, { ...ctx(), met: metOf(keptBoard()) }).state;
    expect(RAID.decode(RAID.encode(met))?.held.main?.foe.by).toBe(MEMBER);
    expect(readView(RAID.view(met, ctx()))?.held.main?.foe.by).toBe(MEMBER);
    const fightDone = must(planned(met), { do: "fight" });
    const note = readNotes(fightDone.notes)?.find((n) => n.t === "fight");
    expect(note?.t === "fight" && note.setup.sides[1].by).toBe(MEMBER);
    expect(RAID.decode(RAID.encode(fightDone.state))?.held.main && fought(fightDone.state)?.setup.sides[1].by).toBe(
      MEMBER,
    );
    const after = must(fightDone.state, { do: "take" }).state;
    expect(RAID.decode(RAID.encode(after))?.held.main?.last?.sides[1].by).toBe(MEMBER);
  });
  test("whose board it is reads as a Leaf id, and a party with one is never a regular's, whatever it is called", () => {
    const board = keptBoard();
    expect(isParty({ ...board, by: MEMBER })).toBe(true);
    expect(isParty({ ...board, by: "x".repeat(65) })).toBe(false);
    expect(isParty({ ...board, by: 7 })).toBe(false);
    expect(regularOf({ who: "Greg" })?.kind).toBe("greg");
    expect(regularOf({ who: "Greg", by: MEMBER })).toBeNull();
  });
});

/** Every figure pulled seven times over, as the pulls award it, with what else a member may have won. */
const EVERYTHING = [
  "trophy-oldbramble",
  "pull:look:gilt",
  "pull:thing:fountain",
  "pull:headliner:banner-1",
  ...EVERYONES.flatMap((id) => [`pull:figure:${id}`, ...[2, 3, 4, 5, 6, 7].map((n) => `copies:figure:${id}:${n}`)]),
];

/**
 * A table played by the bot for some rooms, or to its end, with the same dice every time: what it
 * came to, and everything its commands paid, logged and noted.
 */
function walked(awards: readonly string[], own: boolean, rooms = 99, from: Table | null = null) {
  rolls = 0;
  const at = (): Ctx => ({ ...ctx(), awards });
  const coins: CoinChange[] = [];
  const log: Logged[] = [];
  const notes: RaidNote[] = [];
  let state = from ?? RAID.create(at());
  const did = (c: RaidCommand): void => {
    const done = must(state, c, at());
    coins.push(...(done.coins ?? []));
    log.push(...(done.log ?? []));
    notes.push(...done.notes);
    expect(readNotes(wire(done.notes))).toEqual([...done.notes]);
    state = done.state;
  };
  did(own ? { do: "start", trail: 0, own } : { do: "start", trail: 0 });
  for (let room = 0; room < rooms && state.held.main; room++) {
    for (let again = 0; again < 40; again++) {
      const commands = planCommands(RAID.view(state, at()), SENSIBLE);
      if (commands.length === 0) break;
      for (const c of commands) if (isDone(RAID.apply(state, c, at()))) did(c);
    }
    did({ do: "fight" });
    did({ do: "take" });
  }
  return { state, coins, log, notes };
}

describe("the roster a member's awards come to", () => {
  test("is each figure pulled, with a level for every copy after the first, 6 at most", () => {
    expect(
      rosterOf([
        "pull:figure:greg",
        "copies:figure:greg:3",
        "copies:figure:greg:2",
        "pull:figure:worm",
        "copies:figure:slug:7",
        "copies:figure:moth:9",
        "copies:figure:nobody:2",
        "pull:figure:nobody",
        "pull:look:gilt",
        "copies:thing:rock:2",
        "trophy-oldbramble",
        "pull:figure:greg:2",
      ]),
    ).toEqual({ greg: 2, worm: 0, slug: 6, moth: 6 });
    expect(rosterOf(EVERYTHING)).toEqual({ ...Object.fromEntries(EVERYONES.map((id) => [id, 6])), "banner-1": 0 });
  });
  test("is shown on the page, and is nobody for a member who has pulled nothing", () => {
    const state = RAID.create(ctx(1));
    const view = RAID.view(state, { ...ctx(), awards: ["pull:figure:greg", "copies:figure:greg:2"] });
    expect(view.roster).toEqual({ greg: 1 });
    expect(readView(wire(view))).toEqual(view);
    expect(RAID.view(state, { ...ctx(), awards: ["pull:thing:rock", "trophy-bigcrab"] }).roster).toEqual({});
  });
});

describe("the main way", () => {
  test("plays the same, draw for draw, whatever the player has pulled", () => {
    const plain = walked([], false, 6);
    const rich = walked(EVERYTHING, false, 6);
    expect(rich).toEqual(plain);
    expect(rich.state.held.main?.way).toEqual(onTrail(0));
    expect(rich.state.held.main?.record.length).toBe(6);
    const fights = rich.notes.flatMap((n) => (n.t === "fight" ? n.setup.sides : []));
    expect(fights.flatMap((party) => party.figures).some((p) => "level" in p)).toBe(false);
    expect(rich.log.some((l) => "own" in l.data)).toBe(false);
  });
});

describe("a run with the member's own figures", () => {
  test("is not offered to a member who has pulled no figure", () => {
    const state = RAID.create(ctx(1));
    for (const awards of [[], ["pull:thing:rock", "pull:headliner:banner-9", "trophy-bigcrab"]]) {
      expect(RAID.apply(state, { do: "start", trail: 0, own: true }, { ...ctx(), awards })).toEqual({
        refused: "nothing_pulled",
      });
    }
    expect(refusalText("nothing_pulled")).toBe("You have pulled no figures yet.");
  });
  test("writes the roster down when it starts, and keeps it whatever is pulled meanwhile", () => {
    const first = ["pull:figure:greg", "copies:figure:greg:2", "pull:figure:slug"];
    const begun = walked(first, true, 1);
    expect(begun.state.held.main?.way).toEqual(onTrail(0, { greg: 1, slug: 0 }));
    // More is pulled while the run is in hand: the page is told, the run is not.
    const later: Ctx = { ...ctx(), awards: EVERYTHING };
    const view = RAID.view(begun.state, later);
    expect([view.held.main?.way, view.roster.greg, view.roster.badger]).toEqual([
      onTrail(0, { greg: 1, slug: 0 }),
      6,
      6,
    ]);
    expect(readView(wire(view))).toEqual(view);
    const rustled = must(must(begun.state, { do: "choose", option: 0 }, later).state, { do: "rustle" }, later).state;
    expect(must(must(rustled, { do: "fight" }, later).state, { do: "take" }, later).state.held.main?.way).toEqual(
      onTrail(0, { greg: 1, slug: 0 }),
    );
    expect(RAID.decode(RAID.encode(rustled))).toEqual(rustled);
    // A roster that names nobody the game has is no run.
    const raw = JSON.parse(RAID.encode(rustled));
    raw.held.main.way.figures.roster = { nobody: 1 };
    expect(RAID.decode(JSON.stringify(raw))?.held.main).toBeNull();
  });
  test("fights with its figures' levels in the fight's setup, which plays to the outcome Leaf kept", () => {
    const { notes } = walked(EVERYTHING, true, 3);
    const fights = notes.filter((n) => n.t === "fight");
    expect(fights.length).toBe(3);
    for (const fight of fights) {
      expect(fight.setup.sides[0].figures.every((p) => p.level === 6)).toBe(true);
      expect(fight.setup.sides[1].figures.every((p) => p.level === undefined)).toBe(true);
      expect(playsAsKept(fight)).toBe(true);
    }
  });
  test("leaves and meets its boards apart from the main way's, and only it is met with levels", () => {
    // Two rooms in, the run stands before room 2, a sparring room.
    const sent = must(planned(walked(EVERYTHING, true, 2).state), { do: "fight" });
    const board = sent.keep?.[0];
    expect(board?.slot).toBe("own:0:2");
    expect(RAID.meets?.(sent.state, { do: "take" })).toEqual({ slot: "own:0:3", avoid: [] });
    const met = metOf(board?.data);
    const inOwn = opposition(catalogAt(LEGACY_ERA), 1, 2, 0, met, true);
    const inMain = opposition(catalogAt(LEGACY_ERA), 1, 2, 0, met);
    expect([inOwn.by, inMain.by]).toEqual([MEMBER, MEMBER]);
    expect(inOwn.figures.every((p) => p.level === 6)).toBe(true);
    expect(inMain.figures.every((p) => p.level === undefined)).toBe(true);
  });
  test("pays its Coins, and changes no almanac, award, standing or trail; its log lines say what it was", () => {
    const main = walked([], false, 2).state;
    const home = must(main, { do: "abandon" }).state;
    const before = structuredClone(home);
    const { state, coins, log, notes } = walked(EVERYTHING, true, 99, home);
    const ended = notes.findLast((n) => n.t === "ended");
    if (ended?.t !== "ended") throw new Error("the run did not end");
    // It did what a run on the main way would have been written down for.
    expect(ended.summary.bosses.length).toBeGreaterThan(0);
    expect(ended.summary.reached).toBeGreaterThan(before.almanac.best[0] ?? 0);
    expect(ended.news).toEqual([]);
    expect(coins).toEqual([{ amount: payout(ended.summary).coins, reason: "The Little Raid", key: "run:2" }]);
    expect(state.almanac).toEqual(before.almanac);
    expect(RAID.awards?.(state)).toEqual(RAID.awards?.(before) ?? []);
    expect(RAID.standing?.(state)).toEqual(RAID.standing?.(before));
    expect([0, 1, 2].map((trail) => trailOpen(state.almanac, trail))).toEqual([true, false, false]);
    // Each fight's record says the way it set out, as the other lines say they are of one.
    expect(log.every((l) => (l.kind === "raid_fight" ? l.data["way"] === "own" : l.data["own"] === true))).toBe(true);
    expect(log.map((l) => l.kind)).toEqual([
      "raid_started",
      ...ended.run.record.flatMap(() => ["raid_fight", "raid_room"]),
      "raid_ended",
    ]);
  });
  test("may set out on a trail only once the main game has opened it", () => {
    const state = RAID.create(ctx(1));
    const at: Ctx = { ...ctx(), awards: EVERYTHING };
    expect(RAID.apply(state, { do: "start", trail: 1, own: true }, at)).toEqual({ refused: "trail_closed" });
    state.almanac.bosses[0] = ["bigcrab"];
    expect(must(state, { do: "start", trail: 1, own: true }, at).state.held.main?.way.course).toEqual({
      id: "trail",
      trail: 1,
    });
  });
});

/** The fights a command's log keeps for the staff, each read back as Leaf stores one. */
const fightsOf = (done: Done<Table, RaidNote>) =>
  (done.log ?? []).filter((l) => l.kind === "raid_fight").map((l) => readFight(wire(l.data)));

describe("every fight decided, kept for the staff", () => {
  test("a fight logs one record: the party it was decided from, and how it came out; its takings log none", () => {
    const sent = must(planned(started(5)), { do: "fight" });
    const decided = fought(sent.state);
    if (!decided) throw new Error("no fight");
    const ours = decided.setup.sides[0];
    const plan = ROOMS[0]?.plans.findIndex((p) => p.name === decided.setup.sides[1].title);
    const taken = must(sent.state, { do: "take" });
    expect(fightsOf(sent)).toEqual([
      {
        run: 1,
        way: "main",
        course: "trail",
        trail: 0,
        pool: "fair",
        era: decided.setup.era,
        room: 0,
        kind: "trouble",
        across: `plan:${plan}`,
        result: decided.outcome.result,
        margin: expect.any(Number),
        seconds: Math.round(decided.outcome.seconds * 10) / 10,
        // Resolve as the takings leave it; the level and acorns as the party set out.
        resolve: runOf(taken.state).resolve,
        level: runOf(sent.state).level,
        acorns: runOf(sent.state).acorns,
        party: { figures: ours.figures, traits: traitSteps(CAT, ours), boons: [] },
        against: null,
      },
    ]);
    expect(fightsOf(taken)).toEqual([]);
    // A win leaves the party more of itself than the forest has left.
    const margin = fightsOf(sent)[0]?.margin ?? 0;
    expect(decided.outcome.result === "win" ? margin > 0 : margin <= 0).toBe(true);
  });
  test("a sparring room's record has the party across: a regular's, or a member's board and whose", () => {
    const sparred = must(planned(reach(started(5), 2)), { do: "fight" });
    const regular = fightsOf(sparred)[0];
    const foe = fought(sparred.state)?.setup.sides[1];
    if (!foe) throw new Error("no fight");
    expect(regular?.across).toBe(`regular:${regularOf(foe)?.kind}`);
    expect(regular?.against).toEqual({ figures: foe.figures, traits: traitSteps(CAT, foe), boons: foe.boons });
    const board = keptBoard();
    const met = must(fighting(1), { do: "take" }, { ...ctx(), met: metOf(board) }).state;
    expect(runOf(met).foe.by).toBe(MEMBER);
    const member = fightsOf(must(planned(met), { do: "fight" }))[0];
    expect(member?.across).toBe(`member:${MEMBER}`);
    expect(member?.against?.figures).toEqual(board.figures);
  });
  test("a run with the member's own figures says so, with each figure's level, and every boon of the run", () => {
    const { log } = walked(EVERYTHING, true, 4);
    const fights = log.filter((l) => l.kind === "raid_fight").map((l) => readFight(wire(l.data)));
    expect(fights.length).toBe(4);
    expect(fights.every((f) => f?.way === "own")).toBe(true);
    expect(fights.some((f) => f?.party.figures.some((p) => p.level === LEVELS.most))).toBe(true);
    const third = walked(EVERYTHING, true, 3).state;
    expect(fightsOf(must(planned(third), { do: "fight" }))[0]?.party.boons).toEqual(runOf(third).boons);
  });
  test("a refused fight logs nothing, and a stored table fights as it did", () => {
    const spar = planned(reach(started(5), 2));
    const bare = structuredClone(spar);
    runOf(bare).board = runOf(bare).board.map(() => null);
    expect(RAID.apply(bare, { do: "fight" }, ctx())).toEqual({ refused: "board_empty" });
    const stored = decodeTable(readFileSync(new URL("../stored/planning.json", import.meta.url), "utf8"));
    if (!stored) throw new Error("the stored table does not read");
    const fights = fightsOf(must(planned(stored), { do: "fight" }));
    expect(fights).toHaveLength(1);
    expect(fights[0]?.run).toBe(stored.begun.main);
  });
  test("a record reads back only as the rules have one", () => {
    const record = fightsOf(must(planned(reach(started(5), 2)), { do: "fight" }))[0];
    if (!record) throw new Error("no record");
    const figure = record.party.figures[0];
    for (const broken of [
      { ...record, margin: 2 },
      { ...record, way: "sideways" },
      { ...record, against: undefined },
      { ...record, party: { ...record.party, traits: { crab: 0 } } },
      { ...record, party: { ...record.party, figures: [{ ...figure, kind: "nobody" }] } },
      { ...record, party: { ...record.party, boons: ["luck"] } },
    ]) {
      expect(readFight(wire(broken))).toBeNull();
    }
  });
});
