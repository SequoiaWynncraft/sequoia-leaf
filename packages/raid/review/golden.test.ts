import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";

import { type Ctx, isRefused } from "@sequoia-leaf/core";
import type { Habit } from "@sequoia-leaf/raid/bot.ts";
import { ENDLESS } from "@sequoia-leaf/raid/content/endless.ts";
import { boardMet } from "@sequoia-leaf/raid/foe.ts";
import { readFight } from "@sequoia-leaf/raid/fought.ts";
import { RAID, type Table } from "@sequoia-leaf/raid/game.ts";
import { picksOf } from "@sequoia-leaf/raid/run.ts";
import { advance } from "@sequoia-leaf/raid/sitting/clock.ts";
import { decodeSitting, encodeSitting } from "@sequoia-leaf/raid/sitting/keep.ts";
import { CAT } from "@sequoia-leaf/raid/testkit.ts";

import {
  differences,
  fightLines,
  goldenSetup,
  HABITS,
  keysNow,
  type Line,
  pinned,
  type Pins,
  readPins,
  rowName,
  runLines,
  Seen,
  SHAPES,
  sittingGoldens,
  STORED,
  VERSIONS,
  written,
  writtenPins,
  writtenPool,
} from "./golden.ts";

/**
 * The goldens (`golden.ts`) against what the rules do now. A golden that differs fails with a line
 * for each difference: regenerate with `bun review/golden.ts --write`, and say why in the PR.
 */
const seen = new Seen();
const pool = writtenPool();
const played = new Map<string, Line[]>();
const runsOf = (habit: Habit): Line[] => {
  const lines = played.get(habit.name) ?? runLines(habit, seen);
  played.set(habit.name, lines);
  return lines;
};
const sittings: Line[] = [];
const sittingsNow = (): Line[] => {
  if (sittings.length === 0) sittings.push(...sittingGoldens(seen));
  return sittings;
};

describe("the golden fights", () => {
  test("each plays as written, its setup and every event", () => {
    expect(differences(written("fights"), fightLines(pool))).toEqual([]);
  });
  test("between them field every figure, trouble, item and fight boon of the pool", () => {
    const setups = Array.from({ length: 500 }, (_, n) => goldenSetup(pool, n));
    const figures = setups.flatMap((s) => s.sides.flatMap((p) => p.figures));
    const fielded = new Set<string>([...figures.map((p) => p.kind), ...figures.flatMap((p) => p.items)]);
    const brought = new Set<string>(setups.flatMap((s) => s.sides.flatMap((p) => p.boons)));
    const items = [...pool.components, ...pool.finished, ...Object.keys(pool.emblems)];
    expect([...pool.figures, ...pool.troubles, ...items].filter((id) => !fielded.has(id))).toEqual([]);
    expect(pool.boons.filter((id) => !brought.has(id))).toEqual([]);
    expect(figures.some((p) => (p.level ?? 0) > 0) && figures.some((p) => p.fed > 0)).toBe(true);
  });
});

describe("the golden runs", () => {
  test.each(HABITS.map((h): [string, Habit] => [h.name, h]))(
    "100 runs of the %s bot play as written",
    (name, habit) => {
      const was = written("runs").filter((l) => l.id.startsWith(`run ${name} `));
      expect(differences(was, runsOf(habit))).toEqual([]);
    },
  );
  test("are of every habit the bot has, and no other", () => {
    const names = new Set(written("runs").map((l) => l.id.split(" ")[1]));
    expect([...names]).toEqual(HABITS.map((h) => h.name));
  });
});

describe("the golden sittings", () => {
  test("eight regulars, and two members beside six regulars, go as written to the end", () => {
    expect(differences(written("sittings"), sittingsNow())).toEqual([]);
  });
});

describe("the keys each stored shape is written with", () => {
  test("are pinned beside its version, and are the keys pinned there", () => {
    for (const habit of HABITS) runsOf(habit);
    sittingsNow();
    const pins = writtenPins();
    expect(SHAPES.filter((shape) => !pins.get(shape)?.has(VERSIONS[shape]))).toEqual([]);
    expect(pinned(pins, keysNow(seen)).refused).toEqual([]);
  });
  test("moved under the same version are refused; under a new one they are pinned beside the old", () => {
    const keys = new Map(SHAPES.map((shape) => [shape, ["a", "b"]]));
    const was: Pins = new Map(SHAPES.map((shape) => [shape, new Map([[VERSIONS[shape], ["a", "b"]]])]));
    expect(pinned(was, keys).refused).toEqual([]);
    const gained = pinned(was, new Map([...keys, ["table", ["a", "b", "c"]]]));
    expect(gained.refused).toEqual([
      `table is written with other keys at version ${VERSIONS.table} (+c): a stored shape that changes takes a new version`,
    ]);
    const older: Pins = new Map([...was, ["table", new Map([[VERSIONS.table - 1, ["a"]]])]]);
    const next = pinned(older, new Map([...keys, ["table", ["a", "b", "c"]]]));
    expect(next.refused).toEqual([]);
    expect([...(next.pins.get("table") ?? [])]).toEqual([
      [VERSIONS.table - 1, ["a"]],
      [VERSIONS.table, ["a", "b", "c"]],
    ]);
    expect(readPins("table 3\n  a\n  b\nsitting 1\n  c\n")).toEqual(
      new Map([
        ["table", new Map([[3, ["a", "b"]]])],
        ["sitting", new Map([[1, ["c"]]])],
      ]),
    );
  });
});

