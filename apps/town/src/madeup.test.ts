import { describe, expect, test } from "bun:test";

import { allReached } from "./camp.ts";
import { trophies } from "./games.ts";
import type { Activity, Happening } from "./guild.ts";
import { makeGuild } from "./madeup.ts";
import { isLetter } from "./mail.ts";
import { isThing, thingOf, THINGS } from "./things.ts";

/** Things that only ever come as presents from guild-mates. */
const GIVEN = ["pinecone", "painted-pebble", "acorn-jar", "tiny-cairn", "crab-drawing", "gnome-traveller"];

/** A stream of numbers that is the same every run. */
function steady(seed = 7): () => number {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}

const HOUR = 3_600_000;
const THEN = 1_795_000_000_000;

describe("the made-up guild while the member is away", () => {
  const g = makeGuild({ random: steady() });
  /** The Leaf the guild credits for so many hours away. */
  const leaf = (hours: number): number =>
    g.away(THEN, THEN + hours * HOUR).lines.reduce((n, l) => n + (l.pay?.kind === "leaf" ? l.pay.amount : 0), 0);

  test("a first visit is met with something kept", () => {
    const a = g.away(0, THEN);
    expect(a.first).toBe(true);
    expect(a.lines.some((l) => l.pay?.kind === "leaf")).toBe(true);
  });

  test("no time away pays nothing", () => {
    for (const gone of [0, 1000, 30 * 60_000, HOUR, 2.9 * HOUR])
      expect(g.away(THEN, THEN + gone).lines.every((l) => !l.pay)).toBe(true);
  });

  test("a clock gone backwards pays nothing", () => {
    const a = g.away(THEN, THEN - 9 * HOUR);
    expect(a.hours).toBe(0);
    expect(a.lines.every((l) => !l.pay)).toBe(true);
  });

  test("a raid for every three hours, and never more than four", () => {
    expect(leaf(3)).toBe(12);
    expect(leaf(7)).toBe(24);
    expect(leaf(12)).toBe(48);
    expect(leaf(24 * 30)).toBe(48);
  });

  test("the same stretch of time always reads the same", () => {
    expect(g.away(THEN, THEN + 9 * HOUR)).toEqual(g.away(THEN, THEN + 9 * HOUR));
    expect(makeGuild({ random: steady(99) }).away(THEN, THEN + 9 * HOUR)).toEqual(g.away(THEN, THEN + 9 * HOUR));
  });

  test("only Leaf comes from the guild", () => {
    expect(g.away(THEN, THEN + 40 * HOUR).lines.every((l) => !l.pay || l.pay.kind === "leaf")).toBe(true);
  });
});

