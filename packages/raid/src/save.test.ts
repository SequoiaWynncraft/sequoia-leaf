import { describe, expect, test } from "bun:test";

import { planRoom, SENSIBLE } from "./bot.ts";
import { figureIn } from "./content/figures.ts";
import { FINISHED_IDS, isEmblemId } from "./content/items.ts";
import { LEGACY_ERA } from "./content/releases.ts";
import { ECONOMY } from "./content/rooms.ts";
import { TRAIT_IDS } from "./content/traits.ts";
import { counted, countOn, kindsOn, rackOf } from "./racks.ts";
import {
  beginFight,
  buy,
  choose,
  giveItem,
  picksOf,
  pieces,
  type Run,
  rustle,
  spotOf,
  startRun,
  takeTakings,
} from "./run.ts";
import { checkRun, type Loaded } from "./save.ts";
import { CAT, EVERYONES } from "./testkit.ts";

/** A run as a table keeps it, written out and read back. */
const saveRun = (run: Run): string => JSON.stringify({ run });
const loadRun = (text: string): Loaded => checkRun(JSON.parse(text).run);
/** A run as a table kept it before the rack had tools (before version 10). */
const loadBeforeTools = (text: string): Loaded => checkRun(JSON.parse(text).run, false, false, false, false);

/** A run played by the bot up to a room, stopped in the middle of planning it. */
function midRun(seed: number, rooms: number): Run {
  const run = startRun(seed, { era: LEGACY_ERA });
  for (let i = 0; i < rooms && run.stage.phase !== "over"; i++) {
    planRoom(run, SENSIBLE);
    if (!beginFight(run).ok) break;
    takeTakings(run);
  }
  return run;
}
function reload(run: Run): Run {
  const loaded = loadRun(saveRun(run));
  if (!loaded.ok) throw new Error(loaded.why);
  return loaded.run;
}
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
/** A list read out of saved text, to change in place. */
/** A record in stored data, to change by hand. */
function recordIn(v: unknown): Record<string, unknown> {
  if (typeof v !== "object" || v === null || Array.isArray(v)) throw new Error("not a record");
  return { ...v };
}
/** A stored run's rack as a run kept it before its rack was counts: a list, under `items`. */
function asList(raw: Record<string, unknown>): void {
  const rack = recordIn(raw.rack);
  raw.items = Object.entries(rack).flatMap(([kind, n]) => Array.from({ length: Number(n) }, () => kind));
  delete raw.rack;
}
function listIn(v: unknown): unknown[] {
  if (!Array.isArray(v)) throw new Error("not a list");
  return v;
}
/** A saved run with one thing changed, as text. */
function tampered(run: Run, change: (raw: Record<string, unknown>, whole: Record<string, unknown>) => void): string {
  const whole: unknown = JSON.parse(saveRun(run));
  if (!isRecord(whole) || !isRecord(whole.run)) throw new Error("not a save");
  change(whole.run, whole);
  return JSON.stringify(whole);
}
/** Loads text that must load. */
const mustLoad = (text: string): Run => {
  const read = loadRun(text);
  if (!read.ok) throw new Error(read.why);
  return read.run;
};
/** Loads text that must be refused, and gives back the reason. */
const refused = (text: string): string => {
  const loaded = loadRun(text);
  expect(loaded.ok).toBe(false);
  return loaded.ok ? "" : loaded.why;
};