const rows = (shape: string): [string, string][] =>
  readdirSync(STORED)
    .filter((name) => name.startsWith(`${shape}-v`))
    .map((name): [string, string] => [name, readFileSync(new URL(name, STORED), "utf8")]);
const ctx = (seed = 7): Ctx => ({
  now: Date.UTC(2026, 10, 28),
  player: { id: "00000000-0000-4000-8000-00000000601d", guest: false },
  seed,
  room: 1e9,
  awards: [],
  postcards: {},
});
const read = (text: string): Table => {
  const table = RAID.decode(text);
  if (!table) throw new Error("does not read");
  return table;
};
const met = (data: unknown) => ({
  player: "00000000-0000-4000-8000-0000000060d2",
  name: "Another member",
  data,
  of: 1,
});

describe("every row the goldens keep", () => {
  test("is there for every case at every version the goldens see", () => {
    for (const habit of HABITS) runsOf(habit);
    sittingsNow();
    expect([...seen.rows.keys()].filter((name) => !existsSync(new URL(name, STORED)))).toEqual([]);
    expect(rowName("sitting", "open")).toBe(`sitting-v${VERSIONS.sitting}-open.json`);
  });
  test.each(rows("table"))("%s reads, reads the same once stored again, and plays on", (_, text) => {
    const table = read(text);
    expect(read(RAID.encode(table))).toEqual(table);
    const view = RAID.view(table, ctx());
    const run = view.held.main ?? view.held.endless;
    if (!run) throw new Error("a table row with no run");
    const aim = view.held.main ? {} : { endless: true };
    const next = run.stage.phase === "fight" ? "take" : picksOf(run).length > 0 ? "choose" : "fight";
    const c = RAID.command({ do: next, option: 0, ...aim });
    if (!c) throw new Error("no command");
    const done = RAID.apply(table, c, ctx());
    expect(isRefused(done) ? done.refused : "done").toBe("done");
  });
  test.each(rows("sitting"))(
    "%s reads, reads the same once stored again, and goes on to its next deadline",
    (name, text) => {
      const t = decodeSitting(text);
      if (!t) throw new Error("does not read");
      expect(decodeSitting(encodeSitting(t))).toEqual(t);
      if (name.includes("past-room-15")) expect(t.room).toBeGreaterThanOrEqual(15);
      const next = advance(t, t.stage.at === "over" ? t.stage.ended : t.stage.until);
      expect(decodeSitting(encodeSitting(next))).toEqual(next);
    },
  );
  test.each(rows("fight"))(
    "%s reads as Leaf reads a fight, and the same; one kept before records said their course, pool and era, with those its way said",
    (_, text) => {
      const row: Record<string, unknown> = JSON.parse(text);
      const said = { main: ["trail", "fair"], own: ["trail", "own"], wilds: ["wilds", "fair"], deep: ["deep", "fair"] };
      const [course, whose] = Object.entries(said).find(([way]) => way === row.way)?.[1] ?? [];
      const older = row.course === undefined ? { course, pool: whose, era: CAT.era } : {};
      const kept: unknown = readFight(row);
      expect(kept).toEqual({ ...row, ...older });
    },
  );
  test.each(rows("board"))("%s is met as a board, with levels only on a lane that keeps them", (name, text) => {
    const data: unknown = JSON.parse(text);
    if (name.includes("-own")) {
      expect(boardMet(CAT, met(data), true)?.figures.some((p) => (p.level ?? 0) > 0)).toBe(true);
    } else {
      const board = boardMet(CAT, met(data), false, name.includes("-held") ? ENDLESS.chairs : 0);
      expect(board?.figures.length).toBeGreaterThan(0);
      expect(board?.figures.some((p) => p.level !== undefined)).toBe(false);
    }
  });
  test.each(rows("depth"))("%s is a room, counting from 1", (_, text) => {
    const { room }: { room: unknown } = JSON.parse(text);
    expect(Number.isInteger(room) && typeof room === "number" && room >= 1).toBe(true);
  });
});

describe("how goldens differ", () => {
  test("a line a golden: changed in words, changed in a hash only, new, gone", () => {
    const was: Line[] = [
      { id: "a", says: "won", hashes: "setup 1 fight 2" },
      { id: "b", says: "lost", hashes: "setup 1 fight 2" },
      { id: "c", says: "lost", hashes: "setup 1 fight 2" },
    ];
    const now: Line[] = [
      { id: "a", says: "lost", hashes: "setup 1 fight 3" },
      { id: "b", says: "lost", hashes: "setup 1 fight 3" },
      { id: "d", says: "won", hashes: "setup 4 fight 5" },
    ];
    expect(differences(was, now)).toEqual([
      "  a: won -> lost",
      "  b: lost (fight differs)",
      "+ d | won | setup 4 fight 5",
      "- c | lost | setup 1 fight 2",
    ]);
  });
});
