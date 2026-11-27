/** Feeding Greg: the command, its refusals, what Greg keeps, the bot doing it, and runs kept when Greg ate after every fight. */
import { describe, expect, test } from "bun:test";

import type { Ctx } from "@sequoia-leaf/core";

import { planRoom, SENSIBLE } from "./bot.ts";
import type { RunCommand } from "./command.ts";
import type { FigureId, Stars } from "./content/figures.ts";
import type { ItemId } from "./content/items.ts";
import { LEGACY_ERA } from "./content/releases.ts";
import { traitNumber, traitShort, traitText } from "./content/traits.ts";
import { feed } from "./feed.ts";
import {
  applyCommand,
  decodeTable,
  encodeTable,
  newTable,
  predict,
  readCommand,
  TABLE_VERSION,
  tableView,
} from "./game.ts";
import { merge, type Note, type Piece, pieces, type Run, sell, type Spot, startRun } from "./run.ts";
import { checkRun } from "./save.ts";
import { advance } from "./sitting/clock.ts";
import { command, openSitting, readCommand as readSittingCommand } from "./sitting/commands.ts";
import { decodeSitting, encodeSitting, SITTING_VERSION } from "./sitting/keep.ts";
import type { Sitting } from "./sitting/sitting.ts";

const MOST = traitNumber("greg", "most", 1);
const board = (at: number): Spot => ({ on: "board", at });
const bench = (at: number): Spot => ({ on: "bench", at });

/** A run planning its first room with nothing waiting to be chosen and nothing on the board. */
function planning(seed = 1): Run {
  const run = startRun(seed, { era: LEGACY_ERA });
  run.stage = { phase: "plan", picks: [] };
  return run;
}
function put(run: Run, spot: Spot, kind: FigureId, stars: Stars = 1, items: ItemId[] = [], fed = 0): Piece {
  const piece: Piece = { id: run.nextId++, kind, stars, items, fed };
  (spot.on === "board" ? run.board : run.bench)[spot.at] = piece;
  return piece;
}
const codeOf = (done: ReturnType<typeof feed>): string => (done.ok ? "ok" : done.code);
const ONE = { id: "m1", name: "One" };
/** A live table of one member and seven regulars, brought on to its first planning, and the member's run there. */
function sittingPlanning(): { t: Sitting; run: Run } {
  const opened = command(
    openSitting({ now: 0, seed: 3, player: ONE }),
    { do: "start" },
    { now: 1, seed: 4, player: ONE },
  );
  if (!opened.ok) throw new Error(opened.why);
  let t = opened.sitting;
  for (let guard = 0; guard < 20 && t.stage.at !== "plan"; guard++)
    t = advance(t, t.stage.at === "over" ? t.stage.ended : t.stage.until);
  const run = t.seats.find((s) => s.who.is === "member")?.run;
  if (!run || t.stage.at !== "plan") throw new Error("no planning");
  return { t, run };
}

