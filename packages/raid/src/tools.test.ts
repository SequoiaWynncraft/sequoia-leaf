import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { planRoom, SENSIBLE } from "./bot.ts";
import { isPredicted, legal, readRunCommand } from "./command.ts";
import { COMPONENT_IDS, type ItemId, sortOf } from "./content/items.ts";
import { LEGACY_ERA } from "./content/releases.ts";
import { ROOMS } from "./content/rooms.ts";
import { meltValue, type RackItem, TOOL_IDS } from "./content/tools.ts";
import { RAID } from "./game.ts";
import { forgeItems, melt, useTongs, useWhetstone } from "./rack.ts";
import { countOn, rackOf, rackSize } from "./racks.ts";
import { roomPicks } from "./rewards.ts";
import { roomOf } from "./room.ts";
import { beginFight, choose, giveItem, newPiece, type Run, startRun, takeTakings } from "./run.ts";
import { checkRun } from "./save.ts";
import { wayOn } from "./way.ts";

/** A run planning its first room: a worm on the board at seat 3, holding `held`, with `items` on the rack. */
function planning(items: RackItem[], held: ItemId[] = [], seed = 5): Run {
  const run = startRun(seed, { era: LEGACY_ERA });
  choose(run, 0);
  run.board = run.board.map(() => null);
  const worm = newPiece(run, "worm");
  worm.items = held;
  run.board[3] = worm;
  run.rack = rackOf(items);
  return run;
}
const WORM = { on: "board", at: 3 } as const;
const ctx = {
  now: 1_800_000_000_000,
  player: { id: "10000000-0000-0000-0000-000000000001", guest: false },
  seed: 1,
  room: 1e9,
  awards: [],
  postcards: {},
};

describe("melting by hand", () => {
  test("takes one off the rack for acorns by its sort: a component 1, a finished item or an emblem 3, a tool 2", () => {
    expect([meltValue("thorn"), meltValue("blackthorn"), meltValue("crabcharm"), meltValue("tongs")]).toEqual([
      1, 3, 3, 2,
    ]);
    const run = planning(["thorn", "blackthorn", "blackthorn", "tongs"]);
    const acorns = run.acorns;
    expect(melt(run, "blackthorn")).toEqual({ ok: true, notes: [{ t: "melted", item: "blackthorn", acorns: 3 }] });
    expect(run.rack).toEqual({ thorn: 1, blackthorn: 1, tongs: 1 });
    expect(run.acorns).toBe(acorns + 3);
    expect(melt(run, "tongs").ok).toBe(true);
    expect(run.acorns).toBe(acorns + 5);
    expect(run.rack).toEqual({ thorn: 1, blackthorn: 1 });
  });
  test("is refused for a kind there is none of, and while a pick waits", () => {
    const run = planning(["thorn"]);
    expect(melt(run, "plume")).toMatchObject({ ok: false, code: "no_such_item" });
    run.stage = { phase: "plan", picks: [{ kind: "component", options: ["bark"] }] };
    expect(melt(run, "thorn")).toMatchObject({ ok: false, code: "pick_component" });
  });
  test("draws nothing, so a page does it at once; and nothing ever melts by itself", () => {
    expect(isPredicted({ do: "melt", item: "thorn" })).toBe(true);
    const run = planning(Array.from({ length: 1000 }, (_, i) => COMPONENT_IDS[i % 5] ?? "thorn"));
    run.stage = { phase: "plan", picks: [{ kind: "component", options: ["bark"] }] };
    choose(run, 0);
    expect(rackSize(run.rack)).toBe(1001);
  });
});

