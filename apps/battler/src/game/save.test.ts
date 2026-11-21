import { describe, expect, test } from "bun:test";

import { planRoom, SENSIBLE } from "./bot.ts";
import { beginFight, buy, choose, type Run, rustle, startRun, takeTakings } from "./run.ts";
import { loadRun, SAVE_VERSION, saveRun } from "./save.ts";

/** A run played by the bot up to a room, stopped in the middle of planning it. */
function midRun(seed: number, rooms: number): Run {
  const run = startRun(seed);
  for (let i = 0; i < rooms && run.phase !== "over"; i++) {
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
  test("the stall, the random stream and the next room all come back", () => {
    const run = midRun(8, 5);
    const back = reload(run);
    expect(back.stall).toEqual(run.stall);
    expect(back.rng).toBe(run.rng);
    expect(back.foe).toEqual(run.foe);
    expect(back.room).toBe(run.room);
    expect(back.choices).toEqual(run.choices);
  });
  test("a loaded run goes on exactly as the original would have", () => {
    const a = midRun(77, 4);
    const b = reload(a);
    for (let i = 0; i < 6 && a.phase !== "over"; i++) {
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
    const fresh = startRun(5);
    expect(reload(fresh)).toEqual(fresh);
    expect(reload(fresh).choices[0]?.kind).toBe("starter");
    const fighting = midRun(5, 2);
    planRoom(fighting, SENSIBLE);
    const begun = beginFight(fighting);
    const back = reload(fighting);
    expect(back.phase).toBe("fight");
    // The fight plays out the same from its seed, so the takings are the same.
    const original = takeTakings(fighting);
    expect(takeTakings(back)).toEqual(original);
    expect(begun.ok).toBe(true);
  });
  test("a finished run loads as finished", () => {
    const run = midRun(3, 99);
    expect(run.phase).toBe("over");
    expect(reload(run)).toEqual(run);
  });
});

describe("loading refuses nonsense", () => {
  const run = midRun(12, 4);
  test("text that is not a save at all", () => {
    for (const text of ["", "not json", "null", "[]", "{}", '{"game":"another","v":1,"run":{}}', "42"]) {
      expect(refused(text)).toBe("That is not a saved raid.");
    }
  });
  test("a save from another version", () => {
    const text = tampered(run, (_, whole) => (whole.v = SAVE_VERSION + 1));
    expect(refused(text)).toBe("That raid was saved by a different version of the game.");
  });
  test("numbers out of range", () => {
    const cases: [string, unknown][] = [
      ["acorns", -1],
      ["acorns", 1.5],
      ["acorns", "lots"],
      ["resolve", 21],
      ["resolve", -3],
      ["level", 0],
      ["level", 9],
      ["room", 15],
      ["trail", 3],
      ["rng", -1],
      ["seed", 2 ** 32],
      ["xp", 9999],
      ["phase", "napping"],
      ["held", "yes"],
    ];
    for (const [field, value] of cases) {
      const why = refused(tampered(run, (raw) => (raw[field] = value)));
      expect(why).toContain("does not add up");
    }
  });
  test("figures, items and boons that do not exist", () => {
    expect(refused(tampered(run, (raw) => (raw.stall = ["dragon", null, null, null, null])))).toContain("the stall");
    expect(refused(tampered(run, (raw) => (raw.boons = ["godmode"])))).toContain("the boons");
    expect(refused(tampered(run, (raw) => (raw.items = ["thorn", "excalibur"])))).toContain("the item bench");
    expect(refused(tampered(run, (raw) => (raw.open = ["worm", "gnat"])))).toContain("the open figures");
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
    expect(withPiece({ id: 2, kind: "worm", stars: 1, items: ["thorn", "plume"], fed: 0 })).toContain("holds");
    expect(withPiece({ id: 2, kind: "worm", stars: 1, items: ["hoard", "hoard", "hoard", "hoard"], fed: 0 })).toContain(
      "holds",
    );
    expect(withPiece({ id: 2, kind: "worm", stars: 1, items: [], fed: 3 })).toContain("Greg");
    expect(withPiece("a worm")).toContain("a figure");
  });
  test("a board of the wrong size, too many on it, or two figures with one number", () => {
    expect(refused(tampered(run, (raw) => (raw.board = [])))).toContain("the board");
    expect(refused(tampered(run, (raw) => listIn(raw.bench).push(null)))).toContain("the bench");
    expect(
      refused(
        tampered(run, (raw) => {
          const board = listIn(raw.board);
          for (let seat = 0; seat < 20; seat++)
            board[seat] = { id: seat + 1, kind: "worm", stars: 1, items: [], fed: 0 };
          raw.nextId = 100;
          raw.bench = listIn(raw.bench).map(() => null);
        }),
      ),
    ).toContain("how many are on the board");
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
  test("a stall of the wrong size, a foe that is no party, a choice that is no choice", () => {
    expect(refused(tampered(run, (raw) => (raw.stall = [null])))).toContain("the stall");
    expect(refused(tampered(run, (raw) => (raw.foe = { who: "x" })))).toContain("who is waiting");
    expect(
      refused(
        tampered(run, (raw) => (raw.foe = { who: "x", title: "", figures: [], charms: [], boons: [], might: 100 })),
      ),
    ).toContain("who is waiting");
    expect(refused(tampered(run, (raw) => (raw.choices = [{ kind: "wish", options: ["worm"] }])))).toContain(
      "a choice",
    );
    expect(refused(tampered(run, (raw) => (raw.choices = [{ kind: "starter", options: ["greg"] }])))).toContain(
      "the starters",
    );
    expect(refused(tampered(run, (raw) => (raw.choices = [{ kind: "boon", options: [], redraws: 0 }])))).toContain(
      "the boons on offer",
    );
  });
  test("an ending that contradicts itself", () => {
    expect(refused(tampered(run, (raw) => (raw.won = true)))).toContain("the ending");
    expect(refused(tampered(run, (raw) => (raw.resolve = 0)))).toContain("the ending");
    expect(refused(tampered(run, (raw) => delete raw.seen))).toContain("the almanac notes");
    expect(refused(tampered(run, (raw) => delete raw.record))).toContain("the record");
  });
  test("extra fields are dropped rather than kept", () => {
    const loaded = loadRun(tampered(run, (raw) => (raw.cheat = { acorns: 9999 })));
    expect(loaded.ok && loaded.run).toEqual(run);
  });
  test("a run with its first pick still waiting may have nobody; any other must have somebody", () => {
    const fresh = startRun(4);
    expect(loadRun(saveRun(fresh)).ok).toBe(true);
    const picked = startRun(4);
    choose(picked, 0);
    expect(refused(tampered(picked, (raw) => (raw.board = listIn(raw.board).map(() => null))))).toContain("the party");
  });
});