describe("feeding Greg", () => {
  test("he eats a figure from the bench and gains 2% health for good for each acorn of its price; it is gone, and no acorns come back", () => {
    const run = planning();
    const greg = put(run, board(3), "greg");
    const worm = put(run, bench(0), "worm");
    const acorns = run.acorns;
    const done = feed(run, bench(0), board(3));
    expect(done).toEqual({
      ok: true,
      notes: [
        {
          t: "fed",
          piece: greg.id,
          fed: 2,
          gained: 2,
          ate: worm.id,
          kind: "worm",
          stars: 1,
          from: bench(0),
          items: [],
        },
      ],
    });
    expect(greg.fed).toBe(2);
    expect(run.bench[0]).toBeNull();
    expect(run.acorns).toBe(acorns);
    // A figure's price is its cost times its copies: a two-star of one-acorn figures is 3, a five-acorn figure 5.
    put(run, bench(1), "moth", 2);
    put(run, bench(2), "hearthcat");
    expect(feed(run, bench(1), board(3)).ok && greg.fed).toBe(2 + 3 * 2);
    expect(feed(run, bench(2), board(3)).ok && greg.fed).toBe(2 + 6 + 5 * 2);
  });
  test("Greg may eat from the bench himself", () => {
    const run = planning();
    const greg = put(run, bench(4), "greg");
    put(run, bench(0), "slug");
    expect(feed(run, bench(0), bench(4)).ok).toBe(true);
    expect(greg.fed).toBe(4);
  });
  test("up to 40%, and then he is full", () => {
    const run = planning();
    put(run, board(3), "greg", 1, [], MOST - 1);
    put(run, bench(0), "badger");
    const done = feed(run, bench(0), board(3));
    expect(done.ok && done.notes[0]).toMatchObject({ t: "fed", gained: 1, fed: MOST });
    put(run, bench(1), "worm");
    expect(codeOf(feed(run, bench(1), board(3)))).toBe("greg_full");
    expect(run.bench[1]?.kind).toBe("worm");
  });
  test("what the eaten figure held goes back to the rack, as selling sends it", () => {
    const run = planning();
    put(run, board(3), "greg");
    run.items = ["bark"];
    put(run, bench(0), "crab7", 1, ["wasptail", "glowcap"]);
    const done = feed(run, bench(0), board(3));
    expect(done.ok && done.notes[0]).toMatchObject({ items: ["wasptail", "glowcap"] });
    expect(run.items).toEqual(["bark", "wasptail", "glowcap"]);
  });
  test("turned down: from the board, nobody there, no such place, anyone but Greg eating, a Greg eaten, and outside planning", () => {
    const run = planning();
    put(run, board(3), "greg");
    put(run, board(4), "worm");
    put(run, bench(0), "moth");
    put(run, bench(1), "greg");
    expect(codeOf(feed(run, board(4), board(3)))).toBe("not_from_bench");
    expect(codeOf(feed(run, bench(5), board(3)))).toBe("nobody_there");
    expect(codeOf(feed(run, bench(0), board(6)))).toBe("nobody_there");
    expect(codeOf(feed(run, bench(40), board(3)))).toBe("no_such_place");
    expect(codeOf(feed(run, bench(0), board(4)))).toBe("not_greg");
    expect(codeOf(feed(run, bench(1), board(3)))).toBe("greg_on_greg");
    run.stage = { phase: "over", ending: "lost" };
    expect(codeOf(feed(run, bench(0), board(3)))).toBe("raid_over");
    expect(pieces(run)).toHaveLength(4);
  });
  test("Gregs merging into a star keep the sum of what they had gained, up to 40%; selling Greg loses it", () => {
    const run = planning();
    const keep = put(run, board(3), "greg", 1, [], 12);
    put(run, bench(0), "greg", 1, [], 10);
    put(run, bench(1), "greg", 1, [], 0);
    const notes: Note[] = [];
    merge(run, null, notes);
    expect(keep.stars).toBe(2);
    expect(keep.fed).toBe(22);
    put(run, bench(0), "greg", 2, [], 30);
    put(run, bench(1), "greg", 2, [], 30);
    merge(run, null, notes);
    expect(keep.stars).toBe(3);
    expect(keep.fed).toBe(MOST);
    put(run, bench(2), "worm");
    expect(sell(run, board(3)).ok).toBe(true);
    expect(pieces(run).some((p) => p.kind === "greg")).toBe(false);
  });
});

const ctx = (seed = 7): Ctx => ({
  now: 1_800_000_000_000,
  player: { id: "10000000-0000-0000-0000-000000000001", guest: false },
  seed,
  room: 1e9,
  awards: [],
  postcards: {},
});

describe("the feed command", () => {
  test("reads off the wire, for the run in hand or the endless run, and for a seat at a live table", () => {
    const c: Extract<RunCommand, { do: "feed" }> = { do: "feed", from: bench(0), to: board(3) };
    expect(readCommand(c)).toEqual(c);
    expect(readCommand({ ...c, slot: "endless" })).toEqual({ ...c, slot: "endless" });
    expect(readCommand({ ...c, endless: true })).toEqual({ ...c, slot: "endless" });
    expect(readCommand({ do: "feed", from: bench(0) })).toBeNull();
    expect(readSittingCommand(c)).toEqual(c);
  });
  test("the table does it to the run in hand or the endless run, and the page may show it before Leaf answers", () => {
    for (const endless of [false, true]) {
      const table = newTable(ctx());
      const run = planning();
      run.endless = endless ? "wilds" : null;
      run.record = [{ room: 0, kind: "trouble", result: "win", standing: [1, 0], boss: null }];
      const greg = put(run, board(3), "greg");
      put(run, bench(0), "worm");
      table[endless ? "endless" : "run"] = run;
      const c = endless
        ? ({ do: "feed", from: bench(0), to: board(3), slot: "endless" } as const)
        : ({ do: "feed", from: bench(0), to: board(3) } as const);
      const shown = predict(tableView(table, ctx()), c);
      expect(shown && "view" in shown && (endless ? shown.view.endless : shown.view.run)?.board[3]?.fed).toBe(2);
      const done = applyCommand(table, c, ctx());
      expect("state" in done && (endless ? done.state.endless : done.state.run)?.board[3]?.fed).toBe(2);
      expect(greg.fed).toBe(0);
    }
  });
  test("a seat at a live table feeds its own Greg", () => {
    const { t, run } = sittingPlanning();
    run.stage = { phase: "plan", picks: [] };
    const greg = put(run, bench(5), "greg");
    put(run, bench(0), "worm");
    const now = t.stage.at === "plan" ? t.stage.until - 1 : 0;
    const fed = command(t, { do: "feed", from: bench(0), to: bench(5) }, { now, seed: 5, player: ONE });
    if (!fed.ok) throw new Error(fed.why);
    expect(fed.sitting.seats.find((s) => s.who.is === "member")?.run.bench[5]?.fed).toBe(2);
    expect(greg.fed).toBe(0);
  });
});

