import { describe, expect, test } from "bun:test";

import { type Kind, ROLE, type SnackKind, type SpiritKind, SPIRITS, TROUBLES } from "./cast.ts";
import {
  autoTurn,
  BUDGET,
  buy,
  type Ev,
  feed,
  type Fight,
  fight,
  type Fighter,
  ghost,
  HEARTS,
  load,
  onSale,
  outcome,
  party,
  PRICE,
  ready,
  ROUNDS,
  type Run,
  rustle,
  save,
  sell,
  settle,
  SLOTS,
  type Spirit,
  spirit,
  start,
  swap,
} from "./sim.ts";

/** A spirit or a piece of trouble with the numbers a test wants. */
const of = (kind: Kind, atk?: number, hp?: number, more: Partial<Spirit> = {}): Spirit => ({
  ...spirit(kind),
  ...(atk === undefined ? {} : { atk }),
  ...(hp === undefined ? {} : { hp }),
  ...more,
});
/** How often an ability announced itself by name. */
const said = (f: Fight, text: string): number =>
  f.tape.filter((e) => (e.t === "say" || e.t === "bolt") && e.text === text).length;
/**
 * Plays a tape back the way the screen does, knowing nothing but the two lines that walked in, and
 * says who is left standing where. Anything the tape leaves out would show up here as a wrong end.
 */
function replay(f: Fight): { lines: [Fighter[], Fighter[]]; clashes: number } {
  const all = new Map<number, Fighter>();
  const lines: [number[], number[]] = [[], []];
  for (const side of [0, 1] as const)
    for (const u of f.start[side]) {
      all.set(u.id, { ...u });
      lines[side].push(u.id);
    }
  const who = (id: number): Fighter => {
    const u = all.get(id);
    if (!u) throw new Error(`the tape names ${id}, who never walked in`);
    return u;
  };
  let clashes = 0;
  for (const e of f.tape) {
    if (e.t === "clash") {
      clashes++;
      expect([e.a, e.b]).toEqual([lines[0][0] ?? -1, lines[1][0] ?? -1]);
    }
    if (e.t === "clash" || e.t === "hits")
      for (const h of e.hits) {
        const u = who(h.id);
        if (h.soak === "cushion") u.cushion--;
        expect(u.cushion).toBeGreaterThanOrEqual(0);
        expect(h.hp).toBe(Math.max(0, u.hp - h.amount));
        u.hp = h.hp;
      }
    else if (e.t === "stats") for (const c of e.changes) Object.assign(who(c.id), c);
    else if (e.t === "faint") {
      const u = who(e.id);
      expect(u.hp).toBe(0);
      lines[u.side] = lines[u.side].filter((id) => id !== e.id);
    } else if (e.t === "join") {
      all.set(e.unit.id, { ...e.unit });
      lines[e.unit.side].splice(e.at, 0, e.unit.id);
    } else if (e.t === "order") {
      expect(inOrder(e.ids)).toEqual(inOrder(lines[e.side]));
      lines[e.side] = [...e.ids];
    } else if (e.t === "bolt" || e.t === "say") who(e.t === "bolt" ? e.to : e.id);
  }
  return { lines: [lines[0].map(who), lines[1].map(who)], clashes };
}
const inOrder = (ids: readonly number[]): number[] => ids.toSorted((a, b) => a - b);
const stats = (u: Fighter | undefined): string => (u ? `${u.atk}/${u.hp}` : "gone");
const events = <T extends Ev["t"]>(f: Fight, t: T): Extract<Ev, { t: T }>[] =>
  f.tape.filter((e): e is Extract<Ev, { t: T }> => e.t === t);

