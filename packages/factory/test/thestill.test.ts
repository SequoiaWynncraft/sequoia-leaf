/**
 * Tier 6, the still (SPEC-2 sections 1 to 3, and section 8's PR 3 row): its tables in the spec's
 * line-hours; pitch, creosote and spirit planned from the still; the still's mix out of its own three
 * ways out, and stopped by the first that cannot leave; the cracker; the powerhouse, burning the
 * heaviest first with each fuel's smog; the three things the town does not buy; the rates a card says;
 * how a yard with them is kept; and Leaf's copy and the page's agreeing across a day away.
 */
import { describe, expect, test } from "bun:test";

import type { Ctx } from "@sequoia-leaf/core";

import * as F from "../src/index.ts";
import { bareLand } from "./land.ts";
import { give, must } from "./yards.ts";

const TAR = F.item("tar");
const PITCH = F.item("pitch");
const CREOSOTE = F.item("creosote");
const SPIRIT = F.item("spirit");
const STILL = F.kind("still");
const CRACKER = F.kind("cracker");
const POWERHOUSE = F.kind("powerhouse");

/** The grade III line-hours of a goal: each thing it wants, at what one grade III machine of its maker makes of it a minute. */
function lineHours(g: F.Goal): number {
  const want = F.GOALS[g]?.want ?? F.counts();
  return F.ALL_ITEMS.reduce((sum, n) => {
    const count = want[n] ?? 0;
    if (count === 0) return sum;
    const { kind, recipe } = F.makerOf(n);
    return sum + count / F.makes(kind, 3, recipe) / 60;
  }, 0);
}

/** SPEC-2's line-hours of tier 6's goals. */
const HOURS: readonly (readonly [string, number])[] = [
  ["gatepath", 0.11],
  ["pitprops", 1.3],
  ["roadbed", 3.3],
  ["paving", 18],
  ["hallroof", 33],
  ["vaultwinch", 33],
  ["greatroad", 94],
  ["still", 5.6],
  ["powerhouse", 2.2],
  ["cracker", 4.4],
  ["tarring", 2.2],
  ["sleepers", 2.2],
  ["varnishing", 2.8],
  ["still2", 11],
  ["still3", 39],
  ["deeperculvert", 11],
];

/** A bare yard with all of tier 6 known (stills and crackers to grade III), the depot's middle at (33, 6), pylons along row 10. */
function yard(): F.Yard {
  const y = F.create({ land: bareLand(38, 13, [], [33, 6]), tier: 7, seed: 1 });
  for (const x of [30, 26, 22, 18, 14, 10, 6, 2]) must(y, { do: "build", kind: "pylon", x, y: 10, dir: 0 });
  return y;
}
/** Builds a piece facing east with its own tile on (x, z) (a 2x2's top left, a 3x3's middle): that tile. */
function piece(y: F.Yard, kind: string, x: number, z: number, grade = 1): number {
  must(y, { do: "build", kind, x, y: z, dir: 0, ...(grade > 1 ? { grade } : {}) });
  return F.at(y, x, z);
}
/** A shut crate on a tile, which holds whatever it is handed: its holder's row. */
function bin(y: F.Yard, x: number, z: number): number {
  must(y, { do: "build", kind: "crate", x, y: z, dir: 0 });
  must(y, { do: "crate", x, y: z, open: false });
  return F.holderOf(y, F.at(y, x, z));
}
/** Puts things into the holder of the piece on a tile, as a line would have handed them in. */
function fill(y: F.Yard, i: number, n: F.Item, count: number): void {
  const r = F.holderOf(y, i);
  for (let k = 0; k < count; k++) F.put(y.holders, r, n);
}
/** A thing's name by its number, as a holder keeps it: "none" for none. */
function nameOf(n: number | undefined): string {
  const t = F.ALL_ITEMS.find((k) => k === n);
  return t === undefined ? "none" : F.itemName(t);
}
/** The smog made on the bare land's one plot since it was last counted. */
const made = (y: F.Yard): number => y.smog.made[0] ?? 0;

