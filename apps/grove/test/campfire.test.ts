import { describe, expect, test } from "bun:test";

import { overlaps, placeTags, seatPeople, throwFrom } from "../src/scenes/campfire/seats.ts";

/** The bundle's Campfire (grove/campfire.py): the fire, then the seats in its order (the logs' seat points, then the standing spots). */
const FIRE = { x: 128, y: 129 };
const SEATS = [
  { x: 88, y: 126 },
  { x: 151, y: 126 },
  { x: 167, y: 126 },
  { x: 182, y: 140 },
  { x: 104, y: 126 },
  { x: 98, y: 141 },
  { x: 160, y: 141 },
  { x: 106, y: 121 },
  { x: 150, y: 121 },
  { x: 66, y: 141 },
];
const CALL = ["Moss", "Fern", "Cinder", "Wren", "You"];

describe("the Campfire's seats", () => {
  test("seats everyone in the call in the bundle's order", () => {
    const seated = seatPeople(CALL, SEATS, FIRE);
    const where = Object.fromEntries(seated.map((s) => [s.person, [s.x, s.y]]));
    expect(where).toEqual({
      Moss: [88, 126],
      Fern: [151, 126],
      Cinder: [167, 126],
      Wren: [182, 140],
      You: [104, 126],
    });
  });

  test("turns everyone to face the fire: those on its right are mirrored", () => {
    const seated = seatPeople(CALL, SEATS, FIRE);
    expect(seated.filter((s) => s.flip).map((s) => s.person)).toEqual(["Fern", "Cinder", "Wren"]);
  });

  test("comes back to front, the order they are drawn in", () => {
    const rows = seatPeople([...CALL, "a", "b", "c", "d", "e"], SEATS, FIRE).map((s) => s.y);
    expect(rows).toEqual(rows.toSorted((a, b) => a - b));
    expect(rows[0]).toBe(121);
  });

  test("seats no more people than there are seats", () => {
    const crowd = Array.from({ length: 14 }, (_, i) => `friend-${i}`);
    const seated = seatPeople(crowd, SEATS, FIRE);
    expect(seated).toHaveLength(SEATS.length);
    expect(new Set(seated.map((s) => s.seat)).size).toBe(SEATS.length);
  });

  test("throws a cone from the paws, toward the fire", () => {
    for (const s of seatPeople(CALL, SEATS, FIRE)) {
      const from = throwFrom(s);
      expect(Math.abs(from.x - FIRE.x)).toBeLessThan(Math.abs(s.x - FIRE.x));
      expect(from.y).toBeLessThan(s.y);
    }
  });
});

describe("the Campfire's nametags", () => {
  test("sit just over each head when there is room", () => {
    const [tag] = placeTags([{ name: "Moss", w: 24, x: 100, y: 80, front: 131 }], 400);
    expect(tag?.x).toBe(100);
    expect(tag?.y).toBe(71);
  });

  test("never cover one another, however close the heads", () => {
    const heads = ["Moss", "Fern", "Cinder", "Wren", "You"].map((name, i) => ({
      name,
      w: 6 * name.length + 4,
      x: 140 + i * 9,
      y: 90,
      front: 131,
    }));
    const tags = placeTags(heads, 400);
    expect(tags).toHaveLength(5);
    for (const a of tags) for (const b of tags) if (a !== b) expect(overlaps(a.box, b.box)).toBe(false);
  });

  test("stay on the screen at its edges", () => {
    const tags = placeTags(
      [
        { name: "Moss", w: 24, x: 1, y: 80, front: 131 },
        { name: "Cinder", w: 36, x: 199, y: 80, front: 131 },
      ],
      200,
    );
    for (const t of tags) {
      expect(t.box.x).toBeGreaterThanOrEqual(0);
      expect(t.box.x + t.box.w).toBeLessThanOrEqual(200);
    }
  });
});
