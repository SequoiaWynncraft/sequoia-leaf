import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import type { Ctx, Done } from "@sequoia-leaf/core";

import { planRoom, SENSIBLE } from "./bot.ts";
import type { RaidCommand } from "./command.ts";
import { legal } from "./command.ts";
import type { FigureId, Stars } from "./content/figures.ts";
import { RULE_IDS, type RuleId, WILDS } from "./content/wilds.ts";
import { foeOf, roomAt } from "./endless.ts";
import { HZ } from "./fight/core.ts";
import { openFight, stepFight } from "./fight/engine.ts";
import { attackReach, closedCells } from "./fight/rules.ts";
import type { Fight, FightEvent, FightRule, FightSetup } from "./fight/types.ts";
import { arrange } from "./formation.ts";
import { RAID, type RaidNote, type Table } from "./game.ts";
import { colOf, distance, rowOf, seatCell, SEATS } from "./hex.ts";
import type { Placed } from "./party.ts";
import {
  beginFight,
  type Choice,
  choose,
  foughtOf,
  move,
  notPlanning,
  picksOf,
  type Run,
  startRun,
  takeTakings,
} from "./run.ts";
import { sparParty } from "./spar.ts";
import { at, onCell, partyOfFigures, ready, stepUntil, stillSide, unitOf } from "./testkit.ts";
import { closedNow, closedSeats, ruleOf, wingOf } from "./wing.ts";
import { readNotes, readView } from "./wire.ts";

/** A run of the Wilds brought to a room, its board three stars of the best there are: one that wins. */
function strong(run: Run, room: number): Run {
  const best: FigureId[] = ["greg", "whitefox", "hearthcat", "badger", "crab40", "fogowl", "heron", "apothecary"];
  run.board = run.board.map(() => null);
  best.forEach((kind, i) => {
    const stars: Stars = 3;
    run.board[i < 5 ? i + 1 : 14 + i] = { id: 100 + i, kind, stars, items: [], fed: 0 };
  });
  run.nextId = 200;
  run.level = 8;
  run.room = room;
  run.stage = { phase: "plan", picks: [] };
  run.foe = foeOf(run, 99);
  return run;
}
const wilds = (seed: number, room: number): Run => strong(startRun(seed, { endless: "wilds" }), room);
/** Fights the room the run is in and takes the takings. */
function fought(run: Run): RaidNote[] {
  const begun = beginFight(run);
  if (!begun.ok) throw new Error(begun.why);
  const taken = takeTakings(run);
  if (!taken.ok) throw new Error(taken.why);
  return taken.notes;
}
const rulePick = (run: Pick<Run, "stage">): Extract<Choice, { kind: "rule" }> | undefined => {
  const up = picksOf(run)[0];
  return up?.kind === "rule" ? up : undefined;
};
/** Takes a rule from the pick waiting: the given one if it is offered. */
function pickRule(run: Run, rule?: RuleId): RaidNote[] {
  const pick = rulePick(run);
  if (!pick) throw new Error("no rule to pick");
  const done = choose(run, rule ? Math.max(0, pick.options.indexOf(rule)) : 0);
  if (!done.ok) throw new Error(done.why);
  return done.notes;
}
/** A run of the Wilds in the first room of a wing under a rule, as if it had been picked. */
function ruled(seed: number, rule: RuleId, room = 5): Run {
  const run = wilds(seed, room);
  run.stage = { phase: "plan", picks: [{ kind: "rule", options: [rule] }] };
  pickRule(run, rule);
  return run;
}