describe("the made-up guild's evening", () => {
  test("a party sets out, comes back, and nobody is in two places", () => {
    const g = makeGuild({ random: steady(3) });
    const heard: Happening[] = [];
    g.hear((h) => heard.push(h));
    g.stir("raidBack");
    expect(heard).toEqual([]);
    g.stir("raidOut");
    g.stir("raidOut");
    expect(heard.length).toBe(1);
    const out = heard[0];
    if (out?.kind !== "raidOut") throw new Error("no party set out");
    expect(new Set(out.who).size).toBe(4);
    const names = new Set(g.roster().map((m) => m.name));
    expect(out.who.every((n) => names.has(n))).toBe(true);
    // Nobody levels while they are away.
    for (let i = 0; i < 40; i++) g.stir("level");
    for (const h of heard) if (h.kind === "level") expect(out.who).not.toContain(h.who);
    g.stir("raidBack");
    const back = heard[heard.length - 1];
    if (back?.kind !== "raidBack") throw new Error("no party came back");
    expect(back.who).toEqual(out.who);
    expect(back.raid).toBe(out.raid);
  });

  test("a level is one more than it was, and the roster says so", () => {
    const g = makeGuild({ random: steady(5) });
    const before = new Map(g.roster().map((m) => [m.name, m.level]));
    const heard: Happening[] = [];
    g.hear((h) => heard.push(h));
    g.stir("level");
    const h = heard[0];
    if (h?.kind !== "level") throw new Error("nobody levelled");
    expect(h.level).toBe((before.get(h.who) ?? 0) + 1);
    expect(g.roster().find((m) => m.name === h.who)?.level).toBe(h.level);
  });

  test("something happens within the first few seconds, and keeps happening", () => {
    const g = makeGuild({ random: steady(11) });
    const kinds: string[] = [];
    g.hear((h) => kinds.push(h.kind));
    for (let i = 0; i < 8 * 30; i++) g.step(1 / 30);
    expect(kinds.length).toBeGreaterThan(0);
    for (let i = 0; i < 100 * 30; i++) g.step(1 / 30);
    expect(new Set(kinds)).toEqual(new Set(["level", "raidOut", "raidBack", "land", "quest", "call"]));
  });

  test("a quest is finished once, and says so once", () => {
    let memory = "";
    const g = makeGuild({ random: steady(), keep: (t) => (memory = t) });
    const done: string[] = [];
    g.hear((h) => {
      if (h.kind === "quest") done.push(h.id);
    });
    const planks = (): number => g.quests().find((q) => q.id === "planks")?.have ?? -1;
    expect(planks()).toBe(31);
    for (let i = 0; i < 200 * 30; i++) g.step(1 / 30);
    expect(planks()).toBe(40);
    expect(done.filter((id) => id === "planks")).toEqual(["planks"]);
    for (const q of g.quests()) expect(q.have).toBeLessThanOrEqual(q.need);
    // And the guild that picks up its memory has not forgotten.
    const next = makeGuild({ memory, random: steady() });
    expect(next.quests().find((q) => q.id === "planks")?.have).toBe(40);
    const again: string[] = [];
    next.hear((h) => {
      if (h.kind === "quest") again.push(h.id);
    });
    for (let i = 0; i < 30 * 30; i++) next.step(1 / 30);
    expect(again).not.toContain("planks");
  });

  test("a memory that makes no sense is the board as it was pinned up", () => {
    const fresh = makeGuild({ random: steady() }).quests();
    for (const memory of ["", "nonsense", "[]", '{"v":2,"progress":{"planks":40}}', '{"v":1,"progress":"all of it"}'])
      expect(makeGuild({ memory, random: steady() }).quests()).toEqual(fresh);
    const odd = makeGuild({ memory: '{"v":1,"progress":{"planks":-4,"hold":9999,"raids":"x"}}', random: steady() });
    expect(odd.quests().map((q) => q.have)).toEqual([3, 31, 60]);
  });

  test("everybody is always off to do something the town has a place for", () => {
    const g = makeGuild({ random: steady(21) });
    const known: readonly Activity[] = [
      "fire",
      "bench",
      "play",
      "treasury",
      "quests",
      "market",
      "stall",
      "works",
      "table",
      "pond",
      "tree",
      "pole",
      "garden",
    ];
    const seen = new Set<Activity>();
    for (let i = 0; i < 600; i++) seen.add(g.doing("Mossback"));
    for (const a of seen) expect(known).toContain(a);
    expect(seen.size).toBe(known.length);
  });

  test("everything for sale is a camp thing with a price, sold by somebody in town", () => {
    const g = makeGuild();
    for (const w of g.wares()) expect(w.price).toBeGreaterThan(0);
    const names = g.roster().map((m) => m.name);
    const sold = new Set<string>();
    for (const stall of g.stalls()) {
      expect(names).toContain(stall.by);
      expect(stall.stock.length).toBeGreaterThan(5);
      for (const s of stall.stock) {
        expect(isThing(s.thing)).toBe(true);
        expect(s.price).toBeGreaterThan(0);
        expect(sold.has(s.thing)).toBe(false);
        sold.add(s.thing);
      }
    }
    for (const s of g.pieces()) {
      expect(isThing(s.thing)).toBe(true);
      expect(s.price).toBeGreaterThan(0);
      expect(sold.has(s.thing)).toBe(false);
    }
    expect(sold.size).toBeGreaterThanOrEqual(40);
  });

  test("every kind of thing can be had somewhere, and nothing won or given is for sale", () => {
    const g = makeGuild();
    const sold = new Set([...g.stalls().flatMap((s) => s.stock), ...g.pieces()].map((s) => s.thing));
    const won = new Set(trophies());
    for (const t of THINGS) {
      if (t.kind === "trophies") expect(sold.has(t.id)).toBe(false);
      else if (t.kind !== "home" && !sold.has(t.id)) expect(GIVEN).toContain(t.id);
    }
    for (const id of won) expect(thingOf(id)?.kind).toBe("trophies");
    for (const id of g.presents()) expect(isThing(id)).toBe(true);
  });
});

