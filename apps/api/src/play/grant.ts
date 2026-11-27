import { isRefused, type PlayerId } from "@sequoia-leaf/core";
import {
  applyCommand,
  awardsBetween,
  BANNERS,
  decodePulls,
  type Grant,
  headliner,
  newPulls,
  opensAt,
  type PullsNote,
  type Rarity,
} from "@sequoia-leaf/pulls";
import { readNotes } from "@sequoia-leaf/pulls/wire.ts";
import { everyFigure, prizeOf } from "@sequoia-leaf/raid/content/catalog.ts";
import { Clock, Effect, Option, Schema } from "effect";
import { SecureRandom } from "effect/crypto";
import { SqlClient, SqlSchema } from "effect/sql";

import { ctxOf, GAMES, NOTHING_GIVEN, StaffCommand } from "./games.ts";
import { Play } from "./service.ts";
import { PlayStore } from "./store.ts";

/** A prize as the staff name it: one of the raid's figures by its id, or a banner's headliner by the banner's. */
export type Named = { readonly figure: string } | { readonly banner: string };

/** The one prize a body names, by `figure` or by `banner`; null for both or neither. */
export function namedOf(body: {
  readonly figure?: string | undefined;
  readonly banner?: string | undefined;
}): Named | null {
  if (body.figure !== undefined) return body.banner === undefined ? { figure: body.figure } : null;
  return body.banner === undefined ? null : { banner: body.banner };
}

/** The prize the pull game knows it by (`figure:<id>`, `headliner:<banner>`), or null for none. A headliner's figure is its banner's headliner. */
export function prizeNamed(named: Named): string | null {
  if ("banner" in named) return BANNERS.some(({ id }) => id === named.banner) ? headliner(named.banner) : null;
  const id = everyFigure().find((figure) => figure === named.figure);
  return id === undefined ? null : prizeOf(id);
}

/** The staff member who gives a grant. */
export interface Giver {
  readonly id: PlayerId;
  readonly name: string;
}

/** What a grant did, or with `dry` would do: the copies held before and after, and the awards that follow; and the player's name as Leaf last saw them. */
export interface Granted {
  readonly name: string | null;
  readonly prize: string;
  readonly rarity: Rarity;
  readonly had: number;
  readonly have: number;
  readonly awards: readonly string[];
  readonly at: number;
}

/**
 * Why a grant is not made: the player is not one Leaf has seen (`no_such_player`), the prize no
 * release has (`no_such_prize`), or it is not open yet on Leaf's clock (`not_released`, with when it
 * opens), or their pulls as stored do not read (`unreadable`), or the player's commands are coming
 * faster than Leaf takes them, the grant taking one of their batches (`slow`).
 */
export type NotGranted =
  | { readonly why: "no_such_player" | "no_such_prize" | "unreadable" | "slow" }
  | { readonly why: "not_released"; readonly opens: number };

/** Whether a player was a guest, and their name as Leaf last saw them (null: not seen, only their pulls stored). */
const Seen = Schema.Struct({ guest: Schema.BooleanFromBit, name: Schema.NullOr(Schema.String) });

/**
 * Gives a player `copies` of a prize as a pull gives one, for nothing: a `grant` command to their
 * pulls through the play service as a batch of one of theirs (`StaffCommand`), so that the pulls' state holds it and the awards
 * follow from that state in the same transaction, with a `pulls_granted` activity row saying who
 * gave it. With `dry`, the same rules are run on their pulls as stored, and nothing is written.
 */
export const grantPrize = (player: PlayerId, prize: string, copies: number, by: Giver, dry: boolean) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const play = yield* Play;
    const random = yield* SecureRandom.SecureRandom;
    const store = yield* PlayStore;
    const at = yield* Clock.currentTimeMillis;
    // Whether they were a guest, as their pulls say, or else as Leaf last saw them.
    const seen = yield* SqlSchema.findOneOption({
      Request: Schema.String,
      Result: Seen,
      execute: (id) => sql`
        SELECT coalesce(s.guest, p.guest) AS guest, p.name FROM (SELECT ${id} AS player_id) AS w
        LEFT JOIN players_seen AS p ON p.player_id = w.player_id
        LEFT JOIN play_state AS s ON s.player_id = w.player_id AND s.game = 'pulls'
        WHERE p.player_id IS NOT NULL OR s.player_id IS NOT NULL
      `,
    })(player).pipe(Effect.orDie);
    if (Option.isNone(seen)) return { why: "no_such_player" } satisfies NotGranted;
    const command: Grant = { do: "grant", prize, copies, by: by.id, name: by.name };
    const refusal = (code: string): NotGranted => {
      const opens = opensAt(prize);
      return code === "not_released" && opens !== null ? { why: "not_released", opens } : { why: "no_such_prize" };
    };
    const done = (note: PullsNote, had: number): Granted => ({
      name: seen.value.name,
      prize,
      rarity: note.rarity,
      had,
      have: note.have,
      awards: awardsBetween(prize, had, note.have),
      at,
    });
    if (dry) {
      const stored = yield* store.read(player, "pulls");
      const state = Option.isNone(stored) ? newPulls({ seed: 0, now: at }) : decodePulls(stored.value.state);
      if (state === null) return { why: "unreadable" } satisfies NotGranted;
      const answer = applyCommand(
        state,
        command,
        ctxOf({ playerId: player, guest: seen.value.guest }, at, 0, 0, NOTHING_GIVEN),
      );
      if (isRefused(answer)) return refusal(answer.refused);
      const [note] = answer.notes;
      return note === undefined
        ? yield* Effect.die(new Error("A grant gave no note"))
        : done(note, state.have[prize] ?? 0);
    }
    // Its id is its own: the same id again would be answered as the first, and not done.
    const id = `staff:${at}:${yield* random.intBetween(0, 0xffffffff)}`;
    const batch = yield* play.send({ playerId: player, guest: seen.value.guest }, GAMES.pulls, [
      new StaffCommand(id, command),
    ]);
    if (batch.status === "unreadable" || batch.status === "slow") return { why: batch.status } satisfies NotGranted;
    if (batch.status !== "done") return yield* Effect.die(new Error(`A grant was ${batch.status}`));
    const [result] = batch.results;
    if (result === undefined) return yield* Effect.die(new Error("A grant was not answered"));
    if ("refused" in result) return refusal(result.refused);
    const [note] = readNotes(result.notes) ?? [];
    return note === undefined ? yield* Effect.die(new Error("A grant gave no note")) : done(note, note.have - copies);
  });
