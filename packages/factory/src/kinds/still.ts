import type { Yard } from "../yard.ts";
/**
 * The still, three tiles by three (tier 6): it takes tar in on the nine tile-sides of its back and
 * sides and parts it into pitch, creosote and spirit, 3, 2 and 1 of every 6, in the order of its mix
 * (`content/mixes.ts`, the breaker's step: `mix.ts`). Each leaves by its own way out, the three tiles
 * of its front: pitch the left, creosote the middle, spirit the right (`Ports.out.only`). It holds one
 * finished thing and makes nothing more until that has left, so the first of the three with nowhere to
 * go stops all three. Each it makes adds 1 to the smog on its plot.
 */
import { kind, type Words } from "./kind.ts";
import type { Kit } from "./kit.ts";
import { MIXER } from "./mix.ts";
import { backAndSides, front } from "./ports.ts";
import { as, asItem, heldAs, heldWords, NO_POWER } from "./say.ts";

/**
 * How it stands: the breaker's way, but a thing that cannot leave, with nowhere ahead to take it or the
 * line ahead stopped, stops it: blocked, in trouble, whichever of its three it is (`heldAs`).
 */
function condition(k: Kit, y: Yard, i: number, lit: boolean): number {
  const out = asItem(k, y.holders.out[k.holderOf(y, i)] ?? k.NONE);
  if (!lit || out === null) return MIXER.condition?.(k, y, i, lit) ?? as("waiting");
  return heldAs(k, y, i, out);
}

/** Its words: the breaker's, but stopped or waiting for room it says which thing cannot leave, and by which way out. */
function words(k: Kit, y: Yard, i: number, state: string): Words {
  if (state === "unpowered") return { line: NO_POWER };
  const out = asItem(k, y.holders.out[k.holderOf(y, i)] ?? k.NONE);
  if (out === null) return MIXER.words?.(k, y, i, state) ?? { line: "" };
  return heldWords(k, y, i, state, out, "It makes nothing else until it does.");
}

export const still = kind({
  name: "still",
  info: {
    name: "Still",
    cost: 8000,
    draw: 60,
    gives: 0,
    smog: 1,
    what: "From every 6 tar: 3 pitch from the left of its front, 2 creosote from the middle, 1 spirit from the right. It makes one at a time, and stops while that one cannot leave.",
  },
  graded: true,
  holds: true,
  size: [3, 3],
  ports: {
    in: backAndSides(3, 3),
    out: [
      { at: front(3, 0), sends: "out", only: "pitch" },
      { at: front(3, 1), sends: "out", only: "creosote" },
      { at: front(3, 2), sends: "out", only: "spirit" },
    ],
  },
  rules: { ...MIXER, condition, words },
});