describe("the bot", () => {
  test("feeds Greg the figures it would otherwise sell, while he can still eat", () => {
    const run = planning(9);
    run.acorns = 0;
    run.stall = run.stall.map(() => null);
    const greg = put(run, board(3), "greg");
    const spare: FigureId[] = ["emberkit", "finch", "crab7", "barrowgnome", "mossmote", "moth", "worm"];
    spare.forEach((kind, slot) => put(run, bench(slot), kind));
    planRoom(run, SENSIBLE);
    const gone = spare.length - run.bench.filter((p) => p !== null).length;
    expect(gone).toBeGreaterThan(0);
    expect(greg.fed).toBe(2 * gone);
    expect(run.acorns).toBe(0);
  });
});

/** A run as kept, with Greg on the board having eaten `fed` (as meals, or as a share). */
function kept(fed: number): unknown {
  const run = planning();
  put(run, board(3), "greg", 1, [], fed);
  return JSON.parse(JSON.stringify(run));
}
const gregOf = (loaded: ReturnType<typeof checkRun>): number => (loaded.ok ? (loaded.run.board[3]?.fed ?? -1) : -1);
/** What the member's Greg on the bench at a live table has eaten, read back from the text kept. */
const benchOf = (text: string): number =>
  decodeSitting(text)?.seats.find((s) => s.who.is === "member")?.run.bench[8]?.fed ?? -1;

test("Greg's card and almanac say a meal is worth its price, its cost times its copies, not what was paid", () => {
  expect(traitText("greg", 1)).toContain("for each acorn of its price (its cost times its copies)");
  expect(traitShort("greg", 1)).toBe("Eats: +2% health per acorn of price, up to 40%.");
});

/** What the Greg in a run's parties has eaten: who waits in the room, then each side of the last fight. */
const fedIn = (loaded: ReturnType<typeof checkRun>): number[] =>
  loaded.ok ? [loaded.run.foe, ...(loaded.run.last?.sides ?? [])].map((p) => p.figures[0]?.fed ?? -1) : [];
/** What the Greg on the board the member's seat shows across the table has eaten, read back from the text kept. */
const shownOf = (text: string): number =>
  decodeSitting(text)?.seats.find((s) => s.who.is === "member")?.shown.figures[0]?.fed ?? -1;

describe("a run kept when Greg ate after every fight", () => {
  test("each meal is the 3% it gave him, never more than 40%; a run kept since is read as it is", () => {
    expect(gregOf(checkRun(kept(10), false, true))).toBe(30);
    expect(gregOf(checkRun(kept(10), false, false))).toBe(10);
    expect(gregOf(checkRun(kept(20), false, true))).toBe(MOST);
    expect(gregOf(checkRun(kept(30), false, false))).toBe(30);
  });
  test("a table of version 4 (the Wilds' wing, before feeding) is read as meals and kept as a share: read again, it is the same", () => {
    const table = newTable({ seed: 3, now: 0 });
    const run = planning();
    run.record = [{ room: 0, kind: "trouble", result: "win", standing: [1, 0], boss: null }];
    put(run, board(3), "greg", 1, [], 10);
    table.run = run;
    table.runs = 1;
    const text = encodeTable(table);
    for (const before of [4, 3]) {
      const stored = text.replace(`"v":${TABLE_VERSION}`, `"v":${before}`);
      expect(stored).not.toBe(text);
      const old = decodeTable(stored);
      expect(old?.run?.board[3]?.fed).toBe(30);
      expect(decodeTable(encodeTable(old ?? table))?.run?.board[3]?.fed).toBe(30);
    }
    expect(decodeTable(text)?.run?.board[3]?.fed).toBe(10);
  });
  test("so is a sitting of version 1", () => {
    const { t, run } = sittingPlanning();
    put(run, bench(8), "greg", 1, [], 10);
    const text = encodeSitting(t);
    expect(benchOf(text)).toBe(10);
    expect(benchOf(text.replace(`"v":${SITTING_VERSION}`, '"v":1'))).toBe(30);
  });
  test("so is a Greg in the run's parties: who waits in the room, and the last fight's sides", () => {
    const greg = { kind: "greg" as const, stars: 1 as const, seat: 3, items: [], fed: 10 };
    const party = { who: "Greg", title: "brought Moss Bulwarks", figures: [greg], boons: [], might: 100 };
    const run = planning();
    put(run, board(3), "worm");
    run.foe = party;
    run.last = { seed: 1, era: LEGACY_ERA, sides: [party, party] };
    const raw = JSON.parse(JSON.stringify(run));
    expect(fedIn(checkRun(raw, false, true))).toEqual([30, 30, 30]);
    expect(fedIn(checkRun(raw, false, false))).toEqual([10, 10, 10]);
  });
  test("and the board a seat of a sitting of version 1 shows across the table", () => {
    const { t } = sittingPlanning();
    const seat = t.seats.find((s) => s.who.is === "member");
    if (!seat) throw new Error("no member");
    seat.shown = { ...seat.shown, figures: [{ kind: "greg", stars: 1, seat: 3, items: [], fed: 10 }] };
    const text = encodeSitting(t);
    expect(shownOf(text)).toBe(10);
    expect(shownOf(text.replace(`"v":${SITTING_VERSION}`, '"v":1'))).toBe(30);
  });
});
