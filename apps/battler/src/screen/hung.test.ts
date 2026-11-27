import { describe, expect, test } from "bun:test";

import type { FightSetup } from "@sequoia-leaf/raid";
import { at, partyOfFigures } from "@sequoia-leaf/raid/testkit.ts";

import { fateOf, hangs, type Hung, stillCaught } from "./hung.ts";
import { leadOf } from "./looks.ts";
import { advance, openPlayback } from "./playback.ts";

/**
 * The banner's member behind a wall, against a party that lasts long enough to be caught several
 * times. (The wall has one Groot figure, Greg, so no figure gets back up and the opening is as long
 * as this was written for: whether a cast is shown in a later frame turns on where frames fall.)
 */
const SETUP: FightSetup = {
  seed: 3,
  sides: [
    partyOfFigures([at("banner-1", 3, 3, 2), at("crab40", 3, 0, 2), at("glorp", 2, 0, 2), at("greg", 4, 0, 2)]),
    partyOfFigures([at("rock", 3, 0, 2), at("crab40", 2, 0, 2), at("badger", 4, 0, 2), at("kettle", 3, 2, 2)]),
  ],
};

describe("an ability that lands later", () => {
  test("lands in the frame its damage is shown, at 4x with frames longer than a step", () => {
    const pb = openPlayback(SETUP, leadOf);
    const hung: { h: Hung; by: number; to: number }[] = [];
    const fell = new Map<number, number>();
    let landed = 0;
    let shownLate = 0;
    for (let frame = 0; frame < 100_000 && !pb.fight.over; frame++) {
      const { happened } = advance(pb, 1 / 30, 4);
      for (const cue of happened) {
        if (cue.ev.t === "fall") fell.set(cue.ev.id, cue.at);
        if (cue.ev.t !== "cast" || cue.ev.kind !== "banner-1") continue;
        hung.push({ h: hangs(cue.at, cue.ev.ticks), by: cue.ev.id, to: cue.ev.targets[0] ?? -1 });
        // The frame's clock is already past the step it went off at.
        if (Math.floor(pb.clock) > cue.at) shownLate++;
      }
      for (const one of hung.splice(0)) {
        const fate = fateOf(one.h, pb.clock, pb.fight);
        if (fate === "hangs") hung.push(one);
        if (fate !== "lands") continue;
        landed++;
        const blast = happened.filter(
          (cue) => cue.ev.t === "hit" && cue.ev.source === "ability" && cue.ev.by === one.by && cue.at === one.h.lands,
        );
        expect(blast.length).toBeGreaterThan(0);
        // Whoever it was for is still under it as it lands, though it may be what fells them.
        const struck = blast.some((cue) => cue.ev.t === "hit" && cue.ev.id === one.to);
        expect(stillCaught(one.h, fell.get(one.to) ?? Infinity, pb.clock)).toBe(struck);
      }
    }
    expect(landed).toBeGreaterThan(1);
    expect(shownLate).toBeGreaterThan(0);
  });

  test("still lands when whoever it is for falls first, and only they are out from under it", () => {
    const h = hangs(40, 20);
    const fight = { over: false, tick: 0 };
    expect(stillCaught(h, Infinity, 44)).toBe(true);
    // Felled by somebody else at step 45: out from under it from then, and it hangs on and lands.
    expect(stillCaught(h, 45, 44.9)).toBe(true);
    expect(stillCaught(h, 45, 45)).toBe(false);
    expect(fateOf(h, 45, fight)).toBe("hangs");
    expect(fateOf(h, 59.9, fight)).toBe("hangs");
    expect(fateOf(h, 60, fight)).toBe("lands");
    expect(stillCaught(h, 45, 61.3)).toBe(false);
    // Felled by it, in a frame whose clock is past the step: struck, not gone first.
    expect(stillCaught(h, 60, 61.3)).toBe(true);
  });

  test("never lands when the fight ended before its step, and does when it ended on it", () => {
    const h = hangs(40, 20);
    expect(fateOf(h, 58, { over: true, tick: 57 })).toBe("never");
    expect(fateOf(h, 61, { over: true, tick: 60 })).toBe("lands");
  });
});