describe("the pick of a rule", () => {
  test("after the boss in room 5 of the Wilds, 2 different rules are offered before anything else", () => {
    for (let seed = 1; seed <= 40; seed++) {
      const run = wilds(seed, WILDS.first);
      fought(run);
      const pick = rulePick(run);
      expect(pick?.options).toHaveLength(WILDS.offers);
      expect(new Set(pick?.options).size).toBe(WILDS.offers);
      expect(pick?.options.every((r) => RULE_IDS.includes(r))).toBe(true);
      expect(notPlanning(run)).toBe("pick_rule");
    }
  });
  test("none after any other room, and none in the Deep Woods or on a trail", () => {
    for (let room = 0; room < WILDS.first; room++) {
      const run = wilds(3, room);
      fought(run);
      expect(rulePick(run)).toBeUndefined();
    }
    const deep = strong(startRun(3, { endless: "deep" }), WILDS.first);
    fought(deep);
    expect(rulePick(deep)).toBeUndefined();
    const trail = strong(startRun(3), WILDS.first);
    fought(trail);
    expect(rulePick(trail)).toBeUndefined();
  });
  test("after every boss after it, never offering the rule just played", () => {
    const offered = new Map<string, number>();
    for (let seed = 1; seed <= 60; seed++) {
      const run = wilds(seed, WILDS.first);
      fought(run);
      const first = rulePick(run)?.options ?? [];
      pickRule(run);
      const played = run.wing?.rule;
      expect(played).toBe(first[0]);
      // The boss's components (and room 5's boon) come after the rule.
      expect(
        picksOf(run)
          .slice(0, 2)
          .map((c) => c.kind),
      ).toEqual(["component", "component"]);
      expect(picksOf(run).some((c) => c.kind === "rule")).toBe(false);
      run.stage = { phase: "plan", picks: [] };
      // To the wing's boss: rooms 6 to 10, counting from 1.
      run.room = WILDS.first + WILDS.wing;
      expect(ruleOf(run)?.id).toBe(played);
      run.foe = foeOf(run, seed);
      fought(run);
      const next = rulePick(run)?.options ?? [];
      expect(next).toHaveLength(WILDS.offers);
      expect(next).not.toContain(played);
      expect(next.toSorted()).not.toEqual(first.toSorted());
      for (const r of next) offered.set(r, (offered.get(r) ?? 0) + 1);
    }
    // Drawn, not dealt in one order: every rule is offered somewhere.
    expect([...offered.keys()].toSorted()).toEqual([...RULE_IDS].toSorted());
  });
  test("the rule holds for the 5 rooms of its wing, and the room after it waits for the next pick", () => {
    const run = ruled(5, "fog");
    for (let room = 5; room < 10; room++) expect(ruleOf({ room, wing: run.wing })?.id).toBe("fog");
    expect(ruleOf({ room: 10, wing: run.wing })).toBeNull();
    expect(wingOf(4)).not.toBe(wingOf(5));
  });
});

/** A fight's setup under a rule, or none. */
const setupOf = (ours: Placed[], theirs: Placed[], rule?: FightRule, seed = 7): FightSetup => ({
  seed,
  sides: [partyOfFigures(ours), partyOfFigures(theirs)],
  ...(rule ? { rule } : {}),
});
/** A fight played to its end: the opening, every step's events, and where everyone stood after each step. */
function playOut(setup: FightSetup): {
  opening: FightEvent[];
  events: FightEvent[];
  cells: number[][];
  f: Fight;
} {
  const f = openFight(setup);
  const opening = [...f.opening];
  const events: FightEvent[] = [];
  const cells: number[][] = [f.units.filter((u) => u.alive).map((u) => u.cell)];
  while (!f.over) {
    events.push(...stepFight(f));
    cells.push(f.units.filter((u) => u.alive).map((u) => u.cell));
  }
  return { opening, events, cells, f };
}
/** Whether a fight hex is on either front row. */
const onFront = (c: number): boolean => rowOf(c) === 3 || rowOf(c) === 4;
/** A figure's attack as the fight starts: the first of a kind on a side. */
const attackOf = (f: Fight, kind: string, side = 0): number =>
  f.units.find((u) => u.kind === kind && u.side === side)?.attack ?? 0;