describe("saving a run", () => {
  test("a run saves to a string and loads back identical, at every point of a raid", () => {
    for (const rooms of [0, 1, 3, 6, 10]) {
      const run = midRun(31, rooms);
      const text = saveRun(run);
      expect(typeof text).toBe("string");
      expect(reload(run)).toEqual(run);
      // And saving what was loaded gives the same text again.
      expect(saveRun(reload(run))).toBe(text);
    }
  });
  test("a run saved while some figures were locked still loads, and its stall may offer anyone", () => {
    const run = midRun(19, 2);
    const old = loadRun(tampered(run, (raw) => (raw.open = ["worm", "finch", "moth"])));
    expect(old.ok && old.run).toEqual(run);
  });
  test("the last fight comes back, and a run saved before it was kept loads without one", () => {
    const run = midRun(12, 3);
    expect(run.last).not.toBeNull();
    expect(reload(run).last).toEqual(run.last);
    const old = loadRun(tampered(run, (raw) => delete raw.last));
    expect(old.ok && old.run.last).toBeNull();
    // A last fight that no longer reads is only looked back on: the run loads without it.
    const unread = loadRun(tampered(run, (raw) => (raw.last = { seed: 1, sides: [] })));
    expect(unread.ok && unread.run.last).toBeNull();
  });
  test("the streak comes back, and a run saved before streaks were kept loads with none", () => {
    const run = midRun(31, 4);
    run.streak = run.record.at(-1)?.result === "loss" ? -2 : 2;
    expect(reload(run).streak).toBe(run.streak);
    const old = loadRun(tampered(run, (raw) => delete raw.streak));
    expect(old.ok && old.run.streak).toBe(0);
    expect(old.ok && { ...old.run, streak: run.streak }).toEqual(run);
    expect(refused(tampered(run, (raw) => (raw.streak = 1.5)))).toContain("the streak");
    expect(refused(tampered(run, (raw) => (raw.streak = run.record.length + 1)))).toContain("the streak");
    expect(refused(tampered(run, (raw) => (raw.streak = -run.streak)))).toContain("the streak");
    expect(refused(tampered(startRun(3, { era: LEGACY_ERA }), (raw) => (raw.streak = 1)))).toContain("the streak");
  });
  test("the stall, the random stream and the next room all come back", () => {
    const run = midRun(8, 5);
    const back = reload(run);
    expect(back.stall).toEqual(run.stall);
    expect(back.rng).toBe(run.rng);
    expect(back.foe).toEqual(run.foe);
    expect(back.room).toBe(run.room);
    expect(back.stage).toEqual(run.stage);
  });
  test("a loaded run goes on exactly as the original would have", () => {
    const a = midRun(77, 4);
    const b = reload(a);
    for (let i = 0; i < 6 && a.stage.phase !== "over"; i++) {
      // The same actions on both: new offers, a purchase, a planned room, a fight.
      expect(rustle(b)).toEqual(rustle(a));
      expect(buy(b, 0)).toEqual(buy(a, 0));
      planRoom(a, SENSIBLE);
      planRoom(b, SENSIBLE);
      expect(beginFight(b)).toEqual(beginFight(a));
      expect(takeTakings(b)).toEqual(takeTakings(a));
      expect(b).toEqual(a);
    }
    expect(a.record.length).toBeGreaterThan(5);
  });
  test("a run saved before its first pick, and one saved in the middle of a fight, load too", () => {
    const fresh = startRun(5, { era: LEGACY_ERA });
    expect(reload(fresh)).toEqual(fresh);
    expect(picksOf(reload(fresh))[0]?.kind).toBe("starter");
    const fighting = midRun(5, 2);
    planRoom(fighting, SENSIBLE);
    const begun = beginFight(fighting);
    const back = reload(fighting);
    expect(back.stage.phase).toBe("fight");
    // The fight plays out the same from its seed, so the takings are the same.
    const original = takeTakings(fighting);
    expect(takeTakings(back)).toEqual(original);
    expect(begun.ok).toBe(true);
  });
  test("a run that has met every figure, forged every item and topped every trait loads back whole", () => {
    const run = midRun(31, 6);
    run.seen = {
      fielded: [...EVERYONES],
      threeStars: [...EVERYONES],
      forged: [...FINISHED_IDS],
      topped: [...TRAIT_IDS],
    };
    expect(reload(run)).toEqual(run);
  });
  test("a run saved when a charm counted for its kin gets the emblem on its item bench, once", () => {
    const run = midRun(12, 4);
    run.rack = rackOf(kindsOn(run.rack).filter((item) => !isEmblemId(item)));
    for (const p of pieces(run)) p.items = p.items.filter((item) => !isEmblemId(item));
    // As it was stored then: the rack as a list, the charm among the boons, no emblem anywhere, and parties with charms.
    const old = tampered(run, (raw) => {
      asList(raw);
      raw.boons = ["crabcharm"];
      if (isRecord(raw.foe)) raw.foe.charms = [];
      if (isRecord(raw.last)) for (const side of listIn(raw.last.sides)) if (isRecord(side)) side.charms = ["crab"];
    });
    const loaded = loadBeforeTools(old);
    if (!loaded.ok) throw new Error(loaded.why);
    expect(loaded.run.boons).toEqual(["crabcharm"]);
    expect(loaded.run.rack).toEqual(counted(run.rack, "crabcharm", 1));
    // Read again, it is still the one.
    const again = loadRun(saveRun(loaded.run));
    expect(again.ok && again.run.rack).toEqual(loaded.run.rack);
    // A figure holding it is somewhere it is: none is added.
    const figure = pieces(loaded.run).find((p) => figureIn(CAT, p.kind).kin !== "crab" && p.items.length < 3);
    const spot = figure ? spotOf(loaded.run, figure.id) : null;
    if (!spot) throw new Error("nobody to hold it");
    expect(giveItem(loaded.run, "crabcharm", spot).ok).toBe(true);
    const held = checkRun(JSON.parse(JSON.stringify(loaded.run)));
    expect(held.ok && countOn(held.run.rack, "crabcharm")).toBe(0);
  });
  test("a finished run loads as finished", () => {
    const run = midRun(3, 99);
    expect(run.stage.phase).toBe("over");
    expect(reload(run)).toEqual(run);
  });
});

