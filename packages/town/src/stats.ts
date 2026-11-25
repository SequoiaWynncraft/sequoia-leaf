/** What the camp says of somebody's standing, for their card: the things set out, the Coins spent in town and camp, the callers greeted, the crab spotted. */
import { type Placed, whole } from "@sequoia-leaf/core";

import { LOST_CRAB } from "./catalogue.ts";

export const TOWN_STATS = {
  name: "Camp",
  numbers: ({ score, also }: Placed, spent: number): { label: string; value: string }[] => [
    { label: "Things set out", value: whole(score) },
    { label: "Coins spent", value: whole(spent) },
    { label: "Callers greeted", value: whole(also.greeted ?? 0) },
    { label: `Crab No. ${LOST_CRAB} spotted`, value: whole(also.sightings ?? 0) },
  ],
};
