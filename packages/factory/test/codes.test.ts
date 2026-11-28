/**
 * Blueprint codes (`code.ts`): a kept blueprint as text a player copies and pastes elsewhere, the same
 * text for the same blueprint, and the command that keeps a pasted one in a place (`pasteBlueprint`).
 * The rules read the code, here as on Leaf: it is a blueprint only if Save could have kept it, and it
 * is held to the place's limits as Save is, but not to what the yard has unlocked: that is placing's
 * to refuse. The lengths of real blueprints' codes are printed.
 */
import { describe, expect, test } from "bun:test";

import * as F from "../src/index.ts";
import { bareLand } from "./land.ts";
import { give, must, staged } from "./yards.ts";

const NOT = { refused: "cannot_paste_blueprint", why: "That is not a blueprint code" };

/** A yard on a bare land of 48 by 30 at a tier, every goal below it done. */
const bare = (tier: number, seed = 1): F.Yard => F.create({ land: bareLand(48, 30, [], [44, 4]), tier, seed });

/** Builds a piece through a command off the wire, as a player does. */
const put = (y: F.Yard, kind: string, x: number, z: number, dir = 0, more: Record<string, unknown> = {}): void =>
  must(y, { do: "build", kind, x, y: z, dir, ...more });

/** A yard at tier 5 with a little of everything a blueprint keeps, kept in place 0. */
function kept(): F.Yard {
  const y = bare(5);
  put(y, "belt", 2, 2, 0, { grade: 3 });
  put(y, "splitter", 3, 2, 0, { grade: 2 });
  must(y, { do: "way", way: 1, open: false, x: 3, y: 2 });
  must(y, { do: "first", way: 2, x: 3, y: 2 });
  put(y, "sorter", 4, 2, 0, { right: true });
  must(y, { do: "sort", item: "plank", x: 4, y: 2 });
  must(y, { do: "build", kind: "tunnel", x: 5, y: 2, dir: 0 });
  put(y, "crate", 2, 4);
  must(y, { do: "crate", open: false, x: 2, y: 4 });
  put(y, "bench", 3, 4, 1);
  must(y, { do: "recipe", item: "tool", x: 3, y: 4 });
  must(y, { do: "paint", tint: 4, x: 2, y: 2 });
  must(y, { do: "saveBlueprint", slot: 0, tiles: F.within(y, 2, 2, 10, 4) });
  return y;
}

/** The code `F.blueprintCode` gives for a place's blueprint; it throws if there is none. */
function codeIn(y: F.Yard, slot: number): string {
  const print = y.blueprints[slot];
  const code = print ? F.blueprintCode(print) : null;
  if (code === null) throw new Error(`no code for place ${slot}`);
  return code;
}

/** A code for a blueprint's bytes written by hand, packed as a kept yard packs them, with their check. */
const handCode = (bytes: readonly number[]): string => F.packedCode(Uint8Array.from(bytes));

const paste = (y: F.Yard, slot: number, code: string): ReturnType<typeof F.play> =>
  give(y, { do: "pasteBlueprint", slot, code });
/** A code off the wire, in a command to keep it in place 0. */
const read = (code: unknown): F.Command | null => F.readCommand({ tick: 0, do: "pasteBlueprint", slot: 0, code });
/** The pieces on the area `kept` keeps a blueprint of. */
const keptArea = (y: F.Yard): F.Piece[] => F.piecesAt(y, F.within(y, 2, 2, 10, 4));

/** A yard on a bare land of 56 by 40 with every goal done, the plan room among them. */
function big(): F.Yard {
  const y = F.create({ land: bareLand(56, 40, [], [52, 4]), tier: 6, seed: 1 });
  y.open = F.openOf([...F.ALL_GOALS]);
  return y;
}
/** How long a command is on the wire, with a tick and the longest id. */
const command = (c: Record<string, unknown>): number => JSON.stringify({ ...c, tick: 1e12, id: "x".repeat(40) }).length;