describe("the Tongs", () => {
  test("take everything a figure holds back to the rack as it is, and are gone", () => {
    const run = planning(["bark", "tongs"], ["blackthorn", "plume", "mosscharm"]);
    run.boons = ["mosscharm"];
    const piece = run.board[3]?.id ?? 0;
    expect(useTongs(run, WORM)).toEqual({
      ok: true,
      notes: [{ t: "tongs", piece, items: ["blackthorn", "plume", "mosscharm"] }],
    });
    expect(run.rack).toEqual(rackOf(["bark", "blackthorn", "plume", "mosscharm"]));
    expect(run.board[3]?.items).toEqual([]);
  });
  test("are never refused for want of room: the rack has no limit", () => {
    const run = planning([...Array.from({ length: 2000 }, (): RackItem => "thorn"), "tongs"], ["hedgehog", "conker"]);
    expect(useTongs(run, WORM).ok).toBe(true);
    expect(rackSize(run.rack)).toBe(2002);
  });
  test("are refused on a figure holding nothing, on nobody, and with none on the rack", () => {
    const run = planning(["tongs", "whetstone"]);
    expect(useTongs(run, WORM)).toMatchObject({ ok: false, code: "holds_nothing" });
    expect(useTongs(run, { on: "board", at: 9 })).toMatchObject({ ok: false, code: "nobody_there" });
    const none = planning(["whetstone"], ["thorn"]);
    expect(useTongs(none, WORM)).toMatchObject({ ok: false, code: "no_such_item" });
    expect(run.rack).toEqual({ tongs: 1, whetstone: 1 });
  });
  test("are a tool, not an item: never handed over or forged, and done at once on the page", () => {
    expect(readRunCommand({ do: "give", item: "tongs", to: WORM })).toBeNull();
    expect(readRunCommand({ do: "forge", item: "tongs", with: "thorn" })).toBeNull();
    const run = planning(["tongs", "thorn"], ["plume"]);
    expect(isPredicted({ do: "tongs", to: WORM })).toBe(true);
    expect(legal(run, { do: "tongs", to: WORM })).toBe(true);
    expect(giveItem(run, "thorn", WORM).ok).toBe(true);
  });
});

describe("the Whetstone", () => {
  test("turns each component and finished item a figure holds into another of its sort, leaves its emblem, and is gone", () => {
    for (let seed = 1; seed <= 40; seed++) {
      const run = planning(["whetstone"], ["thorn", "blackthorn", "crabcharm"], seed);
      run.boons = ["crabcharm"];
      const done = useWhetstone(run, WORM);
      if (!done.ok) throw new Error(done.why);
      const now = run.board[3]?.items ?? [];
      expect(now.map(sortOf)).toEqual(["component", "finished", "emblem"]);
      expect(now[0]).not.toBe("thorn");
      expect(now[1]).not.toBe("blackthorn");
      // The emblem is its charm's: it stays.
      expect(now[2]).toBe("crabcharm");
      expect(run.rack).toEqual({});
      const piece = run.board[3]?.id ?? 0;
      expect(done.notes).toEqual([{ t: "whetted", piece, was: ["thorn", "blackthorn", "crabcharm"], now }]);
    }
  });
  test("draws from the run's dice: the same run, the same outcome; another, another", () => {
    const outcomes = new Set<string>();
    for (let seed = 1; seed <= 30; seed++) {
      const a = planning(["whetstone"], ["blackthorn"], seed);
      const b = planning(["whetstone"], ["blackthorn"], seed);
      useWhetstone(a, WORM);
      useWhetstone(b, WORM);
      expect(a.board[3]?.items).toEqual(b.board[3]?.items);
      outcomes.add(a.board[3]?.items.join() ?? "");
    }
    expect(outcomes.size).toBeGreaterThan(5);
    expect(isPredicted({ do: "whetstone", to: WORM })).toBe(false);
  });
  test("leaves the run readable: every emblem stays its charm's, and a charm taken later gives its own", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const run = planning(["whetstone"], ["embercharm", "thorn"], seed);
      run.boons = ["embercharm"];
      expect(useWhetstone(run, WORM).ok).toBe(true);
      // Mosscharm taken later: its emblem is the only Moss one.
      run.stage = { phase: "plan", picks: [{ kind: "boon", options: ["mosscharm"], redraws: 0 }] };
      expect(choose(run, 0).ok).toBe(true);
      const read = checkRun(JSON.parse(JSON.stringify(run)));
      expect(read.ok ? "" : read.why).toBe("");
    }
  });
  test("is refused on a figure holding only emblems, which it would leave as they are", () => {
    const run = planning(["whetstone"], ["crabcharm"]);
    run.boons = ["crabcharm"];
    expect(useWhetstone(run, WORM)).toMatchObject({ ok: false, code: "only_emblems" });
  });
  test("an emblem melted stays melted: reading the run again does not put it back", () => {
    const run = planning(["crabcharm", "thorn"]);
    run.boons = ["crabcharm"];
    expect(melt(run, "crabcharm").ok).toBe(true);
    const read = checkRun(JSON.parse(JSON.stringify(run)));
    expect(read.ok && read.run.rack).toEqual({ thorn: 1 });
  });
  test("is refused on a figure holding nothing", () => {
    expect(useWhetstone(planning(["whetstone"]), WORM)).toMatchObject({ ok: false, code: "holds_nothing" });
  });
});