describe("a fight", () => {
  test("is front against front, both at once, until one side is gone", () => {
    const f = fight([of("leafling", 2, 3)], [of("gnat"), of("gnat")], 1);
    expect(f.result).toBe("win");
    expect(f.clashes).toBe(2);
    expect(stats(replay(f).lines[0][0])).toBe("2/1");
  });
  test("is lost when the trouble is still standing", () => {
    expect(fight([of("chickaree")], [of("mud")], 1).result).toBe("loss");
  });
  test("is a draw when the last two finish each other at once", () => {
    const f = fight([of("leafling", 2, 2)], [of("gnat", 2, 2)], 1);
    expect(f.result).toBe("draw");
    expect(f.tape.at(-1)).toEqual({ t: "end", result: "draw" });
  });
  test("is a draw when nobody can hurt anybody", () => {
    const f = fight([of("rock")], [of("rock")], 1);
    expect(f.result).toBe("draw");
    expect(f.clashes).toBe(2);
  });
  test("is the same fight every time from the same seed, and chance changes with the seed", () => {
    const ours = [of("slug"), of("glorp"), of("leafling"), of("mossmote"), of("worm")];
    const theirs = [of("puddle"), of("magpie")];
    expect(fight(ours, theirs, 42)).toEqual(fight(ours, theirs, 42));
    const pecked = new Set(
      Array.from(
        { length: 30 },
        (_, seed) => events(fight(ours, theirs, seed), "bolt").find((e) => e.look === "peck")?.to,
      ),
    );
    expect(pecked.size).toBeGreaterThan(2);
  });
  test("leaves the spirits that went in as they were", () => {
    const ours = [of("slug"), of("moth")];
    fight(ours, [of("mud")], 3);
    expect(ours).toEqual([of("slug"), of("moth")]);
  });
  test("always ends, and its tape tells the whole story", () => {
    const kinds: Kind[] = [...SPIRITS, ...TROUBLES];
    let rng = 12345;
    const roll = (n: number): number => {
      rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0;
      return Math.floor((rng / 4294967296) * n);
    };
    const anyone = (): Spirit => {
      const kind = kinds[roll(kinds.length)] ?? "gnat";
      return of(kind, ROLE[kind].atk + roll(6), ROLE[kind].hp + roll(9), { level: 1 + roll(3), cushion: roll(3) % 2 });
    };
    for (let seed = 0; seed < 400; seed++) {
      const f = fight(
        Array.from({ length: 1 + roll(SLOTS) }, anyone),
        Array.from({ length: 1 + roll(SLOTS) }, anyone),
        seed,
      );
      expect(f.tape.at(-1)).toEqual({ t: "end", result: f.result });
      const { lines, clashes } = replay(f);
      expect(clashes).toBe(f.clashes);
      expect(lines[0].every((u) => u.hp > 0) && lines[1].every((u) => u.hp > 0)).toBe(true);
      expect(lines[0].length).toBeLessThanOrEqual(SLOTS);
      if (f.result === "win") expect([lines[0].length > 0, lines[1].length]).toEqual([true, 0]);
      if (f.result === "loss") expect([lines[0].length, lines[1].length > 0]).toEqual([0, true]);
    }
  });
});