describe("a blueprint's code", () => {
  test("is the same each time for the same blueprint, and pasted in another yard keeps that blueprint", () => {
    const a = kept();
    const code = codeIn(a, 0);
    expect(code.startsWith(F.CODE_PREFIX)).toBe(true);
    expect(codeIn(a, 0)).toBe(code);
    // Saved again from the same pieces, it is the same code.
    must(a, { do: "saveBlueprint", slot: 1, tiles: F.within(a, 2, 2, 10, 4) });
    expect(codeIn(a, 1)).toBe(code);
    const b = bare(5, 2);
    must(b, { do: "pasteBlueprint", slot: 3, code });
    expect(b.blueprints[3]).toEqual(a.blueprints[0] ?? null);
    expect(codeIn(b, 3)).toBe(code);
    // Set down, it stands as the pieces it was kept from, everything they were set to with them.
    must(b, { do: "placeBlueprint", slot: 3, turns: 0, x: 2, y: 2 });
    expect(keptArea(b)).toEqual(keptArea(a));
  });

  test("is pasted with spaces and line breaks around it or in it", () => {
    const code = codeIn(kept(), 0);
    const b = bare(5, 2);
    must(b, { do: "pasteBlueprint", slot: 0, code: `  ${code.slice(0, 9)}\n${code.slice(9)}\n` });
    expect(codeIn(b, 0)).toBe(code);
  });

  test("cut short by any number of characters, or with one changed, is not a code: not even of fewer pieces", () => {
    const code = codeIn(kept(), 0);
    const b = bare(5, 2);
    for (let cut = 1; cut < code.length - F.CODE_PREFIX.length; cut++)
      expect([cut, paste(b, 0, code.slice(0, -cut))]).toEqual([cut, NOT]);
    const at = F.CODE_PREFIX.length + 10;
    const other = code[at] === "A" ? "B" : "A";
    expect(paste(b, 0, `${code.slice(0, at)}${other}${code.slice(at + 1)}`)).toEqual(NOT);
    expect(b.blueprints[0]).toBeNull();
  });

  test("says how many bytes of pieces follow it, so no code cut short is ever the code of fewer pieces", () => {
    const code = codeIn(kept(), 0);
    const bytes = Buffer.from(code.slice(F.CODE_PREFIX.length), "base64");
    expect(((bytes[3] ?? 0) << 8) + (bytes[4] ?? 0)).toBe(bytes.length - 5);
    // The same pieces, said to be one byte more than follow, with their own check: not a code.
    const longer = Uint8Array.from(bytes);
    longer[4] = (bytes[4] ?? 0) + 1;
    expect(paste(bare(5, 2), 0, F.CODE_PREFIX + Buffer.from(longer).toString("base64").replace(/=+$/, ""))).toEqual(
      NOT,
    );
  });

  test("is none for a plan of the whole yard, which goes back where it was taken", () => {
    const y = kept();
    y.open = F.openOf([...F.ALL_GOALS]);
    must(y, { do: "saveYard", slot: 2 });
    const print = y.blueprints[2];
    expect(print?.whole).toBe(true);
    expect(print && F.blueprintCode(print)).toBeNull();
  });

  test("pasted, replaces what the place kept; a broken code is refused with one sentence and keeps nothing", () => {
    const a = kept();
    const code = codeIn(a, 0);
    const b = bare(5, 2);
    put(b, "mill", 6, 6);
    must(b, { do: "saveBlueprint", slot: 1, tiles: F.within(b, 6, 6, 6, 6) });
    const before = b.blueprints[1];
    for (const broken of [
      "",
      "hello",
      F.CODE_PREFIX,
      `${F.CODE_PREFIX}!!!!`,
      `wb2${code.slice(3)}`,
      code.slice(0, -3),
      `${code}A`,
      `${code}==`,
      code.toUpperCase(),
    ])
      expect(paste(b, 1, broken)).toEqual(NOT);
    expect(b.blueprints[1]).toBe(before ?? null);
    must(b, { do: "pasteBlueprint", slot: 1, code });
    expect(b.blueprints[1]).toEqual(a.blueprints[0] ?? null);
  });

  test("is a blueprint only as Save keeps one: every part of every piece, from the corner of its box, one piece a tile", () => {
    const b = bare(5, 2);
    const kinds = F.kind;
    const belt = kinds("belt");
    // A belt at the corner, going right: a code of its own, as Save would keep it.
    expect(paste(b, 0, handCode([belt, 0, 0, 0]))).not.toHaveProperty("refused");
    for (const bytes of [
      // Of no kind, or the depot.
      [200, 0, 0, 0],
      [kinds("depot"), 0, 0, 0],
      // Not from the corner of its box.
      [belt, 1, 0, 0],
      [belt, 0, 2, 0],
      // Two on one tile; a tunnel coming up on another piece.
      [belt, 0, 0, 0, belt, 0, 0, 1],
      [kinds("tunnel"), 0, 0, 4, 1, belt, 2, 0, 0],
      // A span on a belt; a tunnel with none, or further than any tunnel goes.
      [belt, 0, 0, 4, 2],
      [kinds("tunnel"), 0, 0, 0],
      [kinds("tunnel"), 0, 0, 4, F.SPAN_MOST + 1],
      // Colour on a mill, or past the colours.
      [kinds("mill"), 0, 0, 8, 1],
      [belt, 0, 0, 8, F.TINTS + 1],
      // A grade on a pylon, above the top, or a grade 1 said.
      [kinds("pylon"), 0, 0, 128, 2],
      [belt, 0, 0, 128, F.TOP + 1],
      [belt, 0, 0, 128, 1],
      // Ways on a belt; a splitter putting first a way it has shut; a sorter's left said.
      [belt, 0, 0, 16, 1],
      [kinds("splitter"), 0, 0, 16, F.packWays(2, 2, 0)],
      [kinds("sorter"), 0, 0, 16, F.packWays(0, 2, 0)],
      // A recipe on a belt, or one its machine does not make; a belt shut as a crate is.
      [belt, 0, 0, 64, F.item("plank")],
      [kinds("bench"), 0, 0, 64, F.item("plank")],
      [belt, 0, 0, 32],
      // Bytes left over.
      [belt, 0, 0, 0, belt],
    ])
      expect([bytes, paste(b, 0, handCode(bytes))]).toEqual([bytes, NOT]);
  });

  test("pasted, is held to the place's limits as Save is: how many pieces, how big, which places there are", () => {
    const wide = bare(5);
    for (let x = 1; x <= 20; x++) put(wide, "belt", x, 2);
    must(wide, { do: "saveBlueprint", slot: 0, tiles: F.within(wide, 1, 2, 20, 2) });
    expect(F.codePieces(codeIn(wide, 0))?.length).toBe(20);
    const many = bare(5);
    for (let z = 2; z < 22; z++) for (let x = 1; x < 11; x++) put(many, "belt", x, z);
    must(many, { do: "saveBlueprint", slot: 0, tiles: F.within(many, 1, 2, 10, 21) });
    // A yard of tier 3 keeps one blueprint of up to 150 pieces.
    const small = bare(3, 2);
    expect(small.open.blueprints).toBe(1);
    expect(paste(small, 0, codeIn(many, 0))).toEqual({
      refused: "cannot_paste_blueprint",
      why: "A blueprint holds at most 150 pieces. This is 200",
    });
    expect(paste(small, 1, codeIn(wide, 0))).toEqual({
      refused: "cannot_paste_blueprint",
      why: "There is no such blueprint",
    });
    // Wider than Save keeps: a belt at each end of 33 tiles.
    const belt = F.kind("belt");
    expect(paste(small, 0, handCode([belt, 0, 0, 0, belt, F.BLUEPRINT.w, 0, 0]))).toEqual({
      refused: "cannot_paste_blueprint",
      why: `A blueprint is at most ${F.BLUEPRINT.w} tiles by ${F.BLUEPRINT.h}. This is ${F.BLUEPRINT.w + 1} by 1`,
    });
    expect(F.codeRefusal(small.open, codeIn(many, 0))).toBe("A blueprint holds at most 150 pieces. This is 200");
    expect(F.codeRefusal(small.open, "hello")).toBe("That is not a blueprint code");
    expect(F.codeRefusal(small.open, codeIn(wide, 0))).toBeNull();
    // A yard with no blueprints yet has no place to keep one.
    expect(paste(bare(2), 0, codeIn(wide, 0))).toEqual({
      refused: F.LOCKED,
      why: "Blueprints are not unlocked yet",
    });
  });

  test("pasted, keeps pieces the yard has not unlocked; placing it is refused, naming what is locked", () => {
    const a = bare(5);
    put(a, "belt", 2, 2);
    put(a, "sorter", 3, 2);
    must(a, { do: "saveBlueprint", slot: 0, tiles: F.within(a, 2, 2, 3, 2) });
    const b = bare(3, 2);
    expect(F.locked(b.open, { build: F.SORTER })).toBe("The sorter is not unlocked yet");
    must(b, { do: "pasteBlueprint", slot: 0, code: codeIn(a, 0) });
    expect(give(b, { do: "placeBlueprint", slot: 0, turns: 0, x: 2, y: 2 })).toEqual({
      refused: "cannot_place_blueprint",
      why: "The sorter is not unlocked yet",
    });
  });

  test("the plan room's box is 40 tiles by 30, 1,200 pieces: kept, pasted, and its longest code and its tiles each fit one command", () => {
    // Before the plan room, 32 by 24.
    expect([F.create({ seed: 1, tier: 5 }).open.box, big().open.box]).toEqual([
      { w: 32, h: 24 },
      { w: 40, h: 30 },
    ]);
    const y = big();
    for (let z = 1; z <= 30; z++) for (let x = 1; x <= 40; x++) put(y, "belt", x, z, 0, { grade: 3 });
    for (let z = 1; z <= 30; z++) must(y, { do: "paint", tint: 1 + (z % 6), x: 1, y: z });
    const tiles = F.within(y, 1, 1, 40, 30);
    must(y, { do: "saveBlueprint", slot: 5, tiles });
    const code = codeIn(y, 5);
    expect([F.piecesOf(y.blueprints[5]?.pieces ?? new Uint8Array()).length, code.length <= F.CODE_MOST]).toEqual([
      1200,
      true,
    ]);
    must(big(), { do: "pasteBlueprint", slot: 5, code });
    // One tile wider is refused.
    put(y, "belt", 41, 1, 0, { grade: 3 });
    expect(give(y, { do: "saveBlueprint", slot: 4, tiles: F.within(y, 1, 1, 41, 1) })).toMatchObject({
      why: "A blueprint is at most 40 tiles by 30. This is 41 by 1",
    });
    // The longest code there can be, and every tile of the largest box on the guild's land, each in
    // a command under what the page sends alone in one request (15,500 characters, of the 16 KiB Leaf reads).
    const corner = F.LAND.w * F.LAND.h - 40 * 30;
    expect(command({ do: "pasteBlueprint", slot: 5, code: "x".repeat(F.CODE_MOST) })).toBeLessThan(15_500);
    expect(
      command({ do: "saveBlueprint", slot: 5, tiles: Array.from({ length: 1200 }, (_, k) => corner + k) }),
    ).toBeLessThan(15_500);
  });

  test("off the wire, is text no longer than the longest code there can be", () => {
    expect(read("anything")).toMatchObject({ do: "pasteBlueprint", slot: 0, code: "anything" });
    expect(read("x".repeat(F.CODE_MOST))).not.toBeNull();
    expect(read("x".repeat(F.CODE_MOST + 1))).toBeNull();
    expect(read(12)).toBeNull();
    // Kept on the page's copy, as Leaf reads it: a code longer than that, spaces and all, is no code.
    expect(F.codePieces(`${" ".repeat(F.CODE_MOST)}${F.CODE_PREFIX}AAAA`)).toBeNull();
    expect(F.readCommand({ tick: 0, do: "pasteBlueprint", slot: F.BLUEPRINTS_MOST, code: "x" })).toBeNull();
  });

  test("of real blueprints, small and largest: their lengths, printed", () => {
    const y = staged("large");
    // The busiest box a blueprint may be in the staged yard (most pieces), a small one, and the
    // largest blueprint there can be: every tile of the box a graded, painted belt.
    let most = { tiles: [] as number[], x: 0, z: 0 };
    for (let z = 0; z + F.BLUEPRINT.h <= y.land.h; z += 4)
      for (let x = 0; x + F.BLUEPRINT.w <= y.land.w; x += 4) {
        const tiles = F.within(y, x, z, x + F.BLUEPRINT.w - 1, z + F.BLUEPRINT.h - 1);
        if (tiles.length > most.tiles.length) most = { tiles, x, z };
      }
    y.open = F.openOf([...F.ALL_GOALS]);
    must(y, { do: "saveBlueprint", slot: 0, tiles: most.tiles });
    const full = bare(5);
    full.open = F.openOf([...F.ALL_GOALS]);
    for (let z = 1; z <= F.BLUEPRINT.h; z++)
      for (let x = 1; x <= F.BLUEPRINT.w; x++) put(full, "belt", x, z, 0, { grade: 3 });
    for (let z = 1; z <= F.BLUEPRINT.h; z++) must(full, { do: "paint", tint: 1 + (z % 6), x: 1, y: z });
    must(full, { do: "saveBlueprint", slot: 0, tiles: F.within(full, 1, 1, F.BLUEPRINT.w, F.BLUEPRINT.h) });
    const small = kept();
    const lengths = {
      small: [F.piecesOf(small.blueprints[0]?.pieces ?? new Uint8Array()).length, codeIn(small, 0).length],
      busiest: [F.piecesOf(y.blueprints[0]?.pieces ?? new Uint8Array()).length, codeIn(y, 0).length],
      full: [F.piecesOf(full.blueprints[0]?.pieces ?? new Uint8Array()).length, codeIn(full, 0).length],
    };
    console.log(`Blueprint codes, [pieces, characters]: ${JSON.stringify(lengths)}`);
    // Each reads back as the pieces it was written from.
    for (const from of [small, y, full])
      expect(F.codePieces(codeIn(from, 0))).toEqual(F.piecesOf(from.blueprints[0]?.pieces ?? new Uint8Array()));
    expect(lengths.full[0]).toBe(F.BLUEPRINT.w * F.BLUEPRINT.h);
    expect(lengths.full[1]).toBeLessThanOrEqual(F.CODE_MOST);
    for (const [, chars] of Object.values(lengths)) expect(chars).toBeLessThanOrEqual(F.CODE_MOST);
  });
});
