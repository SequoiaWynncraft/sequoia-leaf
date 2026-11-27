import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";

import { type Ctx, isRefused } from "@sequoia-leaf/core";

import { everyFigure } from "./content/catalog.ts";
import { figureIn } from "./content/figures.ts";
import { HOLDS } from "./content/items.ts";
import { LEGACY_ERA } from "./content/releases.ts";
import { ECONOMY, MAX_LEVEL, TRAIL_COUNT } from "./content/rooms.ts";
import { traitNumber } from "./content/traits.ts";
import { RAID, type Table, TABLE_VERSION } from "./game.ts";
import { addRoom, KEPT_ROOMS, noRooms, type RoomRecord, roomsFought, totalsOf } from "./record.ts";
import { type Choice, type Fought, foughtOf, type Phase, picksOf, type Piece, type Run } from "./run.ts";
import { CAT } from "./testkit.ts";
import { wayOn } from "./way.ts";
import { readView } from "./wire.ts";

/**
 * Tables as Leaf stores them, made by the rules of earlier versions and frozen in `../stored`. Each
 * must read after any change to the content or the numbers: a change that breaks one needs a
 * migration where the table is read, never a player locked out of the table, its almanac or the
 * looks they bought.
 */
const STORED = new URL("../stored/", import.meta.url);
const FIXTURES = readdirSync(STORED).map((name): [string, string] => [
  name,
  readFileSync(new URL(name, STORED), "utf8"),
]);
const fixture = (name: string): string => FIXTURES.find(([n]) => n === name)?.[1] ?? "";

