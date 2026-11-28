import { Effect } from "effect";

import type * as Body from "../api/schemas.ts";
import type { Seen } from "./here.ts";
import { Visits } from "./visits.ts";

const iso = (at: number) => new Date(at).toISOString();
/** Somebody on the lists, as pages are given them: at a camp, whose (its owner's id and name); nothing of a camp anywhere else. */
const seenJson = (player: Seen) => ({
  id: player.playerId,
  username: player.username,
  place: player.place,
  ...(player.camp === null ? {} : { camp_owner: player.camp.playerId, camp_owner_name: player.camp.name }),
  guest: player.guest,
  seen_at: iso(player.seenAt),
});

/**
 * Who is about at `now`, as pages are given it, by the presence routes and in Live's `about`
 * frames alike: Leaf's lists as everybody is given them (`Visits.lists`, read at most once a
 * second unless a change is told), and when they were read, so that a page keeps the newest. Each
 * of those here says what Leaf knows of them and nothing a page has to work out: where, since when,
 * whether a live room has them, and when they last did something. Each of those gone says when
 * they left.
 */
export const whoIsAbout = Effect.fnUntraced(function* (now: number) {
  const visits = yield* Visits;
  const { at, here, acted } = yield* visits.lists(now);
  return {
    at: iso(at),
    present: here.present.map((player) => {
      const did = acted.get(player.playerId);
      return {
        ...seenJson(player),
        live: player.live,
        since: iso(player.since),
        acted_at: did === undefined ? null : iso(did),
      };
    }),
    resting: here.resting.map(seenJson),
    gone: here.gone.map(seenJson),
  } satisfies typeof Body.Present.Type;
});