/** How many hex steps apart two seats of one half are. */
const seatsApart = (a: number, b: number): number => distance(seatCell(0, a), seatCell(0, b));
/** A field of plain data that has to be an object. */
function rec(v: unknown, key: string): Record<string, unknown> {
  const inner = typeof v === "object" && v !== null ? Object.entries(v).find(([k]) => k === key)?.[1] : undefined;
  if (typeof inner !== "object" || inner === null || Array.isArray(inner)) throw new Error(`no ${key}`);
  return Object.fromEntries(Object.entries(inner));
}
const BRAWL: Placed[] = [
  at("rock", 0, 0),
  at("badger", 3, 0),
  at("crab7", 6, 0),
  at("emberkit", 2, 1),
  at("finch", 4, 2),
  at("heron", 1, 3),
  at("moth", 5, 3),
];

describe("each rule in the fight", () => {
  test("Stumps: nobody stands on a stump or walks through one, on either half", () => {
    const rule: FightRule = { id: "stumps", stumps: [2, 3, 10] };
    const stumps = new Set(closedCells(rule));
    expect(stumps.size).toBe(6);
    for (let seed = 1; seed <= 12; seed++) {
      const { cells, events } = playOut(setupOf(BRAWL, BRAWL, rule, seed));
      expect(cells.flat().filter((c) => stumps.has(c))).toEqual([]);
      const steps = events.flatMap((e) => (e.t === "move" || e.t === "leap" ? [e.to] : []));
      expect(steps.length).toBeGreaterThan(0);
      expect(steps.filter((c) => stumps.has(c))).toEqual([]);
    }
  });
  test("Narrow Table: nobody stands in the outside columns all fight long, even those planned there", () => {
    for (let seed = 1; seed <= 12; seed++) {
      const { cells } = playOut(setupOf(BRAWL, BRAWL, { id: "narrow", stumps: [] }, seed));
      expect(cells.flat().filter((c) => colOf(c) === 0 || colOf(c) === 6)).toEqual([]);
    }
    const plain = playOut(setupOf(BRAWL, BRAWL));
    expect(plain.cells[0]?.some((c) => colOf(c) === 0)).toBe(true);
  });
  test("Long Table: both front rows are empty at the start, and walked into once the fight is on", () => {
    const { cells } = playOut(setupOf(BRAWL, BRAWL, { id: "long", stumps: [] }));
    expect(cells[0]?.filter(onFront)).toEqual([]);
    expect(cells.flat().some(onFront)).toBe(true);
  });
  test("Fog: no attack reaches further than 2 hexes", () => {
    const far: Placed[] = [at("rock", 3, 0), at("heron", 2, 3), at("finch", 4, 3), at("fogowl", 3, 3)];
    const shots = (rule?: FightRule): number[] =>
      playOut(setupOf(far, far, rule)).events.flatMap((e) =>
        e.t === "shot" && e.what === "attack" ? [distance(e.from, e.to)] : [],
      );
    expect(Math.max(...shots())).toBeGreaterThan(WILDS.fog);
    const fogged = shots({ id: "fog", stumps: [] });
    expect(fogged.length).toBeGreaterThan(0);
    expect(Math.max(...fogged)).toBeLessThanOrEqual(WILDS.fog);
    const f = openFight(setupOf(far, far, { id: "fog", stumps: [] }));
    expect(f.units.every((u) => attackReach(f, u) <= WILDS.fog)).toBe(true);
    // Each figure keeps its own reach, for its ability.
    expect(Math.max(...f.units.map((u) => u.range))).toBeGreaterThan(WILDS.fog);
  });
  test("Fog leaves abilities their reach: a Drizzle Frog 3 hexes from a Rock casts at it, and does not attack it", () => {
    const frogAt = 5 * 7 + 3;
    const rockAt = 2 * 7 + 3;
    expect(distance(frogAt, rockAt)).toBe(3);
    const f = openFight({
      seed: 3,
      sides: [partyOfFigures([onCell("drizzlefrog", 0, frogAt)]), partyOfFigures([onCell("rock", 1, rockAt)])],
      rule: { id: "fog", stumps: [] },
    });
    const frog = unitOf(f, "drizzlefrog", 0);
    const rock = unitOf(f, "rock", 1);
    stillSide(f, 1);
    frog.rooted = true;
    ready(frog);
    const events = stepUntil(f, (e) => e.t === "cast" && e.id === frog.id, 60);
    const cast = events.find((e) => e.t === "cast" && e.id === frog.id);
    expect(cast?.t === "cast" ? cast.targets : []).toContain(rock.id);
    expect(distance(frog.cell, rock.cell)).toBe(3);
    expect(events.filter((e) => e.t === "shot" && e.id === frog.id && e.what === "attack")).toEqual([]);
  });
  test("Early Dusk: dusk falls after 12 seconds, not 30", () => {
    const sturdy: Placed[] = [at("crab40", 3, 0, 3), at("rock", 2, 0, 3), at("badger", 4, 0, 3)];
    const early = openFight(setupOf(sturdy, sturdy, { id: "dusk", stumps: [] }));
    expect(early.wilds.dusk).toBe(WILDS.dusk);
    expect(openFight(setupOf(sturdy, sturdy)).wilds.dusk).toBe(30);
    // The first dusk event comes in the step of second 13 under the rule, and later without it.
    const secondOf = (rule?: FightRule): number => {
      const f = openFight(setupOf(sturdy, sturdy, rule));
      while (!f.over) if (stepFight(f).some((e) => e.t === "dusk")) return f.tick / HZ;
      return -1;
    };
    expect(secondOf({ id: "dusk", stumps: [] })).toBe(WILDS.dusk + 1);
    const plain = secondOf();
    expect(plain === -1 || plain > WILDS.dusk + 1).toBe(true);
  });
  test("Elbow Room: a figure that starts with no friend touching it has 30% more attack, and the opening says so", () => {
    const ours: Placed[] = [at("badger", 0, 0), at("rock", 3, 0), at("crab7", 4, 0)];
    const theirs: Placed[] = [at("badger", 3, 0)];
    const plain = openFight(setupOf(ours, theirs));
    const elbow = openFight(setupOf(ours, theirs, { id: "elbow", stumps: [] }));
    expect(attackOf(elbow, "badger")).toBe(
      attackOf(plain, "badger") + Math.round((attackOf(plain, "badger") * 30) / 100),
    );
    expect(attackOf(elbow, "rock")).toBe(attackOf(plain, "rock"));
    expect(attackOf(elbow, "crab7")).toBe(attackOf(plain, "crab7"));
    // The badger across the table stands alone too.
    expect(attackOf(elbow, "badger", 1)).toBeGreaterThan(attackOf(plain, "badger", 1));
    const boosts = elbow.opening.filter((e) => e.t === "boost").map((e) => (e.t === "boost" ? e.id : -1));
    expect(boosts.toSorted((a, b) => a - b)).toEqual(
      elbow.units
        .filter((u) => u.kind === "badger" || u.side === 1)
        .map((u) => u.id)
        .toSorted((a, b) => a - b),
    );
  });
  test("a fight set up with no rule is played as it always was", () => {
    const a = playOut(setupOf(BRAWL, BRAWL));
    const f = openFight(setupOf(BRAWL, BRAWL));
    expect(f.wilds).toEqual({ dusk: 30, reach: Number.POSITIVE_INFINITY });
    expect(f.taken.every((v) => v >= -1)).toBe(true);
    expect(a.f.result).not.toBeNull();
  });
});

