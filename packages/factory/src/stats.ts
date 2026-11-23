/**
 * What the Works says of somebody's standing, for their card: what their yard has earned, the tier
 * it has reached, and its place. It reads nothing of the rules, so the town takes it without them.
 */
import type { Placed } from "@sequoia-leaf/core";

export const WORKS_STATS = {
  name: "The Works",
  numbers: ({ place, score, also }: Placed): { label: string; value: string }[] => [
    { label: "Coins earned", value: score.toLocaleString("en-US") },
    { label: "Tier", value: String(also.tier ?? 0) },
    // A yard that has earned nothing is not on the board.
    ...(score > 0 ? [{ label: "Top yards", value: `#${place}` }] : []),
  ],
};
