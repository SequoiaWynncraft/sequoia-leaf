import { Effect } from "effect";

import type * as Body from "../api/schemas.ts";
import { type Seen, Visits } from "./visits.ts";

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
 * frames alike: Leaf's lists (`Visits.about`), each of those here with when they last did
 * something (`Visits.lastActed`), and when the lists were made, so that a page keeps the newest.
 */
export const whoIsAbout = Effect.fnUntraced(function* (now: number) {
  const visits = yield* Visits;
  const here = yield* visits.about(now);
  const acted = yield* visits.lastActed(here.present.map((player) => player.playerId));
  return {
    at: iso(now),
    present: here.present.map((player) => {
      const did = acted.get(player.playerId);
      return { ...seenJson(player), acted_at: did === undefined ? null : iso(did) };
    }),
    resting: here.resting.map(seenJson),
    gone: here.gone.map(seenJson),
  } satisfies typeof Body.Present.Type;
});