describe("closed hexes", () => {
  test("nothing is moved or dropped onto one, and the page is told so", () => {
    const run = ruled(11, "narrow");
    const slot = run.bench.indexOf(null);
    run.bench[slot] = { id: 300, kind: "finch", stars: 1, items: [], fed: 0 };
    run.board[1] = null;
    run.level = 1;
    run.board = run.board.map(() => null);
    run.board[3] = { id: 301, kind: "rock", stars: 1, items: [], fed: 0 };
    run.level = 2;
    const onto = (seat: number) =>
      ({ do: "move", from: { on: "bench", at: slot }, to: { on: "board", at: seat } }) as const;
    for (const seat of [0, 6, 7, 13, 27]) {
      expect(legal(run, onto(seat))).toBe(false);
      const done = move(run, { on: "bench", at: slot }, { on: "board", at: seat });
      expect(done.ok ? "moved" : done.code).toBe("closed_hex");
    }
    expect(legal(run, onto(2))).toBe(true);
    // And from one seat of the board to a closed one.
    expect(legal(run, { do: "move", from: { on: "board", at: 3 }, to: { on: "board", at: 0 } })).toBe(false);
  });
  test("the regulars, formation and the forest's plans seat only open hexes", () => {
    for (const rule of ["stumps", "narrow", "long"] as const) {
      for (let seed = 1; seed <= 15; seed++) {
        for (let room = 15; room < 20; room++) {
          const run = ruled(seed, rule, room);
          const closed = closedNow(run);
          expect(closed.size).toBeGreaterThan(0);
          expect(run.foe.figures.filter((p) => closed.has(p.seat))).toEqual([]);
          run.foe = foeOf(run, seed * 31 + room);
          expect(roomAt(room)).toBeDefined();
          expect(run.foe.figures.filter((p) => closed.has(p.seat))).toEqual([]);
          expect(run.board.flatMap((p, s) => (p && closed.has(s) ? [s] : []))).toEqual([]);
        }
        const closed = closedSeats({ id: rule, stumps: [3, 9, 24] });
        const regular = sparParty(seed, 16, 0, { level: 9, spent: 60, components: 4 }, closed);
        expect(regular.figures.length).toBeGreaterThan(5);
        expect(regular.figures.filter((p) => closed.has(p.seat))).toEqual([]);
        const seats = arrange(
          Array.from({ length: 11 }, () => ({ kind: "rock" as const, health: 100 })),
          false,
          closed,
        );
        expect(new Set(seats).size).toBe(11);
        expect(seats.filter((s) => closed.has(s) || s < 0 || s >= SEATS)).toEqual([]);
      }
    }
  });
  test("the bot plans a wing under each rule without a figure on a closed hex", () => {
    for (const rule of RULE_IDS) {
      const run = ruled(21, rule);
      for (let n = 0; n < WILDS.wing && run.stage.phase !== "over"; n++) {
        planRoom(run, SENSIBLE);
        const closed = closedNow(run);
        expect(run.board.flatMap((p, s) => (p && closed.has(s) ? [s] : []))).toEqual([]);
        const begun = beginFight(run);
        expect(begun.ok).toBe(true);
        if (begun.ok) expect(begun.setup.rule?.id).toBe(rule);
        takeTakings(run);
      }
    }
  });
});

