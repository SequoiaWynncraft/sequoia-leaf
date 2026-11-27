import { describe, expect, test } from "bun:test";

import { type Ctx, isRefused } from "@sequoia-leaf/core";

import { SENSIBLE } from "./bot.ts";
import { COMMANDS, isPlanning, isPredicted, type RaidCommand, type RunCommand } from "./command.ts";
import { planCommands, predict, RAID, readCommand, type Table } from "./game.ts";
import type { Run } from "./run.ts";
import { advance } from "./sitting/clock.ts";
import { type Call, command, openSitting, readCommand as readSeatCommand } from "./sitting/commands.ts";
import type { Sitting } from "./sitting/sitting.ts";
import { predict as predictSeat, sittingView } from "./sitting/view.ts";
import { EVERY_COMMAND } from "./testkit.ts";

/** Leaf's word on a call to the table, with the dice it is given. */
const at = (seed: number): Ctx => ({
  now: 1_800_000_000_000,
  player: { id: "10000000-0000-0000-0000-00000000c0dd", guest: false },
  seed,
  room: 1e9,
  awards: [],
  postcards: {},
});
/** A command as it comes off the wire: plain JSON. */
const wire = (v: object): unknown => JSON.parse(JSON.stringify(v));
/** What a command of a run is, by its spec. */
const specOf = (c: RunCommand) => COMMANDS[c.do];
const EVERY = Object.values(EVERY_COMMAND);
/** A value named, so that a failing comparison says which command it was. */
const named = (name: unknown, v: unknown): unknown => [name, v];
/** A table's command off the wire. */
const read = (v: object): RaidCommand | null => readCommand(wire(v));

function done(table: Table, c: RaidCommand, seed: number): Table {
  const answer = RAID.apply(table, c, at(seed));
  if (isRefused(answer)) throw new Error(`${c.do} was refused: ${answer.refused}`);
  return answer.state;
}
/** A table with a run on the first trail and one in the Deep Woods, each made ready for a command. */
function tableFor(ready: (run: Run) => void): Table {
  const opened = done(done(RAID.create(at(1)), { do: "start", trail: 0 }, 2), { do: "start", course: "deep" }, 3);
  const t = structuredClone(opened);
  for (const run of [t.held.main, t.held.endless]) if (run) ready(run);
  return t;
}

const ME = { id: "10000000-0000-0000-0000-00000000c0de", name: "Mossback" };
const call = (now: number, seed: number): Call => ({ now, seed, player: ME });
/** The member and seven regulars at the first room's planning, the member's run made ready for a command. */
function seatFor(ready: (run: Run) => void): Sitting {
  const started = command(openSitting(call(0, 3)), { do: "start" }, call(1000, 4));
  if (!started.ok) throw new Error(started.why);
  let t = started.sitting;
  for (let guard = 0; guard < 10 && t.stage.at !== "plan"; guard++)
    t = advance(t, "until" in t.stage ? t.stage.until : 0);
  const mine = structuredClone(t);
  const seat = mine.seats[0];
  if (mine.stage.at !== "plan" || seat?.who.is !== "member") throw new Error("the member is not planning");
  ready(seat.run);
  return mine;
}
const planningUntil = (t: Sitting): number => (t.stage.at === "plan" ? t.stage.until : 0);

