import { describe, expect, test } from "bun:test";

import { DAY_MS } from "@sequoia-leaf/core";

import {
  bannerAt,
  BOARD,
  boardAt,
  crabAt,
  dozing,
  folkAt,
  type FolkNow,
  hiding,
  seedOf,
  SET_OUT,
  stagedBy,
  zAt,
} from "./clock.ts";
import { ERRAND_LINES, FOLK, folk } from "./folk.ts";
import { STRETCH, stretchOf } from "./stretch.ts";

const SEED = seedOf("town");
/** Noon to noon, so that the UTC day turns in the middle. */
const T0 = Date.UTC(2026, 10, 25, 12);
const HOURS = 24;
const IN_TOWN = FOLK.filter((t) => t.job !== "calls");
const CRABS = [1, 2, 3, 4, 5, 6, 8, 9];

/** Everything the rules say of a moment. */
const town = (seed: number, now: number) => ({
  folk: IN_TOWN.map((t) => folkAt(seed, t, now)),
  crabs: CRABS.map((n) => crabAt(seed, n, now)),
  lost: hiding(seed, now),
});

/** One of the town's own each second of a day, with the moment. */
function* day(id: Parameters<typeof folk>[0]): Generator<[number, FolkNow]> {
  for (let now = T0; now < T0 + HOURS * 3_600_000; now += 1000) yield [now, folkAt(SEED, folk(id), now)];
}