describe("loading puts right what today's rules would not allow", () => {
  const run = midRun(12, 4);
  /** The run with a worm holding `items` on the bench's last place. */
  const worm = (items: string[], fed = 0) =>
    mustLoad(
      tampered(run, (raw) => {
        raw.boons = ["burrowcharm"];
        listIn(raw.bench)[8] = { id: run.nextId, kind: "worm", stars: 1, items, fed };
        raw.nextId = run.nextId + 1;
      }),
    );
  test("what a figure holds that it may not hold now goes to the item bench, and nobody but Greg has eaten", () => {
    const two = worm(["thorn", "plume"], 3);
    expect([two.bench[8]?.items, two.bench[8]?.fed, countOn(two.rack, "plume")]).toEqual([
      ["thorn"],
      0,
      countOn(run.rack, "plume") + 1,
    ]);
    expect(worm(["hoard", "hoard", "hoard", "hoard"]).bench[8]?.items).toEqual(["hoard", "hoard", "hoard"]);
    // A worm is a burrow kin already.
    const kin = worm(["burrowcharm"]);
    expect([kin.bench[8]?.items, countOn(kin.rack, "burrowcharm")]).toEqual([[], 1]);
  });
  test("more on the board than may be fielded now stand there: setting out is refused until one is benched", () => {
    const crowded = mustLoad(
      tampered(run, (raw) => {
        const board = listIn(raw.board);
        for (let seat = 0; seat < board.length; seat++)
          board[seat] = seat < 20 ? { id: seat + 1, kind: "worm", stars: 1, items: [], fed: 0 } : null;
        raw.nextId = 100;
        raw.bench = listIn(raw.bench).map(() => null);
      }),
    );
    expect(beginFight(crowded)).toMatchObject({ ok: false, code: "too_many_fielded" });
  });
  test("what the run drew and no longer reads is drawn again: the room is laid out afresh, and what the player has stands", () => {
    const again = [
      tampered(run, (raw) => (raw.stall = ["dragon", null, null, null, null])),
      tampered(run, (raw) => (raw.foe = { who: "x" })),
      tampered(run, (raw) => (raw.foe = { who: "x", title: "", figures: [], charms: [], boons: [], might: 100 })),
      tampered(run, (raw) => (raw.stage = { phase: "plan", picks: [{ kind: "boon", options: [], redraws: 0 }] })),
    ].map(mustLoad);
    for (const laid of again) {
      expect([laid.board, laid.bench, laid.rack, laid.acorns, laid.level, laid.room]).toEqual([
        run.board,
        run.bench,
        run.rack,
        run.acorns,
        run.level,
        run.room,
      ]);
      expect(laid.stall.every((offer) => offer === null || EVERYONES.some((id) => id === offer))).toBe(true);
      expect(laid.foe.figures.length).toBeGreaterThan(0);
    }
    const boon = again[3];
    expect(boon && picksOf(boon)).toMatchObject([{ kind: "boon", redraws: 0 }]);
    expect(boon && picksOf(boon)[0]?.options).toHaveLength(3);
  });
  test("a run in a fight that no longer reads is put back to planning the room", () => {
    const fighting = midRun(12, 4);
    expect(beginFight(fighting).ok).toBe(true);
    const back = mustLoad(
      tampered(fighting, (raw) => {
        raw.stage = { phase: "fight", fight: { setup: { seed: 1, sides: [] } } };
      }),
    );
    expect([back.stage, back.room]).toEqual([{ phase: "plan", picks: [] }, fighting.room]);
  });
  test("a stall or a bench of another size is today's size, and starters that cost more are offered as they were", () => {
    expect(mustLoad(tampered(run, (raw) => (raw.stall = [null]))).stall).toHaveLength(ECONOMY.stall);
    expect(mustLoad(tampered(run, (raw) => listIn(raw.bench).push(null))).bench).toHaveLength(ECONOMY.bench);
    const fresh = startRun(4, { era: LEGACY_ERA });
    const greg = mustLoad(
      tampered(fresh, (raw) => (raw.stage = { phase: "plan", picks: [{ kind: "starter", options: ["greg"] }] })),
    );
    expect(picksOf(greg)).toEqual([{ kind: "starter", options: ["greg"] }]);
  });
});

