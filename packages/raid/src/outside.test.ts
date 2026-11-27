import { describe, expect, test } from "bun:test";

import { BOSS_IDS, type BossId, figureIn } from "./content/figures.ts";
import { FINISHED_IDS } from "./content/items.ts";
import { PAYOUT } from "./content/keepsakes.ts";
import { LEGACY_ERA } from "./content/releases.ts";
import { ROOM_COUNT, TRAILS } from "./content/rooms.ts";
import { TRAIT_IDS } from "./content/traits.ts";
import { type Almanac, newAlmanac, payout, readAlmanac, recordRun, trailCleared, trailOpen } from "./outside.ts";
import { type RunSummary, startRun } from "./run.ts";
import { CAT, EVERYONES } from "./testkit.ts";

const summary = (more: Partial<RunSummary> = {}): RunSummary => ({
  trail: 0,
  ending: "lost",
  cleared: 0,
  reached: 1,
  bosses: [],
  fielded: [],
  threeStars: [],
  forged: [],
  topped: [],
  ...more,
});
const WON = summary({
  ending: "won",
  cleared: 15,
  reached: 15,
  bosses: ["oldbramble", "hoardmagpie", "bigcrab"],
});

/** An almanac as a table keeps it, written out and read back. */
const saveAlmanac = (almanac: Almanac): string => JSON.stringify({ almanac });
function loadAlmanac(text: string): Almanac | null {
  try {
    const raw: unknown = JSON.parse(text);
    return readAlmanac(typeof raw === "object" && raw !== null && "almanac" in raw ? raw.almanac : null);
  } catch {
    return null;
  }
}

describe("the payout", () => {
  test("is for rooms won, bosses beaten, and a bonus for winning", () => {
    expect(payout(summary()).coins).toBe(0);
    expect(payout(summary({ cleared: 4 })).coins).toBe(4 * PAYOUT.room);
    expect(payout(summary({ cleared: 7, bosses: ["oldbramble"] })).coins).toBe(7 * PAYOUT.room + PAYOUT.boss);
    const whole = payout(WON);
    expect(whole.coins).toBe(15 * PAYOUT.room + 3 * PAYOUT.boss + PAYOUT.win);
    expect(whole.lines).toEqual([
      { why: "rooms", coins: 15 * PAYOUT.room },
      { why: "bosses", coins: 3 * PAYOUT.boss },
      { why: "win", coins: PAYOUT.win },
    ]);
  });
  test("an abandoned run is paid for what it cleared, the same as one that walked home", () => {
    const walked = summary({ cleared: 6, bosses: ["oldbramble"] });
    expect(payout({ ...walked, ending: "left" })).toEqual(payout(walked));
  });
  test("harder trails pay their share more, and the lines add up to the total", () => {
    for (let trail = 0; trail < TRAILS.length; trail++) {
      const paid = payout({ ...WON, trail });
      expect(paid.coins).toBe(Math.round((payout(WON).coins * (TRAILS[trail]?.pays ?? 100)) / 100));
      expect(paid.lines.reduce((sum, line) => sum + line.coins, 0)).toBe(paid.coins);
    }
    expect(payout({ ...WON, trail: 2 }).coins).toBeGreaterThan(payout({ ...WON, trail: 1 }).coins);
  });
  test("is modest: a whole raid on the first trail pays about half an hour's Coins", () => {
    expect(payout(WON).coins).toBeGreaterThan(300);
    expect(payout(WON).coins).toBeLessThan(800);
  });
});

