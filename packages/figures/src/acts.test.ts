import { describe, expect, test } from "bun:test";

import { dazed, falling, holding, raising, recoiling, slamming, standing, throwing, walking } from "./acts.ts";
import { handOf, REST } from "./rig.ts";

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

  test("raises an ability with both arms, points at whoever it is for until it lands, and brings it down", () => {
    expect(raising(0, false)).toMatchObject({ arm: 0, offArm: 0 });
    expect(raising(1, false)).toMatchObject({ arm: 6, offArm: 6 });
    for (let since = 0; since < 16; since++) expect(holding(since, 20 - since, true, 4).arm).toBe(4);
    expect(holding(18, 2, true, 4)).toMatchObject({ arm: 6, offArm: 6 });
    expect(slamming(0, true).sink).toBe(2);
    expect(slamming(11, true)).toMatchObject({ arm: 0, offArm: 0, sink: 0 });
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