describe("tier 6's tables", () => {
  test("every node and piece of research is in the spec's line-hours, by the planner, within 5%", () => {
    const tier6 = F.ALL_GOALS.filter((g) => F.GOALS[g]?.tier === 6).map((g) => F.GOALS[g]?.id ?? "");
    expect(tier6.toSorted()).toEqual(HOURS.map(([id]) => id).toSorted());
    for (const [id, hours] of HOURS) {
      const got = lineHours(F.goal(id));
      expect([id, Math.abs(got / hours - 1) <= 0.05 ? hours : got]).toEqual([id, hours]);
    }
  });

  test("pitch, creosote and spirit are planned from the still, 3, 2 and 1 of every 6 tar; the cracker's recipes come after it", () => {
    const planned = [PITCH, CREOSOTE, SPIRIT].map((n) => {
      const { kind, recipe } = F.makerOf(n);
      return [F.kindName(kind), recipe?.from.map(F.itemName), recipe?.need, F.makes(kind, 3, recipe), F.workOf(n)];
    });
    expect(planned).toEqual([
      ["still", ["tar"], [2], 120, 20],
      ["still", ["tar"], [3], 80, 20],
      ["still", ["tar"], [6], 40, 20],
    ]);
    // The cracker makes more of each, 120 a minute at grade III, and is listed after the still.
    expect(F.makersOf(CREOSOTE).map((r) => [F.kindName(r.by), r.from.map(F.itemName)])).toEqual([
      ["still", ["tar"]],
      ["cracker", ["pitch"]],
    ]);
    const crack = F.RECIPE[SPIRIT];
    expect([crack && F.makes(CRACKER, 3, crack), F.kindsMaking(SPIRIT).map(F.kindName)]).toEqual([
      120,
      ["still", "cracker"],
    ]);
    // A tree of tarmac names a bench, a still and its tar.
    const tree = F.tree(F.item("tarmac"), 60, 3);
    const pitch = tree.from.find((t) => t.item === PITCH);
    expect([F.kindName(tree.kind), pitch && F.kindName(pitch.kind), pitch?.from[0]?.kind]).toEqual([
      "bench",
      "still",
      F.GATHERING,
    ]);
  });

  test("each new recipe is after every older recipe of its machine, and none has parts all found in another's of its machine", () => {
    const fresh = (["creosote", "spirit", "tarmac", "sleeper", "varnish"] as const).map((n) => F.item(n));
    for (const n of fresh) {
      const r = F.RECIPE[n];
      if (!r) throw new Error(`no recipe for ${F.itemName(n)}`);
      const mine = F.MADE_BY[r.by] ?? [];
      const older = mine.filter((o) => o.out < Math.min(...fresh));
      expect([F.itemName(n), older.every((o) => mine.indexOf(o) < mine.indexOf(r))]).toEqual([F.itemName(n), true]);
      const within = mine.filter((o) => o !== r && r.from.every((part) => o.from.includes(part)));
      expect([F.itemName(n), within.map((o) => F.itemName(o.out))]).toEqual([F.itemName(n), []]);
    }
  });

  test("the board may ask for tar, tarmac, sleepers and varnish, two ways each, and never for the three things the town does not buy", () => {
    for (const n of ["tar", "tarmac", "sleeper", "varnish"] as const) expect([n, F.ASKS[n]?.length]).toEqual([n, 2]);
    for (const n of [PITCH, CREOSOTE, SPIRIT]) {
      const info = F.ITEM_INFO[n];
      expect([F.itemName(n), info?.unsold, info?.worth, F.ASKS[F.itemName(n)]]).toEqual([
        F.itemName(n),
        true,
        0,
        undefined,
      ]);
    }
  });

  test("the commission wants 2,000 tarmac, 4,000 sleepers and 6,000 varnish: pitch, creosote and spirit as 1, 2 and 3", () => {
    const g = F.goal("roadbed");
    const roadbed = F.GOALS[g];
    expect([roadbed?.kind, roadbed?.tier, F.NODES[g]?.gift?.id, F.tierName(6)]).toEqual([
      "commission",
      6,
      "tar-road",
      "Tier 6: The still",
    ]);
    const want = roadbed?.want ?? F.counts();
    expect((["tarmac", "sleeper", "varnish"] as const).map((n) => want[F.item(n)] ?? 0)).toEqual([2000, 4000, 6000]);
    // What those take of the still's three, by their recipes: 2,000 pitch, 4,000 creosote, 6,000 spirit.
    const takes = (part: F.Item): number =>
      F.ALL_ITEMS.reduce((sum, n) => {
        const r = F.RECIPE[n];
        const at = r?.from.indexOf(part) ?? -1;
        return at < 0 || !r ? sum : sum + (want[n] ?? 0) * (r.need[at] ?? 0);
      }, 0);
    expect([PITCH, CREOSOTE, SPIRIT].map(takes)).toEqual([2000, 4000, 6000]);
  });

  test("a tunnel passes under 20 tiles and carries what goes in all the way; under 21 it is refused", () => {
    const y = yard();
    expect([F.SPAN_MOST, y.open.span]).toEqual([20, 20]);
    const plank = F.item("plank");
    must(y, { do: "build", kind: "crate", x: 1, y: 4, dir: 0 });
    const out = bin(y, 25, 4);
    must(y, F.writeAct({ do: "lay", legs: [{ tunnel: true, x: 2, y: 4, dir: 0, span: 20, grade: 1 }] }));
    must(y, { do: "build", kind: "belt", x: 24, y: 4, dir: 0 });
    expect([F.kindAt(y, 23, 4), y.span[F.at(y, 2, 4)], y.span[F.at(y, 23, 4)]]).toEqual([F.TUNNEL, 20, -20]);
    fill(y, F.at(y, 1, 4), plank, 6);
    for (let k = 0; k < 600; k++) F.step(y);
    expect(F.held(y.holders, out, plank)).toBe(6);
    // A span past the most does not read as a command at all, and changes nothing.
    const was = F.encode(y);
    const deeper = F.writeAct({ do: "lay", legs: [{ tunnel: true, x: 2, y: 6, dir: 0, span: 21, grade: 1 }] });
    expect(() => give(y, deeper)).toThrow("does not read");
    expect(F.encode(y)).toBe(was);
  });
});