describe("the almanac", () => {
  test("starts empty, with only the first trail open", () => {
    const almanac = newAlmanac();
    expect(almanac.fielded).toEqual([]);
    expect(almanac.best).toEqual([0, 0, 0]);
    expect(almanac.runs).toBe(0);
    expect([0, 1, 2].map((trail) => trailOpen(almanac, trail))).toEqual([true, false, false]);
    expect(trailOpen(almanac, 3)).toBe(false);
    expect(trailOpen(almanac, -1)).toBe(false);
  });
  test("remembers who was fielded, who reached three stars, what was forged and which bosses fell", () => {
    const { almanac, news } = recordRun(
      newAlmanac(),
      summary({
        cleared: 6,
        reached: 8,
        bosses: ["oldbramble"],
        fielded: ["worm", "finch"],
        threeStars: ["worm"],
        forged: ["wasptail"],
      }),
    );
    expect(almanac.fielded).toEqual(["worm", "finch"]);
    expect(almanac.threeStars).toEqual(["worm"]);
    expect(almanac.forged).toEqual(["wasptail"]);
    expect(almanac.bosses[0]).toEqual(["oldbramble"]);
    expect(almanac.best).toEqual([8, 0, 0]);
    expect(almanac.runs).toBe(1);
    expect(news.map((n) => n.t)).toEqual(["fielded", "fielded", "threeStars", "forged", "boss", "best"]);
  });
  test("only says what is new, and never forgets or goes backwards", () => {
    const first = recordRun(newAlmanac(), summary({ reached: 9, fielded: ["worm"], bosses: ["oldbramble"] }));
    const second = recordRun(first.almanac, summary({ reached: 4, fielded: ["worm", "moth"] }));
    expect(second.news).toEqual([{ t: "fielded", figure: "moth" }]);
    expect(second.almanac.best[0]).toBe(9);
    expect(second.almanac.bosses[0]).toEqual(["oldbramble"]);
    expect(second.almanac.runs).toBe(2);
    // The almanac handed in is left as it was.
    expect(first.almanac.fielded).toEqual(["worm"]);
    expect(first.almanac.runs).toBe(1);
  });
  test("keeps each trail's best room and bosses apart", () => {
    let almanac = recordRun(newAlmanac(), WON).almanac;
    almanac = recordRun(almanac, summary({ trail: 1, reached: 6, bosses: ["oldbramble"] })).almanac;
    expect(almanac.best).toEqual([15, 6, 0]);
    expect(almanac.bosses).toEqual([["oldbramble", "hoardmagpie", "bigcrab"], ["oldbramble"], []]);
  });
});

describe("trails", () => {
  test("the next trail opens when the last is cleared", () => {
    const beaten = recordRun(newAlmanac(), WON);
    expect(trailCleared(beaten.almanac, 0)).toBe(true);
    expect([0, 1, 2].map((trail) => trailOpen(beaten.almanac, trail))).toEqual([true, true, false]);
    expect(beaten.news).toContainEqual({ t: "trail", trail: 1 });
    const again = recordRun(beaten.almanac, WON);
    expect(again.news.some((n) => n.t === "trail")).toBe(false);
    const second = recordRun(beaten.almanac, { ...WON, trail: 1 });
    expect(trailOpen(second.almanac, 2)).toBe(true);
    expect(second.news).toContainEqual({ t: "trail", trail: 2 });
  });
  test("getting most of the way does not open it", () => {
    const close = recordRun(newAlmanac(), summary({ cleared: 14, reached: 15, bosses: ["oldbramble", "hoardmagpie"] }));
    expect(trailOpen(close.almanac, 1)).toBe(false);
  });
});

describe("the open table", () => {
  test("nothing in the almanac changes who the stall may offer: a new member and one who has done everything get the same", () => {
    const fresh = newAlmanac();
    const full = {
      ...newAlmanac(),
      fielded: [...EVERYONES],
      threeStars: [...EVERYONES],
      forged: [...FINISHED_IDS],
      topped: [...TRAIT_IDS],
      bosses: TRAILS.map(() => BOSS_IDS.slice()),
      best: TRAILS.map(() => 15),
      runs: 99,
    };
    expect(loadAlmanac(saveAlmanac(full))).toEqual(full);
    expect(loadAlmanac(saveAlmanac(fresh))).toEqual(fresh);
    // A run takes nothing from the almanac: the same seed is the same run, stall and all, for both.
    expect(startRun(6, { era: LEGACY_ERA })).toEqual(startRun(6, { era: LEGACY_ERA }));
    expect(startRun(6, { era: LEGACY_ERA }).stall.every((id) => id === null || figureIn(CAT, id) !== undefined)).toBe(
      true,
    );
  });
  test("a run never opens anything", () => {
    const everything = recordRun(newAlmanac(), { ...WON, topped: ["mender"] });
    expect(everything.news.map((n) => n.t)).not.toContain("opened");
  });
});

