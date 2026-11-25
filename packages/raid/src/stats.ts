/** What The Little Raid says of somebody's standing, for their card: the bosses beaten, the runs, the furthest room. */
import { type Placed, whole } from "@sequoia-leaf/core";

export const RAID_STATS = {
  name: "The Little Raid",
  numbers: ({ score, also }: Placed): { label: string; value: string }[] => [
    { label: "Bosses beaten", value: whole(score) },
    { label: "Runs", value: whole(also.runs ?? 0) },
    { label: "Furthest room", value: String(also.room ?? 0) },
  ],
};
