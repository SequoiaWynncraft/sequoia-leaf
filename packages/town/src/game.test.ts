import { describe, expect, test } from "bun:test";

import { type Ctx, DAY_MS, type Done, LOGGED, type Refused } from "@sequoia-leaf/core";

import { canPlace, MOST_OWNED, MOST_PLACED, NEW_CAMP, newThings, YARD } from "./camp.ts";
import { STALLS } from "./catalogue.ts";
import { STRETCH, stretchOf } from "./clock.ts";
import { CALLERS, folk, GIFTS } from "./folk.ts";
import {
  CALLS,
  decodeTown,
  encodeTown,
  predict,
  readCommand,
  readNotes,
  readView,
  TOWN,
  type Town,
  type TownCommand,
  type TownNote,
  townView,
} from "./game.ts";
import { BOX, letter } from "./mail.ts";
import { THINGS } from "./things.ts";

/** Wednesday 25 November 2026, 12:00 UTC. */
const T0 = Date.UTC(2026, 10, 25, 12);
const SECOND = 1000;
const HOUR = 3600 * SECOND;
const ctx = (now = T0, awards: readonly string[] = []): Ctx => ({
  now,
  player: { id: "p", guest: false },
  seed: 7,
  room: 1e9,
  awards,
});
const fresh = (): Town => TOWN.create(ctx());

/** A command done, or the test fails. */
function did(s: Town, c: TownCommand, at = ctx()): Done<Town, TownNote> {
  const answer = TOWN.apply(s, c, at);
  if ("refused" in answer) throw new Error(`${c.do} was refused: ${answer.refused}`);
  return answer;
}
/** The code a command is refused with; the state it was given is left as it was. */
function refused(s: Town, c: TownCommand, at = ctx()): string {
  const before = encodeTown(s);
  const answer: Done<Town, TownNote> | Refused = TOWN.apply(s, c, at);
  expect(encodeTown(s)).toBe(before);
  if (!("refused" in answer)) throw new Error(`${c.do} was done`);
  return answer.refused;
}
const nOf = (s: Town, id: string): number => s.camp.placed.find((p) => p.id === id)?.n ?? -1;

