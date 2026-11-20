import { describe, expect, it } from "bun:test";

import { Effect, Random } from "effect";

import { SecureRandom } from "../src/random.ts";

describe("the server's dice", () => {
  it("roll whole numbers across a cone's range, and fractions from 0 up to 1", async () => {
    const draws = await Effect.runPromise(
      Effect.all(Array.from({ length: 2_000 }, () => Random.nextIntBetween(0, 2 ** 32, { halfOpen: true }))).pipe(
        Effect.provide(SecureRandom),
      ),
    );
    const fractions = await Effect.runPromise(
      Effect.all(Array.from({ length: 2_000 }, () => Random.next)).pipe(Effect.provide(SecureRandom)),
    );

    expect(draws.every((draw) => Number.isInteger(draw) && draw >= 0 && draw < 2 ** 32)).toBe(true);
    expect(new Set(draws).size).toBeGreaterThan(1_990);
    expect(Math.max(...draws)).toBeGreaterThan(2 ** 31);
    expect(fractions.every((fraction) => fraction >= 0 && fraction < 1)).toBe(true);
  });
});