describe("a way out for one thing only", () => {
  test("names a thing there is: a misspelt name does not type-check, and is refused as the tables are built", () => {
    const right: F.Ports["out"][number] = { at: [2, 1], sends: "out", only: "creosote" };
    // @ts-expect-error: "creosot" is no thing's name, so a way out for it cannot be written.
    const wrong: F.Ports["out"][number] = { at: [2, 1], sends: "out", only: "creosot" };
    expect(F.item(right.only ?? "plank")).toBe(CREOSOTE);
    // Written past the type, the name is refused where the tables read it (`sizes.ts`, `item`), not
    // taken as a way out for anything.
    expect(() => F.item(wrong.only ?? "plank")).toThrow("creosot");
  });
});

describe("the still", () => {
  test("is three tiles by three, takes tar in across each of the nine tile-sides of its back and sides, none at its front, and holds up to 8", () => {
    // Where power does not reach, so that it distils nothing and keeps all it takes.
    const y = F.create({ land: bareLand(38, 13, [], [33, 6]), tier: 7, seed: 1 });
    const i = piece(y, "still", 4, 4);
    expect([F.isBig(STILL), F.litAt(y, i), F.wants(y, i, PITCH)]).toEqual([true, false, false]);
    // A crate of 1 tar against each side, handing in: its back (west), its left (north) and its right (south).
    const sides: (readonly [number, number, number])[] = [];
    for (let k = 3; k <= 5; k++) sides.push([2, k, 0], [k, 2, 1], [k, 6, 3]);
    const crates = sides.map(([x, z, dir]) => {
      must(y, { do: "build", kind: "crate", x, y: z, dir });
      fill(y, F.at(y, x, z), TAR, 1);
      return F.holderOf(y, F.at(y, x, z));
    });
    // And one against each of its three front tiles, which send things out and take nothing in.
    const front = [3, 4, 5].map((z) => {
      must(y, { do: "build", kind: "crate", x: 6, y: z, dir: 2 });
      fill(y, F.at(y, 6, z), TAR, 1);
      return F.holderOf(y, F.at(y, 6, z));
    });
    for (let k = 0; k < 60; k++) F.step(y);
    // What a crate still has of it: in it, or ready to hand on.
    const has = (r: number): number => F.held(y.holders, r, TAR) + (y.holders.out[r] === TAR ? 1 : 0);
    const left = crates.map(has);
    // Eight of the nine came in; the ninth is offered still, with no room for it.
    expect([
      F.held(y.holders, F.holderOf(y, i), TAR),
      left.filter((n) => n === 0).length,
      left.filter((n) => n === 1).length,
    ]).toEqual([8, 8, 1]);
    expect([front.map(has), F.MIX_OF[STILL]?.holds]).toEqual([[1, 1, 1], 8]);
    // Power reaches it, with nothing at its front: it distils one tar and stops, its pitch with nowhere
    // to go; with room for one again, it takes the ninth from where it waits.
    for (const z of [3, 4, 5]) must(y, { do: "remove", x: 6, y: z });
    for (const x of [30, 26, 22, 18, 14, 10, 6]) must(y, { do: "build", kind: "pylon", x, y: 8, dir: 0 });
    for (let k = 0; k < 40; k++) F.step(y);
    const r = F.holderOf(y, i);
    expect([F.litAt(y, i), y.holders.out[r], F.held(y.holders, r, TAR), crates.every((c) => has(c) === 0)]).toEqual([
      true,
      PITCH,
      8,
      true,
    ]);
  });

  test("gives pitch, creosote, pitch, spirit, pitch, creosote, out of its left, middle, left, right, left and middle ways out", () => {
    const y = yard();
    const i = piece(y, "still", 4, 4);
    // Its box is x 3 to 5 and rows 3 to 5; its front its east side, its left the north. A shut crate
    // ahead of each way out.
    const rows = [3, 4, 5].map((z) => [z, bin(y, 6, z)] as const);
    // Just after a count, so that what it makes is all there to be seen before the next.
    while (y.tick % 100 !== 1) F.step(y);
    fill(y, i, TAR, 6);
    // Each thing as it reaches a crate, and which row's crate.
    const got: [string, number][] = [];
    const had = rows.map(() => F.counts());
    for (let k = 0; k < 90; k++) {
      F.step(y);
      rows.forEach(([z, r], w) => {
        for (const n of [PITCH, CREOSOTE, SPIRIT])
          if (F.held(y.holders, r, n) > (had[w]?.[n] ?? 0)) {
            got.push([F.itemName(n), z]);
            (had[w] ?? F.counts())[n] = F.held(y.holders, r, n);
          }
      });
    }
    expect(got).toEqual([
      ["pitch", 3],
      ["creosote", 4],
      ["pitch", 3],
      ["spirit", 5],
      ["pitch", 3],
      ["creosote", 4],
    ]);
    // Each it made added 1 to its plot's smog.
    expect(made(y)).toBe(6);
  });

  test("with its middle way out blocked it holds its creosote, makes nothing more, and says which way: in trouble", () => {
    const y = yard();
    const i = piece(y, "still", 4, 4);
    bin(y, 6, 3);
    bin(y, 6, 5);
    fill(y, i, TAR, 8);
    for (let k = 0; k < 300; k++) F.step(y);
    const r = F.holderOf(y, i);
    expect([nameOf(y.holders.out[r]), F.held(y.holders, r, TAR), y.holders.mix[r]]).toEqual(["creosote", 6, 2]);
    expect(F.status(y, i)).toMatchObject({
      state: "blocked",
      trouble: true,
      line: "Stopped: its creosote cannot leave by its middle way out. It makes nothing else until it does.",
    });
    // Given a belt there, into a crate, it goes on.
    must(y, { do: "build", kind: "belt", x: 6, y: 4, dir: 0 });
    bin(y, 7, 4);
    for (let k = 0; k < 40; k++) F.step(y);
    expect(F.status(y, i)?.trouble).toBe(false);
  });

  test("waiting at a full crate ahead, it says which thing has no room and by which way out, and is not in trouble", () => {
    const y = yard();
    const i = piece(y, "still", 4, 4);
    bin(y, 6, 3);
    const full = bin(y, 6, 4);
    bin(y, 6, 5);
    for (let k = 0; k < y.open.crate; k++) F.put(y.holders, full, CREOSOTE);
    fill(y, i, TAR, 8);
    for (let k = 0; k < 60 && F.status(y, i)?.state === "working"; k++) F.step(y);
    expect([F.status(y, i)?.line, F.status(y, i)?.trouble]).toEqual([
      "Waiting: no room ahead for its creosote, by its middle way out.",
      false,
    ]);
  });

  test("says what it does: distilling tar, waiting for tar, and its card's rate, each way's at its share and no more than its belt carries", () => {
    const y = yard();
    const i = piece(y, "still", 4, 4, 3);
    expect(F.status(y, i)?.line).toBe("Waiting for tar.");
    fill(y, i, TAR, 1);
    F.step(y);
    expect(F.status(y, i)?.line).toBe("Distilling tar.");
    // Grade III distils 240 tar a minute: 120 pitch, 80 creosote and 40 spirit.
    expect(F.machineRate(y, i)).toMatchObject({ nominal: 240, effective: 240, most: null });
    // Each way's belt holds it to that belt over its share: a grade I belt carries 150, so its left way
    // allows 300 in all, its middle 450 and its right 900. A still III is under all three.
    for (const z of [3, 4, 5]) must(y, { do: "build", kind: "belt", x: 6, y: z, dir: 0 });
    expect(F.machineRate(y, i)).toMatchObject({ nominal: 240, effective: 240, most: null });
    expect([F.mixShare(STILL, PITCH), F.mixShare(STILL, CREOSOTE), F.mixShare(STILL, SPIRIT)]).toEqual([
      0.5,
      2 / 6,
      1 / 6,
    ]);
  });
});

