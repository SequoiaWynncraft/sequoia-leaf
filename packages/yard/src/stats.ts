/** What the Works says of somebody's standing, for their card: what their yard has earned, the story, and its place. */
import type { Placed } from "@sequoia-leaf/core";

import { STORY } from "./content/story.ts";

export const WORKS_STATS = {
  name: "The Works",
  numbers: ({ place, score, also }: Placed): { label: string; value: string }[] => [
    { label: "Coins earned", value: score.toLocaleString("en-US") },
    { label: "Story", value: `${also.story ?? 0} of ${STORY.length}` },
    // A yard that has earned nothing is not on the board.
    ...(score > 0 ? [{ label: "Top yards", value: `#${place}` }] : []),
  ],
};