describe("what the spirits do in a fight", () => {
  test("a Mossmote cushions the friend ahead of it, and nobody when it is at the front", () => {
    const f = fight([of("slug"), of("mossmote")], [of("wasp")], 1);
    expect(said(f, "Cushions")).toBe(1);
    expect(events(f, "clash")[0]?.hits.find((h) => h.id === 0)).toEqual({ id: 0, amount: 0, hp: 5, soak: "cushion" });
    expect(said(fight([of("mossmote"), of("slug")], [of("wasp")], 1), "Cushions")).toBe(0);
  });
  test("a bigger Mossmote cushions two", () => {
    const f = fight([of("slug"), of("leafling"), of("mossmote", 3, 5, { level: 2 })], [of("puddle")], 1);
    expect(events(f, "stats")[0]?.changes.map((c) => [c.id, c.cushion])).toEqual([
      [0, 1],
      [1, 1],
    ]);
  });
  test("a bit comes off a Glorp each time it is hurt, and stands right behind it", () => {
    const { lines } = replay(fight([of("glorp"), of("moth")], [of("gnat"), of("gnat"), of("gnat")], 1));
    expect(lines[0].map((u) => u.kind)).toEqual(["glorp", "glorplet", "glorplet", "glorplet", "moth"]);
    expect(stats(lines[0][0])).toBe("2/1");
  });
  test("a Glorp's bits are as big as its level, and there are none when the line is full", () => {
    const big = fight([of("glorp", 3, 6, { level: 2 })], [of("gnat")], 1);
    expect(stats(events(big, "join")[0]?.unit)).toBe("2/2");
    const full = fight([of("glorp"), of("slug"), of("slug"), of("slug"), of("slug")], [of("gnat")], 1);
    expect(events(full, "join")).toEqual([]);
  });
  test("a Slug slimes whoever hurt it, down to one attack and no further", () => {
    const f = fight([of("slug", 1, 9)], [of("mud", 3, 8)], 1);
    expect(events(f, "stats").map((e) => e.changes[0]?.atk)).toEqual([2, 1]);
    expect(said(f, "Slimed")).toBe(2);
  });
  test("a Worm burrows instead of fainting, once, and comes up at the back with 1 health", () => {
    const f = fight([of("worm"), of("slug")], [of("wasp")], 1);
    expect(said(f, "Burrows")).toBe(1);
    expect(replay(f).lines[0].map((u) => `${u.kind} ${stats(u)}`)).toEqual(["slug 1/5", "worm 3/1"]);
    expect(fight([of("worm")], [of("wasp"), of("wasp"), of("wasp")], 1).result).toBe("loss");
  });
  test("a bigger Worm burrows twice", () => {
    const f = fight([of("worm", 3, 2, { level: 2 })], [of("wasp"), of("wasp"), of("wasp")], 1);
    expect(said(f, "Burrows")).toBe(2);
    expect(f.result).toBe("draw");
  });
  test("an Emberkit at the very back sends a spark after every clash", () => {
    const f = fight([of("slug"), of("emberkit")], [of("puddle")], 1);
    expect(f.clashes).toBe(3);
    expect(said(f, "Spark")).toBe(2);
  });
  test("an Emberkit anywhere else stays asleep", () => {
    expect(said(fight([of("slug"), of("emberkit"), of("mossmote")], [of("puddle")], 1), "Spark")).toBe(0);
    expect(said(fight([of("emberkit")], [of("puddle")], 1), "Spark")).toBe(0);
  });
  test("a Rock does nothing, shrugs most of a hit off, and whoever hit it stubs a toe", () => {
    const f = fight([of("rock")], [of("wasp")], 1);
    expect(events(f, "clash")[0]?.hits).toEqual([{ id: 0, amount: 1, hp: 7, soak: "shrug" }]);
    expect(said(f, "It is a rock.")).toBe(1);
    expect(f.result).toBe("win");
  });
  test("something always gets through to a Rock", () => {
    const f = fight([of("rock")], [of("puddle", 1, 30)], 1);
    expect(events(f, "clash")[0]?.hits[0]).toEqual({ id: 0, amount: 1, hp: 7, soak: "none" });
  });
  test("a Moth grows when a friend faints, and not when a Worm only burrows", () => {
    const f = fight([of("chickaree", 1, 1), of("moth")], [of("wasp"), of("gnat")], 1);
    expect(said(f, "Flutters over")).toBe(1);
    expect(events(f, "stats")[0]?.changes).toEqual([{ id: 1, atk: 3, hp: 3, cushion: 0 }]);
    expect(said(fight([of("worm"), of("moth")], [of("wasp")], 1), "Flutters over")).toBe(0);
  });
  test("a Fog Owl swoops on whoever is at the very back before anything else happens", () => {
    const f = fight([of("slug"), of("owl")], [of("gnat"), of("puddle"), of("puddle", 1, 5)], 1);
    expect(f.tape[0]).toEqual({ t: "bolt", from: 1, to: 4, look: "swoop", text: "Swoops" });
    expect(f.tape[1]).toEqual({ t: "hits", hits: [{ id: 4, amount: 4, hp: 1, soak: "none" }] });
  });
  test("a White Fox that sends trouble packing rings its antlers for everyone else", () => {
    const f = fight([of("fox"), of("slug"), of("rock")], [of("gnat"), of("gnat")], 1);
    expect(said(f, "Antlers ring")).toBe(2);
    expect(replay(f).lines[0].map(stats)).toEqual(["5/3", "3/7", "0/10"]);
  });
});