describe("moving off a hex that closes", () => {
  test("a figure on a seat that closes when a wing starts moves to the nearest open seat, and says so", () => {
    const run = wilds(4, WILDS.first);
    fought(run);
    run.board = run.board.map(() => null);
    run.board[0] = { id: 400, kind: "rock", stars: 1, items: [], fed: 0 };
    run.board[3] = { id: 401, kind: "badger", stars: 1, items: [], fed: 0 };
    run.board[1] = { id: 402, kind: "finch", stars: 1, items: [], fed: 0 };
    run.stage = { phase: "plan", picks: [{ kind: "rule", options: ["narrow", "fog"] }] };
    const notes = pickRule(run, "narrow");
    expect(run.board[0]).toBeNull();
    const shifted = notes.filter((n) => n.t === "shifted");
    expect(shifted).toHaveLength(1);
    const to = shifted[0]?.t === "shifted" ? shifted[0].to : null;
    expect(to?.on).toBe("board");
    const open = Array.from({ length: SEATS }, (_, seat) => seat).filter(
      (seat) => !closedNow(run).has(seat) && (run.board[seat] === null || seat === to?.at),
    );
    expect(seatsApart(0, to?.at ?? 0)).toBe(Math.min(...open.map((seat) => seatsApart(0, seat))));
    expect(run.board[to?.at ?? -1]?.id).toBe(400);
    expect(run.board[1]?.id).toBe(402);
    // As Leaf sends it to the page.
    expect(readNotes(JSON.parse(JSON.stringify(notes)))).toEqual(notes);
  });
  test("under Long Table the front row moves back, and under Stumps new stumps every room move whoever is on them", () => {
    const run = wilds(6, WILDS.first);
    fought(run);
    run.board = run.board.map(() => null);
    for (let col = 0; col < 7; col++) run.board[col] = { id: 500 + col, kind: "rock", stars: 1, items: [], fed: 0 };
    run.stage = { phase: "plan", picks: [{ kind: "rule", options: ["long"] }] };
    const notes = pickRule(run, "long");
    expect(notes.filter((n) => n.t === "shifted")).toHaveLength(7);
    expect(run.board.slice(0, 7).every((p) => p === null)).toBe(true);
    expect(run.board.filter((p) => p !== null)).toHaveLength(7);

    const stumped = ruled(8, "stumps");
    const seen = new Set<string>();
    for (let n = 0; n < 4; n++) {
      // Everyone stands everywhere a stump could be, so whichever are drawn, somebody moves.
      const stumps = stumped.wing?.stumps ?? [];
      expect(stumps).toHaveLength(WILDS.stumps);
      seen.add(stumps.join());
      expect(stumped.board.flatMap((p, s) => (p && stumps.includes(s) ? [s] : []))).toEqual([]);
      stumped.stage = { phase: "plan", picks: [] };
      stumped.board = stumped.board.map((_, s) =>
        s < 9 && !stumps.includes(s) ? { id: 600 + n * 30 + s, kind: "rock", stars: 1, items: [], fed: 0 } : null,
      );
      stumped.level = 9;
      const begun = beginFight(stumped);
      expect(begun.ok).toBe(true);
      const taken = takeTakings(stumped);
      if (!taken.ok) throw new Error(taken.why);
      const moved = taken.notes.filter((t) => t.t === "shifted");
      const occupied = (stumped.wing?.stumps ?? []).filter((s) => s < 9 && !stumps.includes(s));
      expect(moved.length).toBe(occupied.length);
    }
    expect(seen.size).toBeGreaterThan(1);
  });
});

