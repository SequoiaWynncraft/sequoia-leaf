import { describe, expect, test } from "bun:test";

import type { CoinChange, Ctx, Done, Logged, Refused } from "@sequoia-leaf/core";

import { SENSIBLE } from "./bot.ts";
import { FIGURES } from "./content/figures.ts";
import { EMBLEM_IDS, EMBLEMS } from "./content/items.ts";
import { newLooks } from "./content/looks.ts";
import { resolveFight } from "./fight/engine.ts";
import {
  decodeTable,
  encodeTable,
  planCommands,
  predict,
  RAID,
  type RaidCommand,
  type RaidNote,
  readCommand,
  refusalText,
  type Table,
  tableView,
} from "./game.ts";
import { payout } from "./outside.ts";
import { isParty } from "./party.ts";
import { pieces, playsAsKept, spotOf, summariseRun } from "./run.ts";
import { RAID_STATS } from "./stats.ts";
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
});

type Answer = Done<Table, RaidNote> | Refused;
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
    expect(state.run).toBeNull();
    expect(state.runs).toBe(0);
    expect(state.looks).toEqual({ cloth: "bare", lantern: "iron", bases: "plain", owned: [] });
    expect(RAID.view(state, ctx())).toEqual({
      runs: 0,
      run: null,
      almanac: state.almanac,
      trail: 0,
      looks: state.looks,
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
    expect(view.run).not.toBeNull();
    expect(Object.keys(view.run ?? {})).not.toContain("rng");
    expect(Object.keys(view.run ?? {})).not.toContain("seed");
  });
  test("shows only the first of the picks waiting; what the rest will offer is not shown", () => {
    const state = started();
    const run = state.run;
    if (!run) throw new Error("no run");
    run.choices = [
      { kind: "component", options: ["thorn", "bark", "plume"] },
      { kind: "component", options: ["glowcap", "chestnut", "thorn"] },
      { kind: "boon", options: ["windfall", "regular", "quickstudy"], redraws: 1 },
    ];
    const shown = RAID.view(state, ctx()).run?.choices;
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
    expect(done.state.runs).toBe(1);
    expect(done.state.run?.choices[0]?.kind).toBe("starter");
    expect(done.notes).toEqual([{ t: "started", trail: 0, run: 1 }]);
    expect(done.log).toEqual([{ kind: "raid_started", data: { trail: 0 } }]);
    expect(done.coins).toEqual([]);
  });
  test("picking, buying, selling, moving, benching, holding, rustling and experience", () => {
    let state = started(11);
    const run = (): NonNullable<Table["run"]> => {
      if (!state.run) throw new Error("no run");
      return state.run;
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
    expect(done.state.run?.board[3]).toBeNull();
    expect(done.state.run?.bench[1]).not.toBeNull();
    state = done.state;
    done = must(state, { do: "sell", from: { on: "bench", at: 1 } });
    expect(done.notes[0]).toMatchObject({ t: "sold" });
    state = done.state;
    done = must(state, { do: "hold", on: true });
    expect(done.state.run?.held).toBe(true);
    state = must(done.state, { do: "hold", on: false }).state;
    const before = state.run?.stall;
    done = must(state, { do: "rustle" });
    expect(done.notes[0]).toMatchObject({ t: "rustled", cost: 0 });
    expect(done.state.run?.stall).not.toEqual(before);
    state = done.state;
    if (state.run) state.run.acorns = 10;
    done = must(state, { do: "xp" });
    expect(done.notes[0]).toEqual({ t: "xp", gained: 4, cost: 4 });
  });
  test("a fight is decided when the party sets out, and its note carries both boards, the seed and the outcome", () => {
    const state = planned(started(5));
    const done = must(state, { do: "fight" });
    const note = done.notes[0];
    if (note?.t !== "fight") throw new Error("no fight note");
    expect(note.setup.sides[0].figures.length).toBeGreaterThan(0);
    expect(note.setup.sides[1]).toEqual(state.run?.foe ?? note.setup.sides[0]);
    expect(note.outcome).toEqual(resolveFight(note.setup));
    expect(done.state.run?.fight).toEqual({ setup: note.setup, outcome: note.outcome });
    // The boards are locked.
    expect(RAID.apply(done.state, { do: "buy", offer: 0 }, ctx())).toEqual({ refused: "fighting" });
    expect(RAID.apply(done.state, { do: "fight" }, ctx())).toEqual({ refused: "fighting" });
  });
  test("the takings are paid from the outcome Leaf kept, not from anything else", () => {
    const fighting = must(planned(started(5)), { do: "fight" }).state;
    const kept = fighting.run?.fight?.outcome.result;
    const taken = must(fighting, { do: "take" });
    expect(taken.notes[0]).toMatchObject({ t: "result", result: kept });
    // Had Leaf kept another outcome, that is what would be paid.
    const other = structuredClone(fighting);
    const fight = other.run?.fight;
    if (!fight) throw new Error("no fight");
    fight.outcome.result = kept === "win" ? "loss" : "win";
    expect(must(other, { do: "take" }).notes[0]).toMatchObject({ t: "result", result: fight.outcome.result });
  });
  test("the outcome Leaf kept is kept across a restart: a table stored in a fight reads back with it, not one worked out again", () => {
    const fighting = must(planned(started(5)), { do: "fight" }).state;
    const run = fighting.run;
    const fight = run?.fight;
    if (!run || !fight) throw new Error("no fight");
    // An outcome the rules loaded now would not give from that setup, as after a balance change.
    const kept = { ...fight.outcome, result: fight.outcome.result === "win" ? "loss" : "win", ticks: 4321 } as const;
    const stored = RAID.encode({ ...fighting, run: { ...run, fight: { ...fight, outcome: kept } } });
    const read = RAID.decode(stored);
    expect(read?.run?.fight?.outcome).toEqual(kept);
    if (!read) throw new Error("does not read");
    expect(must(read, { do: "take" }).notes[0]).toMatchObject({ t: "result", result: kept.result });
  });
  test("a room taken is logged: which, what kind, won or not, resolve left, how long the fight took", () => {
    const fighting = must(planned(started(5)), { do: "fight" }).state;
    const seconds = fighting.run?.fight?.outcome.seconds ?? -1;
    const won = fighting.run?.fight?.outcome.result === "win";
    const taken = must(fighting, { do: "take" });
    expect(taken.log).toEqual([
      {
        kind: "raid_room",
        data: {
          room: 1,
          kind: "trouble",
          won,
          resolve: taken.state.run?.resolve ?? 0,
          seconds: Math.round(seconds * 10) / 10,
        },
      },
    ]);
  });
  test("handing over an item, and picking a component and a boon, with one redraw", () => {
    let state = planned(started(5));
    state = must(state, { do: "fight" }).state;
    state = must(state, { do: "take" }).state;
    // The first room is trouble: a component pick follows it.
    expect(state.run?.choices[0]?.kind).toBe("component");
    let done = must(state, { do: "choose", option: 0 });
    expect(done.notes[0]).toMatchObject({ t: "component" });
    state = done.state;
    const seat = state.run?.board.findIndex((p) => p !== null) ?? -1;
    done = must(state, { do: "give", item: 0, to: { on: "board", at: seat } });
    expect(done.notes[0]).toMatchObject({ t: "gave", forged: null });
    state = done.state;
    // Play on to the boon after the second room.
    for (let guard = 0; guard < 6 && state.run?.choices[0]?.kind !== "boon"; guard++) {
      state = planned(state);
      state = must(state, { do: "fight" }).state;
      state = must(state, { do: "take" }).state;
      if (state.run?.choices[0]?.kind === "component") state = must(state, { do: "choose", option: 0 }).state;
    }
    expect(state.run?.choices[0]?.kind).toBe("boon");
    const offered = state.run?.choices[0]?.options;
    done = must(state, { do: "redraw" });
    expect(done.notes[0]).toMatchObject({ t: "redrawn" });
    expect(done.state.run?.choices[0]?.options).not.toEqual(offered);
    expect(RAID.apply(done.state, { do: "redraw" }, ctx())).toEqual({ refused: "redrawn" });
    expect(must(done.state, { do: "choose", option: 0 }).notes[0]).toMatchObject({ t: "boon" });
  });
  test("walking home ends the run, pays for the rooms won under the run's number, and writes the almanac", () => {
    let state = planned(started(5));
    state = must(state, { do: "fight" }).state;
    state = must(state, { do: "take" }).state;
    const run = state.run;
    if (!run) throw new Error("no run");
    const paid = payout(summariseRun({ ...structuredClone(run), phase: "over", left: true })).coins;
    const done = must(state, { do: "abandon" });
    expect(done.state.run).toBeNull();
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
    const run = state.run;
    if (!run) throw new Error("no run");
    const worth = payout(summariseRun({ ...structuredClone(run), phase: "over", left: true }));
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
    expect(none.state.run).toBeNull();
  });
  test("setting out afresh puts down the run laid out, as walking home does", () => {
    let state = planned(started(5));
    state = must(state, { do: "fight" }).state;
    state = must(state, { do: "take" }).state;
    const done = must(state, { do: "start", trail: 0 });
    expect(done.state.runs).toBe(2);
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
    expect(bought.state.looks).toEqual({ cloth: "bare", lantern: "jar", bases: "plain", owned: ["jar"] });
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
    const a = must(state, { do: "rustle" }, ctx(1000)).state.run?.stall;
    const b = must(state, { do: "rustle" }, ctx(1000)).state.run?.stall;
    const others = [2000, 3000, 4000, 5000].map((seed) => must(state, { do: "rustle" }, ctx(seed)).state.run?.stall);
    expect(a).toEqual(b);
    expect(others.some((stall) => JSON.stringify(stall) !== JSON.stringify(a))).toBe(true);
  });
  test("decide each fight's seed, so a fight cannot be known before the party sets out", () => {
    const state = planned(started(21));
    const seeds = new Set(
      [1, 2, 3, 4].map((seed) => must(state, { do: "fight" }, ctx(seed)).state.run?.fight?.setup.seed),
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
    for (let guard = 0; guard < 40 && state.run; guard++) {
      state = planned(state);
      take(must(state, { do: "fight" }));
      const taken = must(state, { do: "take" });
      ended = taken.notes.find((n) => n.t === "ended");
      take(taken);
    }
    expect(state.run).toBeNull();
    if (ended?.t !== "ended") throw new Error("the run did not end");
    const paid = payout(ended.summary).coins;
    expect(paid).toBeGreaterThan(0);
    expect(coins).toEqual([{ amount: paid, reason: "The Little Raid", key: "run:1" }]);
    const rooms = log.filter((l) => l.kind === "raid_room");
    expect(rooms.length).toBe(ended.run.record.length);
    expect(log.at(-1)).toEqual({
      kind: "raid_ended",
      data: { trail: 0, rooms_won: ended.summary.cleared, ended: ended.summary.won ? "won" : "lost", coins: paid },
    });
    expect(state.almanac.runs).toBe(1);
    expect(state.almanac.best[0]).toBe(ended.summary.reached);
    // Where the table stands, for the player's card: the bosses beaten, the runs done, the furthest room.
    expect(RAID.standing?.(RAID.create(ctx(42)))).toEqual({ score: 0, also: { runs: 0, room: 0 } });
    expect(RAID.standing?.(state)).toEqual({
      score: state.almanac.bosses.flat().length,
      also: { runs: 1, room: ended.summary.reached },
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
    for (const text of ["", "nope", "{}", "[]", "null", changed((r) => (r.v = 2)), changed((r) => (r.game = "x"))]) {
      expect(RAID.decode(text)).toBeNull();
    }
    expect(RAID.decode(changed((r) => (r.rng = -1)))).toBeNull();
    expect(
      RAID.decode(changed((r) => (r.looks = { cloth: "disco", lantern: "iron", bases: "plain", owned: [] }))),
    ).toBeNull();
    expect(RAID.decode(changed(() => undefined))).not.toBeNull();
    // What contradicts the rules now is put right, and a run that does not read is let go (`stored.test.ts`).
    expect(RAID.decode(changed((r) => (r.trail = 2)))?.trail).toBe(0);
    expect(RAID.decode(changed((r) => (r.runs = 0)))?.run).toBeNull();
    expect(RAID.decode(changed((r) => (r.run = { phase: "plan" })))?.run).toBeNull();
    expect(
      RAID.decode(changed((r) => (r.looks = { cloth: "plum", lantern: "iron", bases: "plain", owned: [] })))?.looks,
    ).toEqual(newLooks());
  });
  test("a table stored when a charm counted for its kin comes back with the charm's emblem on the item bench, once", () => {
    const state = planned(started(9));
    const run = state.run;
    if (!run) throw new Error("no run");
    const stored: unknown = JSON.parse(RAID.encode(state));
    if (typeof stored !== "object" || stored === null || !("run" in stored)) throw new Error("not a table");
    const raw = stored.run;
    if (typeof raw !== "object" || raw === null) throw new Error("no run");
    // The charm among the boons, no emblem anywhere, and the foe with the old `charms`.
    const old = JSON.stringify({ ...stored, run: { ...raw, boons: ["crabcharm"], foe: { ...run.foe, charms: [] } } });
    const once = RAID.decode(old);
    expect(once?.run?.items).toEqual([...run.items, "crabcharm"]);
    expect(once?.run?.foe).toMatchObject(run.foe);
    const twice = once ? RAID.decode(RAID.encode(once)) : null;
    expect(twice?.run?.items).toEqual([...run.items, "crabcharm"]);
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
    const seat = state.run?.board.findIndex((p) => p !== null) ?? -1;
    const offer = state.run?.stall.findIndex((k) => k !== null) ?? -1;
    const same = (c: RaidCommand): void => {
      const guessed = predict(RAID.view(state, ctx()), c);
      const done = must(state, c);
      expect(guessed).toEqual({ view: tableView(done.state), notes: [...done.notes] });
      state = done.state;
    };
    same({ do: "give", item: 0, to: { on: "board", at: seat } });
    same({ do: "move", from: { on: "board", at: seat }, to: { on: "board", at: 20 } });
    same({ do: "hold", on: true });
    same({ do: "bench", seat: 20 });
    same({ do: "move", from: { on: "bench", at: 0 }, to: { on: "board", at: 4 } });
    // Whoever else the bot bought is sold, down to the last figure, which cannot be.
    for (let guard = 0; guard < 20; guard++) {
      const run = state.run;
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

describe("an emblem handed to a figure of its kin already", () => {
  test("is refused on the page as Leaf refuses it, with the sentence the page shows", () => {
    const state = started(9);
    const run = state.run;
    const figure = run ? pieces(run)[0] : undefined;
    const spot = run && figure ? spotOf(run, figure.id) : null;
    if (!run || !figure || !spot) throw new Error("nobody to hand it to");
    const own = EMBLEM_IDS.find((id) => EMBLEMS[id] === FIGURES[figure.kind].kin);
    if (!own) throw new Error("no emblem of its kin");
    run.boons = [own];
    run.items = [own];
    const command: RaidCommand = { do: "give", item: 0, to: spot };
    expect(predict(RAID.view(state, ctx()), command)).toEqual({ refused: "already_kin" });
    expect(RAID.apply(state, command, ctx())).toEqual({ refused: "already_kin" });
    expect(refusalText("already_kin")).toBe("It is of that kin already.");
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
    for (let guard = 0; guard < 40 && state.run; guard++) {
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
    expect(state.run).toBeNull();
  });
  test("a fight's outcome is read as Leaf sent it, in its note and in the view, never worked out again", () => {
    const done = must(planned(started(5)), { do: "fight" });
    const note = done.notes[0];
    if (note?.t !== "fight") throw new Error("no fight note");
    const other = { ...note.outcome, result: note.outcome.result === "win" ? "loss" : "win", ticks: 4321 } as const;
    expect(readNotes(wire([{ ...note, outcome: other }]))).toEqual([{ ...note, outcome: other }]);
    const view = RAID.view(done.state, ctx());
    const run = view.run;
    if (!run?.fight) throw new Error("no fight");
    const shown = { ...view, run: { ...run, fight: { ...run.fight, outcome: other } } };
    expect(readView(wire(shown))?.run?.fight?.outcome).toEqual(other);
    expect(readNotes(wire([{ ...note, outcome: { ...other, result: "maybe" } }]))).toBeNull();
  });
  test("the page's rules play a fight to the outcome Leaf kept, or say they do not, for the page to load again", () => {
    const fought = must(planned(started(5)), { do: "fight" }).state.run?.fight;
    if (!fought) throw new Error("no fight");
    expect(playsAsKept(fought)).toBe(true);
    expect(playsAsKept({ ...fought, outcome: { ...fought.outcome, ticks: fought.outcome.ticks + 1 } })).toBe(false);
    const flipped = fought.outcome.result === "win" ? "loss" : "win";
    expect(playsAsKept({ ...fought, outcome: { ...fought.outcome, result: flipped } })).toBe(false);
  });
  test("anything else is not read", () => {
    const view = wire(RAID.view(started(), ctx()));
    expect(readView(view)).not.toBeNull();
    for (const bad of [null, {}, [], { ...Object(view), trail: 9 }, { ...Object(view), run: { phase: "plan" } }]) {
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
  test("setting out afresh, or walking home, before a room is fought changes nothing: no new opening for free", () => {
    for (const state of [RAID.create(ctx(5)), started(5)]) {
      // Laid out, and its starter picked or not: either way no room has been fought.
      const laid = state.run ? state : must(state, { do: "start", trail: 0 }).state;
      for (const command of [{ do: "start", trail: 0 }, { do: "abandon" }] as const) {
        const done = must(laid, command);
        expect(done.state).toBe(laid);
        expect(encodeTable(done.state)).toBe(encodeTable(laid));
        expect(done.notes).toEqual([]);
        expect(done.coins ?? []).toEqual([]);
        expect(done.log ?? []).toEqual([]);
      }
    }
    // Nor in the middle of the first fight, once it is decided.
    const fighting = must(planned(started(5)), { do: "fight" }).state;
    expect(must(fighting, { do: "start", trail: 0 }).state).toBe(fighting);
    expect(must(fighting, { do: "abandon" }).state).toBe(fighting);
    expect(RAID.apply(fighting, { do: "start", trail: 2 }, ctx())).toEqual({ refused: "trail_closed" });
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

describe("a look won as a pull's prize", () => {
  test("is owned at the table, costs nothing, and may be put on", () => {
    const state = RAID.create(ctx(1));
    expect(won(state, "trophy-oldbramble", "pull:thing:rock", "pull:look:bare", "pull:look:nothing")).toBe(state);
    const owner = won(state, "pull:look:gilt", "pull:look:baize");
    expect(owner.looks).toEqual({ cloth: "bare", lantern: "iron", bases: "plain", owned: ["gilt", "baize"] });
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

describe("awards", () => {
  test("are a carved figure of each boss the almanac has beaten, on any trail, once", () => {
    const state = RAID.create(ctx(1));
    expect(RAID.awards?.(state)).toEqual([]);
    state.almanac.bosses[0] = ["oldbramble", "bigcrab"];
    state.almanac.bosses[1] = ["oldbramble"];
    expect(RAID.awards?.(state)).toEqual(["trophy-oldbramble", "trophy-bigcrab"]);
  });
});

describe("the board a member fought with", () => {
  test("is left for Leaf to keep at each fight, by trail and room: the party the fight was decided from", () => {
    const first = must(planned(started(5)), { do: "fight" });
    const note = first.notes[0];
    if (note?.t !== "fight") throw new Error("no fight note");
    expect(first.keep).toEqual([{ slot: "board:0:0", data: note.setup.sides[0] }]);
    expect(isParty(first.keep?.[0]?.data)).toBe(true);
    expect(note.outcome).toEqual(resolveFight(note.setup));
    const second = must(planned(must(first.state, { do: "take" }).state), { do: "fight" });
    expect(second.keep).toEqual([{ slot: "board:0:1", data: second.state.run?.fight?.setup.sides[0] }]);
    expect(isParty(second.keep?.[0]?.data)).toBe(true);
  });
  test("is not left by a refused command, by any other command, or by a guest's fight", () => {
    const state = planned(started(5));
    const fought = must(state, { do: "fight" });
    expect(RAID.apply(fought.state, { do: "fight" }, ctx())).toEqual({ refused: "fighting" });
    expect(must(fought.state, { do: "take" }).keep).toBeUndefined();
    const guest = must(state, { do: "fight" }, { ...ctx(), player: { ...PLAYER, guest: true } });
    expect(guest.notes[0]).toMatchObject({ t: "fight" });
    expect(guest.keep).toBeUndefined();
  });
});