describe("what the trouble does", () => {
  test("a Bramble pricks whoever hurts it", () => {
    const f = fight([of("slug")], [of("bramble", 1, 2)], 1);
    expect(said(f, "Thorns")).toBe(2);
    expect(stats(replay(f).lines[0][0])).toBe("1/1");
  });
  test("a Crab's shell takes the first hit", () => {
    const f = fight([of("leafling", 2, 9)], [of("crab", 2, 4, { cushion: 1 })], 1);
    expect(events(f, "clash")[0]?.hits.find((h) => h.id === 1)?.soak).toBe("cushion");
    expect(f.clashes).toBe(3);
  });
  test("a Toadstool puffs spores over the whole line when it goes", () => {
    const f = fight([of("leafling", 2, 3), of("chickaree")], [of("toadstool", 2, 2)], 1);
    expect(said(f, "Spores")).toBe(1);
    expect(replay(f).lines[0].map((u) => `${u.kind} ${stats(u)}`)).toEqual(["chickaree 1/1"]);
  });
  test("a Gust blows the front to the back, unless it is a Rock", () => {
    const f = fight([of("leafling"), of("slug"), of("moth")], [of("gust")], 1);
    expect(events(f, "order")).toEqual([{ t: "order", side: 0, ids: [1, 2, 0] }]);
    const rock = fight([of("rock"), of("slug")], [of("gust")], 1);
    expect(events(rock, "order")).toEqual([]);
    expect(said(rock, "It is a rock.")).toBeGreaterThan(0);
  });
  test("a Magpie pecks someone before the first clash", () => {
    const f = fight([of("slug"), of("glorp", 2, 9)], [of("magpie")], 5);
    expect(f.tape[0]?.t).toBe("bolt");
    expect(events(f, "hits")[0]?.hits[0]?.amount).toBe(2);
  });
  test("the big crab gets crabbier after every clash it is in", () => {
    const f = fight([of("puddle", 1, 40)], [of("bigcrab", 6, 30)], 1);
    expect(
      events(f, "clash")
        .slice(0, 4)
        .map((e) => e.hits[0]?.amount),
    ).toEqual([6, 7, 8, 9]);
  });
});

/** A turn at the stall with the offers a test wants and acorns to spare. */
const shop = (stall: SpiritKind[], snacks: SnackKind[] = [], line: (Spirit | null)[] = []): Run => {
  const run = start(1);
  run.stall = [...stall];
  run.snacks = [...snacks];
  run.line = Array.from({ length: SLOTS }, (_, i) => line[i] ?? null);
  run.acorns = 50;
  return run;
};
const kinds = (run: Run): (string | null)[] =>
  run.line.map((s) => (s ? `${s.kind}${s.level > 1 ? s.level : ""}` : null));