// ---------- kept ----------

const ME = "10000000-0000-0000-0000-000000000001";
const ctx = (seed = 7): Ctx => ({
  now: 1_800_000_000_000,
  player: { id: ME, guest: false },
  seed,
  room: 1e9,
  awards: [],
  postcards: {},
});
const isDone = (d: Done<Table, RaidNote> | { refused: string }): d is Done<Table, RaidNote> => !("refused" in d);
function must(state: Table, c: RaidCommand, seed = 7): Table {
  const done = RAID.apply(state, c, ctx(seed));
  if (!isDone(done)) throw new Error(`${c.do} was refused: ${done.refused}`);
  return done.state;
}
/** A table whose run of the Wilds is in room 7, under a rule picked after room 5. */
function tableInWing(rule: RuleId): Table {
  let state = must(RAID.create(ctx(1)), { do: "start", course: "wilds" });
  const run = state.endless;
  if (!run) throw new Error("no run");
  strong(run, 6);
  run.wing = { rule, at: wingOf(6), stumps: rule === "stumps" ? [2, 9, 20] : [] };
  run.foe = foeOf(run, 5);
  run.record.push({ room: 4, kind: "boss", result: "win", standing: [3, 0], boss: "oldbramble" });
  state = must(state, { do: "fight", slot: "endless" });
  return state;
}
const raw = (state: Table): Record<string, unknown> & { endless: Record<string, unknown> } =>
  JSON.parse(RAID.encode(state));