/** In how many of `n` runs the picks after a room had a tool, and in how many their first pick was only tools. */
function tally(room: number, won = true, n = 4000): { any: number; all: number } {
  let any = 0;
  let all = 0;
  for (let seed = 1; seed <= n; seed++) {
    const run = startRun(seed, { era: LEGACY_ERA });
    const picks = roomPicks(run, roomOf(run, room), won);
    const options = picks.flatMap((p) => (p.kind === "component" ? p.options : []));
    const first = picks[0]?.kind === "component" ? picks[0].options : [];
    if (options.some((o) => TOOL_IDS.some((t) => t === o))) any++;
    if (first.length > 0 && first.every((o) => TOOL_IDS.some((t) => t === o))) all++;
    for (const p of picks) if (p.kind === "component") expect(new Set(p.options).size).toBe(p.options.length);
  }
  return { any: any / n, all: all / n };
}

describe("where tools come from", () => {
  test("a boss room's picks have one tool in place of one component, one time in two", () => {
    const { any, all } = tally(ROOMS.findIndex((r) => r.kind === "boss"));
    expect(any).toBeGreaterThan(0.46);
    expect(any).toBeLessThan(0.54);
    expect(all).toBe(0);
  });
  test("a trouble room's pick is of tools instead of components, one time in ten", () => {
    const { any, all } = tally(ROOMS.findIndex((r) => r.kind === "trouble"));
    expect(any).toBeGreaterThan(0.08);
    expect(any).toBeLessThan(0.12);
    expect(all).toBe(any);
  });
  test("in an endless run past room 15, every tenth room's first pick is of tools, whatever the room", () => {
    const wilds = wayOn({ id: "wilds" });
    for (const room of [19, 29, 99])
      for (const won of [true, false])
        for (let seed = 1; seed <= 20; seed++) {
          const run = startRun(seed, { era: LEGACY_ERA, way: wilds });
          expect(roomPicks(run, roomOf(run, room), won)[0]).toEqual({ kind: "component", options: [...TOOL_IDS] });
        }
  });
});

describe("the commands off the wire", () => {
  test("name a kind on the rack, and for a tool only the figure", () => {
    expect(readRunCommand({ do: "melt", item: "tongs" })).toEqual({ do: "melt", item: "tongs" });
    expect(readRunCommand({ do: "give", item: "thorn", to: WORM })).toEqual({ do: "give", item: "thorn", to: WORM });
    expect(readRunCommand({ do: "tongs", to: WORM, item: 4 })).toEqual({ do: "tongs", to: WORM });
    expect(readRunCommand({ do: "whetstone", to: WORM })).toEqual({ do: "whetstone", to: WORM });
    expect(readRunCommand({ do: "melt", item: 3 })).toBeNull();
    expect(readRunCommand({ do: "give", item: 0, to: WORM })).toBeNull();
    expect(readRunCommand({ do: "tongs" })).toBeNull();
  });
});

/** A run deep in, five thousand on its rack: a thousand of most components, and some of everything else. */
function deep(): Run {
  const run = planning([], ["thorn"]);
  run.rack = {
    thorn: 1000,
    plume: 1000,
    glowcap: 1000,
    bark: 1000,
    chestnut: 960,
    blackthorn: 30,
    hoard: 8,
    tongs: 1,
    whetstone: 1,
  };
  return run;
}