const ctx = (seed = 99): Ctx => ({
  now: 1_800_000_000_000,
  player: { id: "10000000-0000-0000-0000-000000000001", guest: false },
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
const runOf = (table: Table): Run => {
  if (!table.held.main) throw new Error("no run");
  return table.held.main;
};
/** A run as a table of version 1 kept it: where it stood as a phase, the picks, two flags and the fight. */
type Kept1 = Omit<Run, "stage"> & {
  phase: Phase;
  choices: Choice[];
  won: boolean;
  left: boolean;
  fight: Fought | null;
};
/** A fixture (each is of version 1) as later rules might find it: its text with `change` made to its data. */
function shifted(name: string, change: (raw: Omit<Table, "run"> & { run: Kept1 }) => void): string {
  const raw: Omit<Table, "run"> & { run: Kept1 } = JSON.parse(fixture(name));
  change(raw);
  return JSON.stringify(raw);
}

describe("every stored table kept as a fixture", () => {
  test.each(FIXTURES)("%s reads, reads the same once stored again, and plays on", (_, text) => {
    const table = read(text);
    expect(read(RAID.encode(table))).toEqual(table);
    expect(RAID.view(table, ctx())).toBeDefined();
    const run = table.held.main;
    const next = !run ? "start" : run.stage.phase === "fight" ? "take" : picksOf(run).length > 0 ? "choose" : "fight";
    const command = RAID.command({ do: next, trail: 0, option: 0 });
    if (!command) throw new Error("no command");
    const done = RAID.apply(table, command, ctx());
    expect(isRefused(done) ? done.refused : "done").toBe("done");
  });
  test("there is one for each kind of table Leaf keeps", () => {
    expect(FIXTURES.map(([name]) => name).toSorted()).toEqual([
      "endless-deep.json",
      "fighting.json",
      "long-time.json",
      "new-table.json",
      "older-run.json",
      "own-fighting.json",
      "own-member.json",
      "picks-waiting.json",
      "planning.json",
      "starter-waiting.json",
      "wilds-past-room-400.json",
      "wilds-past-room-5.json",
      "wilds-rule.json",
    ]);
  });
});

describe("a table kept with an endless run", () => {
  test("reads with the run in hand and, beside it, the endless run fighting a room held in the Deep Woods", () => {
    const table = read(fixture("endless-deep.json"));
    expect(table.held.main?.way.course.id).toBe("trail");
    expect(table.held.endless).toMatchObject({ way: wayOn({ id: "deep" }), room: 17, foe: { who: "Fernwhistle" } });
    expect(foughtOf(table.held.endless ?? runOf(table))?.setup.sides[1].by).toBe(
      "10000000-0000-0000-0000-000000000002",
    );
    expect(table.almanac.deepest.deep).toBe(18);
    const done = RAID.apply(table, { do: "take", slot: "endless" }, ctx());
    expect(isRefused(done) ? done.refused : done.state.held.endless?.room).toBe(18);
  });
});

/** The table as the page reads what Leaf shows of it, through JSON as it goes. */
const shown = (table: Table) => readView(JSON.parse(JSON.stringify(RAID.view(table, ctx()))));
/** A table's endless run, fought on a room and taken: its fight, then its takings. */
function playedOn(table: Table): Table {
  let now = table;
  for (const c of ["fight", "take"] as const) {
    const done = RAID.apply(now, { do: c, slot: "endless" }, ctx());
    if (isRefused(done)) throw new Error(`${c} was refused: ${done.refused}`);
    now = done.state;
  }
  return now;
}
/** The text of a stored table's endless run, as Leaf stores it. */
const storedEndless = (table: Table): string => JSON.stringify(JSON.parse(RAID.encode(table)).held.endless);

describe("a table kept with an endless run past its four hundredth room", () => {
  test("keeps the run, its rooms before the last hundred folded, the page reads it, and it plays on to the next room", () => {
    const table = read(fixture("wilds-past-room-400.json"));
    const run = table.held.endless;
    expect(run).toMatchObject({ way: wayOn({ id: "wilds" }), room: 401, streak: 401 });
    expect(run?.record).toHaveLength(KEPT_ROOMS);
    expect(run?.record[0]?.room).toBe(401 - KEPT_ROOMS);
    expect(run?.before).toMatchObject({ fought: 401 - KEPT_ROOMS, won: 401 - KEPT_ROOMS, lost: 0 });
    expect(shown(table)?.held.endless).toMatchObject({ room: 401, streak: 401 });
    const now = playedOn(table);
    expect(now.held.endless?.room).toBe(402);
    expect(now.held.endless && roomsFought(now.held.endless)).toBe(402);
    expect(shown(now)?.held.endless?.room).toBe(402);
    expect(read(RAID.encode(now)).held.endless?.room).toBe(402);
  });
});

/** The run past room 400, gone on to its 2,000th room, every room won, as a table of version 8 kept it: every room in full. */
function deep(): { text: string; record: RoomRecord[] } {
  const raw = JSON.parse(fixture("wilds-past-room-400.json"));
  const kept: RoomRecord[] = raw.held.endless.record;
  // Past room 400 the rooms come round as they did: room 386 to 400 again, and again.
  const record = Array.from({ length: 2000 }, (_, room): RoomRecord => {
    const like = kept[room < kept.length ? room : 386 + ((room - 386) % 15)];
    if (!like) throw new Error("the fixture's record is short");
    return { ...like, room };
  });
  raw.held.endless = { ...raw.held.endless, room: 2000, streak: 2000, record };
  return { text: JSON.stringify(raw), record };
}

describe("a table kept with an endless run of 2,000 rooms", () => {
  test("reads, every room it fought counted as its whole record counts them, and keeps the last hundred in full", () => {
    const { text, record } = deep();
    expect(text.length).toBeGreaterThan(150_000);
    const run = read(text).held.endless;
    if (!run) throw new Error("the run was let go of");
    expect(run.record).toEqual(record.slice(-KEPT_ROOMS));
    expect(roomsFought(run)).toBe(2000);
    expect(totalsOf(run)).toEqual(record.reduce((t, r) => addRoom(t, r, run.way), noRooms()));
    expect(shown(read(text))?.held.endless).toMatchObject({ room: 2000, streak: 2000, record: run.record });
  });

  test("plays a room, and is stored in under 12 KB", () => {
    const now = playedOn(read(deep().text));
    const run = now.held.endless;
    expect(run?.room).toBe(2001);
    expect(run && roomsFought(run)).toBe(2001);
    expect(run?.record).toHaveLength(KEPT_ROOMS);
    expect(storedEndless(now).length).toBeLessThan(12 * 1024);
    expect(read(RAID.encode(now))).toEqual(now);
  });

  test("goes on to a room as high as a whole number goes, and no higher", () => {
    const raw = JSON.parse(fixture("wilds-past-room-400.json"));
    const at = (room: unknown) =>
      RAID.decode(JSON.stringify({ ...raw, held: { ...raw.held, endless: { ...raw.held.endless, room } } }))?.held
        .endless?.room;
    expect(at(Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER);
    for (const room of [Number.MAX_SAFE_INTEGER + 1, -1, 401.5, "401"]) expect(at(room)).toBeUndefined();
  });
});

describe("a table kept before there were runs with the member's own figures", () => {
  test("reads with its run on the main way: no roster, and nobody with a level", () => {
    for (const [name, text] of FIXTURES) {
      const run = read(text).held.main;
      if (name.startsWith("own-") || !run) continue;
      expect(run.way.figures).toEqual({ pool: "fair" });
      const parties = [run.last, foughtOf(run)?.setup].flatMap((setup) => setup?.sides ?? []);
      expect(parties.flatMap((party) => party.figures).some((p) => "level" in p)).toBe(false);
    }
  });
});

describe("a table kept in the fight of a run with the member's own figures", () => {
  test("reads with its roster, and the fight with its levels and the outcome Leaf kept", () => {
    const run = runOf(read(fixture("own-fighting.json")));
    expect(run.way.figures).toEqual({
      pool: "own",
      roster: { crab7: 2, worm: 0, slug: 1, rock: 0, badger: 3, greg: 1 },
    });
    const fight = foughtOf(run);
    if (!fight) throw new Error("no fight");
    expect(fight.setup.sides[0].figures.map((p) => [p.kind, p.stars, p.level])).toEqual([
      ["emberkit", 2, undefined],
      ["barrowgnome", 1, undefined],
      ["rock", 1, undefined],
      ["crab7", 2, 2],
    ]);
    // Kept before figures used their abilities as they do now: today's rules play it otherwise, and
    // the page shows only its end (`playsAsKept`), with the outcome as Leaf kept it.
    const kept: { run: { stage: { fight: Fought } } } = JSON.parse(fixture("own-fighting.json"));
    expect(fight.outcome).toEqual(kept.run.stage.fight.outcome);
  });
});

describe("a table of version 1", () => {
  test("reads with where its run stands as one value: the picks waiting, or the fight with the outcome Leaf kept", () => {
    const picks: { run: Kept1 } = JSON.parse(fixture("picks-waiting.json"));
    expect(runOf(read(fixture("picks-waiting.json"))).stage).toEqual({ phase: "plan", picks: picks.run.choices });
    const fighting: { run: Kept1 } = JSON.parse(fixture("fighting.json"));
    // A fight kept before there were eras is of the era live then.
    const { fight } = fighting.run;
    if (!fight) throw new Error("the fixture fights");
    expect(foughtOf(runOf(read(fixture("fighting.json"))))).toEqual({
      ...fight,
      setup: { ...fight.setup, era: LEGACY_ERA },
    });
  });
  test("is stored again as the version now, and reads back the same", () => {
    for (const [, text] of FIXTURES) {
      const table = read(text);
      expect(JSON.parse(RAID.encode(table))).toMatchObject({ v: TABLE_VERSION });
      expect(read(RAID.encode(table))).toEqual(table);
    }
  });
});

describe("a table stored under other numbers", () => {
  test("experience past a level's step now: the levels it makes are gained", () => {
    const run = runOf(
      read(
        shifted("planning.json", (raw) => {
          raw.run.level = 2;
          raw.run.xp = (ECONOMY.levelXp[1] ?? 0) + (ECONOMY.levelXp[2] ?? 0) + 1;
        }),
      ),
    );
    expect([run.level, run.xp]).toEqual([4, 1]);
  });

  test("a level above the top now: the top, with no experience", () => {
    const run = runOf(
      read(
        shifted("planning.json", (raw) => {
          raw.run.level = MAX_LEVEL + 2;
          raw.run.xp = 7;
        }),
      ),
    );
    expect([run.level, run.xp]).toEqual([MAX_LEVEL, 0]);
  });

  test("a stall of another size: cut to today's, or filled out with empty places", () => {
    const longer = runOf(
      read(
        shifted("planning.json", (raw) => {
          raw.run.stall = [...raw.run.stall, "worm", "worm"];
        }),
      ),
    );
    expect(longer.stall).toEqual(runOf(read(fixture("planning.json"))).stall);
    const shorter = runOf(
      read(
        shifted("planning.json", (raw) => {
          raw.run.stall = raw.run.stall.slice(0, 2);
        }),
      ),
    );
    expect(shorter.stall).toHaveLength(ECONOMY.stall);
    expect(shorter.stall.slice(2)).toEqual([null, null, null]);
  });

  test("a bench of another size: filled out with empty places, or its figures past the end moved up or sold", () => {
    const base = runOf(read(fixture("planning.json")));
    const shorter = runOf(
      read(
        shifted("planning.json", (raw) => {
          raw.run.bench = raw.run.bench.slice(0, 4);
        }),
      ),
    );
    expect(shorter.bench).toHaveLength(ECONOMY.bench);
    // A bench twice as long with a figure at its far end, and every place before it taken.
    const extra: Piece = { id: base.nextId, kind: "worm", stars: 1, items: [], fed: 0 };
    const crowded = runOf(
      read(
        shifted("planning.json", (raw) => {
          raw.run.bench = [...raw.run.bench, ...raw.run.bench.map(() => null)];
          raw.run.bench[raw.run.bench.length - 1] = extra;
          raw.run.nextId += 1;
        }),
      ),
    );
    expect(crowded.bench).toHaveLength(ECONOMY.bench);
    const free = base.bench.indexOf(null);
    if (free >= 0) expect(crowded.bench[free]).toEqual(extra);
    else expect(crowded.acorns).toBe(base.acorns + figureIn(CAT, "worm").tier);
  });

  test("starters that no longer cost 1 are offered as they were", () => {
    const options = picksOf(
      runOf(
        read(
          shifted("starter-waiting.json", (raw) => {
            raw.run.choices = [{ kind: "starter", options: ["worm", "badger", "greg"] }];
          }),
        ),
      ),
    );
    expect(options).toEqual([{ kind: "starter", options: ["worm", "badger", "greg"] }]);
  });

  test("more resolve, or more boon redraws, than a run has now: as many as it has", () => {
    const run = runOf(
      read(
        shifted("picks-waiting.json", (raw) => {
          raw.run.resolve = ECONOMY.resolve + 5;
          raw.run.choices = raw.run.choices.map((c) => (c.kind === "boon" ? { ...c, redraws: 4 } : c));
        }),
      ),
    );
    expect(run.resolve).toBe(ECONOMY.resolve);
    expect(picksOf(run).find((c) => c.kind === "boon")).toMatchObject({ redraws: ECONOMY.boonRedraws });
  });

  test("a figure holding more than a figure holds now: the rest go to the item bench", () => {
    const run = runOf(
      read(
        shifted("long-time.json", (raw) => {
          const holder = raw.run.board.find((p) => p?.items.length === HOLDS);
          holder?.items.push("glowthorn");
        }),
      ),
    );
    expect(run.board.every((p) => !p || p.items.length <= HOLDS)).toBe(true);
    expect(run.rack).toEqual({ glowthorn: 1 });
  });

  test("Greg fed more than he eats now, or anybody else fed at all: as much as he eats, and nothing", () => {
    const run = runOf(
      read(
        shifted("long-time.json", (raw) => {
          const someone = raw.run.board.find((p) => p !== null);
          if (someone) someone.fed = 3;
          raw.run.bench[0] = { id: raw.run.nextId, kind: "greg", stars: 1, items: [], fed: 40 };
          raw.run.nextId += 1;
        }),
      ),
    );
    expect(run.board.find((p) => p !== null)?.fed).toBe(0);
    expect(run.bench[0]?.fed).toBe(traitNumber(CAT, "greg", "most", 1));
  });

  test("an almanac kept with another number of trails: one for each trail now", () => {
    const fewer = read(
      shifted("long-time.json", (raw) => {
        raw.almanac.bosses = raw.almanac.bosses.slice(0, 1);
        raw.almanac.best = raw.almanac.best.slice(0, 1);
      }),
    );
    expect(fewer.almanac.bosses).toHaveLength(TRAIL_COUNT);
    expect(fewer.almanac.best).toHaveLength(TRAIL_COUNT);
    expect(fewer.almanac.bosses[0]).toEqual(read(fixture("long-time.json")).almanac.bosses[0] ?? []);
    const more = read(
      shifted("long-time.json", (raw) => {
        raw.almanac.bosses = [...raw.almanac.bosses, []];
        raw.almanac.best = [...raw.almanac.best, 99];
      }),
    );
    expect(more.almanac).toEqual(read(fixture("long-time.json")).almanac);
  });

  test("a trail picked that is not open now: the first", () => {
    const table = read(
      shifted("long-time.json", (raw) => {
        raw.almanac.bosses = raw.almanac.bosses.map(() => []);
      }),
    );
    expect(table.trail).toBe(0);
  });

  test("a look worn that is not the member's now is put away for the plain one", () => {
    const table = read(
      shifted("long-time.json", (raw) => {
        raw.looks.owned = raw.looks.owned.filter((id) => id !== "jar");
      }),
    );
    expect(table.looks.lantern).toBe("iron");
    expect(table.looks.owned).not.toContain("jar");
  });
});

describe("a table whose run cannot be read", () => {
  test("is kept without the run: the almanac, the looks and the trail stand", () => {
    const whole = read(fixture("long-time.json"));
    const table = read(
      shifted("long-time.json", (raw) => {
        Object.assign(raw.run, { board: [{ id: 1, kind: "nobody", stars: 1, items: [], fed: 0 }] });
      }),
    );
    expect(table).toEqual({ ...whole, held: { ...whole.held, main: null } });
  });
});

describe("text that is not a table", () => {
  test("does not read", () => {
    for (const text of [
      "{",
      "null",
      shifted("new-table.json", (raw) => {
        Object.assign(raw, { v: 0 });
      }),
      shifted("new-table.json", (raw) => {
        raw.rng = -1;
      }),
      shifted("new-table.json", (raw) => {
        Object.assign(raw, { almanac: null });
      }),
      shifted("new-table.json", (raw) => {
        Object.assign(raw.looks, { owned: ["nothing"] });
      }),
    ]) {
      expect(RAID.decode(text)).toBeNull();
    }
    expect(everyFigure()).toContain("worm");
  });
});
