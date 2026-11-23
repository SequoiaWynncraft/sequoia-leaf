/** What the camp says of somebody's standing, for their card: the things set out, the Coins spent in town and camp, the callers greeted, the crab spotted. */
import type { Placed } from "@sequoia-leaf/core";

import { LOST_CRAB } from "./catalogue.ts";

export const TOWN_STATS = {
  name: "Camp",
  numbers: ({ score, also }: Placed, spent: number): { label: string; value: string }[] => [
    { label: "Things set out", value: score.toLocaleString("en-US") },
    { label: "Coins spent", value: spent.toLocaleString("en-US") },
    { label: "Callers greeted", value: (also.greeted ?? 0).toLocaleString("en-US") },
    { label: `Crab No. ${LOST_CRAB} spotted`, value: (also.sightings ?? 0).toLocaleString("en-US") },
  ],
};
