import { Layer, Random } from "effect";

/** 53 random bits, from Web Crypto: as many as a double holds exactly. */
function randomBits(): number {
  const [high = 0, low = 0] = crypto.getRandomValues(new Uint32Array(2));
  return (high & 0x1f_ffff) * 2 ** 32 + low;
}

/**
 * The server's dice, from Web Crypto rather than `Math.random`, whose state can
 * be worked out from a few of its outputs. A cone's roll decides what Leaf buys,
 * so nobody must be able to see the next one coming.
 */
export const SecureRandom = Layer.succeed(Random.Random)({
  nextIntUnsafe: randomBits,
  nextDoubleUnsafe: () => randomBits() / 2 ** 53,
});
