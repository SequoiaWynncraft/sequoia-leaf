import { describe, expect, test } from "bun:test";

import { charging, dazed, falling, gathering, pushing, recoiling, standing, throwing, walking } from "./acts.ts";
import { handOf, handsOf, REST } from "./rig.ts";

describe("what a person on a rig does", () => {
  test("walks with arms and legs swinging in turn, each arm against the leg on its side", () => {
    const strides = Array.from({ length: 8 }, (_, c) => walking(c, false));
    expect(new Set(strides.map((s) => s.leg)).size).toBeGreaterThan(3);
    for (const s of strides) {
      expect(s.view).toBe("side");
      expect(s.offLeg).toBe(-s.leg);
      expect(s.arm).toBe(-s.leg);
    }
  });

  test("throws with the arm drawn back, then out at whoever it is for as the thing leaves the hand", () => {
    expect(throwing(1, -0.1, false, 5).arm).toBeGreaterThan(5);
    const out = throwing(1, 0, false, 5);
    expect(out.arm).toBe(5);
    // The hand is out past the body on the side it throws to, above the shoulder.
    expect(handOf(out).x).toBeGreaterThan(5);
    expect(handOf({ ...out, left: true }).x).toBeLessThan(-5);
    expect(throwing(1, 9, false, 5).arm).toBe(0);
  });

  test("gathers an ability at the far hip in both hands, holds it there, and pushes it out at whoever it is for", () => {
    // Whoever it is for is on our right: the head turns to them, both hands go to the other hip.
    expect(gathering(0, false)).toMatchObject({ arm: 0, offArm: 0, turn: 1 });
    const gathered = gathering(1, false);
    expect(gathered).toMatchObject({ view: "front", sway: -1, turn: 1 });
    const hip = handsOf(gathered);
    expect(hip.x).toBeLessThan(-1);
    expect(hip.y).toBeGreaterThan(-9);
    expect(hip.y).toBeLessThan(-3);
    expect(handsOf(gathering(1, true)).x).toBeGreaterThan(1);
    // Held there until it lands, trembling a pixel as it comes.
    for (let since = 0; since < 20; since++) {
      const held = handsOf(charging(since, 20 - since, false));
      expect(Math.abs(held.x - hip.x) + Math.abs(held.y - hip.y)).toBeLessThanOrEqual(1);
    }
    // Pushed out: both hands on their side, the leading one well out, higher for somebody higher, then let down.
    const level = pushing(0, false, 4);
    expect(handsOf(level).x).toBeGreaterThan(2);
    expect(handOf(level).x).toBeGreaterThan(6);
    expect(handOf(pushing(0, false, 6)).y).toBeLessThan(handOf(level).y);
    expect(handOf(pushing(0, true, 4)).x).toBeLessThan(-6);
    expect(pushing(11, false, 5)).toMatchObject({ arm: 0, offArm: 0 });
  });

  test("reels from a blow, sways when dazed, and falls onto its back", () => {
    expect(recoiling(0, false, true).sway).toBeGreaterThan(recoiling(0, false, false).sway);
    expect(new Set(Array.from({ length: 16 }, (_, c) => dazed(c).sway)).size).toBe(2);
    expect(falling(0, false).lie).toBe(false);
    expect(falling(3, false).lie).toBe(true);
    expect(falling(7, true)).toMatchObject({ lie: true, left: true });
  });

  test("stands still but for a breath, a shift of weight and a look at whoever it is about to hit", () => {
    const stood = Array.from({ length: 280 }, (_, c) => standing(c, false, 0, false));
    expect(stood.some((s) => s.nod === 1)).toBe(true);
    expect(stood.some((s) => s.sway === 1)).toBe(true);
    expect(stood.every((s) => s.turn === 0)).toBe(true);
    expect(standing(0, false, 0, true).turn).toBe(1);
    expect(standing(0, false, 0, false)).toEqual({ ...REST });
  });
});
