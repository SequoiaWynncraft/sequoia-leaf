import { createHash } from "node:crypto";

import { DAY_MS, type PlayerId } from "@sequoia-leaf/core";
import { Context, Effect, Layer, type Option, Schema } from "effect";
import { SecureRandom } from "effect/crypto";
import { SqlClient, SqlSchema } from "effect/sql";

import { DiscordId, PlayerUuid } from "../wire.ts";

/** How long a Leaf session lasts, in milliseconds. */
export const SIGN_IN_MS = 30 * DAY_MS;
/** The cookie a Leaf session is kept in. The website's session is `seq_session`. */
export const LEAF_SESSION_COOKIE = "leaf_session";

/** Who a Leaf session is, for a player who signed in with Discord alone. */
export interface SignedIn {
  readonly playerId: PlayerId;
  readonly discord: DiscordId;
  readonly name: string;
  /** Whether Sequoia's Discord gave the account a member's role when it signed in; null when not known. */
  readonly member: boolean | null;
}

const Row = Schema.Struct({
  playerId: PlayerUuid,
  discord: DiscordId,
  name: Schema.String,
  member: Schema.NullOr(Schema.BooleanFromBit),
});

const hashOf = (token: string) => createHash("sha256").update(token).digest("hex");

/**
 * Leaf's own sessions, for players who sign in with Discord alone (members sign in with the
 * website's session, as before). A session is a random token in the player's cookie; Leaf keeps
 * only its SHA-256, so the table names no token anyone could use. A database failure is a defect.
 */
export class SignIns extends Context.Service<
  SignIns,
  {
    /** Begins a session, and answers its token for the cookie. */
    readonly begin: (signedIn: SignedIn, now: number) => Effect.Effect<string>;
    /** Who this token is, while its session lasts. */
    readonly identify: (token: string, now: number) => Effect.Effect<Option.Option<SignedIn>>;
    /** Ends the session this token is, if it is one. */
    readonly end: (token: string) => Effect.Effect<void>;
  }
>()("leaf/SignIns") {
  static readonly layer = Layer.effect(
    SignIns,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const random = yield* SecureRandom.SecureRandom;
      const find = SqlSchema.findOneOption({
        Request: Schema.Struct({ hash: Schema.String, now: Schema.Int }),
        Result: Row,
        execute: ({ hash, now }) => sql`
          SELECT player_id AS playerId, discord_id AS discord, name, member FROM sign_ins
          WHERE token_hash = ${hash} AND expires_at > ${now}
        `,
      });
      return SignIns.of({
        begin: (signedIn, now) =>
          Effect.gen(function* () {
            const token = Buffer.from(yield* random.randomBytes(32)).toString("base64url");
            const member = signedIn.member === null ? null : signedIn.member ? 1 : 0;
            yield* sql`
              INSERT INTO sign_ins (token_hash, player_id, discord_id, name, member, created_at, expires_at)
              VALUES (${hashOf(token)}, ${signedIn.playerId}, ${signedIn.discord}, ${signedIn.name}, ${member},
                      ${now}, ${now + SIGN_IN_MS})
            `;
            yield* sql`DELETE FROM sign_ins WHERE expires_at <= ${now}`;
            return token;
          }).pipe(Effect.orDie),
        identify: (token, now) => find({ hash: hashOf(token), now }).pipe(Effect.orDie),
        end: (token) => sql`DELETE FROM sign_ins WHERE token_hash = ${hashOf(token)}`.pipe(Effect.asVoid, Effect.orDie),
      });
    }),
  );
}
