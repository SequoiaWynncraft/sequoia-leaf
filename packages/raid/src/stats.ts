/** What The Little Raid says of somebody's standing, for their card: the bosses beaten, the runs, the furthest room. */
import type { Placed } from "@sequoia-leaf/core";

export const RAID_STATS = {
  name: "The Little Raid",
  numbers: ({ score, also }: Placed): { label: string; value: string }[] => [
    { label: "Bosses beaten", value: score.toLocaleString("en-US") },
    { label: "Runs", value: (also.runs ?? 0).toLocaleString("en-US") },
    { label: "Furthest room", value: String(also.room ?? 0) },
  ],
};
