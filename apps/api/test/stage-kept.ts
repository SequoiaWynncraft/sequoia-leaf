/**
 * Keeping a staged state as Leaf keeps one, for the staging routes (`stage-raid.ts`,
 * `stage-works.ts`): in one transaction, the state over the one there (its `rev` up by one) or as
 * the first, and what it tells the town (`Game.postcard`) at that `rev`.
 */
import type { GameId, PlayerId, Postcard } from "@sequoia-leaf/core";
import { Effect } from "effect";
import { SqlClient } from "effect/sql";

export const keepStaged = (
  playerId: PlayerId,
  game: GameId,
  text: string,
  postcard: Postcard | undefined,
  now: number,
) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql.withTransaction(
      Effect.gen(function* () {
        yield* sql`
          INSERT INTO play_state (player_id, game, rev, state, updated_at) VALUES (${playerId}, ${game}, 1, ${text}, ${now})
          ON CONFLICT (player_id, game) DO UPDATE SET rev = rev + 1, state = excluded.state, updated_at = excluded.updated_at
        `;
        if (postcard === undefined) return;
        yield* sql`
          INSERT INTO play_postcards (player_id, game, rev, postcard)
          SELECT player_id, game, rev, ${JSON.stringify(postcard)} FROM play_state WHERE player_id = ${playerId} AND game = ${game}
          ON CONFLICT (player_id, game) DO UPDATE SET rev = excluded.rev, postcard = excluded.postcard
        `;
      }),
    );
  });