describe("the town by the clock", () => {
  test("the same seed and time give the same answer, whenever it is asked", () => {
    const later = town(SEED, T0 + 5 * 3_600_000);
    const first = town(SEED, T0 + 1234);
    town(seedOf("camp"), T0 + 99_000);
    expect(town(SEED, T0 + 1234)).toEqual(first);
    expect(town(SEED, T0 + 5 * 3_600_000)).toEqual(later);
  });

  test("two seeds differ", () => {
    const other = seedOf("camp");
    expect(other).not.toBe(SEED);
    let differ = 0;
    for (let now = T0; now < T0 + 600_000; now += 1000)
      if (JSON.stringify(town(SEED, now)) !== JSON.stringify(town(other, now))) differ++;
    expect(differ).toBeGreaterThan(590);
  });

  test("over a whole day whoever gets about sets out from where its last turn took it, and has the time for the walk", () => {
    for (const [id, walk] of [
      ["pipwick", 5],
      ["embertoe", 9],
    ] as const) {
      let was: FolkNow | null = null;
      for (const [now, f] of day(id)) {
        expect(f.at).toBeLessThanOrEqual(now);
        if (was && f.at !== was.at) {
          expect(f.from).toEqual(was.to);
          expect(f.from).not.toEqual(f.to);
          // The shortest turn is the walk and seven seconds over.
          expect(f.at - was.at).toBeGreaterThanOrEqual((walk + 7) * 1000);
        }
        was = f;
      }
    }
  });

  test("each of the town's own does each of its things about as often as it did", () => {
    /** How often each thing was begun in the day, and how many seconds each was said to be done. */
    const begun: Record<string, number> = {};
    const secs: Record<string, number> = {};
    const lines: Record<string, number> = {};
    for (const t of IN_TOWN) {
      let was: FolkNow | null = null;
      for (const [, f] of day(t.id)) {
        const key = `${t.name} ${f.doing}`;
        secs[key] = (secs[key] ?? 0) + 1;
        if (!was || was.at !== f.at || was.doing !== f.doing) begun[key] = (begun[key] ?? 0) + 1;
        if (f.say && f.say.until !== was?.say?.until) lines[t.name] = (lines[t.name] ?? 0) + 1;
        was = f;
      }
    }
    const hourly = (of: Record<string, number>, key: string): number => Math.round((of[key] ?? 0) / HOURS);
    // Before the clock, measured over 20 hours: Pipwick ran each errand 55.5 times an hour, Fika
    // went to each end 56.6 times, Sootpaw woke 49.4 times and was awake 9.6% of the time, and 802
    // lines were said: Mossback 201, Tindra 180, Bramblewick 176, Fika 131, Pipwick 97, Sootpaw 17.
    expect(["crabs", "board", "gate"].map((e) => hourly(begun, `Pipwick ${e}`))).toEqual([55, 55, 55]);
    expect(["works", "fire"].map((e) => hourly(begun, `Fika ${e}`))).toEqual([56, 56]);
    const woke = hourly(begun, "Sootpaw stall");
    const awake = (secs["Sootpaw stall"] ?? 0) / (HOURS * 3600);
    expect(woke).toBeGreaterThanOrEqual(45);
    expect(woke).toBeLessThanOrEqual(53);
    expect(awake).toBeGreaterThan(0.085);
    expect(awake).toBeLessThan(0.105);
    const said = Object.fromEntries(IN_TOWN.map((t) => [t.name, hourly(lines, t.name)]));
    const all = Object.values(said).reduce((a, b) => a + b, 0);
    expect(all).toBeGreaterThan(780);
    expect(all).toBeLessThanOrEqual(801);
    expect(said.Cinfy).toBe(0);
    for (const [name, least, most] of [
      ["Mossback", 165, 200],
      ["Tindra", 165, 200],
      ["Bramblewick", 165, 200],
      ["Fika", 115, 150],
      ["Pipwick", 90, 125],
      ["Sootpaw", 10, 24],
    ] as const) {
      expect(said[name]).toBeGreaterThanOrEqual(least);
      expect(said[name]).toBeLessThanOrEqual(most);
    }
    console.log("an hour, by the clock:", JSON.stringify({ begun: mapped(begun), awake, said, all }));
  });

  test("a line is begun only by somebody at its post and awake, and three of Pipwick's in four are about his errand", () => {
    const WALK = { crabs: 12, board: 12, gate: 5 } as const;
    let errand = 0;
    let own = 0;
    for (const id of ["sootpaw", "pipwick"] as const)
      for (const [, f] of day(id)) {
        if (!f.say) continue;
        const began = f.say.until - 2800;
        const then = folkAt(SEED, folk(id), began);
        expect(then.say).toEqual(f.say);
        if (id === "sootpaw") expect(then.doing).toBe("stall");
        else if (then.doing === "crabs" || then.doing === "board" || then.doing === "gate") {
          expect(began - then.at).toBeGreaterThanOrEqual(WALK[then.doing] * 1000);
          if (ERRAND_LINES[then.doing].includes(f.say.text)) errand++;
          else own++;
        } else throw new Error(`Pipwick is ${then.doing}`);
      }
    expect(errand / (errand + own)).toBeGreaterThan(0.7);
    expect(errand / (errand + own)).toBeLessThan(0.8);
  });
});

const mapped = (of: Record<string, number>): Record<string, number> =>
  Object.fromEntries(Object.entries(of).map(([k, n]) => [k, Math.round((n / HOURS) * 10) / 10]));

describe("the crabs by the clock", () => {
  test("each ambles off about 654 times an hour, from where it last went, never further than its reach", () => {
    for (const n of CRABS) {
      let was = crabAt(SEED, n, T0);
      let moves = 0;
      for (let now = T0; now < T0 + HOURS * 3_600_000; now += 500) {
        const c = crabAt(SEED, n, now);
        if (c.at !== was.at) {
          moves++;
          expect(c.from).toBe(was.to);
          // Two and a half seconds at least between setting out and setting out again.
          expect(c.at - was.at).toBeGreaterThanOrEqual(2500);
        }
        expect(Math.abs(c.to)).toBeLessThanOrEqual(0.5);
        was = c;
      }
      expect(Math.round(moves / HOURS)).toBeGreaterThanOrEqual(653);
      expect(Math.round(moves / HOURS)).toBeLessThanOrEqual(655);
    }
  });

  test("No. 7 hides in one place for a stretch, the same whenever it is asked, and in another the next", () => {
    const from = stretchOf(T0) * STRETCH;
    const places = new Set<string>();
    for (let k = 0; k < (HOURS * 3_600_000) / STRETCH; k++) {
      const h = hiding(SEED, from + k * STRETCH);
      const late = hiding(SEED, from + (k + 1) * STRETCH - 1);
      expect(late).toEqual({ ...h, since: STRETCH - 1 });
      expect(h.stretch).toBe(stretchOf(T0) + k);
      expect(h.at).not.toEqual(h.was);
      expect(hiding(SEED, from + (k + 1) * STRETCH).was).toEqual(h.at);
      places.add(`${h.at.x},${h.at.y}`);
    }
    // All nine of its places, in a day.
    expect(places.size).toBe(9);
    expect(DAY_MS / STRETCH).toBe(1440);
  });
});

