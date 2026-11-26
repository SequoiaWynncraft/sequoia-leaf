import { describe, expect, test } from "bun:test";

import {
  backRow,
  cellAt,
  CELLS,
  cellSeat,
  colOf,
  COLS,
  cone,
  distance,
  line,
  mirror,
  neighbours,
  ring,
  rowOf,
  ROWS,
  seatCell,
  SEATS,
  stepToward,
  touching,
  walkLength,
  within,
} from "./hex.ts";

const inOrder = (numbers: readonly number[]): number[] => numbers.toSorted((a, b) => a - b);
const free = (): number[] => Array.from({ length: CELLS }, () => -1);

describe("the board", () => {
  test("is seven hexes by eight, four rows a side", () => {
    expect(COLS).toBe(7);
    expect(ROWS).toBe(8);
    expect(CELLS).toBe(56);
    expect(SEATS).toBe(28);
  });
  test("a cell knows its column and row", () => {
    expect(colOf(cellAt(5, 6))).toBe(5);
    expect(rowOf(cellAt(5, 6))).toBe(6);
  });
  test("a hex in the middle touches six others, a corner two or three", () => {
    expect(neighbours(cellAt(3, 3)).length).toBe(6);
    expect(neighbours(cellAt(0, 0)).length).toBe(2);
    expect(neighbours(cellAt(6, 0)).length).toBe(3);
    expect(neighbours(cellAt(6, 7)).length).toBe(2);
  });
  test("touching goes both ways", () => {
    for (let a = 0; a < CELLS; a++) for (const b of neighbours(a)) expect(neighbours(b)).toContain(a);
  });
  test("odd rows sit half a hex to the right", () => {
    // (3,4) is on an even row: above it are columns 2 and 3. (3,3) is on an odd row: above it are 3 and 4.
    expect(touching(cellAt(3, 4), cellAt(2, 3))).toBe(true);
    expect(touching(cellAt(3, 4), cellAt(3, 3))).toBe(true);
    expect(touching(cellAt(3, 4), cellAt(4, 3))).toBe(false);
    expect(touching(cellAt(3, 3), cellAt(4, 2))).toBe(true);
    expect(touching(cellAt(3, 3), cellAt(2, 2))).toBe(false);
  });
});

describe("distance", () => {
  test("is 0 to itself, 1 to a neighbour, and the same both ways", () => {
    for (let a = 0; a < CELLS; a++) {
      expect(distance(a, a)).toBe(0);
      for (const b of neighbours(a)) expect(distance(a, b)).toBe(1);
      for (let b = 0; b < CELLS; b++) expect(distance(a, b)).toBe(distance(b, a));
    }
  });
  test("along a row is the number of columns", () => {
    expect(distance(cellAt(0, 2), cellAt(6, 2))).toBe(6);
  });
  test("straight down the board is one step a row", () => {
    expect(distance(cellAt(3, 0), cellAt(3, 7))).toBe(7);
    expect(distance(cellAt(0, 0), cellAt(6, 7))).toBe(10);
  });
  test("matches the shortest walk on an empty board", () => {
    const board = free();
    for (let a = 0; a < CELLS; a += 5) {
      for (let b = 0; b < CELLS; b += 3) expect(walkLength(board, a, b)).toBe(distance(a, b));
    }
  });
  test("never breaks the triangle rule", () => {
    for (let a = 0; a < CELLS; a += 3) {
      for (let b = 0; b < CELLS; b += 4) {
        for (let c = 0; c < CELLS; c += 5) expect(distance(a, c)).toBeLessThanOrEqual(distance(a, b) + distance(b, c));
      }
    }
  });
});

describe("the two halves", () => {
  test("turning the board half round keeps every distance", () => {
    for (let a = 0; a < CELLS; a += 2) {
      for (let b = 0; b < CELLS; b += 3) expect(distance(mirror(a), mirror(b))).toBe(distance(a, b));
    }
  });
  test("front lines face each other: ours is row 4, theirs row 3", () => {
    expect(rowOf(seatCell(0, 3))).toBe(4);
    expect(rowOf(seatCell(1, 3))).toBe(3);
    expect(rowOf(seatCell(0, 3 * COLS))).toBe(backRow(0));
    expect(rowOf(seatCell(1, 3 * COLS))).toBe(backRow(1));
  });
  test("the same seat on either side is the same hex seen from the other chair", () => {
    for (let seat = 0; seat < SEATS; seat++) {
      expect(seatCell(1, seat)).toBe(mirror(seatCell(0, seat)));
      expect(cellSeat(0, seatCell(0, seat))).toBe(seat);
      expect(cellSeat(1, seatCell(1, seat))).toBe(seat);
      expect(cellSeat(1, seatCell(0, seat))).toBe(-1);
    }
  });
});

