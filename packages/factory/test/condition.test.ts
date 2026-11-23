/**
 * `condition` is `status` as a number: for every piece of yards at work (the staged yards, the
 * generated one, and every 50 commands of random play in `play.test.ts`), it says the same state and
 * the same trouble, tick after tick.
 */
import { describe, expect, test } from "bun:test";

import * as F from "../src/index.ts";
import { bothSay } from "./said.ts";
import { generated, staged, STAGES } from "./yards.ts";

describe("a piece's condition", () => {
  test("is its status, for every piece of the staged yards and of the generated one, as they run", () => {
    const yards = [...STAGES.map((name) => staged(name)), F.decode(F.encode(generated().y), generated().y.land)];
    for (const y of yards) {
      if (!y) throw new Error("no yard");
      for (let round = 0; round < 6; round++) {
        const { status, condition } = bothSay(y);
        expect(condition).toEqual(status);
        for (let k = 0; k < 37; k++) F.step(y);
      }
    }
  });
});
