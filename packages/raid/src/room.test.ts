import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { LEGACY_ERA } from "./content/releases.ts";
import { ECONOMY, type RoomKind, ROOMS } from "./content/rooms.ts";
import { apart, bind, PLAIN_RULES, ROOM_RULES, ruled } from "./content/rules.ts";
import { RULE_IDS, type RuleId, WILDS } from "./content/wilds.ts";
import { grownAt } from "./endless.ts";
import { openFight, stepFight } from "./fight/engine.ts";
import { attackReach, rulesOf } from "./fight/rules.ts";
import type { FightEvent, FightSetup } from "./fight/types.ts";
import { RAID } from "./game.ts";
import { colOf, COLS, distance } from "./hex.ts";
import { closedNow, roomOf, setupRules } from "./room.ts";
import { beginFight, fieldCap, foughtOf, playsAsKept, type Run, startRun } from "./run.ts";
import { fields } from "./save.ts";
import { at, partyOfFigures } from "./testkit.ts";
import { wayOn } from "./way.ts";
import { wingOf } from "./wing.ts";

/** What one rule sets, from what it drew. */
const one = (rule: RuleId, drawn: number[] = []) => ruled(ROOM_RULES[rule].sets(drawn));
const BRAWL = [
  at("rock", 0, 0),
  at("badger", 3, 0),
  at("crab7", 6, 0),
  at("emberkit", 2, 1),
  at("finch", 4, 2),
  at("heron", 1, 3),
  at("moth", 5, 3),
];
const setupUnder = (rules: Pick<FightSetup, "rules">, seed = 7): FightSetup => ({
  seed,
  era: LEGACY_ERA,
  sides: [partyOfFigures(BRAWL), partyOfFigures(BRAWL)],
  ...rules,
});
/** A fight played out: every hex anyone stood on after each step, and every event. */
function playOut(setup: FightSetup): { cells: number[]; events: FightEvent[] } {
  const f = openFight(setup);
  const cells = f.units.filter((u) => u.alive).map((u) => u.cell);
  const events: FightEvent[] = [];
  while (!f.over) {
    events.push(...stepFight(f));
    cells.push(...f.units.filter((u) => u.alive).map((u) => u.cell));
  }
  return { cells, events };
}

describe("two rules bound", () => {
  test("close the seats either closes, with the lower reach and dusk, and both rules' extra attack", () => {
    const stumps = one("stumps", [2, 9, 20]);
    const narrow = one("narrow");
    expect(bind(stumps, narrow).closed).toEqual([0, 2, 6, 7, 9, 13, 14, 20, 21, 27]);
    expect(bind(stumps, one("long"))).toMatchObject({ closed: [2, 9, 20], closedToSit: [0, 1, 2, 3, 4, 5, 6] });
    expect(bind(one("fog"), one("dusk"))).toMatchObject({ reach: WILDS.fog, dusk: WILDS.dusk });
    expect(bind(one("dusk"), one("fog"))).toEqual(bind(one("fog"), one("dusk")));
    expect(bind(one("elbow"), one("elbow")).alone).toBe(2 * WILDS.elbow);
    // Plain rules add nothing to any rule.
    for (const id of RULE_IDS) expect(bind(one(id, [2, 9, 20]), PLAIN_RULES)).toEqual(one(id, [2, 9, 20]));
  });
  test("bind a fight by both: under Fog and Narrow Table nobody stands in the outside columns and no attack goes further than 2 hexes", () => {
    const both = { rules: apart(bind(one("fog"), one("narrow"))) };
    for (let seed = 1; seed <= 8; seed++) {
      const { cells, events } = playOut(setupUnder(both, seed));
      expect(cells.filter((c) => colOf(c) === 0 || colOf(c) === COLS - 1)).toEqual([]);
      const shots = events.flatMap((e) => (e.t === "shot" && e.what === "attack" ? [distance(e.from, e.to)] : []));
      expect(shots.length).toBeGreaterThan(0);
      expect(Math.max(...shots)).toBeLessThanOrEqual(WILDS.fog);
    }
    const f = openFight(setupUnder({ rules: apart(bind(one("dusk"), one("fog"))) }));
    expect(f.wilds.dusk).toBe(WILDS.dusk);
    expect(f.units.every((u) => attackReach(f, u) <= WILDS.fog)).toBe(true);
  });
});

describe("a fight's rule kept by its id", () => {
  test("is read as that rule's row sets it, from its stumps, and named", () => {
    const p = partyOfFigures(BRAWL);
    for (const id of RULE_IDS) {
      const setup = fields.setup({ seed: 1, sides: [p, p], rule: { id, stumps: [1, 5, 15] } }, "the fight");
      expect(rulesOf(setup)).toEqual(one(id, [1, 5, 15]));
      expect(setup.named).toEqual([id]);
    }
    expect(
      rulesOf(fields.setup({ seed: 1, sides: [p, p], rule: { id: "stumps", stumps: [1, 5, 15] } }, "")).closed,
    ).toEqual([1, 5, 15]);
    expect(() => fields.setup({ seed: 1, sides: [p, p], rule: { id: "bighats", stumps: [] } }, "the fight")).toThrow();
  });
  test("a table of version 6 fighting under Fog plays its fight to the outcome Leaf kept, and says Fog", () => {
    const text = readFileSync(new URL("../review/golden/stored/table-v6-wilds.json", import.meta.url), "utf8");
    expect(text.replace(/\s/g, "")).toContain('"rule":{"id":"fog"');
    const table = RAID.decode(text);
    const fought = table?.held.endless ? foughtOf(table.held.endless) : null;
    if (!table || !fought) throw new Error("no fight in it");
    expect(fought.setup.named).toEqual(["fog"]);
    expect(fought.setup.rules).toEqual({ reach: WILDS.fog });
    expect(playsAsKept(fought)).toBe(true);
    // Kept again, it is kept by what the rule sets.
    const again = RAID.encode(table);
    expect(again).not.toContain('"rule":{');
    expect(again).toContain(`"rules":{"reach":${WILDS.fog}},"named":["fog"]`);
  });
});