describe("the stall", () => {
  test("starts with a budget, sells a spirit for three acorns, and offers only the first few at first", () => {
    const run = start(7);
    expect([run.acorns, run.hearts, run.round, run.phase]).toEqual([BUDGET, HEARTS, 1, "shop"]);
    expect(run.stall.every((k) => k !== null && ROLE[k].tier === 1)).toBe(true);
    expect(buy(run, 0).ok).toBe(true);
    expect(run.acorns).toBe(BUDGET - PRICE);
    expect([run.line[0]?.kind !== undefined, run.stall[0]]).toEqual([true, null]);
    expect(onSale(1).length).toBeLessThan(onSale(3).length);
    expect(onSale(5)).toEqual([...SPIRITS]);
  });
  test("says why when it will not sell", () => {
    const run = shop(["slug", "slug"], [], [of("glorp"), of("glorp"), of("moth"), of("owl"), of("fox")]);
    expect(buy(run, 0)).toEqual({ ok: false, why: "The line is full: sell someone first" });
    run.line[4] = null;
    expect(buy(run, 0, 1)).toEqual({ ok: false, why: "Someone is standing there" });
    run.acorns = 2;
    expect(buy(run, 0)).toEqual({ ok: false, why: "Not enough acorns" });
    run.acorns = 3;
    expect(buy(run, 0, 4).ok).toBe(true);
    expect(buy(run, 0)).toEqual({ ok: false, why: "Nothing left there" });
  });
  test("three of a kind become one stronger, where the foremost stood, keeping the best of the three", () => {
    const run = shop(["slug"], [], [null, of("slug", 4, 5), of("moth"), of("slug", 1, 9)]);
    const done = buy(run, 0, 4);
    expect(done).toEqual({ ok: true, notes: [{ t: "merge", into: 1, from: [1, 3, 4], level: 2 }] });
    expect(kinds(run)).toEqual([null, "slug2", "moth", null, null]);
    expect(run.line[1]).toMatchObject({ atk: 6, hp: 11, level: 2 });
  });
  test("the third of a kind can be bought into a full line", () => {
    const run = shop(["glorp"], [], [of("glorp"), of("glorp"), of("moth"), of("owl"), of("fox")]);
    expect(buy(run, 0).ok).toBe(true);
    expect(kinds(run)).toEqual(["glorp2", null, "moth", "owl", "fox"]);
  });
  test("three stronger ones become one stronger still, in the same purchase", () => {
    const run = shop(["worm"], [], [spirit("worm", 2), spirit("worm", 2), of("worm"), of("worm")]);
    const done = buy(run, 0);
    expect(done.ok && done.notes.map((n) => (n.t === "merge" ? n.level : 0))).toEqual([2, 3]);
    expect(kinds(run)).toEqual(["worm3", null, null, null, null]);
    expect(run.line[0]).toMatchObject(spirit("worm", 3));
  });
  test("a Leafling tells the friend ahead of it how to do things, every time a friend is bought", () => {
    const run = shop(["moth", "moth"], [], [of("slug"), of("leafling")]);
    expect(buy(run, 0)).toEqual({ ok: true, notes: [{ t: "advice", from: 1, to: 0, atk: 1 }] });
    buy(run, 1);
    expect(run.line[0]?.atk).toBe(3);
  });
  test("a Leafling at the front has nobody to tell, and a Rock is not listening", () => {
    const front = shop(["moth"], [], [of("leafling"), of("slug")]);
    expect(buy(front, 0)).toEqual({ ok: true, notes: [] });
    expect(front.line[1]?.atk).toBe(1);
    const rock = shop(["moth"], [], [of("rock"), of("leafling")]);
    expect(buy(rock, 0)).toEqual({ ok: true, notes: [{ t: "advice", from: 1, to: 0, atk: 0 }] });
    expect(rock.line[0]?.atk).toBe(0);
  });
  test("a snack is for good, and a pepper nut is wasted on a Rock", () => {
    const run = shop([], ["honeycake", "peppernut"], [of("slug"), of("rock")]);
    expect(feed(run, 0, 0).ok).toBe(true);
    expect(feed(run, 1, 1).ok).toBe(true);
    expect([run.line[0]?.hp, run.line[1]?.atk, run.acorns]).toEqual([8, 0, 46]);
    expect(feed(run, 0, 0)).toEqual({ ok: false, why: "Nothing left there" });
  });
  test("Greg eats the snack meant for the spirit next to him, and grows on top", () => {
    const run = shop([], ["honeycake", "peppernut"], [of("slug"), of("greg"), null, of("moth")]);
    expect(feed(run, 0, 0)).toEqual({
      ok: true,
      notes: [
        { t: "fed", slot: 1, meant: 0, atk: 0, hp: 3, cushion: 0 },
        { t: "seconds", slot: 1, atk: 1, hp: 1 },
      ],
    });
    // The Moth is next to him too: the empty place between them is no protection.
    feed(run, 1, 3);
    expect(run.line.map((s) => (s ? `${s.atk}/${s.hp}` : ""))).toEqual(["1/5", "6/10", "", "2/2", ""]);
  });
  test("Greg eats three bowls of the stew and leaves the rest of the line theirs", () => {
    const run = shop([], ["stew"], [of("leafling"), of("greg"), of("slug"), of("mossmote")]);
    expect(feed(run, 0).ok).toBe(true);
    expect(run.line.map((s) => (s ? `${s.atk}/${s.hp}` : ""))).toEqual(["2/3", "6/9", "1/5", "2/4", ""]);
  });
  test("a marshmallow gives a cushion for every fight, once", () => {
    const run = shop([], ["marshmallow", "marshmallow"], [of("slug")]);
    expect(feed(run, 0, 0).ok).toBe(true);
    expect(run.line[0]?.cushion).toBe(1);
    expect(feed(run, 1, 0)).toEqual({ ok: false, why: "As padded as can be already" });
    const f = fight(party(run), [of("wasp")], 1);
    expect(events(f, "clash")[0]?.hits[0]?.soak).toBe("cushion");
  });
  test("selling sends a spirit home for an acorn a level", () => {
    const run = shop([], [], [of("slug"), spirit("moth", 2)]);
    sell(run, 0);
    sell(run, 1);
    expect([run.acorns, kinds(run).filter(Boolean)]).toEqual([53, []]);
    expect(sell(run, 0).ok).toBe(false);
  });
  test("the line can be reordered, into empty places too, but a Rock stays where it was put", () => {
    const run = shop([], [], [of("slug"), of("rock"), of("moth")]);
    expect(swap(run, 0, 2).ok).toBe(true);
    expect(swap(run, 0, 4).ok).toBe(true);
    expect(kinds(run)).toEqual([null, "rock", "slug", null, "moth"]);
    expect(swap(run, 1, 0)).toEqual({ ok: false, why: "It is a rock. It stays where it is." });
    expect(swap(run, 0, 3).ok).toBe(false);
  });
  test("rustling costs an acorn and brings new offers, the same ones for the same seed", () => {
    const a = start(99);
    const b = start(99);
    const before = [...a.stall];
    rustle(a);
    rustle(b);
    expect(a.acorns).toBe(BUDGET - 1);
    expect([a.stall, a.snacks]).toEqual([b.stall, b.snacks]);
    for (let i = 0; i < 6; i++) rustle(a);
    expect(a.stall).not.toEqual(before);
    expect(rustle(a)).toEqual({ ok: true, notes: [] });
    expect(rustle(a)).toEqual({ ok: false, why: "Not enough acorns" });
  });
});