const rester = (id: string, at: "town" | "works" | "table" | "grove", seen: number) => ({ id, at, seen });

describe("members in the games and gone from them, by Leaf's list", () => {
  const SEATS = [
    { n: 0, x: 248, y: 201, at: "fire" },
    { n: 1, x: 264, y: 201, at: "fire", yours: true },
    { n: 2, x: 248, y: 236, at: "fire" },
    { n: 3, x: 221, y: 213, at: "fire" },
    { n: 4, x: 114, y: 312, at: "bench" },
    { n: 5, x: 422, y: 152, at: "works" },
    { n: 6, x: 435, y: 152, at: "works" },
    { n: 7, x: 431, y: 213, at: "table", yours: true },
    { n: 8, x: 457, y: 213, at: "table" },
  ] as const;
  /** The seats each may have, by where they were. */
  const MAY: Readonly<Record<string, readonly string[]>> = {
    town: ["fire", "bench", "works"],
    grove: ["fire", "bench", "works"],
    table: ["table", "fire", "bench"],
    works: ["works", "fire", "bench"],
  };
  const RESTING = [
    rester("fern", "town", T0 - 3 * 3_600_000),
    rester("quill", "works", T0 - 40 * 60_000),
    rester("ash", "works", T0 - 30 * 60_000),
    rester("wren", "works", T0 - 20 * 60_000),
    rester("moss", "table", T0 - 10 * 60_000),
    rester("twin", "table", T0 - 10 * 60_000),
  ];
  const seats = (
    free: readonly (typeof SEATS)[number][] = SEATS,
    resting: readonly ReturnType<typeof rester>[] = RESTING,
  ): Record<string, number> => Object.fromEntries([...dozing(resting, free)].map(([id, s]) => [id, s.n]));

  test("each dozer has a seat they may have for where they were, nobody shares one, and nobody has the member's", () => {
    const got = seats();
    expect(Object.keys(got).toSorted()).toEqual(RESTING.map((r) => r.id).toSorted());
    expect(new Set(Object.values(got)).size).toBe(RESTING.length);
    for (const r of RESTING) {
      const s = SEATS.find((seat) => seat.n === got[r.id]);
      expect(MAY[r.at]).toContain(s?.at ?? "none");
      expect(s && "yours" in s).toBe(false);
    }
  });

  test("the same seats whatever order Leaf's list and the town's seats come in", () => {
    const want = seats();
    for (let turn = 1; turn < RESTING.length; turn++) {
      const resting = [...RESTING.slice(turn), ...RESTING.slice(0, turn)].toReversed();
      expect(seats([...SEATS.slice(turn), ...SEATS.slice(0, turn)], resting)).toEqual(want);
    }
    // Two gone at the same moment choose by account, whichever comes first.
    const two = [rester("b", "town", 5), rester("a", "town", 5)];
    expect(seats(SEATS, two)).toEqual(seats(SEATS, two.toReversed()));
  });

  test("the one gone longest keeps their seat whoever else comes or goes, and anybody else rarely moves", () => {
    const places = ["town", "works", "table", "grove"] as const;
    let list = Array.from({ length: 16 }, (_, k) => rester(`m${k}`, places[k % 4] ?? "town", T0 + k));
    let next = 16;
    let moved = 0;
    const changes = 400;
    for (let k = 0; k < changes; k++) {
      const before = seats(SEATS, list);
      const first = list[0]?.id ?? "";
      // In turn: the one gone longest leaves, or one in the middle comes back to play; and somebody new is gone.
      const out = k % 3 === 0 ? 0 : 1 + ((k * 7) % (list.length - 1));
      const rest = list.filter((_, i) => i !== out);
      list = [...rest, rester(`m${next}`, places[next % 4] ?? "town", T0 + next)];
      next++;
      const after = seats(SEATS, list);
      if (out !== 0) expect(after[first]).toBe(before[first]);
      for (const [id, n] of Object.entries(after)) if (id in before && before[id] !== n) moved++;
    }
    // Giving out the first seat left, in one order for all, moved three of them at each change.
    expect(moved / changes).toBeLessThan(0.6);
  });

  test("a seat a player sits on is passed over, and whoever finds none left has none", () => {
    expect(Object.values(seats(SEATS.filter((s) => s.n !== 5)))).not.toContain(5);
    // Only the member's own seats left: nobody dozes.
    expect(seats(SEATS.filter((s) => "yours" in s))).toEqual({});
    expect(seats(SEATS.filter((s) => s.at === "table"))).toEqual({ moss: 8 });
  });

  test('a dozer breathes out a "z" 1,800 times an hour, as before (one every 1.6 to 2.4 seconds), never two within 1.2 seconds', () => {
    let was = zAt(SEED, "fern", T0);
    let zs = 0;
    for (let now = T0; now < T0 + HOURS * 3_600_000; now += 100) {
      const z = zAt(SEED, "fern", now);
      expect(z).toBeLessThanOrEqual(now);
      if (z === was) continue;
      zs++;
      expect(z - was).toBeGreaterThanOrEqual(1200);
      expect(z - was).toBeLessThanOrEqual(2800);
      was = z;
    }
    expect(Math.round(zs / HOURS)).toBe(1800);
    expect(zAt(SEED, "quill", T0)).not.toBe(zAt(SEED, "fern", T0));
  });
});