describe("the made-up guild's camps and letters", () => {
  test("every guild-mate has a camp, the same every visit", () => {
    const g = makeGuild({ random: steady(2) });
    for (const m of g.roster()) {
      const camp = g.camp(m.name);
      expect(camp).not.toBeNull();
      expect(camp?.placed).toEqual(makeGuild({ random: steady(40) }).camp(m.name)?.placed);
      expect(camp?.pets.length).toBeGreaterThan(0);
      expect(camp?.note.length).toBeGreaterThan(0);
      expect(camp && allReached(camp.placed)).toBe(true);
    }
    expect(g.camp("Nobody")).toBeNull();
  });

  test("no two guild-mates keep the same camp", () => {
    const g = makeGuild();
    const seen = new Set(g.roster().map((m) => JSON.stringify(g.camp(m.name)?.placed)));
    expect(seen.size).toBe(g.roster().length);
  });

  test("somebody away on a raid is not at home", () => {
    const g = makeGuild({ random: steady(3) });
    const heard: Happening[] = [];
    g.hear((h) => heard.push(h));
    g.stir("raidOut");
    const out = heard[0];
    if (out?.kind !== "raidOut") throw new Error("no party set out");
    for (const m of g.roster()) expect(g.camp(m.name)?.home).toBe(!out.who.includes(m.name));
  });

  test("a first visit finds a letter with a present, and no time away finds none", () => {
    const g = makeGuild();
    const first = g.mail(0, THEN);
    expect(first.length).toBe(1);
    expect(first[0]?.gift).toBe("toadstool");
    expect(g.mail(THEN, THEN + 20 * 60_000)).toEqual([]);
    expect(g.mail(THEN, THEN - HOUR)).toEqual([]);
  });

  test("the same time away always leaves the same letters, each a real letter", () => {
    const g = makeGuild();
    const mail = g.mail(THEN, THEN + 9 * HOUR);
    expect(mail.length).toBe(2);
    expect(mail).toEqual(makeGuild({ random: steady(5) }).mail(THEN, THEN + 9 * HOUR));
    for (const l of mail) expect(isLetter(l)).toBe(true);
    expect(new Set(mail.map((l) => l.id)).size).toBe(mail.length);
  });

  test("the letter and the arrival letter's line are about the same guild-mate", () => {
    const g = makeGuild();
    const line = g.away(THEN, THEN + 2 * HOUR).lines.find((l) => l.art === "mates");
    expect(g.mail(THEN, THEN + 2 * HOUR)[0]?.from).toBe(line?.who?.[0] ?? "");
  });

  test("a guild-mate who looks in is somebody in town, and their letter has a name of its own", () => {
    let memory = "";
    const g = makeGuild({ random: steady(8), keep: (t) => (memory = t) });
    const heard: Happening[] = [];
    g.hear((h) => heard.push(h));
    for (let i = 0; i < 12; i++) g.stir("call");
    const calls = heard.flatMap((h) => (h.kind === "call" ? [h] : []));
    expect(calls.length).toBe(12);
    const names = g.roster().map((m) => m.name);
    for (const c of calls) {
      expect(names).toContain(c.who);
      expect(c.gift === "" || isThing(c.gift)).toBe(true);
    }
    expect(new Set(calls.map((c) => c.id)).size).toBe(12);
    expect(calls.some((c) => c.gift !== "")).toBe(true);
    expect(calls.some((c) => c.note === "" && c.gift === "")).toBe(true);
    // The guild that picks up its memory does not use a name again.
    const next = makeGuild({ memory, random: steady(8) });
    const again: Happening[] = [];
    next.hear((h) => again.push(h));
    next.stir("call");
    const one = again[0];
    expect(one?.kind === "call" && !calls.some((c) => c.id === one.id)).toBe(true);
  });
});