describe("the cracker", () => {
  test("told nothing, makes creosote from pitch and spirit from creosote, by what it is fed; each adds 1 to its plot's smog", () => {
    const y = yard();
    const i = piece(y, "cracker", 4, 4);
    const out = bin(y, 6, 4);
    expect([F.isBig(CRACKER), F.wants(y, i, PITCH), F.wants(y, i, CREOSOTE), F.wants(y, i, TAR)]).toEqual([
      true,
      true,
      true,
      false,
    ]);
    fill(y, i, PITCH, 2);
    for (let k = 0; k < 40; k++) F.step(y);
    expect([F.held(y.holders, out, CREOSOTE), made(y)]).toEqual([1, 1]);
    fill(y, i, CREOSOTE, 2);
    for (let k = 0; k < 40; k++) F.step(y);
    expect([F.held(y.holders, out, SPIRIT), made(y)]).toEqual([1, 2]);
    // Between batches it holds nothing and aims at nothing: its card and its plot's smog both count it for
    // what it last began, 60 spirit a minute, 1 smog each.
    expect([F.aim(y, i), F.countedFor(y, i)?.out, F.machineRate(y, i).effective, F.madeOn(y, 0)]).toEqual([
      null,
      SPIRIT,
      60,
      60,
    ]);
    // A cracker I makes 60 a minute of what it is told; III, 120.
    expect([F.machineRate(y, i, F.RECIPE[SPIRIT]).nominal, F.makes(CRACKER, 3, F.RECIPE[SPIRIT] ?? null)]).toEqual([
      60, 120,
    ]);
  });
});

