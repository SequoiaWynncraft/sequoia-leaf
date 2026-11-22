import { describe, expect, test } from "bun:test";

import { DAY_MS } from "@sequoia-leaf/core";

import { crabAt, folkAt, type FolkNow, hiding, seedOf, STRETCH, stretchOf } from "./clock.ts";
import { ERRAND_LINES, FOLK, folk } from "./folk.ts";

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