/** Whether two hexes of the board are beside one another. */
const beside = (a: number, b: number): boolean => {
  const [ax = 0, ay = 0] = BOARD[a] ?? [];
  const [bx = 0, by = 0] = BOARD[b] ?? [];
  return Math.abs(ax - bx) <= 6 && Math.abs(ay - by) <= 4;
};

describe("the stump's board by the clock", () => {
  test("over six hours one figure at a time goes to a free hex beside its own, each 2.1 seconds as before (1.3 to 2.9), and the board never jumps", () => {
    // Six hours, not the day the others watch: a board is replayed from its last set-out, every quarter second, so a day of them took CI past its 5 seconds.
    const hours = 6;
    let was = boardAt(SEED, T0);
    let moves = 0;
    let setOut = 0;
    for (let now = T0 + 250; now < T0 + hours * 3_600_000; now += 250) {
      const b = boardAt(SEED, now);
      expect(new Set(b.on).size).toBe(SET_OUT.length);
      if (b.moved?.at !== was.moved?.at) {
        const changed = b.on.flatMap((cell, i) => (cell === was.on[i] ? [] : [i]));
        if (b.moved) {
          moves++;
          // The one figure said to have moved did, from where it stood, to a hex beside it nobody was on.
          expect(changed).toEqual([b.moved.piece]);
          expect(was.on[b.moved.piece]).toBe(b.moved.from);
          expect(beside(b.moved.from, b.on[b.moved.piece] ?? -1)).toBe(true);
          expect(was.on).not.toContain(b.on[b.moved.piece]);
          expect(b.moved.at - (was.moved?.at ?? 0)).toBeGreaterThanOrEqual(1300);
        } else expect(changed).toEqual([]);
        if (b.on.join() === SET_OUT.join()) setOut++;
      } else expect(b.on).toEqual(was.on);
      was = b;
    }
    // 1,714 turns an hour; in a few of them the figure whose turn it is has no free hex beside it.
    expect(Math.round(moves / hours)).toBeGreaterThanOrEqual(1690);
    expect(Math.round(moves / hours)).toBeLessThanOrEqual(1715);
    // Set out again every 64 turns: about 27 times an hour.
    expect(Math.round(setOut / hours)).toBeGreaterThanOrEqual(26);
  });

  test("the same board whenever it is asked, and another in another room", () => {
    const at = T0 + 7 * 3_600_000 + 123;
    const b = boardAt(SEED, at);
    boardAt(SEED, T0);
    expect(boardAt(SEED, at)).toEqual(b);
    let differ = 0;
    for (let now = T0; now < T0 + 600_000; now += 5000)
      if (boardAt(seedOf("camp"), now).on.join() !== boardAt(SEED, now).on.join()) differ++;
    expect(differ).toBeGreaterThan(100);
  });
});

