import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { type Rect, ROOMS, rulesModules } from "@sequoia-leaf/core";

import { type Kind, kindOf, KINDS } from "./kinds.ts";
import { type At, type Group, PLACE_IDS, type Row } from "./rows.ts";
import { TOWN_MAP } from "./town.ts";

// The table as it is typed, before anything is worked out from it: these hold even when `map.ts`
// could not be.

const ROWS = TOWN_MAP.areas.flatMap((a) => a.pieces);
const isRow = (r: Row | Group): r is Row => "x" in r;
const ROW_IDS = new Set(ROWS.flatMap((r) => (isRow(r) ? [r.id] : [])));

/** Everything the table fixes to a piece, with what it is. */
function attached(): [string, At][] {
  const m = TOWN_MAP;
  const out: [string, At][] = [];
  const put = (what: string, a: At): void => {
    out.push([what, a]);
  };
  for (const a of m.areas) {
    for (const p of a.places) put(`the place ${p.id}`, { piece: p.piece, x: p.stand.x, y: p.stand.y });
    a.clearings.forEach((c, i) => put(`clearing ${i} of ${c.piece}`, c));
    for (const p of a.paths) if ("piece" in p) put(`a path of ${p.piece}`, { piece: p.piece, ...p.from });
    for (const r of a.pieces) if (r.piece !== undefined) put(`the row ${r.id}`, { piece: r.piece, x: 0, y: 0 });
  }
  for (const [at, b] of Object.entries(m.busy)) {
    put(`${at}'s middle`, b.middle);
    b.spots.forEach((s, i) => put(`busy at ${at} ${i}`, s));
  }
  for (const [post, ss] of Object.entries(m.errands)) ss.forEach((s, i) => put(`errand ${post} ${i}`, s));
  m.crabs.forEach((c, i) => put(`crab home ${i}`, c));
  m.hides.forEach((h, i) => put(`hide ${i}`, h));
  put("Cinfy", m.keepers.counter);
  m.keepers.stalls.forEach((k, i) => put(`stall keeper ${i}`, k));
  for (const [k, a] of Object.entries(m.trail)) put(`the trail's ${k}`, a);
  put("the glints", m.glints);
  m.fireflies.forEach((f, i) => put(`fireflies ${i}`, f));
  m.strings.forEach((s, i) => {
    put(`string ${i}'s first end`, s.from);
    put(`string ${i}'s other end`, s.to);
  });
  return out;
}

/** Every box of ground a kind, one of its looks or a wall has, with whose it is. */
function boxes(): [string, Rect][] {
  const out: [string, Rect][] = TOWN_MAP.ground.walls.map((w) => [`the wall ${w.id}`, w]);
  for (const [id, kind] of Object.entries(KINDS)) {
    const k: Kind = kind;
    for (const b of k.blocks ?? []) out.push([`${id}'s ground`, b]);
    for (const b of k.opens ?? []) out.push([`the way ${id} opens`, b]);
    (k.looks ?? []).forEach((l, i) => {
      for (const b of l.blocks ?? []) out.push([`${id}'s look ${i}`, b]);
    });
  }
  return out;
}

/** How many looks a kind comes in. */
const looks = (kind: Row["kind"]): number => kindOf(kind).looks?.length ?? 1;

describe("the town's table, as it is typed", () => {
  test("every row, group and piece of a group has an id of its own, and so has every wall", () => {
    const ids = ROWS.flatMap((r) => (isRow(r) ? [r.id] : [r.id, ...r.points.map((_, i) => `${r.id}.${i}`)]));
    expect(ids.filter((id, i) => ids.indexOf(id) !== i)).toEqual([]);
    const walls = TOWN_MAP.ground.walls.map((w) => w.id);
    expect(walls.filter((id, i) => walls.indexOf(id) !== i)).toEqual([]);
  });

  test("everything fixed to a piece names a row, never one of a group's", () => {
    const wrong = attached().flatMap(([what, a]) => (ROW_IDS.has(a.piece) ? [] : [`${what}: ${a.piece}`]));
    expect(wrong).toEqual([]);
  });

  test("a row or a group that is part of a piece is part of a row that is part of nothing", () => {
    const wholes = new Set(ROWS.flatMap((r) => (isRow(r) && r.piece === undefined ? [r.id] : [])));
    const wrong = ROWS.flatMap((r) => (r.piece === undefined || wholes.has(r.piece) ? [] : [`${r.id}: ${r.piece}`]));
    expect(wrong).toEqual([]);
  });

  test("every place is in one area, once", () => {
    const ids = TOWN_MAP.areas.flatMap((a) => a.places.map((p) => p.id));
    expect(ids.toSorted()).toEqual([...PLACE_IDS].toSorted());
  });

  test("every look is one its kind has", () => {
    const wrong = ROWS.flatMap((r) =>
      isRow(r)
        ? (r.look ?? 0) < looks(r.kind)
          ? []
          : [r.id]
        : r.points.flatMap(([, , look = 0], i) => (look < looks(r.kind) ? [] : [`${r.id}.${i}`])),
    );
    expect(wrong).toEqual([]);
  });

  test("a piece of a kind to rest on says who rests there and which way they face, and its kind has rest spots that way", () => {
    for (const r of ROWS) {
      const rests = kindOf(r.kind).rests;
      if (!isRow(r)) {
        expect([r.id, rests === undefined]).toEqual([r.id, true]);
        continue;
      }
      if (!rests) {
        expect([r.id, r.face, r.at, r.yours]).toEqual([r.id, undefined, undefined, undefined]);
        continue;
      }
      const list = r.face === undefined ? [] : (rests[r.face] ?? []);
      expect([r.id, r.at !== undefined, list.length > 0]).toEqual([r.id, true, true]);
      if (r.yours !== undefined) expect([r.id, r.yours >= 0 && r.yours < list.length]).toEqual([r.id, true]);
    }
  });

  test("every box of ground is wider and taller than nothing", () => {
    expect(boxes().flatMap(([whose, b]) => (b.w > 0 && b.h > 0 ? [] : [whose]))).toEqual([]);
  });

  test("there is a home for each of the eight crabs at roll call: the ninth is never there", () => {
    expect(TOWN_MAP.crabs.length).toBe(8);
  });

  test("Leaf's live room for the town is the town's size, from 0,0", () => {
    const { x, y, w, h } = TOWN_MAP.bounds;
    if (x !== 0 || y !== 0)
      throw new Error(
        `The town starts at ${x},${y}. Leaf's live room for it starts at 0,0: give the room an origin before the town grows left or up.`,
      );
    const room = ROOMS["town"];
    expect([room?.width, room?.height]).toEqual([w, h]);
  });

  test("the town's rules are none of the map: moving a piece does not change the rules' version", () => {
    // The Live rebuild drops this once the server checks reach and walls by the map.
    const root = join(import.meta.dir, "..", "..", "..", "..");
    const read = (path: string): string | null => {
      try {
        return readFileSync(join(root, path), "utf8");
      } catch {
        return null;
      }
    };
    const modules = [...rulesModules("town", read).keys()];
    expect(modules).toContain("packages/town/src/game.ts");
    expect(modules.filter((path) => path.startsWith("packages/town/src/map/"))).toEqual([]);
  });
});