describe("the powerhouse", () => {
  test("burns pitch before creosote before spirit, for 10, 15 and 20 ticks, giving 300 power; each piece taken adds 4, 2 and 1 smog", () => {
    const y = yard();
    const i = piece(y, "powerhouse", 4, 4);
    expect([F.isBig(POWERHOUSE), [PITCH, CREOSOTE, SPIRIT, TAR].map((n) => F.wants(y, i, n))]).toEqual([
      true,
      [true, true, true, false],
    ]);
    fill(y, i, SPIRIT, 1);
    fill(y, i, CREOSOTE, 1);
    fill(y, i, PITCH, 1);
    const r = F.holderOf(y, i);
    F.rewire(y);
    const steady = y.wire?.steady ?? 0;
    const seen: [string, number, number][] = [];
    for (let k = 0; k < 50; k++) {
      const was = y.holders.fuel[r] ?? 0;
      F.step(y);
      if ((y.holders.fuel[r] ?? 0) > was) seen.push([nameOf(y.holders.making[r]), k, made(y)]);
    }
    expect(seen).toEqual([
      ["pitch", 0, 4],
      ["creosote", 10, 6],
      ["spirit", 25, 7],
    ]);
    expect(y.supply - steady).toBe(0);
    expect(F.status(y, i)?.line).toBe("Out of fuel. It makes power only while it has pitch, creosote or spirit.");
    fill(y, i, PITCH, 5);
    fill(y, i, CREOSOTE, 2);
    F.step(y);
    expect([y.supply - steady, F.status(y, i)?.line]).toEqual([
      600,
      "Running. Makes 300 power. Burning pitch; holds 4 pitch, 2 creosote and 0 spirit.",
    ]);
    expect(F.status(y, i)?.trouble).toBe(false);
  });

  test("holding fuel, a powerhouse and a boiler are burning on every tick, the tick a piece burns out on too: power, card and picture", () => {
    const y = yard();
    const p = piece(y, "powerhouse", 4, 4);
    const b = piece(y, "boiler", 8, 4);
    fill(y, p, PITCH, 8);
    fill(y, b, F.DEADFALL, 4);
    F.rewire(y);
    const steady = y.wire?.steady ?? 0;
    const said = new Set<string>();
    let gaps = 0;
    for (let k = 0; k < 70; k++) {
      F.step(y);
      if (y.supply - steady !== 600 + 60) gaps++;
      for (const i of [p, b]) {
        const st = F.status(y, i);
        said.add(`${st?.state ?? ""}${st?.trouble === true ? " in trouble" : ""}`);
        if (!F.burningAt(y, i)) gaps++;
      }
    }
    expect([gaps, [...said]]).toEqual([0, ["giving"]]);
    // Once the last piece has burnt out, cold, and in trouble.
    for (let k = 0; k < 400; k++) F.step(y);
    expect([F.burningAt(y, p), F.status(y, p)?.state, F.status(y, p)?.trouble]).toEqual([false, "cold", true]);
  });

  test("the yard counts what it needs a minute, and the smog card what it makes: 60 pitch and 240 smog on pitch, 30 spirit and 30 smog on spirit", () => {
    const y = yard();
    const i = piece(y, "powerhouse", 4, 4);
    fill(y, i, PITCH, 2);
    F.step(y);
    const need = (): [number, number, number] => {
      const needed = F.counts();
      F.flow(y, F.counts(), needed);
      return [needed[PITCH] ?? 0, needed[SPIRIT] ?? 0, F.madeOn(y, 0)];
    };
    expect(need()).toEqual([60, 0, 240]);
    for (let k = 0; k < 30; k++) F.step(y);
    fill(y, i, SPIRIT, 2);
    F.step(y);
    expect(need()).toEqual([0, 30, 30]);
    // A still III beside it adds its 240 things a minute, 1 smog each; one power does not reach adds nothing.
    piece(y, "still", 10, 4, 3);
    const far = piece(y, "powerhouse", 20, 0);
    fill(y, far, PITCH, 2);
    expect([F.litAt(y, far), F.smogRate(y, far), F.madeOn(y, 0)]).toEqual([false, 0, 270]);
  });
});