describe("shapes", () => {
  test("a ring holds the hexes exactly that far away", () => {
    const middle = cellAt(3, 4);
    expect(inOrder(ring(middle, 1))).toEqual(inOrder(neighbours(middle)));
    expect(ring(middle, 2).length).toBe(12);
    expect(within(middle, 2).length).toBe(18);
    for (const c of ring(middle, 2)) expect(distance(middle, c)).toBe(2);
  });
  test("a line runs straight from one hex through another and on", () => {
    const path = line(cellAt(0, 2), cellAt(2, 2), 5);
    expect(path).toEqual([cellAt(1, 2), cellAt(2, 2), cellAt(3, 2), cellAt(4, 2), cellAt(5, 2)]);
    // Each hex is one further than the last, and each touches the one before.
    const slant = line(cellAt(3, 7), cellAt(3, 5), 6);
    slant.forEach((c, i) => {
      expect(distance(cellAt(3, 7), c)).toBe(i + 1);
      expect(touching(i === 0 ? cellAt(3, 7) : (slant[i - 1] ?? -1), c)).toBe(true);
    });
    expect(slant[1]).toBe(cellAt(3, 5));
  });
  test("a line stops at the edge of the board", () => {
    expect(line(cellAt(4, 2), cellAt(5, 2), 6)).toEqual([cellAt(5, 2), cellAt(6, 2)]);
    expect(line(cellAt(4, 2), cellAt(4, 2), 6)).toEqual([]);
  });
  test("a cone opens toward its target: one hex wide, then three", () => {
    const from = cellAt(3, 5);
    const toward = cellAt(3, 4);
    const cells = cone(from, toward, 2);
    expect(cells).toContain(toward);
    for (const c of cells) {
      expect(distance(from, c)).toBeLessThanOrEqual(2);
      // Nothing in it is behind or beside where it starts.
      expect(rowOf(c)).toBeLessThan(5);
    }
    expect(cells.filter((c) => distance(from, c) === 1).length).toBeLessThanOrEqual(2);
    expect(cells.filter((c) => distance(from, c) === 2).length).toBeGreaterThanOrEqual(2);
    // Along a row it is exactly one hex, then three.
    const flat = cone(cellAt(2, 4), cellAt(3, 4), 2);
    expect(flat.filter((c) => distance(cellAt(2, 4), c) === 1)).toEqual([cellAt(3, 4)]);
    expect(flat.filter((c) => distance(cellAt(2, 4), c) === 2).length).toBe(3);
  });
});

describe("finding a way", () => {
  test("the first step of a walk gets nearer", () => {
    const board = free();
    const from = cellAt(0, 7);
    const goal = cellAt(6, 0);
    const step = stepToward(0, board, from, goal, 1);
    expect(touching(from, step)).toBe(true);
    expect(distance(step, goal)).toBe(distance(from, goal) - 1);
  });
  test("stops short by its reach", () => {
    const board = free();
    // Three away with a reach of three: any step is a step that is already in reach.
    const step = stepToward(0, board, cellAt(3, 7), cellAt(3, 3), 3);
    expect(distance(step, cellAt(3, 3))).toBeLessThanOrEqual(3);
  });
  test("of the nearest hexes in reach, it makes for the one furthest from any enemy", () => {
    const board = free();
    const goal = cellAt(3, 0);
    const other = cellAt(4, 1);
    board[goal] = 1;
    board[other] = 2;
    /** Where a walk from the back row ends, with a reach of two, knowing where some enemies stand. */
    const end = (foes: readonly number[]): number => {
      let here = cellAt(3, 7);
      for (let i = 0; i < 9 && distance(here, goal) > 2; i++) here = stepToward(0, board, here, goal, 2, foes);
      return here;
    };
    // Told of nobody it takes the first hex found, which touches the other enemy.
    expect(distance(end([]), other)).toBe(1);
    expect([distance(end([goal, other]), goal), distance(end([goal, other]), other)]).toEqual([2, 2]);
  });
  test("walks round a wall", () => {
    const board = free();
    // A wall across row 4 with one gap at the far right.
    for (let col = 0; col < COLS - 1; col++) board[cellAt(col, 4)] = 99;
    const from = cellAt(0, 6);
    const goal = cellAt(0, 2);
    expect(walkLength(board, from, goal)).toBeGreaterThan(distance(from, goal));
    // Following the steps gets there, through the gap.
    let here = from;
    const trail: number[] = [];
    for (let i = 0; i < 40 && distance(here, goal) > 1; i++) {
      const next = stepToward(0, board, here, goal, 1);
      expect(next).toBeGreaterThanOrEqual(0);
      expect(board[next]).toBe(-1);
      here = next;
      trail.push(here);
    }
    expect(distance(here, goal)).toBe(1);
    expect(trail).toContain(cellAt(6, 4));
  });
  test("with no way to a hex in reach there is no step, though a longer reach finds one", () => {
    const board = free();
    for (let col = 0; col < COLS; col++) board[cellAt(col, 4)] = 99;
    const goal = cellAt(3, 2);
    expect(stepToward(0, board, cellAt(3, 7), goal, 1)).toBe(-1);
    const nearer = stepToward(0, board, cellAt(3, 7), goal, 3);
    expect(distance(nearer, goal)).toBeLessThan(distance(cellAt(3, 7), goal));
    expect(walkLength(board, cellAt(3, 7), goal)).toBe(-1);
  });
  test("both sides walk alike: a mirrored walk is the mirror of the walk", () => {
    const board = free();
    const mirrored = free();
    for (const c of [cellAt(3, 4), cellAt(2, 4), cellAt(4, 3)]) {
      board[c] = 99;
      mirrored[mirror(c)] = 99;
    }
    for (let from = 0; from < CELLS; from += 3) {
      if (board[from] !== -1) continue;
      const goal = cellAt(3, 1);
      const a = stepToward(0, board, from, goal, 1);
      const b = stepToward(1, mirrored, mirror(from), mirror(goal), 1);
      expect(b).toBe(a < 0 ? -1 : mirror(a));
    }
  });
});