describe("the guild's moments by the clock", () => {
  test("the first banner goes up; the next finds it flying, which dips, changes and goes up again", () => {
    const wars = [
      { at: T0, land: "Detlas", happened: T0 - 40_000 },
      { at: T0 + 60_000, land: "Ragni", happened: T0 + 20_000 },
    ];
    expect(bannerAt(wars, T0 - 1)).toBeNull();
    expect(bannerAt(wars, T0)).toMatchObject({ land: "Detlas", up: 0 });
    // A page that opens in the middle joins it there; one that opens after sees it up.
    expect(bannerAt(wars, T0 + 400)?.up).toBeCloseTo(0.3);
    expect(bannerAt(wars, T0 + 30_000)).toMatchObject({ land: "Detlas", up: 1 });
    expect(bannerAt(wars, T0 + 60_400)).toMatchObject({ land: "Detlas" });
    expect(bannerAt(wars, T0 + 60_400)?.up).toBeCloseTo(0.7);
    expect(bannerAt(wars, T0 + 3_600_000)).toMatchObject({ land: "Ragni", up: 1 });
    // It never jumps on the pole, and is at the top when it says.
    let was = 0;
    for (let now = T0; now < T0 + 70_000; now += 20) {
      const b = bannerAt(wars, now);
      if (!b) throw new Error("no banner");
      expect(Math.abs(b.up - was)).toBeLessThan(0.02);
      if (now >= b.full) expect(b.up).toBe(1);
      else if (now > T0 + 60_000) expect(b.up).toBeLessThan(1);
      was = b.up;
    }
  });

  test("an older war heard of late does not take the banner; of two fought at one moment, the later name flies", () => {
    const flying = { at: 0, land: "Detlas", happened: T0 };
    const late = { at: T0 + 60_000, land: "Almuj", happened: T0 - 3_600_000 };
    for (const now of [T0 + 59_000, T0 + 60_500, T0 + 3_600_000])
      expect(bannerAt([flying, late], now)).toMatchObject({ land: "Detlas", up: 1 });
    // In whatever order they are given.
    const twins = [
      { at: T0 + 90_000, land: "Ragni", happened: T0 + 50_000 },
      { at: T0 + 90_000, land: "Troms", happened: T0 + 50_000 },
    ];
    for (const wars of [twins, twins.toReversed()])
      expect(bannerAt([flying, late, ...wars], T0 + 120_000)).toMatchObject({ land: "Troms", up: 1 });
    // The one flying before dips for the new one, whenever the older war was heard of.
    expect(bannerAt([flying, late, ...twins], T0 + 90_100)).toMatchObject({ land: "Detlas" });
  });

  test("the day's count is Leaf's, less what the town has still to stage; the newest are those the page knows of", () => {
    // Nine raids today, as Leaf says; the page knows of the last two, one not home yet.
    expect(stagedBy(9, [T0 - 5000, T0 + 4000], T0)).toEqual({ n: 8, at: [T0 - 5000] });
    expect(stagedBy(9, [T0 + 4000, T0 - 5000], T0 + 4000)).toEqual({ n: 9, at: [T0 - 5000, T0 + 4000] });
    // With none the page knows of, the count stands as it is.
    expect(stagedBy(9, [], T0)).toEqual({ n: 9, at: [] });
    expect(stagedBy(0, [], T0)).toEqual({ n: 0, at: [] });
  });
});