describe("a new member's town", () => {
  test("is the camp every member starts with, each thing numbered, nothing welcomed, and a caller on the way", () => {
    const s = fresh();
    expect(s.camp.placed.map(({ id, x, y, t }) => ({ id, x, y, t }))).toEqual([...NEW_CAMP]);
    expect(s.camp.placed.map((p) => p.n)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(s.made).toBe(9);
    expect([s.seenAt, s.welcomedDay, s.chestDay, s.visit]).toEqual([0, -1, -1, null]);
    expect(s.nextCall).toBeGreaterThanOrEqual(T0 + CALLS.least);
    expect(s.nextCall).toBeLessThan(T0 + CALLS.least + CALLS.more);
    expect(TOWN.create({ ...ctx(), seed: 8 }).rng).not.toBe(s.rng);
  });

  test("is shown without its stream or when the next caller comes, and with the letter Leaf would post", () => {
    const view = TOWN.view(fresh(), ctx());
    expect(Object.keys(view).toSorted()).toEqual(
      [
        "sightings",
        "spotAt",
        "chestDay",
        "welcomedDay",
        "seenAt",
        "cursor",
        "stay",
        "camp",
        "visit",
        "made",
        "arrival",
      ].toSorted(),
    );
    expect(view.arrival).toMatchObject({
      first: true,
      newDay: true,
      away: 0,
      said: ["Tindra left a mushroom by your gate."],
    });
    expect(view.arrival.mail.map((l) => [l.from, l.gift])).toEqual([["Tindra", "toadstool"]]);
  });
});

describe("the arrival letter", () => {
  test("posts what the view said it would, once, and welcomes the member now", () => {
    const s = fresh();
    const said = townView(s, T0).arrival;
    const after = did(s, { do: "welcome", cursor: 5 }).state;
    expect(after.camp.letters).toEqual(said.mail);
    expect([after.seenAt, after.welcomedDay, after.cursor]).toEqual([T0, Math.floor(T0 / DAY_MS), 5]);
    // Put away again at once: nothing more, and the news told never goes back.
    const again = did(after, { do: "welcome", cursor: 2 }).state;
    expect(again.camp.letters).toEqual(after.camp.letters);
    expect(again.cursor).toBe(5);
    expect(townView(again, T0).arrival).toMatchObject({ first: false, newDay: false, away: 0, mail: [] });
  });

  test("brings a letter after an hour away and a caller's present too after six, from Leaf's clock", () => {
    const home = did(fresh(), { do: "welcome", cursor: null }).state;
    const soon = townView(home, T0 + 59 * 60 * SECOND).arrival;
    expect(soon.mail).toEqual([]);
    const hour = townView(home, T0 + HOUR).arrival;
    expect([hour.mail.length, hour.said.length, hour.away]).toEqual([1, 1, HOUR]);
    const long = townView(home, T0 + 7 * HOUR).arrival;
    expect(long.mail).toHaveLength(2);
    expect(GIFTS.some((g) => g === long.mail[1]?.gift)).toBe(true);
    const back = did(home, { do: "welcome", cursor: null }, ctx(T0 + 7 * HOUR)).state;
    expect(back.camp.letters.slice(1)).toEqual(long.mail);
    expect(new Set(back.camp.letters.map((l) => l.id)).size).toBe(3);
  });

  test("a new UTC day is a new day, and being here moves the time away on", () => {
    const home = did(fresh(), { do: "welcome", cursor: null }).state;
    expect(townView(home, Date.UTC(2026, 10, 26, 0, 1)).arrival.newDay).toBe(true);
    const here = did(home, { do: "here", cursor: 9 }, ctx(T0 + 2 * HOUR)).state;
    expect([here.seenAt, here.cursor]).toEqual([T0 + 2 * HOUR, 9]);
    expect(townView(here, T0 + 2 * HOUR + 59 * 60 * SECOND).arrival.mail).toEqual([]);
  });
});

describe("the chest", () => {
  test("pays 3 Coins, free, once a UTC day", () => {
    const first = did(fresh(), { do: "openChest" }, ctx(Date.UTC(2026, 10, 25, 23, 59)));
    const day = Math.floor(Date.UTC(2026, 10, 25) / DAY_MS);
    expect(first.coins).toEqual([{ amount: 3, reason: "The chest by the Treasury", key: `chest:${day}`, free: true }]);
    expect(refused(first.state, { do: "openChest" }, ctx(Date.UTC(2026, 10, 25, 0, 0)))).toBe("opened_today");
    const next = did(first.state, { do: "openChest" }, ctx(Date.UTC(2026, 10, 26, 0, 1)));
    expect(next.coins?.[0]?.key).toBe(`chest:${day + 1}`);
  });
});

describe("the missing crab", () => {
  test("is counted once for each place it hides: a second sighting in one stretch is refused", () => {
    const from = stretchOf(T0) * STRETCH;
    const s = did(fresh(), { do: "spotCrab" }, ctx(from)).state;
    expect(s.sightings).toBe(1);
    expect(refused(s, { do: "spotCrab" }, ctx(from + STRETCH - 1))).toBe("too_soon");
    expect(did(s, { do: "spotCrab" }, ctx(from + STRETCH)).state.sightings).toBe(2);
  });
});

describe("buying", () => {
  const [stall] = STALLS;
  const ware = stall?.stock[0];
  if (!stall || !ware) throw new Error("no stall");

  test("puts one thing in the tray, new, and nothing on the ground, and takes the stall's price, keyed by a number of its own", () => {
    const one = did(fresh(), { do: "buy", stall: stall.id, thing: ware.thing });
    expect([one.state.camp.tray, one.state.camp.fresh]).toEqual([{ [ware.thing]: 1 }, { [ware.thing]: 1 }]);
    expect(one.state.camp.placed).toEqual(fresh().camp.placed);
    expect(one.coins).toEqual([{ amount: -ware.price, reason: "A thing for the camp", key: "buy:9" }]);
    expect(one.log).toEqual([{ kind: LOGGED.townBought, data: { thing: ware.thing, price: ware.price } }]);
    expect(did(one.state, { do: "buy", stall: stall.id, thing: ware.thing }).coins?.[0]?.key).toBe("buy:10");
  });

  test("is refused, before anything is paid, for what the stall does not sell, or 999 of it", () => {
    const s = fresh();
    expect(refused(s, { do: "buy", stall: stall.id, thing: "fountain" })).toBe("not_for_sale");
    expect(refused(s, { do: "buy", stall: "nowhere", thing: ware.thing })).toBe("not_for_sale");
    s.camp.tray[ware.thing] = MOST_OWNED;
    expect(refused(s, { do: "buy", stall: stall.id, thing: ware.thing })).toBe("plenty");
  });
});

describe("the pet", () => {
  test("is chosen once", () => {
    const one = did(fresh(), { do: "choosePet", pet: "fox" });
    expect(one.state.camp.first).toBe("fox");
    expect(one.log).toEqual([{ kind: LOGGED.townPet, data: { pet: "fox" } }]);
    expect(refused(one.state, { do: "choosePet", pet: "cat" })).toBe("pet_chosen");
  });
});

describe("callers", () => {
  test("come only when Leaf's clock reaches the next, one at most for each call however long nobody was here", () => {
    const s = fresh();
    expect(TOWN.advance(s, ctx(s.nextCall - 1))).toBe(s);
    const week = s.nextCall + 7 * DAY_MS;
    const one = TOWN.advance(s, ctx(week));
    expect(one.visit).toMatchObject({ id: 0 });
    // A caller takes no id from the counter the page gives its own things from: what the page set out keeps its id.
    expect(one.made).toBe(s.made);
    expect(CALLERS).toContain(one.visit?.who ?? "pipwick");
    expect(one.nextCall).toBeGreaterThanOrEqual(week + CALLS.least);
    expect(one.nextCall).toBeLessThan(week + CALLS.least + CALLS.more);
    // The same state at the same moment always comes to the same caller: the page is shown it before it is greeted.
    expect(TOWN.advance(s, ctx(week))).toEqual(one);
    expect(TOWN.advance(one, ctx(week))).toBe(one);
  });

  test("a caller still waiting when the next comes leaves what they brought in the mailbox", () => {
    let s = fresh();
    const left: string[] = [];
    for (let k = 0; k < 40; k++) {
      const before = s.visit;
      s = TOWN.advance(s, ctx(s.nextCall));
      if (before && (before.note !== "" || before.gift !== "")) left.push(`v-${before.id}`);
    }
    expect(s.camp.letters).toHaveLength(BOX);
    expect(s.camp.letters.every((l) => left.includes(l.id))).toBe(true);
  });

  test("bring a present two times in five and a note seven times in ten", () => {
    let s = fresh();
    let gifts = 0;
    let notes = 0;
    const N = 2000;
    for (let k = 0; k < N; k++) {
      s = TOWN.advance(s, ctx(s.nextCall));
      if (s.visit?.gift) gifts++;
      if (s.visit?.note) notes++;
    }
    expect(Math.abs(gifts / N - 0.4)).toBeLessThan(0.04);
    expect(Math.abs(notes / N - 0.7)).toBeLessThan(0.04);
  });

  test("are greeted by their id: counted, what they brought posted, and gone", () => {
    let s = fresh();
    while (!(s.visit && s.visit.gift !== "")) s = TOWN.advance(s, ctx(s.nextCall));
    const visit = s.visit;
    expect(refused(s, { do: "greet", visit: visit.id + 1 })).toBe("no_such_visit");
    const after = did(s, { do: "greet", visit: visit.id }).state;
    expect([after.camp.greeted, after.visit]).toEqual([1, null]);
    expect(after.camp.letters.at(-1)).toMatchObject({
      id: `v-${visit.id}`,
      from: folk(visit.who).name,
      gift: visit.gift,
    });
    expect(refused(after, { do: "greet", visit: visit.id })).toBe("no_such_visit");
  });
});

describe("things won", () => {
  test("each won elsewhere goes into the tray once, new, and nothing on the ground", () => {
    const awards = ["trophy-oldbramble", "model-crab", "not-a-thing"];
    const won = TOWN.advance(fresh(), ctx(T0, awards));
    expect([won.camp.tray, won.camp.fresh]).toEqual([
      { "trophy-oldbramble": 1, "model-crab": 1 },
      { "trophy-oldbramble": 1, "model-crab": 1 },
    ]);
    expect(won.camp.placed).toEqual(fresh().camp.placed);
    expect(won.camp.earned).toEqual(["trophy-oldbramble", "model-crab"]);
    expect(TOWN.advance(won, ctx(T0, awards))).toBe(won);
  });

  test("a pull's thing arrives once, whatever copies come after; its headliner brings the banner's statue", () => {
    // Awards from before the camp knew of them: handed over on the next look.
    const awards = ["pull:thing:fountain", "pull:look:baize", "pull:headliner:banner-1", "pull:thing:nothing"];
    const won = TOWN.advance(fresh(), ctx(T0, awards));
    expect(won.camp.tray).toEqual({ fountain: 1, "statue-banner-1": 1 });
    expect(won.camp.earned).toEqual(["fountain", "statue-banner-1"]);
    // Set out and gone from the tray: a second copy of the prize is the same award, and brings nothing.
    const set = did(won, { do: "setOut", thing: "fountain", x: 30, y: 20, t: 0 }).state;
    expect(TOWN.advance(set, ctx(T0, awards))).toBe(set);
    // The statue is set out, turned and put away like any thing.
    const statue = did(set, { do: "setOut", thing: "statue-banner-1", x: 34, y: 20, t: 1 }).state;
    expect(did(statue, { do: "putAway", n: nOf(statue, "statue-banner-1") }).state.camp.tray).toEqual({
      "statue-banner-1": 1,
    });
  });

  test("one more of a thing the member has 999 of is won, and not kept", () => {
    const s = fresh();
    s.camp.tray = { "model-crab": MOST_OWNED };
    const won = TOWN.advance(s, ctx(T0, ["model-crab"]));
    expect([won.camp.tray, won.camp.fresh, won.camp.earned]).toEqual([
      { "model-crab": MOST_OWNED },
      {},
      ["model-crab"],
    ]);
  });
});

describe("the mailbox", () => {
  test("is read, and what has been dealt with is cleared", () => {
    const s = fresh();
    s.camp.letters = [letter("a", "Pipwick", "hello"), letter("b", "Tindra", "for you", "pumpkin")];
    const read = did(s, { do: "readMail" }).state;
    expect(read.camp.letters.every((l) => l.read)).toBe(true);
    expect(did(read, { do: "clearLetters" }).state.camp.letters.map((l) => l.id)).toEqual(["b"]);
  });

  test("a present taken goes into the tray once, new, and nothing on the ground", () => {
    const s = fresh();
    s.camp.letters = [letter("a", "Tindra", "for you", "pumpkin")];
    const one = did(s, { do: "takePresent", letter: "a" }).state;
    expect([one.camp.tray, one.camp.fresh]).toEqual([{ pumpkin: 1 }, { pumpkin: 1 }]);
    expect(one.camp.placed).toEqual(s.camp.placed);
    expect(one.camp.letters[0]?.taken).toBe(true);
    expect(refused(one, { do: "takePresent", letter: "a" })).toBe("no_present");
    expect(refused(one, { do: "takePresent", letter: "zz" })).toBe("no_present");
  });

  test("a present is kept in its letter when there is no room for one more of it", () => {
    const s = fresh();
    s.camp.letters = [letter("a", "Tindra", "for you", "pumpkin")];
    s.camp.tray.pumpkin = MOST_OWNED;
    expect(refused(s, { do: "takePresent", letter: "a" })).toBe("plenty");
    expect(s.camp.letters[0]?.taken).toBe(false);
  });
});

describe("things in the camp", () => {
  test("what arrives is new until the member looks in the tray, and not after; what they put away is not new", () => {
    const [stall] = STALLS;
    const ware = stall?.stock[0];
    if (!stall || !ware) throw new Error("no stall");
    let s = TOWN.advance(fresh(), ctx(T0, ["model-crab"]));
    s = did(s, { do: "buy", stall: stall.id, thing: ware.thing }).state;
    s = did(s, { do: "buy", stall: stall.id, thing: ware.thing }).state;
    expect([s.camp.fresh, newThings(s.camp)]).toEqual([{ "model-crab": 1, [ware.thing]: 2 }, 3]);
    // One taken in hand has been looked at; the rest are new until the tray is looked in.
    s = did(s, { do: "setOut", thing: ware.thing, x: 30, y: 20, t: 0 }).state;
    expect([s.camp.tray, s.camp.fresh]).toEqual([{ "model-crab": 1, [ware.thing]: 1 }, { "model-crab": 1 }]);
    // Looked in: what the page showed as new is new no more, and what it had not shown yet stays new.
    s = did(s, { do: "looked", things: [] }).state;
    expect(newThings(s.camp)).toBe(1);
    s = did(s, { do: "looked", things: ["model-crab"] }).state;
    expect([s.camp.tray, s.camp.fresh, newThings(s.camp)]).toEqual([{ "model-crab": 1, [ware.thing]: 1 }, {}, 0]);
    s = did(s, { do: "putAway", n: nOf(s, ware.thing) }).state;
    expect([s.camp.tray[ware.thing], s.camp.fresh]).toEqual([2, {}]);
  });

  test("a thing is set out of the tray only where it may stand, turned a way it turns", () => {
    const s = fresh();
    s.camp.tray = { gnome: 2 };
    expect(refused(s, { do: "setOut", thing: "rock", x: 30, y: 20, t: 0 })).toBe("not_in_tray");
    expect(refused(s, { do: "setOut", thing: "gnome", x: 1, y: 1, t: 0 })).toBe("off");
    expect(refused(s, { do: "setOut", thing: "gnome", x: 45, y: 26, t: 0 })).toBe("trail");
    expect(refused(s, { do: "setOut", thing: "gnome", x: 28, y: 25, t: 0 })).toBe("taken");
    expect(refused(s, { do: "setOut", thing: "gnome", x: 30, y: 20, t: 2 })).toBe("cannot_turn");
    const out = did(s, { do: "setOut", thing: "gnome", x: 30, y: 20, t: 1 }).state;
    expect(out.camp.placed.at(-1)).toEqual({ n: 9, id: "gnome", x: 30, y: 20, t: 1, s: 0 });
    expect(out.camp.tray).toEqual({ gnome: 1 });
    // Shutting the mailbox in is refused: rocks above it, below it and to its left, and the last to its right.
    const box = out.camp.placed.find((p) => p.id === "mailbox");
    if (!box) throw new Error("no mailbox");
    const shut = structuredClone(out);
    for (const [x, y] of [
      [box.x, box.y - 1],
      [box.x, box.y + 1],
      [box.x - 1, box.y],
    ] as const) {
      expect(canPlace(shut.camp.placed, "rock", x, y, 0)).toBe("ok");
      shut.camp.placed.push({ n: shut.made++, id: "rock", x, y, t: 0, s: 0 });
    }
    shut.camp.tray = { rock: 1 };
    expect(refused(shut, { do: "setOut", thing: "rock", x: box.x + 1, y: box.y, t: 0 })).toBe("shut");
    const full = structuredClone(out);
    full.camp.placed = Array.from({ length: MOST_PLACED }, (_v, n) => ({ n, id: "rock", x: 0, y: 0, t: 0, s: 0 }));
    expect(refused(full, { do: "setOut", thing: "gnome", x: 30, y: 20, t: 0 })).toBe("full");
  });

  test("a thing is moved, turned, put away and toggled by its id, never by its place in the list", () => {
    const s = fresh();
    const stump = nOf(s, "stump");
    const post = nOf(s, "lantern-post");
    // Two commands made from the same copy: the first takes a thing out of the list before the second's.
    const away = did(s, { do: "putAway", n: nOf(s, "trophy-shelf") }).state;
    const moved = did(away, { do: "move", n: stump, x: 30, y: 30, t: 0 }).state;
    expect(moved.camp.placed.find((p) => p.n === stump)).toMatchObject({ id: "stump", x: 30, y: 30 });
    expect(moved.camp.tray).toEqual({ "trophy-shelf": 1 });
    // A thing set out again has a new id: the old one is never used again.
    const back = did(moved, { do: "setOut", thing: "trophy-shelf", x: 18, y: 15, t: 0 }).state;
    expect(back.camp.placed.at(-1)?.n).toBe(9);
    expect(refused(back, { do: "putAway", n: 1 })).toBe("no_such_thing");
    expect(refused(back, { do: "move", n: stump, x: 7, y: 13, t: 0 })).toBe("taken");
    expect(refused(back, { do: "putAway", n: nOf(back, "cabin") })).toBe("rooted");
    const lit = did(back, { do: "toggle", n: post }).state;
    expect(lit.camp.placed.find((p) => p.n === post)?.s).toBe(1);
    expect(did(lit, { do: "toggle", n: post }).state.camp.placed.find((p) => p.n === post)?.s).toBe(0);
    expect(refused(back, { do: "toggle", n: stump })).toBe("nothing_to_toggle");
    expect(refused(back, { do: "toggle", n: 99 })).toBe("no_such_thing");
  });

  test("a pennant runs through its five colours and a gnome looks the other way", () => {
    const s = fresh();
    s.camp.placed.push(
      { n: 9, id: "pennant", x: 30, y: 20, t: 0, s: 0 },
      { n: 10, id: "gnome", x: 32, y: 20, t: 0, s: 0 },
    );
    let t = s;
    for (let k = 0; k < 5; k++) t = did(t, { do: "toggle", n: 9 }).state;
    expect(t.camp.placed.find((p) => p.n === 9)?.s).toBe(0);
    expect(did(t, { do: "toggle", n: 10 }).state.camp.placed.find((p) => p.n === 10)?.t).toBe(1);
  });

  test("the stay switch", () => {
    expect(did(fresh(), { do: "stay", on: false }).state.stay).toBe(false);
  });
});

describe("commands off the wire", () => {
  test("are read with every field checked; the command's own id is let be", () => {
    expect(readCommand({ id: "c-1", do: "move", n: 3, x: 10, y: 20, t: 1 })).toEqual({
      do: "move",
      n: 3,
      x: 10,
      y: 20,
      t: 1,
    });
    expect(readCommand({ do: "welcome" })).toEqual({ do: "welcome", cursor: null });
    expect(readCommand({ do: "buy", stall: "lamps", thing: "rock" })).toEqual({
      do: "buy",
      stall: "lamps",
      thing: "rock",
    });
    for (const bad of [
      null,
      { do: "fly" },
      { do: "move", n: -1, x: 1, y: 1, t: 0 },
      { do: "move", n: 1, x: 1.5, y: 1, t: 0 },
      { do: "setOut", thing: "moon", x: 1, y: 1, t: 0 },
      { do: "choosePet", pet: "dragon" },
      { do: "here", cursor: "far" },
      { do: "takePresent", letter: "<b>" },
      { do: "unpack", x: 1, y: 1, t: 0 },
    ])
      expect(readCommand(bad)).toBeNull();
  });
});

// ---------- keeping it ----------

/** The largest camp there can be: as many things set out as may be, the tray as full as it goes and all of it new, the mailbox full. */
function largest(): Town {
  const s = fresh();
  const some = ["rock", "flower-pot", "plank-path", "cushion", "pumpkin", "stepping-stones", "glowcap"];
  for (let y = YARD.y0 + 1; y <= YARD.y1 && s.camp.placed.length < MOST_PLACED; y += 1)
    for (let x = YARD.x0 + 1; x < YARD.x1 && s.camp.placed.length < MOST_PLACED; x += 2) {
      const id = some[(x + y) % some.length] ?? "rock";
      if (canPlace(s.camp.placed, id, x, y, 0) === "ok") s.camp.placed.push({ n: s.made++, id, x, y, t: 0, s: 0 });
    }
  s.camp.tray = Object.fromEntries(THINGS.map((t) => [t.id, MOST_OWNED]));
  s.camp.fresh = { ...s.camp.tray };
  s.camp.letters = Array.from({ length: BOX }, (_v, i) =>
    letter(`m-${i}`, "Pipwick", "Came by. You were out. I fed the fire. ".repeat(6).trim(), i % 2 ? "pinecone" : ""),
  );
  return s;
}

describe("keeping a town", () => {
  test("it comes back as it was kept, and nonsense does not", () => {
    let s = fresh();
    s = TOWN.advance(s, ctx(s.nextCall));
    s = did(s, { do: "welcome", cursor: 3 }).state;
    expect(decodeTown(encodeTown(s))).toEqual(s);
    // A letter kept from before the Works' cat was renamed is signed with the cat's name now.
    s.camp.letters = [letter("a", "Embertoe", "Meow.")];
    expect(decodeTown(encodeTown(s))?.camp.letters[0]?.from).toBe("Fika");
    for (const bad of [
      "",
      "{}",
      "[]",
      JSON.stringify({ ...JSON.parse(encodeTown(s)), v: 2 }),
      JSON.stringify({ ...JSON.parse(encodeTown(s)), made: -1 }),
    ])
      expect(decodeTown(bad)).toBeNull();
  });

  test("a camp kept with parcels by the trail is read with them in the tray, new, and what stood still stands", () => {
    const s = fresh();
    s.camp.tray = { rock: 1 };
    const kept = JSON.stringify({
      ...JSON.parse(encodeTown(s)),
      camp: { ...s.camp, fresh: undefined, parcels: ["rock", "toadstool", "rock"] },
    });
    expect(decodeTown(kept)?.camp).toEqual({
      ...s.camp,
      tray: { rock: 3, toadstool: 1 },
      fresh: { rock: 2, toadstool: 1 },
    });
  });

  test("the largest camp is read back in under a millisecond, trusting what Leaf stored", () => {
    const s = largest();
    expect(s.camp.placed).toHaveLength(MOST_PLACED);
    const text = encodeTown(s);
    for (let k = 0; k < 20; k++) decodeTown(text);
    const runs = 200;
    const start = performance.now();
    for (let k = 0; k < runs; k++) decodeTown(text);
    expect((performance.now() - start) / runs).toBeLessThan(1);
  });
});

/** A town with a caller, a present, and two things in the tray, one of them new. */
function lived(): Town {
  const s = TOWN.advance(fresh(), ctx(fresh().nextCall));
  s.camp.tray = { stump: 1, rock: 1 };
  s.camp.fresh = { rock: 1 };
  s.camp.letters = [letter("w-1", "Tindra", "For you.", "toadstool")];
  return s;
}

describe("the page's copy", () => {
  test("is read back from the wire as it was shown, and nonsense is not", () => {
    const view = TOWN.view(lived(), ctx());
    expect(readView(JSON.parse(JSON.stringify(view)))).toEqual(view);
    expect([readView(null), readView({ ...view, arrival: null }), readView({ ...view, made: -1 })]).toEqual([
      null,
      null,
      null,
    ]);
    expect([readNotes([]), readNotes([{ t: "tray", thing: "rock" }]), readNotes({})]).toEqual([[], null, null]);
  });

  test("comes to what Leaf comes to for every command the page works out itself, ids and all", () => {
    const s = lived();
    const stump = nOf(s, "stump");
    const lantern = nOf(s, "lantern-post");
    const commands: TownCommand[] = [
      { do: "setOut", thing: "stump", x: 33, y: 20, t: 0 },
      { do: "takePresent", letter: "w-1" },
      { do: "looked", things: ["stump"] },
      { do: "move", n: stump, x: 30, y: 33, t: 0 },
      { do: "toggle", n: lantern },
      { do: "putAway", n: stump },
      { do: "readMail" },
      { do: "clearLetters" },
      { do: "spotCrab" },
      { do: "choosePet", pet: "fox" },
      { do: "stay", on: false },
      { do: "here", cursor: 4 },
    ];
    let leaf = s;
    let view = TOWN.view(s, ctx());
    for (const c of commands) {
      const done = did(leaf, c);
      const guess = predict(view, c, T0);
      if (!guess || "refused" in guess) throw new Error(`${c.do} was not worked out`);
      expect(guess.notes).toEqual([...done.notes]);
      leaf = done.state;
      view = guess.view;
      expect({ ...view, arrival: null }).toEqual({ ...TOWN.view(leaf, ctx()), arrival: null });
    }
    // Refused the same way, and the letter is the one Leaf showed until Leaf says otherwise.
    expect(predict(view, { do: "choosePet", pet: "cat" }, T0)).toEqual({ refused: "pet_chosen" });
    expect(view.arrival).toEqual(TOWN.view(s, ctx()).arrival);
  });

  test("is not guessed for what only Leaf can say", () => {
    const view = TOWN.view(lived(), ctx());
    for (const c of [
      { do: "welcome", cursor: null },
      { do: "greet", visit: 0 },
      { do: "openChest" },
      { do: "buy", stall: "lamps", thing: "rock" },
    ] satisfies TownCommand[])
      expect(predict(view, c, T0)).toBeNull();
  });
});

describe("where a camp stands", () => {
  test("is the things set out, with the callers greeted and the crab's sightings beside it", () => {
    const s = fresh();
    s.camp.greeted = 2;
    s.sightings = 5;
    expect(TOWN.standing?.(s)).toEqual({ score: 9, also: { greeted: 2, sightings: 5 } });
  });
});

describe("a visit", () => {
  test("is what stands in the camp, each thing in its own state, and the pet, and none of the owner's own", () => {
    const s = lived();
    s.camp.first = "fox";
    s.camp.earned = ["crab-statue"];
    s.camp.greeted = 2;
    s.sightings = 5;
    const lantern = s.camp.placed.find((p) => p.id === "lantern-post");
    if (lantern) lantern.s = 1;
    // A caller waiting, a letter, and things in the tray, one of them new: the owner's own.
    expect(s.visit).not.toBeNull();
    expect([s.camp.letters.length, s.camp.fresh, s.camp.tray]).toEqual([1, { rock: 1 }, { stump: 1, rock: 1 }]);
    const before = encodeTown(s);
    const seen = TOWN.visit?.(s, ctx()) ?? null;
    expect(seen).toEqual({
      sightings: 0,
      spotAt: 0,
      chestDay: -1,
      welcomedDay: -1,
      seenAt: 0,
      cursor: null,
      stay: false,
      camp: { first: "fox", placed: s.camp.placed, tray: {}, fresh: {}, letters: [], greeted: 0, earned: [] },
      visit: null,
      made: 0,
      arrival: { first: false, newDay: false, away: 0, said: [], mail: [] },
    });
    expect(seen?.camp.placed.find((p) => p.id === "lantern-post")?.s).toBe(1);
    expect(encodeTown(s)).toBe(before);
    expect(readView(JSON.parse(JSON.stringify(seen)))).toEqual(seen);
  });
});