describe("pitch, creosote and spirit, which the town does not buy", () => {
  test("are refused by the depot and by a cart stop, and taken by a crate", () => {
    const y = yard();
    must(y, { do: "build", kind: "stop", x: 12, y: 8, dir: 0 });
    must(y, { do: "build", kind: "crate", x: 14, y: 8, dir: 0 });
    const at = (x: number, z: number): number => F.at(y, x, z);
    for (const n of [PITCH, CREOSOTE, SPIRIT])
      expect([F.itemName(n), F.wants(y, at(33, 6), n), F.wants(y, at(12, 8), n), F.wants(y, at(14, 8), n)]).toEqual([
        F.itemName(n),
        false,
        false,
        true,
      ]);
  });
});

describe("a yard with tier 6's pieces", () => {
  test("is kept as the version the Leaf of version 10 leaves alone, reads back as itself, and its powerhouse goes on burning what it burned", () => {
    const y = yard();
    piece(y, "still", 4, 4, 3);
    piece(y, "cracker", 10, 4, 2);
    const ph = piece(y, "powerhouse", 14, 4);
    fill(y, ph, CREOSOTE, 2);
    F.step(y);
    const text = F.encode(y);
    expect(JSON.parse(text).v).toBe(F.VERSION);
    expect(F.pastTen(y)).toBe(true);
    const back = F.decode(text, y.land);
    if (!back) throw new Error("the yard does not read back");
    const r = F.holderOf(back, ph);
    expect([F.check(back), nameOf(back.holders.making[r]), back.holders.fuel[r]]).toEqual([
      F.check(y),
      "creosote",
      y.holders.fuel[F.holderOf(y, ph)],
    ]);
  });
});