const frozen = (name: string): Table => {
  const table = RAID.decode(readFileSync(new URL(`../stored/${name}`, import.meta.url), "utf8"));
  if (!table) throw new Error(`${name} does not read`);
  return table;
};

describe("a run's rule, kept", () => {
  test("the frozen tables: one of version 3 past room 5 has no rule; one of version 4 keeps its Stumps", () => {
    const old = frozen("wilds-past-room-5.json").endless;
    expect(old?.room).toBe(6);
    expect(old?.wing).toBeNull();
    const kept = frozen("wilds-rule.json").endless;
    expect(kept?.wing?.rule).toBe("stumps");
    expect(kept && ruleOf(kept)?.stumps).toHaveLength(WILDS.stumps);
    const closed = kept ? closedNow(kept) : new Set<number>();
    expect(kept?.board.flatMap((p, s) => (p && closed.has(s) ? [s] : []))).toEqual([]);
    expect(kept?.foe.figures.filter((p) => closed.has(p.seat))).toEqual([]);
  });
  test("is stored with the run and its fight, and read back the same", () => {
    for (const rule of RULE_IDS) {
      const state = tableInWing(rule);
      const back = RAID.decode(RAID.encode(state));
      expect(back).toEqual(state);
      expect(back?.endless?.wing?.rule).toBe(rule);
      const fight = back?.endless ? foughtOf(back.endless) : null;
      expect(fight?.setup.rule?.id).toBe(rule);
    }
  });
  test("a table of version 3 has none: its run of the Wilds past room 5 plays on, and picks one at its next boss", () => {
    const old = raw(tableInWing("fog"));
    old.v = 3;
    delete old.endless.wing;
    const stage = rec(old.endless, "stage");
    const fight = rec(stage, "fight");
    const setup = rec(fight, "setup");
    delete setup.rule;
    old.endless.stage = { ...stage, fight: { ...fight, setup } };
    const state = RAID.decode(JSON.stringify(old));
    const run = state?.endless;
    expect(run?.wing).toBeNull();
    expect(run ? foughtOf(run)?.setup.rule : "none").toBeUndefined();
    if (!state || !run) throw new Error("does not read");
    let table = must(state, { do: "take", slot: "endless" });
    expect(table.endless ? rulePick(table.endless) : undefined).toBeUndefined();
    // On to the wing's boss, room 10.
    const deep = table.endless;
    if (!deep) throw new Error("no run");
    strong(deep, 9);
    deep.foe = foeOf(deep, 3);
    table = must(must(table, { do: "fight", slot: "endless" }), { do: "take", slot: "endless" });
    expect(table.endless ? rulePick(table.endless)?.options : []).toHaveLength(2);
  });
  test("a rule an update took out is none, and the run picks again for the rest of its wing", () => {
    const kept = tableInWing("elbow");
    let taken = must(kept, { do: "take", slot: "endless" });
    const text = raw(taken);
    text.endless.wing = { ...rec(text.endless, "wing"), rule: "bighats" };
    const state = RAID.decode(JSON.stringify(text));
    const run = state?.endless;
    expect(run?.wing).toBeNull();
    expect(run ? rulePick(run)?.options : []).toHaveLength(2);
    if (!state) throw new Error("does not read");
    // The pick is shown to the page as it is.
    const waiting = readView(JSON.parse(JSON.stringify(RAID.view(state, ctx()))))?.endless;
    expect(waiting ? rulePick(waiting)?.options : []).toEqual(run ? rulePick(run)?.options : []);
    taken = must(state, { do: "choose", option: 0, slot: "endless" });
    expect(taken.endless?.wing?.at).toBe(wingOf(taken.endless?.room ?? 0));
    // Shown to the page, a rule it does not know is a view it could not have been sent.
    const view = JSON.parse(JSON.stringify(RAID.view(taken, ctx())));
    expect(readView(view)?.endless?.wing?.at).toBe(wingOf(taken.endless?.room ?? 0));
    view.endless.wing.rule = "bighats";
    expect(readView(view)).toBeNull();
  });
});