describe("keeping the almanac", () => {
  test("it saves to a string and loads back the same", () => {
    const { almanac } = recordRun(newAlmanac(), {
      ...WON,
      fielded: ["worm", "greg"],
      forged: ["hoard"],
      topped: ["moss"],
    });
    const text = saveAlmanac(almanac);
    expect(loadAlmanac(text)).toEqual(almanac);
    expect(loadAlmanac(saveAlmanac(newAlmanac()))).toEqual(newAlmanac());
  });
  test("an almanac with every figure, every finished item and every trait in it loads back the same", () => {
    const almanac = {
      ...newAlmanac(),
      fielded: [...EVERYONES],
      threeStars: [...EVERYONES],
      forged: [...FINISHED_IDS],
      topped: [...TRAIT_IDS],
      bosses: TRAILS.map(() => BOSS_IDS.slice()),
    };
    expect(loadAlmanac(saveAlmanac(almanac))).toEqual(almanac);
  });
  test("it refuses nonsense", () => {
    const good = saveAlmanac(recordRun(newAlmanac(), WON).almanac);
    const change = (edit: (almanac: Record<string, unknown>, whole: Record<string, unknown>) => void): string => {
      const whole: unknown = JSON.parse(good);
      if (typeof whole !== "object" || whole === null || !("almanac" in whole)) throw new Error("not an almanac");
      const parts: Record<string, unknown> = { ...whole };
      const almanac: Record<string, unknown> = { ...(typeof parts.almanac === "object" ? parts.almanac : {}) };
      parts.almanac = almanac;
      edit(almanac, parts);
      return JSON.stringify(parts);
    };
    expect(loadAlmanac(change(() => {}))).not.toBeNull();
    for (const text of ["", "nope", "{}", "[]", "null"]) expect(loadAlmanac(text)).toBeNull();
    expect(loadAlmanac(change((a) => (a.fielded = ["dragon"])))).toBeNull();
    expect(loadAlmanac(change((a) => (a.fielded = ["worm", "worm"])))).toBeNull();
    expect(loadAlmanac(change((a) => (a.forged = ["thorn"])))).toBeNull();
    expect(loadAlmanac(change((a) => (a.bosses = [["gnat"], [], []])))).toBeNull();
    expect(loadAlmanac(change((a) => (a.best = [3, "far", 0])))).toBeNull();
    expect(loadAlmanac(change((a) => (a.runs = -1)))).toBeNull();
    // An almanac kept while some figures were locked still loads, whatever it says it opened.
    const kept = loadAlmanac(change((a) => (a.opened = ["kettle", "crab40"])));
    expect(kept).not.toBeNull();
    expect(kept && "opened" in kept).toBe(false);
    expect(loadAlmanac(change((a) => delete a.topped))).toBeNull();
  });
  test("one kept with another number of trails, or rooms, has one for each trail now and no room past the last", () => {
    const almanac = recordRun(newAlmanac(), WON).almanac;
    const fewer = readAlmanac({ ...almanac, bosses: [["bigcrab"]], best: [3] });
    expect([fewer?.bosses, fewer?.best]).toEqual([
      TRAILS.map((_, i): BossId[] => (i === 0 ? ["bigcrab"] : [])),
      TRAILS.map((_, i) => (i === 0 ? 3 : 0)),
    ]);
    const more = readAlmanac({ ...almanac, bosses: [[], [], [], []], best: [ROOM_COUNT + 1, 0, 0, 9] });
    expect([more?.bosses, more?.best]).toEqual([
      TRAILS.map(() => []),
      TRAILS.map((_, i) => (i === 0 ? ROOM_COUNT : 0)),
    ]);
  });
});
