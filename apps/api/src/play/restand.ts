import { gameId } from "@sequoia-leaf/core";
import { Effect } from "effect";

import type { JobRun } from "../metrics.ts";
import { GAMES } from "./games.ts";
import { PlayStore } from "./store.ts";

/** How many states' standings one run works out again, at most: the rest wait for the next minute. */
export const RESTANDS_A_RUN = 2000;

/**
 * Works out again where each state stands (`standings`) whose standing was not worked out from it
 * as it is stored (`stood`, migration 42): a state whose game came to count differently (as the
 * Little Raid did, counting each boss once), and any that a Leaf from before that, beside this one
 * in a deploy, wrote. Each is read as the play service reads it, and stands as its game says, as
 * stored (`Held.standing`), if it is still at that `rev`: one written meanwhile stands as its batch
 * wrote. A state never written (`rev` 0), one that does not read (logged), and one of a game Leaf
 * does not play stand nowhere new. One at a time, `RESTANDS_A_RUN` at most, giving way after each.
 */
export const restandAll = Effect.gen(function* () {
  const store = yield* PlayStore;
  const unstood = yield* store.unstood(RESTANDS_A_RUN);
  for (const { playerId, game, rev, state } of unstood) {
    const id = gameId(game);
    const held = id === undefined || rev === 0 ? null : GAMES[id].read(state, null);
    if (id !== undefined && rev > 0 && held === null) {
      yield* Effect.logError(`The ${game} state stored for ${playerId} does not read; it stands nowhere new`).pipe(
        Effect.annotateLogs({ player: playerId, game, rev }),
      );
    }
    yield* store.restand(playerId, game, rev, held?.standing() ?? null);
    yield* Effect.yieldNow;
  }
  const run: JobRun = unstood.length > 0 ? "done" : "idle";
  return run;
});
