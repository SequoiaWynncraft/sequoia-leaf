import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";

import { type Ctx, isRefused } from "@sequoia-leaf/core";

import { BANNERS, HISTORY, PULLS, type Pulls, rarityOf, RATES } from "./game.ts";

/**
 * States as Leaf stores them, made by the rules of earlier versions and frozen in `../stored`. Each
 * must read after any change to the content or the numbers: a change that breaks one needs a
 * migration where the state is read, never a player locked out of their pulls.
 */
const STORED = new URL("../stored/", import.meta.url);
const FIXTURES = readdirSync(STORED).map((name): [string, string] => [
  name,
  readFileSync(new URL(name, STORED), "utf8"),
]);
const fixture = (name: string): string => FIXTURES.find(([n]) => n === name)?.[1] ?? "";

/** Wednesday 25 November 2026, 12:00 UTC: banner-1 is open. */
const T0 = Date.UTC(2026, 10, 25, 12);
const ctx = (now = T0): Ctx => ({
  now,
  player: { id: "mossback", guest: false },
  seed: 7,
  room: 0,
  awards: [],
  postcards: {},
});
const read = (text: string): Pulls => {
  const state = PULLS.decode(text);
  if (!state) throw new Error("does not read");
  return state;
};
/** A fixture as later rules might find it: its text with `change` made to its data. */
function shifted(name: string, change: (raw: Pulls) => void): string {
  const raw: Pulls = JSON.parse(fixture(name));
  change(raw);
  return JSON.stringify(raw);
}

describe("every stored state kept as a fixture", () => {
  test.each(FIXTURES)("%s reads, reads the same once stored again, and can pull", (_, text) => {
    const state = read(text);
    expect(read(PULLS.encode(state))).toEqual(state);
    expect(PULLS.view(state, ctx())).toBeDefined();
    const at = { ...ctx(), now: Math.max(T0, state.free.next) };
    expect(
      isRefused(PULLS.apply(PULLS.advance(state, at), { do: "pull", pool: "grove", n: 1, with: "free" }, at)),
    ).toBe(false);
  });
  test("there is one for each kind of state Leaf keeps", () => {
    expect(FIXTURES.map(([name]) => name).toSorted()).toEqual([
      "earlier-prizes.json",
      "every-prize.json",
      "new-player.json",
      "pulled.json",
    ]);
  });
});

// Banner-1 as it will be once it is taken out of `BANNERS`: a banner these rules do not know.
const retired = () =>
  shifted("pulled.json", (raw) => {
    raw.have = Object.fromEntries(
      Object.entries(raw.have).map(([prize, n]) => [prize.replace("banner-1", "banner-0"), n]),
    );
    raw.have["headliner:banner-0"] = 2;
    raw.history = raw.history.map((p) => ({ ...p, pool: p.pool.replace("banner-1", "banner-0") }));
  });

describe("a state stored under other content or numbers", () => {
  test("pulled on a banner since retired: its pool and its headliner are kept, the headliner as Yggdrasil", () => {
    expect(BANNERS.some(({ id }) => id === "banner-0")).toBe(false);
    const state = read(retired());
    expect(state.have["headliner:banner-0"]).toBe(2);
    expect(state.history.some((p) => p.pool === "banner-0")).toBe(true);
    expect(rarityOf("headliner:banner-0")).toBe("Yggdrasil");
    expect(PULLS.awards?.(state)).toContain("pull:headliner:banner-0");
    expect(PULLS.standing?.(state).also?.top).toBeGreaterThanOrEqual(2);
  });

  test("a pull from a retired banner is refused as closed, not as nonsense", () => {
    const command = PULLS.command({ do: "pull", pool: "banner-0", n: 1, with: "free" });
    expect(command).not.toBeNull();
    if (!command) return;
    const answer = PULLS.apply(read(retired()), command, ctx());
    expect(isRefused(answer) && answer.refused).toBe("closed");
  });

  test("counters past where a prize is certain now: the next pull is certain", () => {
    const state = read(
      shifted("pulled.json", (raw) => {
        raw.counters.grove = { top: RATES.top.certainAt + 15, mid: RATES.mid.certainAt + 4, owed: false };
      }),
    );
    expect(state.counters.grove).toEqual({ top: RATES.top.certainAt - 1, mid: RATES.mid.certainAt - 1, owed: false });
    const done = PULLS.apply(state, { do: "pull", pool: "grove", n: 1, with: "leaf" }, ctx());
    if (isRefused(done)) throw new Error(done.refused);
    expect(done.notes[0]?.rarity).toBe("Treant");
  });

  test("more free pulls waiting than are kept now: as many as are kept", () => {
    const state = read(
      shifted("every-prize.json", (raw) => {
        raw.free.waiting = RATES.free.most + 3;
      }),
    );
    expect(state.free.waiting).toBe(RATES.free.most);
  });

  test("a longer history than is kept now: its last pulls", () => {
    const state = read(
      shifted("pulled.json", (raw) => {
        raw.history = [...raw.history.slice(0, 30), ...raw.history];
      }),
    );
    expect(state.history).toHaveLength(HISTORY);
    expect(state.history).toEqual(read(fixture("pulled.json")).history.slice(-HISTORY));
  });

  test("a figure that is no longer a prize is still held, and is awarded as before", () => {
    const state = read(
      shifted("every-prize.json", (raw) => {
        raw.have["figure:gone"] = 1;
      }),
    );
    expect(state.have["figure:gone"]).toBe(1);
    expect(PULLS.awards?.(state)).toContain("pull:figure:gone");
  });

  test("text that is not a state of pulls does not read", () => {
    for (const text of [
      "{",
      "null",
      shifted("new-player.json", (raw) => {
        Object.assign(raw, { v: 0 });
      }),
      shifted("new-player.json", (raw) => {
        raw.seeds = -1;
      }),
      shifted("new-player.json", (raw) => {
        Object.assign(raw.counters, { banner: { top: 1.5, mid: 0, owed: false } });
      }),
      shifted("new-player.json", (raw) => {
        raw.have = { "figure:worm": 0 };
      }),
      shifted("new-player.json", (raw) => {
        Object.assign(raw, { history: [{ prize: 4, pool: "grove", at: 0, top: 1 }] });
      }),
    ]) {
      expect(PULLS.decode(text)).toBeNull();
    }
  });
});