describe("loading refuses nonsense", () => {
  const run = midRun(12, 4);
  test("numbers out of range", () => {
    const cases: [string, unknown][] = [
      ["acorns", -1],
      ["acorns", 1.5],
      ["acorns", "lots"],
      ["resolve", -3],
      ["level", 0],
      ["room", -1],
      ["way", { course: { id: "trail", trail: 0.5 }, figures: { pool: "fair" } }],
      ["way", { course: { id: "versus" }, figures: { pool: "fair" } }],
      ["way", { course: { id: "wilds" }, figures: { pool: "own", roster: { nobody: 1 } } }],
      ["rng", -1],
      ["seed", 2 ** 32],
      ["xp", -1],
      ["stage", { phase: "napping" }],
      ["held", "yes"],
    ];
    for (const [field, value] of cases) {
      const why = refused(tampered(run, (raw) => (raw[field] = value)));
      expect(why).toContain("does not add up");
    }
  });
  test("figures, items and boons that do not exist", () => {
    expect(refused(tampered(run, (raw) => (raw.boons = ["godmode"])))).toContain("the boons");
    expect(refused(tampered(run, (raw) => (raw.rack = { thorn: 1, excalibur: 1 })))).toContain("the rack");
    expect(refused(tampered(run, (raw) => (raw.rack = ["thorn"])))).toContain("the rack");
    // A run kept with its rack as a list (before version 10).
    expect(refused(tampered(run, (raw) => ((raw.items = ["thorn", "excalibur"]), delete raw.rack)))).toContain(
      "the item bench",
    );
    const withPiece = (piece: unknown): string =>
      refused(
        tampered(run, (raw) => {
          const bench = listIn(raw.bench);
          bench[8] = piece;
        }),
      );
    expect(withPiece({ id: 1_000_000, kind: "worm", stars: 1, items: [], fed: 0 })).toContain("number");
    expect(withPiece({ id: 2, kind: "bigcrab", stars: 1, items: [], fed: 0 })).toContain("kind");
    expect(withPiece({ id: 2, kind: "worm", stars: 4, items: [], fed: 0 })).toContain("stars");
    expect(withPiece({ id: 2, kind: "worm", stars: 1, items: ["excalibur"], fed: 0 })).toContain("holds");
    expect(withPiece("a worm")).toContain("a figure");
  });
  test("a board of the wrong size, or two figures with one number", () => {
    expect(refused(tampered(run, (raw) => (raw.board = [])))).toContain("the board");
    expect(
      refused(
        tampered(run, (raw) => {
          const bench = listIn(raw.bench);
          bench[7] = { id: 1, kind: "worm", stars: 1, items: [], fed: 0 };
          bench[8] = { id: 1, kind: "worm", stars: 1, items: [], fed: 0 };
        }),
      ),
    ).toContain("numbers");
  });
  test("a choice that is no choice", () => {
    expect(
      refused(tampered(run, (raw) => (raw.stage = { phase: "plan", picks: [{ kind: "wish", options: ["worm"] }] }))),
    ).toContain("a choice");
  });
  test("an ending that contradicts itself", () => {
    expect(refused(tampered(run, (raw) => (raw.stage = { phase: "over", ending: "maybe" })))).toContain("the ending");
    expect(refused(tampered(run, (raw) => (raw.resolve = 0)))).toContain("the ending");
    expect(refused(tampered(run, (raw) => delete raw.seen))).toContain("the almanac notes");
    expect(refused(tampered(run, (raw) => delete raw.record))).toContain("the record");
  });
  test("an emblem with no charm to give it, or two of one emblem", () => {
    const stray = tampered(run, (raw) => (raw.rack = { ...recordIn(raw.rack), crabcharm: 1 }));
    const before = loadBeforeTools(stray);
    expect(!before.ok && before.why).toContain("the emblems");
    // Nor since: a Whetstone leaves emblems as they are.
    expect(refused(stray)).toContain("the emblems");
    expect(
      refused(
        tampered(run, (raw) => {
          raw.boons = ["crabcharm"];
          raw.rack = { ...recordIn(raw.rack), crabcharm: 2 };
        }),
      ),
    ).toContain("the emblems");
  });
  test("extra fields are dropped rather than kept", () => {
    const loaded = loadRun(tampered(run, (raw) => (raw.cheat = { acorns: 9999 })));
    expect(loaded.ok && loaded.run).toEqual(run);
  });
  test("a run with its first pick still waiting may have nobody; any other must have somebody", () => {
    const fresh = startRun(4, { era: LEGACY_ERA });
    expect(loadRun(saveRun(fresh)).ok).toBe(true);
    const picked = startRun(4, { era: LEGACY_ERA });
    choose(picked, 0);
    expect(refused(tampered(picked, (raw) => (raw.board = listIn(raw.board).map(() => null))))).toContain("the party");
  });
});