/** A run of the Wilds in a room (from 0), under a rule picked for the wing a place is in. */
function wildsAt(room: number, rule: RuleId | null, wingAt = room, stumps: number[] = [2, 9, 20]): Run {
  const run = startRun(5, { era: LEGACY_ERA, way: wayOn({ id: "wilds" }) });
  run.room = room;
  run.stage = { phase: "plan", picks: [] };
  run.wing = rule ? { rule, at: wingOf(wingAt), stumps: rule === "stumps" ? stumps : [] } : null;
  return run;
}
const firstOf = (kind: RoomKind): number => ROOMS.findIndex((r) => r.kind === kind);

describe("the room a run is in", () => {
  test("is bound by its wing's rule in the wing's 5 rooms, and by nothing before or after them", () => {
    const run = wildsAt(5, "long");
    for (let room = 5; room < 10; room++) {
      expect(roomOf(run, room).named).toEqual(["long"]);
      expect(roomOf(run, room).rules).toEqual(one("long"));
    }
    for (const room of [4, 10]) {
      expect(roomOf(run, room).named).toEqual([]);
      expect(roomOf(run, room).rules).toEqual(PLAIN_RULES);
    }
    expect(roomOf(wildsAt(7, null)).rules).toEqual(PLAIN_RULES);
  });
  test("closes to sitting down the seats its rules close, and Long Table's front row", () => {
    expect([...closedNow(wildsAt(6, "stumps"))].toSorted((a, b) => a - b)).toEqual([2, 9, 20]);
    expect([...closedNow(wildsAt(6, "long"))].toSorted((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(closedNow(wildsAt(6, "narrow")).size).toBe(8);
    for (const rule of ["fog", "dusk", "elbow"] as const) expect(closedNow(wildsAt(6, rule)).size).toBe(0);
  });
  test("sets up its fight with what it sets and the rules named, and a fight under none with neither", () => {
    for (const rule of RULE_IDS) {
      const run = wildsAt(6, rule);
      run.board[COLS * 2 + 3] = { id: 900, kind: "rock", stars: 1, items: [], fed: 0 };
      const begun = beginFight(run);
      if (!begun.ok) throw new Error(begun.why);
      expect(rulesOf(begun.setup)).toEqual(roomOf(run).rules);
      expect(begun.setup.named).toEqual([rule]);
      // Kept as plain data: no Infinity, so nothing turns into null.
      expect(JSON.stringify(begun.setup)).not.toContain("null");
    }
    const plain = wildsAt(6, null);
    plain.board[COLS * 2 + 3] = { id: 900, kind: "rock", stars: 1, items: [], fed: 0 };
    const begun = beginFight(plain);
    if (!begun.ok) throw new Error(begun.why);
    expect(Object.keys(begun.setup).toSorted()).toEqual(["era", "seed", "sides"]);
    expect(setupRules(roomOf(plain))).toEqual({});
  });
  test("has the forest grown as its way grows it, the run's chairs, and the picks its kind leaves", () => {
    const wilds = wildsAt(20, null);
    const trail = startRun(5, { era: LEGACY_ERA });
    expect(roomOf(wilds).might).toBe(grownAt(20));
    expect(roomOf(wilds, 3).might).toBe(100);
    expect(roomOf(trail, 14).might).toBe(100);
    trail.level = 4;
    expect(roomOf(trail).chairs).toBe(4);
    trail.boons.push("extrachair");
    expect(roomOf(trail).chairs).toBe(5);
    expect(fieldCap(trail)).toBe(5);
    expect(roomOf(trail, firstOf("trouble")).picks).toMatchObject({ won: 1, lost: 1 });
    expect(roomOf(trail, firstOf("boss")).picks).toMatchObject({ won: 2, lost: 1 });
    expect(roomOf(trail, firstOf("spar")).picks).toMatchObject({ won: 0, lost: 0 });
  });
  test("is followed by a boon only in a boon's room, and only the first time it is fought", () => {
    const run = startRun(5, { era: LEGACY_ERA });
    const boonRoom = ECONOMY.boonRooms[0];
    expect(roomOf(run, boonRoom).picks.boon).toBe(true);
    expect(roomOf(run, boonRoom + 1).picks.boon).toBe(false);
    run.record.push({ room: boonRoom, kind: roomOf(run, boonRoom).kind, result: "loss", standing: [0, 1], boss: null });
    expect(roomOf(run, boonRoom).picks.boon).toBe(false);
  });
});