const ctx = (now: number): Ctx => ({
  now,
  player: { id: "p", guest: false },
  seed: 9,
  room: 0,
  awards: [],
  postcards: {},
});
const AT0 = 1_800_000_000_000;
const MINUTE_MS = 60_000;

/**
 * A bare yard with two stills III at work, each fed from a full crate of tar: the top one's pitch into
 * a cracker, its creosote and spirit into a powerhouse; the bottom one's into shut crates.
 */
function working(): F.Yard {
  const y = yard();
  for (const [x, z] of [
    [2, 4],
    [9, 3],
  ] as const)
    must(y, { do: "build", kind: "pylon", x, y: z, dir: 0 });
  for (const z of [2, 7]) {
    must(y, { do: "build", kind: "crate", x: 2, y: z, dir: 0 });
    const r = F.holderOf(y, F.at(y, 2, z));
    for (let k = 0; k < y.open.crate; k++) F.put(y.holders, r, TAR);
    piece(y, "still", 4, z, 3);
  }
  piece(y, "cracker", 6, 0);
  bin(y, 8, 0);
  piece(y, "powerhouse", 6, 2);
  for (const z of [6, 7, 8]) bin(y, 6, z);
  y.history = [];
  return y;
}

describe("Leaf's copy and the page's", () => {
  test("the same yard of stills, a cracker and a powerhouse, tended by Leaf across 24 hours away and run on by the page, gives one check all the way", () => {
    const start = working();
    const text = F.encode(start);
    const leaf = F.decode(text, start.land);
    const page = F.decode(text, start.land);
    if (!leaf || !page) throw new Error("does not read back");
    leaf.at = AT0;
    leaf.seen = F.here(leaf);
    page.seen = F.here(page);
    const marks = [
      ...Array.from({ length: 12 }, (_, m) => (m + 1) * MINUTE_MS),
      ...Array.from({ length: 24 }, (_, h) => (h + 1) * 60 * MINUTE_MS),
    ];
    let most = 0;
    for (const after of marks) {
      for (let further = true; further;) {
        let left = 7777;
        further = F.FACTORY.tend?.(leaf, ctx(AT0 + after), () => left-- > 0) ?? false;
      }
      F.stepTo(page, leaf.tick);
      expect([after, F.check(page)]).toEqual([after, F.check(leaf)]);
      most = Math.max(most, leaf.smog.level[0] ?? 0);
    }
    expect(Math.abs(leaf.tick - leaf.seen.tick - 24 * 60 * F.MINUTE)).toBeLessThan(F.MINUTE);
    // It distilled, cracked and burned, and made smog doing it, until its tar ran out.
    expect(most).toBeGreaterThan(0);
  });
});
