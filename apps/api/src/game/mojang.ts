import type { MinecraftId } from "@sequoia-leaf/core";
import { Context, Duration, Effect, Layer, Option, Schema, Stream } from "effect";
import { HttpClient, HttpClientResponse } from "effect/http";

/** How long one request to Mojang may take, from asking to the last byte. */
const TIMEOUT = Duration.seconds(5);

/** The largest skin sheet Leaf takes. A real one, 64 by 64 pixels, is a few kilobytes. */
export const MAX_SKIN_BYTES = 64 * 1024;

const SESSION_SERVER = "https://sessionserver.mojang.com";

/** Mojang could not be asked, or answered with something that is not what was asked for. */
export class MojangError extends Schema.TaggedError<MojangError>()("MojangError", { message: Schema.String }) {}

/** A player as Mojang's session server describes them. */
export interface MojangProfile {
  /** Their Minecraft name now. */
  readonly name: string;
  /** The address of their skin sheet, as Mojang wrote it, or undefined when they wear a default skin. */
  readonly skin: string | undefined;
}

const Profile = Schema.Struct({
  name: Schema.NonEmptyString,
  properties: Schema.Array(Schema.Struct({ name: Schema.String, value: Schema.String })),
});

const failed = (error: { readonly message: string }) => new MojangError({ message: error.message });

/** The `textures` property of a profile: base64 of JSON that names the skin's address. */
const Textures = Schema.StringFromBase64.pipe(
  Schema.decodeTo(
    Schema.fromJsonString(
      Schema.Struct({ textures: Schema.Struct({ SKIN: Schema.optionalKey(Schema.Struct({ url: Schema.String })) }) }),
    ),
  ),
);

/**
 * Mojang, which knows every player's name and skin. Leaf asks it only for
 * the game, and keeps what it answers (see `Skins` and `PlayerNames`).
 */
export class Mojang extends Context.Service<
  Mojang,
  {
    /** A Minecraft account's profile, or none when Mojang knows no such account. */
    readonly profile: (account: MinecraftId) => Effect.Effect<Option.Option<MojangProfile>, MojangError>;
    /** The bytes at a skin address Leaf has checked, failing past `MAX_SKIN_BYTES`. */
    readonly texture: (address: URL) => Effect.Effect<Uint8Array, MojangError>;
  }
>()("leaf/Mojang") {
  /** Mojang itself, over the network. */
  static readonly layer = Layer.effect(
    Mojang,
    Effect.gen(function* () {
      const client = yield* HttpClient.HttpClient;
      return Mojang.of({
        profile: (account) =>
          client.get(`${SESSION_SERVER}/session/minecraft/profile/${account.replaceAll("-", "")}`).pipe(
            Effect.flatMap((response) =>
              // Mojang answers a UUID that is no one's with no content.
              response.status === 204 || response.status === 404
                ? Effect.succeedNone
                : HttpClientResponse.filterStatusOk(response).pipe(
                    Effect.flatMap(HttpClientResponse.schemaBodyJson(Profile)),
                    Effect.flatMap(readProfile),
                    Effect.map(Option.some),
                  ),
            ),
            Effect.timeout(TIMEOUT),
            Effect.mapError(failed),
          ),
        texture: (address) =>
          client.get(address).pipe(
            Effect.flatMap(HttpClientResponse.filterStatusOk),
            Effect.flatMap((response) => readAtMost(response.stream, MAX_SKIN_BYTES)),
            Effect.timeout(TIMEOUT),
            Effect.mapError(failed),
          ),
      });
    }),
  );
}

const readProfile = (profile: typeof Profile.Type) => {
  const textures = profile.properties.find((property) => property.name === "textures");
  if (textures === undefined) {
    return Effect.succeed({ name: profile.name, skin: undefined });
  }
  return Schema.decodeUnknownEffect(Textures)(textures.value).pipe(
    Effect.map((decoded) => ({ name: profile.name, skin: decoded.textures.SKIN?.url })),
  );
};

/** The whole of a body, failing as soon as it passes `limit` bytes rather than reading the rest. */
const readAtMost = <E>(body: Stream.Stream<Uint8Array, E>, limit: number) =>
  Stream.suspend(() => {
    let total = 0;
    return Stream.mapEffect(body, (chunk) => {
      total += chunk.length;
      return total > limit
        ? Effect.fail(new MojangError({ message: `The skin is larger than ${limit} bytes` }))
        : Effect.succeed(chunk);
    });
  }).pipe(
    Stream.runCollect,
    Effect.map((chunks) => {
      const bytes = new Uint8Array(chunks.reduce((size, chunk) => size + chunk.length, 0));
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
      return bytes;
    }),
  );