/** Plays a run to its end with a line that never changes. */
function through(run: Run, line: Spirit[]): Run {
  run.line = Array.from({ length: SLOTS }, (_, i) => line[i] ?? null);
  while (run.phase !== "over") {
    const out = ready(run);
    if (!out.ok) throw new Error(out.why);
    settle(run);
  }
  return run;
}
const giants = (): Spirit[] => Array.from({ length: SLOTS }, () => of("leafling", 60, 300));
/** How much there is of a party: everyone's attack and health together. */
const heft = (line: readonly Spirit[]): number => line.reduce((sum, s) => sum + s.atk + s.hp, 0);
/** A whole run by the plain shopper, as it stood at the end. */
function played(seed: number): string {
  const run = start(seed);
  while (run.phase !== "over") {
    autoTurn(run);
    ready(run);
    settle(run);
  }
  return save(run);
}

describe("a run", () => {
  test("a Chickaree buries one leftover acorn, which comes back as two next turn, or more from a bigger one", () => {
    const run = shop([], [], [of("chickaree", 1, 50), of("leafling", 9, 50)]);
    run.acorns = 2;
    const out = ready(run);
    expect(out.ok && out.notes).toEqual([{ t: "buried", slot: 0, comes: 2 }]);
    expect([run.acorns, run.buried]).toEqual([1, 2]);
    expect(settle(run)).toEqual([{ t: "dug", acorns: 2 }]);
    expect([run.acorns, run.buried, run.round]).toEqual([BUDGET + 2, 0, 2]);
    run.line[0] = spirit("chickaree", 3);
    run.line[1] = of("leafling", 60, 300);
    const more = ready(run);
    expect(more.ok && more.notes).toEqual([{ t: "buried", slot: 0, comes: 4 }]);
  });
  test("a Chickaree with nothing left over buries nothing, and what is not spent or buried is lost", () => {
    const run = shop([], [], [of("chickaree", 9, 50)]);
    run.acorns = 0;
    ready(run);
    expect(settle(run)).toEqual([]);
    const spare = shop([], [], [of("leafling", 9, 50)]);
    ready(spare);
    settle(spare);
    expect(spare.acorns).toBe(BUDGET);
  });
  test("will not set out with nobody in the line, or shop while the party is out", () => {
    const run = start(3);
    expect(ready(run)).toEqual({ ok: false, why: "Take at least one spirit along" });
    buy(run, 0);
    expect(ready(run).ok).toBe(true);
    expect([buy(run, 1).ok, rustle(run).ok, sell(run, 0).ok, swap(run, 0, 1).ok]).toEqual([false, false, false, false]);
  });
  test("a loss costs a heart, and the run ends when the hearts are gone", () => {
    const run = through(start(5), [of("chickaree", 0, 1)]);
    expect([run.hearts, run.round, run.record]).toEqual([0, HEARTS, ["loss", "loss", "loss"]]);
    expect(outcome(run)).toBe("lost");
    expect(settle(run)).toEqual([]);
  });
  test("a run is eight rounds, the last against the crab nobody counted, and is won by beating it", () => {
    const run = start(11);
    run.line = Array.from({ length: SLOTS }, (_, i) => giants()[i] ?? null);
    const tags: string[] = [];
    for (;;) {
      if (run.round === ROUNDS) expect(run.foe.party.at(-1)).toMatchObject({ kind: "bigcrab", tag: `#${run.missing}` });
      else tags.push(...run.foe.party.map((s) => s.tag).filter(Boolean));
      ready(run);
      settle(run);
      if (run.phase === "over") break;
    }
    expect([run.round, run.hearts, run.record.length]).toEqual([ROUNDS, HEARTS, ROUNDS]);
    expect(outcome(run)).toBe("won");
    expect(tags).not.toContain(`#${run.missing}`);
    expect(new Set(tags).size).toBe(tags.length);
  });
  test("the trouble escalates", () => {
    const run = start(11);
    run.line = Array.from({ length: SLOTS }, (_, i) => giants()[i] ?? null);
    const weight: number[] = [];
    while (run.phase !== "over") {
      weight.push(heft(run.foe.party));
      ready(run);
      settle(run);
    }
    expect(weight.slice(0, ROUNDS - 1)).toEqual(weight.slice(0, ROUNDS - 1).toSorted((a, b) => a - b));
  });
  test("reaching the boss and losing to it is not a win", () => {
    const run = start(11);
    run.line = Array.from({ length: SLOTS }, (_, i) => giants()[i] ?? null);
    while (run.round < ROUNDS) {
      ready(run);
      settle(run);
    }
    run.line = [of("chickaree", 0, 1), null, null, null, null];
    ready(run);
    settle(run);
    expect([run.phase, outcome(run), run.hearts]).toEqual(["over", "lost", HEARTS - 1]);
  });
  test("a draw costs nothing", () => {
    const run = start(5);
    run.foe.party = [of("gnat", 2, 2)];
    run.line = [of("leafling", 2, 2), null, null, null, null];
    ready(run);
    settle(run);
    expect([run.record, run.hearts, run.round]).toEqual([["draw"], HEARTS, 2]);
  });
  test("friendly bouts are against guild-mates' parties of spirits, and cost no hearts however they go", () => {
    const run = start(8, "friendly");
    expect(run.foe.who).not.toBe("The forest");
    expect(run.foe.party.every((s) => SPIRITS.some((k) => k === s.kind))).toBe(true);
    through(run, [of("chickaree", 0, 1)]);
    expect([run.hearts, run.record.length, outcome(run)]).toEqual([HEARTS, ROUNDS, "played"]);
  });
  test("a guild-mate's party is the same every time it is met, and grows with the rounds", () => {
    expect(ghost(77, 4)).toEqual(ghost(77, 4));
    expect(ghost(77, 4).party.length).toBeLessThanOrEqual(SLOTS);
    expect(heft(ghost(77, 8).party)).toBeGreaterThan(heft(ghost(77, 2).party));
  });
  test("the same seed and the same choices make the same run", () => {
    expect(played(2024)).toBe(played(2024));
    expect(played(2024)).not.toBe(played(2025));
  });
  test("a run can be saved and taken up again, and nonsense is not a run", () => {
    const run = start(31);
    autoTurn(run);
    const again = load(save(run));
    expect(again).toEqual(run);
    expect(load("{}")).toBeNull();
    expect(load("not a run")).toBeNull();
    // One kept by a version that knew a spirit this one does not.
    expect(load(save(run).replace(/"kind":"\w+"/, '"kind":"gnome"'))).toBeNull();
  });
});
