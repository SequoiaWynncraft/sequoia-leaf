/**
 * The page's store of banner people (`people.ts`): a tab left open across a banner's opening learns
 * who its people are from Leaf's next answer, with no reload, and asks Leaf one question at a time.
 */
import { afterAll, beforeAll, expect, test } from "bun:test";

import type { Answer } from "@sequoia-leaf/kit/net.ts";
import { blankCanvas, noCanvas } from "@sequoia-leaf/kit/standin.ts";
import { catalogAt } from "@sequoia-leaf/raid/content/catalog.ts";
import { eraOf } from "@sequoia-leaf/raid/content/releases.ts";

import { wearPeople } from "./member.ts";
import { ASK_AGAIN, bannersIn, makePeople } from "./people.ts";
import { CALLED, nameOf, shownAs } from "./sprites.ts";

/** A minute before Groot Night opens, by Leaf's clock. */
const EVE = Date.UTC(2026, 11, 7, 23, 59);
const BEFORE = bannersIn(catalogAt(eraOf("gaz-stall")));
const NIGHT = bannersIn(catalogAt(eraOf("groot-night")));
const NIGHT_CAT = catalogAt(eraOf("groot-night"));
const MOSS = { id: "banner-1", headliner: { id: "p-moss", name: "Mossback" }, called: [] };
const GROOTERS = ["Ash", "Birch", "Cedar", "Dogwood"].map((name, i) => ({ seat: i + 1, id: `p-${name}`, name }));
const GROOT = { id: "groot-night", headliner: { id: "p-gaz", name: "Gazzy" }, called: GROOTERS };

/** Leaf as the store asks it: each question waits until the test answers it. */
function leaf(): {
  ask: () => Promise<Answer>;
  out: () => number;
  answer: (status: number, banners?: object[]) => Promise<void>;
} {
  const asked: ((a: Answer) => void)[] = [];
  return {
    ask: () => new Promise<Answer>((done) => asked.push(done)),
    out: () => asked.length,
    async answer(status, banners = []) {
      const next = asked.shift();
      if (!next) throw new Error("nothing was asked");
      next({ status, body: { banners } });
      // The store hears the answer, and asks again if it is to, before the test looks.
      await Bun.sleep(0);
    },
  };
}

beforeAll(() => {
  // No page here: a blank canvas, and a skin that never loads.
  blankCanvas();
});

afterAll(() => {
  noCanvas();
});

test("an open raid crossing 8 December 00:00 gets the Commodore and his grooters from Leaf's next answer, with no reload", async () => {
  expect([BEFORE.includes("groot-night"), NIGHT.includes("groot-night")]).toEqual([false, true]);
  const world = leaf();
  const store = makePeople(world.ask, () => EVE);
  const seen: string[] = [];
  wearPeople(store, (banner, name) => seen.push(`${banner}: ${name}`));
  // Until Leaf says who, the Commodore is nobody under his title, and the grooters are the rules' own.
  expect(seen).toEqual(["banner-1: A guild member", "groot-night: Commodore"]);
  const before = shownAs("commodore");
  // The raid's first view, before Groot Night: Leaf is asked once, and says who banner-1's member is.
  store.see(BEFORE);
  expect(world.out()).toBe(1);
  await world.answer(200, [MOSS]);
  store.see(BEFORE);
  expect([world.out(), seen.at(-1)]).toEqual([0, "banner-1: Mossback"]);
  // The view after midnight has Groot Night open: Leaf is asked at once, and its answer is worn.
  store.see(NIGHT);
  expect(world.out()).toBe(1);
  await world.answer(200, [MOSS, GROOT]);
  expect(seen.at(-1)).toBe("groot-night: Commodore");
  expect(shownAs("commodore")).not.toBe(before);
  expect(CALLED.map((id) => nameOf(NIGHT_CAT, id))).toEqual(["Ash", "Birch", "Cedar", "Dogwood"]);
  // Everyone has their people: later views ask nothing more.
  store.see(NIGHT);
  expect(world.out()).toBe(0);
});

test("one question at a time, and again as soon as it is answered when a banner opened while it was out", async () => {
  const world = leaf();
  const store = makePeople(world.ask, () => EVE);
  const heard: number[] = [];
  store.onChange(() => heard.push(store.people().length));
  store.see(BEFORE);
  store.see(NIGHT);
  store.see(NIGHT);
  expect(world.out()).toBe(1);
  // The answer was asked before Groot Night opened: it is asked about at once.
  await world.answer(200, [MOSS]);
  expect([world.out(), heard]).toEqual([1, [1]]);
  await world.answer(200, [MOSS, GROOT]);
  expect([world.out(), heard]).toEqual([0, [1, 2]]);
  expect(store.people().find((b) => b.id === "groot-night")?.called).toHaveLength(4);
  // An answer that already had the banner seen while it was out: nothing more is asked.
  const again = leaf();
  const other = makePeople(again.ask, () => EVE);
  other.see(BEFORE);
  other.see(NIGHT);
  await again.answer(200, [MOSS, GROOT]);
  expect(again.out()).toBe(0);
});

test("a banner still without its people, or Leaf not answering, is asked about again a minute on at most", async () => {
  const world = leaf();
  const clock = { now: EVE };
  const store = makePeople(world.ask, () => clock.now);
  store.see(NIGHT);
  // Leaf has not put the Commodore's member in yet.
  await world.answer(200, [MOSS, { ...GROOT, headliner: null, called: [] }]);
  clock.now += ASK_AGAIN - 1;
  store.see(NIGHT);
  expect(world.out()).toBe(0);
  clock.now += 1;
  store.see(NIGHT);
  expect(world.out()).toBe(1);
  // No answer that reads: the same minute's wait.
  await world.answer(503);
  store.see(NIGHT);
  expect(world.out()).toBe(0);
  clock.now += ASK_AGAIN;
  store.see(NIGHT);
  await world.answer(200, [MOSS, GROOT]);
  expect(store.people().find((b) => b.id === "groot-night")?.headliner?.name).toBe("Gazzy");
  // Asked again by hand (a staged test world), it asks though nothing is missing.
  const done = store.again();
  expect(world.out()).toBe(1);
  await world.answer(200, [MOSS, GROOT]);
  await done;
});