describe("a rack of five thousand", () => {
  test("is kept as counts by kind: as small stored as a rack of a few", () => {
    const run = deep();
    expect(rackSize(run.rack)).toBe(5000);
    const stored = JSON.stringify({ rack: run.rack }).length;
    const few = JSON.stringify({ rack: rackOf(["thorn", "plume", "blackthorn", "tongs"]) }).length;
    expect(stored).toBeLessThan(200);
    expect(stored - few).toBeLessThan(120);
  });
  test("reads, plays and stores, and stays the same size", () => {
    const run = deep();
    const table = { ...RAID.create(ctx), begun: { main: 1, endless: 0 }, held: { main: run, endless: null } };
    const text = RAID.encode(table);
    const back = RAID.decode(text)?.held.main;
    if (!back) throw new Error("did not read");
    expect(back.rack).toEqual(run.rack);
    // Plays: things are handed over, forged, melted and used, and a room is planned, fought and taken.
    expect(giveItem(back, "plume", WORM).ok).toBe(true);
    expect(forgeItems(back, "bark", "bark").ok).toBe(true);
    expect(melt(back, "chestnut").ok).toBe(true);
    expect(useTongs(back, WORM).ok).toBe(true);
    planRoom(back, SENSIBLE);
    expect(beginFight(back).ok).toBe(true);
    expect(takeTakings(back).ok).toBe(true);
    expect(rackSize(back.rack)).toBeGreaterThan(4900);
    const again = RAID.encode({ ...table, held: { main: back, endless: null } });
    expect(Math.abs(again.length - text.length)).toBeLessThan(2000);
    expect(RAID.decode(again)?.held.main?.rack).toEqual(back.rack);
    expect(countOn(back.rack, "blackthorn")).toBeGreaterThanOrEqual(30);
  });
  test("a run kept with its rack as a list of thousands still reads, folded into counts", () => {
    const run = deep();
    const { rack, ...rest } = JSON.parse(JSON.stringify(run));
    const items = Object.entries(rack).flatMap(([kind, n]) => Array.from({ length: Number(n) }, () => kind));
    const read = checkRun({ ...rest, items }, false, false, false, false);
    if (!read.ok) throw new Error(read.why);
    expect(read.run.rack).toEqual(run.rack);
  });
  test("acorns and figures' numbers past what a run once kept still read; negative or broken ones do not", () => {
    const run = deep();
    run.acorns = 2_000_000;
    run.nextId = 3_000_000;
    const read = checkRun(JSON.parse(JSON.stringify(run)));
    expect(read.ok && [read.run.acorns, read.run.nextId]).toEqual([2_000_000, 3_000_000]);
    const broken = [
      { acorns: -1 },
      { acorns: 1.5 },
      { nextId: 0.5 },
      { rack: { thorn: -2 } },
      { rack: { thorn: 0 } },
      { rack: { thorn: 1.5 } },
      { rack: { nope: 1 } },
    ];
    for (const bad of broken) expect(checkRun({ ...JSON.parse(JSON.stringify(run)), ...bad }).ok).toBe(false);
  });
});

/**
 * As production keeps one: the room-400 fixture (a table of version 8) read and written back as
 * version 9 keeps it, its record as rows and its rack a list, with 314 on the rack in 18 kinds.
 */
function keptAtNine(): { text: string; listed: string[] } {
  const fixture = RAID.decode(readFileSync(join(import.meta.dir, "../stored/wilds-past-room-400.json"), "utf8"));
  if (!fixture?.held.endless) throw new Error("the fixture did not read");
  const stored = JSON.parse(RAID.encode(fixture));
  const kinds = ["thorn", "plume", "glowcap", "bark", "chestnut", "blackthorn", "wasptail", "conker"];
  const more = ["hedgehog", "hollowlog", "honeycake", "hummingbird", "lichen", "mothlantern", "stewpot", "stump"];
  const all = [...kinds, ...more, "quilt", "fairyring"];
  const listed = Array.from({ length: 314 }, (_, i) => all[i < 250 ? i % 5 : 5 + ((i - 250) % 13)] ?? "thorn");
  const { rack: _, ...endless } = stored.held.endless;
  const text = JSON.stringify({ ...stored, v: 9, held: { ...stored.held, endless: { ...endless, items: listed } } });
  return { text, listed };
}

describe("a deep Wilds run kept at table version 9", () => {
  test("reads, plays a room, and is stored again as table version 10, its rack as counts", () => {
    const { text, listed } = keptAtNine();
    expect(new Set(listed).size).toBe(18);
    const table = RAID.decode(text);
    const run = table?.held.endless;
    if (!table || !run) throw new Error("the version 9 table did not read");
    expect(rackSize(run.rack)).toBe(314);
    expect(Object.keys(run.rack)).toHaveLength(18);
    expect(run.room).toBeGreaterThan(400);
    // A room played on it as Leaf plays one: planned by the bot, fought, and its takings taken.
    const room = run.room;
    planRoom(run, SENSIBLE);
    expect(beginFight(run).ok).toBe(true);
    expect(takeTakings(run).ok).toBe(true);
    expect(run.room === room + 1 || run.stage.phase === "over").toBe(true);
    const again = RAID.encode(table);
    const kept = JSON.parse(again);
    expect(kept.v).toBe(10);
    expect(kept.held.endless.items).toBeUndefined();
    expect(Object.values(kept.held.endless.rack).reduce((n: number, c) => n + Number(c), 0)).toBe(rackSize(run.rack));
    expect(RAID.decode(again)?.held.endless?.rack).toEqual(run.rack);
    // Its rack as counts is a few hundred bytes, where the list was some thousands.
    expect(JSON.stringify(kept.held.endless.rack).length).toBeLessThan(400);
    expect(JSON.stringify(listed).length).toBeGreaterThan(2500);
  });
});
