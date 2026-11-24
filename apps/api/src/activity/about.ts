import { Effect } from "effect";

import type * as Body from "../api/schemas.ts";
import type { Seen } from "./here.ts";
import { Visits } from "./visits.ts";

const iso = (at: number) => new Date(at).toISOString();
const seenJson = (player: Seen) => ({
  id: player.playerId,
  username: player.username,
  place: player.place,
  guest: player.guest,
  seen_at: iso(player.seenAt),
});

/**
 * Who is about at `now`, as pages are given it, by the presence routes and in Live's `about`
 * frames alike: Leaf's lists as everybody is given them (`Visits.lists`, read at most once a
 * second unless a change is told), each of those here with when they last did something, and when
 * the lists were read, so that a page keeps the newest.
 */
export const whoIsAbout = Effect.fnUntraced(function* (now: number) {
  const visits = yield* Visits;
  const { at, here, acted } = yield* visits.lists(now);
  return {
    at: iso(at),
    present: here.present.map((player) => {
      const did = acted.get(player.playerId);
      return { ...seenJson(player), acted_at: did === undefined ? null : iso(did) };
    }),
    resting: here.resting.map(seenJson),
    gone: here.gone.map(seenJson),
  } satisfies typeof Body.Present.Type;
});
