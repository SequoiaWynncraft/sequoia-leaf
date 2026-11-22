import { describe, expect, test } from "bun:test";

import { CALLERS, FOLK, folk, isFolk } from "@sequoia-leaf/town/folk.ts";
import { isLetter } from "@sequoia-leaf/town/mail.ts";
import { isThing, thingOf, THINGS } from "@sequoia-leaf/town/things.ts";

import { trophies } from "./games.ts";
import type { Happening, Person } from "./guild.ts";
import { GAP, type MadeUp, makeGuild, STANDINS } from "./madeup.ts";
import { lineFor } from "./news.ts";

/** Things that only ever come as presents from the town's own. */
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

/** Runs a guild's clock on for so many seconds, a quarter of a second at a time; what it told, and when. */
function evening(g: MadeUp, seconds: number): { at: number; h: Happening }[] {
  const heard: { at: number; h: Happening }[] = [];
  let at = 0;
  const stop = g.hear((h) => heard.push({ at, h }));
  for (let i = 0; i < seconds * 4; i++) {
    at = (i + 1) / 4;
    g.step(0.25);
  }
  stop();
  return heard;
}

/** The gaps between one moment and the next, in seconds; things told at the same moment are one. */
const gaps = (times: readonly number[]): number[] => {
  const moments = [...new Set(times)];
  return moments.slice(1).map((t, i) => t - (moments[i] ?? 0));
};

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
    expect(leaf(3)).toBe(80);
    expect(leaf(7)).toBe(160);
    expect(leaf(12)).toBe(320);
    expect(leaf(24 * 30)).toBe(320);
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
  const names = new Set(STANDINS.map((m) => m.name));
  const real = (p: Person): boolean => p.you || names.has(p.name);

  test("raids, wars, levels and milestones are only ever its stand-in members' (and the member's)", () => {
    const g = makeGuild({ random: steady(3) });
    const heard: Happening[] = [];
    g.hear((h) => heard.push(h));
    for (let i = 0; i < 12; i++) for (const kind of ["raid", "war", "level", "milestone"] as const) g.stir(kind);
    expect(new Set(heard.map((h) => h.kind))).toEqual(new Set(["party", "war", "reached", "milestone", "quest"]));
    for (const h of heard) {
      if (h.kind === "party" || h.kind === "war") {
        expect(h.who.length).toBeGreaterThan(0);
        expect(h.who.every(real)).toBe(true);
        expect(new Set(h.who.map((p) => p.id)).size).toBe(h.who.length);
      }
      if (h.kind === "reached" || h.kind === "milestone") expect(real(h.who) && !h.who.you).toBe(true);
    }
  });

  test("a level is one more than the last, for each stand-in", () => {
    const g = makeGuild({ random: steady(5) });
    const last = new Map(STANDINS.map((m) => [m.name, m.level]));
    const heard: Happening[] = [];
    g.hear((h) => heard.push(h));
    for (let i = 0; i < 20; i++) g.stir("level");
    for (const h of heard) {
      if (h.kind !== "reached") continue;
      expect(h.level).toBe((last.get(h.who.name) ?? 0) + 1);
      last.set(h.who.name, h.level);
    }
  });

  test("two stand-ins are in the game and two have gone a while, most recent first, never both", () => {
    const g = makeGuild({ now: () => THEN });
    const here = g.visitors().map((v) => v.name);
    const resting = g.resting();
    expect(here.length).toBe(2);
    expect(resting.length).toBe(2);
    expect(resting.map((r) => r.name).some((n) => here.includes(n))).toBe(false);
    expect(resting[0]?.seen ?? 0).toBeGreaterThan(resting[1]?.seen ?? 0);
    for (const r of resting) expect(THEN - r.seen).toBeGreaterThan(90_000);
    for (const v of [...g.visitors(), ...resting]) expect(v.skin).toBe("");
  });

  test("beside the real guild it has nobody: no stand-ins, no news; only the town's own calling", () => {
    const g = makeGuild({ random: steady(9), quiet: true });
    const heard: Happening[] = [];
    g.hear((h) => heard.push(h));
    for (let i = 0; i < 400 * 30; i++) g.step(1 / 30);
    for (const kind of ["raid", "war", "level", "milestone"] as const) g.stir(kind);
    expect(g.visitors()).toEqual([]);
    expect(g.resting()).toEqual([]);
    expect(heard.length).toBeGreaterThan(0);
    for (const h of heard) {
      expect(h.kind).toBe("call");
      if (h.kind === "call") expect(isFolk(h.who)).toBe(true);
    }
  });

  test("something happens within the first few seconds, and keeps happening", () => {
    const g = makeGuild({ random: steady(11) });
    const kinds: string[] = [];
    g.hear((h) => kinds.push(h.kind));
    for (let i = 0; i < 8 * 30; i++) g.step(1 / 30);
    expect(kinds.length).toBeGreaterThan(0);
    for (let i = 0; i < 30 * 60 * 30; i++) g.step(1 / 30);
    expect(new Set(kinds)).toEqual(new Set(["reached", "party", "war", "milestone", "quest", "call"]));
  });

  test("its moments, of any kind, are at least ninety seconds apart", () => {
    for (const seed of [1, 11, 42]) {
      const heard = evening(makeGuild({ random: steady(seed) }), 2 * 3600);
      expect(new Set(heard.map((x) => x.h.kind))).toEqual(
        new Set(["reached", "party", "war", "milestone", "quest", "call"]),
      );
      const between = gaps(heard.map((x) => x.at));
      expect(between.length).toBeGreaterThan(40);
      expect(Math.min(...between)).toBeGreaterThanOrEqual(GAP);
    }
  });

  test("a moment set off from outside is ninety seconds from the next the guild has of its own", () => {
    const g = makeGuild({ random: steady(4) });
    evening(g, 60);
    const heard: Happening[] = [];
    g.hear((h) => heard.push(h));
    g.stir("raid");
    expect(heard.map((h) => h.kind)).toEqual(["party"]);
    expect(evening(g, GAP - 1)).toEqual([]);
  });

  test("a stand-in levels up at most once in ten minutes", () => {
    for (const seed of [2, 13, 77]) {
      const heard = evening(makeGuild({ random: steady(seed) }), 3 * 3600);
      const levels = heard.filter((x) => x.h.kind === "reached").map((x) => x.at);
      expect(levels.length).toBeGreaterThan(5);
      expect(Math.min(...gaps(levels))).toBeGreaterThanOrEqual(600);
    }
  });

  test("a territory comes at most once in five minutes", () => {
    for (const seed of [3, 21, 64]) {
      const heard = evening(makeGuild({ random: steady(seed) }), 3 * 3600);
      const wars = heard.filter((x) => x.h.kind === "war").map((x) => x.at);
      expect(wars.length).toBeGreaterThan(10);
      expect(Math.min(...gaps(wars))).toBeGreaterThanOrEqual(300);
    }
  });

  test("its lines are said at once, worded as they always were", () => {
    const g = makeGuild({ random: steady(6) });
    const said: string[] = [];
    const who = STANDINS.slice(0, 2).map((s) => ({ id: s.name, name: s.name, you: false }));
    const land = "the Lantern Shallows";
    for (const h of [
      { kind: "war", who, land, held: true },
      { kind: "war", who, land, held: false },
      { kind: "reached", who: { id: "w", name: "Wrenly", you: false }, level: 73 },
    ] as const)
      g.say(h, (text) => said.push(text));
    expect(said).toEqual([
      "Quillfeather and Fernwhistle held the Lantern Shallows for the guild.",
      "Quillfeather and Fernwhistle fought for the Lantern Shallows.",
      "Wrenly reached level 73.",
    ]);
    // Everything it tells of its own is said in the same words.
    for (const { h } of evening(g, 3600)) {
      const line: string[] = [];
      g.say(h, (text) => line.push(text));
      expect(line).toEqual(h.kind === "call" ? [] : [lineFor(h)?.[0] ?? ""]);
    }
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

  test("everything for sale is a camp thing with a price, each stall kept by its own keeper", () => {
    const g = makeGuild();
    for (const w of g.wares()) expect(w.price).toBeGreaterThan(0);
    const sold = new Set<string>();
    g.stalls().forEach((stall, i) => {
      const keeper = FOLK.find((t) => t.name === stall.by);
      expect(keeper?.job).toMatchObject({ stall: i });
      expect(stall.stock.length).toBeGreaterThan(5);
      for (const s of stall.stock) {
        expect(isThing(s.thing)).toBe(true);
        expect(s.price).toBeGreaterThan(0);
        expect(sold.has(s.thing)).toBe(false);
        sold.add(s.thing);
      }
    });
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

describe("the made-up guild's letters and callers", () => {
  test("nobody's camp may be visited yet", () => {
    const g = makeGuild({ random: steady(2) });
    for (const name of [...STANDINS.map((m) => m.name), ...FOLK.map((t) => t.name), "Nobody"])
      expect(g.camp(name)).toBeNull();
  });

  test("a first visit finds a letter with a present, and no time away finds none", () => {
    const g = makeGuild();
    const first = g.mail(0, THEN);
    expect(first.length).toBe(1);
    expect(first[0]?.gift).toBe("toadstool");
    expect(g.mail(THEN, THEN + 20 * 60_000)).toEqual([]);
    expect(g.mail(THEN, THEN - HOUR)).toEqual([]);
  });

  test("the same time away always leaves the same letters, each a real letter from one of the town's own", () => {
    const g = makeGuild();
    const mail = g.mail(THEN, THEN + 9 * HOUR);
    expect(mail.length).toBe(2);
    expect(mail).toEqual(makeGuild({ random: steady(5) }).mail(THEN, THEN + 9 * HOUR));
    for (const l of mail) {
      expect(isLetter(l)).toBe(true);
      expect(isFolk(l.from)).toBe(true);
    }
    expect(new Set(mail.map((l) => l.id)).size).toBe(mail.length);
  });

  test("the letter and the arrival letter's line are about the same one of the town's own", () => {
    for (let k = 0; k < 20; k++) {
      const g = makeGuild();
      const from = THEN + k * 7919_000;
      const line = g.away(from, from + 2 * HOUR).lines.find((l) => l.art === "folk");
      expect(line?.who?.length).toBe(1);
      expect(isFolk(line?.who?.[0] ?? "")).toBe(true);
      expect(g.mail(from, from + 2 * HOUR)[0]?.from).toBe(line?.who?.[0] ?? "");
    }
  });

  test("whoever looks in at the camp is one of the town's callers, and each visit's letter has a name of its own", () => {
    let memory = "";
    const g = makeGuild({ random: steady(8), keep: (t) => (memory = t) });
    const heard: Happening[] = [];
    g.hear((h) => heard.push(h));
    for (let i = 0; i < 12; i++) g.stir("call");
    const calls = heard.flatMap((h) => (h.kind === "call" ? [h] : []));
    expect(calls.length).toBe(12);
    const callers = CALLERS.map((id) => folk(id).name);
    for (const c of calls) {
      expect(callers).toContain(c.who);
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
