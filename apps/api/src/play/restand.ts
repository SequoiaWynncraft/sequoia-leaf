import { gameId } from "@sequoia-leaf/core";
import { Effect } from "effect";

import type { JobRun } from "../metrics.ts";
import { GAMES, unreadable } from "./games.ts";
import { PlayStore } from "./store.ts";

/** How many states' standings one run works out again, at most: the rest wait for the next minute. */
export const RESTANDS_A_RUN = 2000;

/**
 * Works out again where each state stands (`standings`) whose standing was not worked out from it
 * as it is stored (`stood`, migration 42): a state whose game came to count differently (as the
 * Little Raid did, counting each boss once), and any that a Leaf from before that, beside this one
 * in a deploy, wrote. Each is read as the play service reads it, and its standing there is put right
 * to what its game says, as stored (`Held.standing`), if it is still at that `rev` (`PlayStore.restand`,
 * which says when it was reached): one written meanwhile stands as its batch wrote. A standing is
 * only ever put right, never made: a state that stands nowhere (one never written, or moved to
 * another player as it was made) stays so, and one that does not read (logged) or of a game Leaf does
 * not play is left as it stands. One at a time, `RESTANDS_A_RUN` at most, giving way after each.
 */
export const restandAll = Effect.gen(function* () {
  const store = yield* PlayStore;
  const unstood = yield* store.unstood(RESTANDS_A_RUN);
  for (const { playerId, game, rev, state } of unstood) {
    const id = gameId(game);
    const held = id === undefined || rev === 0 ? null : GAMES[id].read(state, null);
    if (id !== undefined && rev > 0 && held === null) yield* unreadable(game, playerId, rev, "it stands as it stood");
    yield* store.restand(playerId, game, rev, held?.standing() ?? null);
    yield* Effect.yieldNow;
  }
  const run: JobRun = unstood.length > 0 ? "done" : "idle";
  return run;
});
