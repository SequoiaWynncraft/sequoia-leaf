/**
 * The table's postcard for the town (`Game.postcard`), which Leaf keeps with the table: a raid
 * under way and where it got to, or the board set out. The table keeps no till.
 */
import type { Postcard } from "@sequoia-leaf/core";

import { TRAILS } from "./content/rooms.ts";
import type { Almanac } from "./outside.ts";
import type { Run } from "./run.ts";
import { trailOf } from "./way.ts";

/** The postcard of a table: of the run in hand (`held.main`), or of the almanac. */
export function postcard({
  held: { main: run },
  almanac,
}: {
  readonly held: { readonly main: Run | null };
  readonly almanac: Almanac;
}): Postcard {
  const waiting =
    run && run.stage.phase !== "over"
      ? `A raid is under way: room ${run.room + 1}, on ${TRAILS[trailOf(run.way)]?.name ?? "the trail"}.`
      : almanac.runs === 0
        ? "The board is set out. One crab is uncounted."
        : "The board is set out for another raid.";
  return { waiting, till: 0 };
}
