import { describe, expect, test } from "bun:test";

import { CARELESS, fondOf, type Habit, planRoom, playRoom, playRun, ROLLER, SAVER, SENSIBLE } from "./bot.ts";
import { figureIn } from "./content/figures.ts";
import { HOLDS, isComponentId } from "./content/items.ts";
import { LEGACY_ERA } from "./content/releases.ts";
import { ECONOMY, MAX_LEVEL, ROOM_COUNT } from "./content/rooms.ts";
import { KINS } from "./content/traits.ts";
import { newAlmanac, payout, recordRun } from "./outside.ts";
import {
  beginFight,
  endingOf,
  fieldCap,
  fielded,
  picksOf,
  pieces,
  type Run,
  startRun,
  summariseRun,
  takeTakings,
  traitsNow,
} from "./run.ts";
import { checkRun } from "./save.ts";
import { CAT, EVERYONES } from "./testkit.ts";

/** Everything that must be true of a run however it has been played. */
function expectSound(run: Run): void {
  expect(run.acorns).toBeGreaterThanOrEqual(0);
  expect(run.resolve).toBeGreaterThanOrEqual(0);
  expect(run.resolve).toBeLessThanOrEqual(ECONOMY.resolve);
  expect(run.level).toBeGreaterThanOrEqual(1);
  expect(run.level).toBeLessThanOrEqual(MAX_LEVEL);
  expect(fielded(run)).toBeLessThanOrEqual(fieldCap(run));
  expect(run.room).toBeLessThan(ROOM_COUNT);
  const own = pieces(run);
  expect(new Set(own.map((p) => p.id)).size).toBe(own.length);
  for (const p of own) {
    expect(p.items.length).toBeLessThanOrEqual(HOLDS);
    expect(p.items.filter(isComponentId).length).toBeLessThanOrEqual(1);
    expect(EVERYONES).toContain(p.kind);
  }
  // Three of a kind never sit unmerged.
  const counts = new Map<string, number>();
  for (const p of own) if (p.stars < 3) counts.set(`${p.kind}${p.stars}`, (counts.get(`${p.kind}${p.stars}`) ?? 0) + 1);
  for (const n of counts.values()) expect(n).toBeLessThan(3);
  // And it would be kept and read back as it stands.
  const loaded = checkRun(JSON.parse(JSON.stringify(run)));
  expect(loaded.ok && loaded.run).toEqual(run);
}

/** How much of what a habit fields, over a dozen runs, is of one kin. */
const share = (habit: Habit, kin: string): number => {
  let fond = 0;
  let all = 0;
  for (let seed = 1; seed <= 12; seed++) {
    const run = playRun(seed * 31, habit, { era: LEGACY_ERA });
    for (const kind of run.seen.fielded) {
      all++;
      if (figureIn(CAT, kind).kin === kin) fond++;
    }
  }
  return fond / all;
};

describe("the bot plays by the rules", () => {
  const habits: Habit[] = [SENSIBLE, SAVER, ROLLER, CARELESS, ...KINS.map(fondOf), fondOf("sneak"), fondOf("sage")];
  test("every habit plays whole runs to an end, and the run is sound after every room", () => {
    for (const habit of habits) {
      for (const seed of [1, 2, 3]) {
        const run = startRun(seed * 101, { era: LEGACY_ERA });
        let rooms = 0;
        while (run.stage.phase !== "over") {
          planRoom(run, habit);
          expect(picksOf(run)).toHaveLength(0);
          expect(fielded(run)).toBeGreaterThan(0);
          expectSound(run);
          const taken = playRoom(run, habit);
          expect(taken.ok).toBe(true);
          expect(++rooms).toBeLessThan(60);
        }
        expect(endingOf(run) === "won" || run.resolve === 0).toBe(true);
        expect(run.record.length).toBe(rooms);
      }
    }
  });
  test("the same seed and habit play the same run", () => {
    expect(playRun(55, SENSIBLE, { era: LEGACY_ERA })).toEqual(playRun(55, SENSIBLE, { era: LEGACY_ERA }));
    expect(playRun(55, CARELESS, { era: LEGACY_ERA })).toEqual(playRun(55, CARELESS, { era: LEGACY_ERA }));
    expect(playRun(55, SENSIBLE, { era: LEGACY_ERA })).not.toEqual(playRun(56, SENSIBLE, { era: LEGACY_ERA }));
  });
  test("it fields as many as it may, once it owns them", () => {
    const run = startRun(9, { era: LEGACY_ERA });
    for (let i = 0; i < 6 && run.stage.phase !== "over"; i++) {
      planRoom(run, SENSIBLE);
      if (pieces(run).length >= fieldCap(run)) expect(fielded(run)).toBe(fieldCap(run));
      beginFight(run);
      takeTakings(run);
    }
    expect(run.level).toBeGreaterThan(2);
  });
  test("a bot with a favourite kin fields more of it than a bot without", () => {
    for (const kin of ["crab", "moss", "feather"] as const) {
      expect(share(fondOf(kin), kin)).toBeGreaterThan(share(SENSIBLE, kin));
    }
  });
  test("the roller ends lower in level and with more stars than the saver", () => {
    let rollerLevel = 0;
    let saverLevel = 0;
    let rollerStars = 0;
    let saverStars = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const roller = playRun(seed * 17, ROLLER, { era: LEGACY_ERA });
      const saver = playRun(seed * 17, SAVER, { era: LEGACY_ERA });
      rollerLevel += roller.level;
      saverLevel += saver.level;
      rollerStars += roller.seen.threeStars.length;
      saverStars += saver.seen.threeStars.length;
    }
    expect(rollerLevel).toBeLessThan(saverLevel);
    expect(rollerStars).toBeGreaterThan(saverStars);
  });
  test("a sensible player gets further than a careless one", () => {
    let sensible = 0;
    let careless = 0;
    for (let seed = 1; seed <= 12; seed++) {
      sensible += summariseRun(playRun(seed * 13, SENSIBLE, { era: LEGACY_ERA })).cleared;
      careless += summariseRun(playRun(seed * 13, CARELESS, { era: LEGACY_ERA })).cleared;
    }
    expect(sensible).toBeGreaterThan(careless * 2);
  });
  test("it switches traits on, makes items and takes boons along the way", () => {
    const run = startRun(4, { era: LEGACY_ERA });
    let traits = 0;
    while (run.stage.phase !== "over") {
      planRoom(run, SENSIBLE);
      traits = Math.max(traits, traitsNow(run).filter((t) => t.step > 0).length);
      beginFight(run);
      takeTakings(run);
    }
    expect(traits).toBeGreaterThanOrEqual(2);
    expect(run.boons.length).toBeGreaterThanOrEqual(1);
    expect(run.seen.forged.length).toBeGreaterThanOrEqual(1);
  });
});

describe("a whole life of raids", () => {
  test("runs feed the almanac, raid after raid", () => {
    let almanac = newAlmanac();
    let coins = 0;
    for (let seed = 1; seed <= 8; seed++) {
      const run = playRun(seed * 7, SENSIBLE, { era: LEGACY_ERA });
      const summary = summariseRun(run);
      coins += payout(summary).coins;
      almanac = recordRun(almanac, summary).almanac;
    }
    expect(almanac.runs).toBe(8);
    expect(almanac.fielded.length).toBeGreaterThan(15);
    expect(almanac.best[0]).toBeGreaterThan(5);
    expect(almanac.bosses[0]).toContain("oldbramble");
    expect(coins).toBeGreaterThan(8 * 80);
    expect(coins).toBeLessThan(8 * 600);
  });
});