describe("every command of a run, at every kind of table", () => {
  test("is read off the wire, aimed at the main run or the endless run, done, and predicted when it draws nothing", () => {
    for (const { c, ready } of EVERY) {
      const spec = specOf(c);
      for (const slot of ["main", "endless"] as const) {
        const t = tableFor(ready);
        const aimed: RaidCommand = slot === "main" ? c : { ...c, slot };
        const said =
          slot === "main"
            ? [c, { ...c, slot }]
            : [
                { ...c, slot },
                { ...c, endless: true },
              ];
        for (const w of said) expect([c.do, slot, readCommand(wire({ id: "c-1", ...w }))]).toEqual([c.do, slot, aimed]);
        const answer = RAID.apply(t, aimed, at(9));
        if (isRefused(answer)) throw new Error(`${c.do} at the ${slot} run was refused: ${answer.refused}`);
        // The other run is as it was, but for Leaf's dice, which are stirred into every run's.
        const other = slot === "main" ? "endless" : "main";
        expect({ ...answer.state.held[other], rng: 0 }).toEqual({ ...t.held[other], rng: 0 });
        const guess = predict(RAID.view(t, at(9)), aimed);
        const leafs = { view: RAID.view(answer.state, at(9)), notes: answer.notes };
        expect(named([c.do, slot], guess)).toEqual(named([c.do, slot], spec.draws ? null : leafs));
      }
    }
  });

  test("a planning command is read, done and predicted at a seat; the clock's are not read there, however aimed", () => {
    for (const { c, ready } of EVERY) {
      const spec = specOf(c);
      const said = [c, { ...c, slot: "endless" }, { ...c, endless: true }];
      if (spec.whose === "clock") {
        for (const w of said) expect([c.do, readSeatCommand(wire(w))]).toEqual([c.do, null]);
        continue;
      }
      const t = seatFor(ready);
      const seated = readSeatCommand(wire({ id: "c-1", ...c }));
      expect(named(c.do, seated)).toEqual(named(c.do, c));
      if (!seated) continue;
      const answer = command(t, seated, call(planningUntil(t) - 5000, 9));
      if (!answer.ok) throw new Error(`${c.do} at a seat was refused: ${answer.code}`);
      const guess = predictSeat(sittingView(t, ME.id), seated);
      const leafs = { view: sittingView(answer.sitting, ME.id), notes: answer.notes };
      expect(named(c.do, guess)).toEqual(named(c.do, spec.draws ? null : leafs));
    }
  });

  test("what a member plans with is every command but the fight, the takings and walking home; the page predicts only planning", () => {
    const planning = new Set(EVERY.filter(({ c }) => isPlanning(c)).map(({ c }) => c.do));
    expect(EVERY.filter(({ c }) => !isPlanning(c)).map(({ c }) => c.do)).toEqual(["fight", "take", "abandon"]);
    expect(EVERY.filter(({ c }) => isPredicted(c)).every(({ c }) => planning.has(c.do))).toBe(true);
    expect(Object.keys(COMMANDS)).toEqual(Object.keys(EVERY_COMMAND));
  });

  test("the bot's commands for the endless run say its slot, and read back as themselves", () => {
    const t = tableFor(EVERY_COMMAND.buy.ready);
    const commands = planCommands(RAID.view(t, at(9)), SENSIBLE, "endless");
    expect(commands.length).toBeGreaterThan(0);
    for (const c of commands) {
      expect("slot" in c && c.slot).toBe("endless");
      expect(readCommand(wire(c))).toEqual(c);
    }
  });
});

describe("setting out and aiming, off the wire", () => {
  test("says a course and is read as one, and the old ways of saying it still are", () => {
    expect(read({ do: "start", course: "trail", trail: 1 })).toEqual({ do: "start", trail: 1 });
    expect(read({ do: "start", course: "trail", trail: 1, own: true })).toEqual({ do: "start", trail: 1, own: true });
    expect(read({ do: "start", course: "deep", trail: 2 })).toEqual({ do: "start", course: "deep" });
    expect(read({ do: "start", course: "wilds", own: true })).toEqual({ do: "start", course: "wilds", own: true });
    // As pages before courses sent them.
    expect(read({ do: "start", trail: 1, own: true })).toEqual({ do: "start", trail: 1, own: true });
    expect(read({ do: "endless", way: "wilds" })).toEqual({ do: "start", course: "wilds" });
    expect(read({ do: "buy", offer: 1, endless: true })).toEqual({ do: "buy", offer: 1, slot: "endless" });
    expect(read({ do: "buy", offer: 1, slot: "main", endless: true })).toEqual({ do: "buy", offer: 1 });
    for (const bad of [
      { do: "start", course: "versus" },
      { do: "start", course: "trail" },
      { do: "endless", way: "trail", trail: 0 },
      { do: "buy", offer: 1, slot: "seat" },
      { do: "buy", offer: 1, slot: 1 },
    ]) {
      expect([bad, read(bad)]).toEqual([bad, null]);
    }
  });

  test("an old way of saying a command does at Leaf exactly what the new one does", () => {
    const fresh = RAID.create(at(1));
    const fighting = tableFor(EVERY_COMMAND.fight.ready);
    const pairs: [Table, object, object][] = [
      [fresh, { do: "endless", way: "wilds" }, { do: "start", course: "wilds" }],
      [fresh, { do: "start", trail: 0, own: true }, { do: "start", course: "trail", trail: 0, own: true }],
      [fighting, { do: "fight", endless: true }, { do: "fight", slot: "endless" }],
    ];
    const answer = (t: Table, v: object) => {
      const c = readCommand(wire(v));
      return c && RAID.apply(t, c, { ...at(9), awards: ["pull:figure:crab7"] });
    };
    for (const [t, old, now] of pairs) {
      const was = answer(t, old);
      expect([now, was !== null && !isRefused(was)]).toEqual([now, true]);
      expect(was).toEqual(answer(t, now));
    }
  });
});
