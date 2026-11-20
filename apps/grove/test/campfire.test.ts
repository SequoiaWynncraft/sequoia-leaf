import { describe, expect, test } from "bun:test";

import { seatPeople, throwFrom } from "../src/scenes/campfire/seats.ts";

/** The bundle's Campfire: the fire, then the seats in its order (two logs, the ground in front, behind). */
const FIRE = { x: 128, y: 129 };
const SEATS = [
  { x: 92, y: 131 },
  { x: 104, y: 131 },
  { x: 152, y: 131 },
  { x: 164, y: 131 },
  { x: 116, y: 139 },
  { x: 140, y: 139 },
  { x: 80, y: 139 },
  { x: 176, y: 139 },
  { x: 120, y: 121 },
  { x: 136, y: 121 },
];
const CALL = ["Moss", "Fern", "Cinder", "Wren", "You"];

describe("the Campfire's seats", () => {
  test("seats everyone in the call in the bundle's order: the two logs, then the ground in front", () => {
    const seated = seatPeople(CALL, SEATS, FIRE);
    const where = Object.fromEntries(seated.map((s) => [s.person, [s.x, s.y]]));
    expect(where).toEqual({
      Moss: [92, 131],
      Fern: [104, 131],
      Cinder: [152, 131],
      Wren: [164, 131],
      You: [116, 139],
    });
  });

  test("turns everyone to face the fire: those on its right are mirrored", () => {
    const seated = seatPeople(CALL, SEATS, FIRE);
    expect(seated.filter((s) => s.flip).map((s) => s.person)).toEqual(["Cinder", "Wren"]);
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
