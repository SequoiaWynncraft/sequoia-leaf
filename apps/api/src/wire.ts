import { type MinecraftId, parseMinecraftId, parsePlayerId, type PlayerId } from "@sequoia-leaf/core";
import { Effect, Schema, SchemaIssue, SchemaTransformation } from "effect";

// How other Sequoia services write the values Leaf reads from them.

/** A player's id as Leaf's own pages and rows give it back, a UUID dashed or not, in any case. Decodes to a `PlayerId`. */
export const PlayerUuid = Schema.String.pipe(
  Schema.decodeTo(
    Schema.declare((input): input is PlayerId => typeof input === "string" && parsePlayerId(input) === input),
    SchemaTransformation.transformEffect<PlayerId, string>({
      decode: (text, options) => {
        const id = parsePlayerId(text);
        return id === undefined
          ? Effect.fail(new SchemaIssue.InvalidValue({ expected: "a UUID" }, text, options))
          : Effect.succeed(id);
      },
      encode: (id) => Effect.succeed(id),
    }),
  ),
);

/**
 * A Minecraft account's UUID as other services send it (the backend's feeds and sessions, Sierra's
 * awards), dashed or not, in any case. Decodes to a `MinecraftId`: `Logins` says whose it is.
 */
export const MinecraftUuid = Schema.String.pipe(
  Schema.decodeTo(
    Schema.declare((input): input is MinecraftId => typeof input === "string" && parseMinecraftId(input) === input),
    SchemaTransformation.transformEffect<MinecraftId, string>({
      decode: (text, options) => {
        const id = parseMinecraftId(text);
        return id === undefined
          ? Effect.fail(new SchemaIssue.InvalidValue({ expected: "a UUID" }, text, options))
          : Effect.succeed(id);
      },
      encode: (id) => Effect.succeed(id),
    }),
  ),
);

/** A time as other services send it, an ISO 8601 string. Decodes to milliseconds since the Unix epoch. */
export const IsoTime = Schema.String.pipe(
  Schema.decodeTo(
    Schema.Number,
    SchemaTransformation.transformEffect<number, string>({
      decode: (text, options) => {
        const at = Date.parse(text);
        return Number.isNaN(at)
          ? Effect.fail(new SchemaIssue.InvalidValue({ expected: "an ISO 8601 time" }, text, options))
          : Effect.succeed(at);
      },
      encode: (at) => Effect.succeed(new Date(at).toISOString()),
    }),
  ),
);

/** A Discord account's id as Discord and the backend send it: a snowflake, digits only. */
export const DiscordId = Schema.String.check(Schema.isPattern(/^[0-9]{5,25}$/)).pipe(Schema.brand("DiscordId"));
export type DiscordId = typeof DiscordId.Type;
