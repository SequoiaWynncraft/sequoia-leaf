import { DAY_MS, type PlayerId } from "@sequoia-leaf/core";
import { Context, Effect, Layer, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";

import { MAX_SKIN_BYTES, Mojang, MojangError } from "./mojang.ts";
import { PlayerNames } from "./names.ts";

/** A skin sheet Mojang served this recently is served again without asking. */
export const SKIN_KEPT_MS = DAY_MS;

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * The address to fetch a skin sheet from, when Mojang named one on its own
 * texture server, `textures.minecraft.net/texture/<hex>`; undefined for any
 * other. Mojang writes these addresses with `http:`, so they are fetched over
 * HTTPS whichever it wrote.
 */
export function textureAddress(written: string): URL | undefined {
  const texture = /^https?:\/\/textures\.minecraft\.net\/texture\/([0-9a-f]+)$/.exec(written)?.[1];
  return texture === undefined ? undefined : new URL(`https://textures.minecraft.net/texture/${texture}`);
}

function isPng(bytes: Uint8Array): boolean {
  return PNG_SIGNATURE.every((byte, index) => bytes[index] === byte);
}

const Kept = Schema.Struct({ png: Schema.Uint8Array, fetchedAt: Schema.Int });

/**
 * Players' skin sheets, the 64 by 64 picture Minecraft wraps around a
 * character, for the game to draw members as themselves. Each is fetched from
 * Mojang and kept in the database for a day; when Mojang can't be reached, the
 * last one it served is served instead, however old. A database failure is a
 * defect.
 */
export class Skins extends Context.Service<
  Skins,
  {
    /** A player's skin sheet as a PNG, or none when they have none Leaf can get. */
    readonly sheet: (playerId: PlayerId, now: number) => Effect.Effect<Option.Option<Uint8Array>>;
  }
>()("leaf/Skins") {
  static readonly layer = Layer.effect(
    Skins,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const mojang = yield* Mojang;
      const names = yield* PlayerNames;
      const kept = SqlSchema.findOneOption({
        Request: Schema.String,
        Result: Kept,
        execute: (playerId) => sql`SELECT png, fetched_at AS fetchedAt FROM skins WHERE player_id = ${playerId}`,
      });

      /** Asks Mojang for the player's skin now, and keeps what it answers. */
      const fetch = (playerId: PlayerId, now: number) =>
        Effect.gen(function* () {
          const profile = yield* mojang.profile(playerId);
          if (Option.isSome(profile)) {
            yield* names.remember(playerId, profile.value.name, now);
          }
          const written = Option.getOrUndefined(profile)?.skin;
          if (written === undefined) {
            // No such player, or one in a default skin: nothing to serve, however old.
            yield* sql`DELETE FROM skins WHERE player_id = ${playerId}`.pipe(Effect.orDie);
            return Option.none<Uint8Array>();
          }
          const address = textureAddress(written);
          if (address === undefined) {
            return yield* new MojangError({ message: "The skin is not on Mojang's texture server" });
          }
          const png = yield* mojang.texture(address);
          if (png.length > MAX_SKIN_BYTES || !isPng(png)) {
            return yield* new MojangError({ message: "The skin is not a PNG of at most 64 KiB" });
          }
          yield* sql`
            INSERT INTO skins (player_id, png, fetched_at) VALUES (${playerId}, ${png}, ${now})
            ON CONFLICT (player_id) DO UPDATE SET png = excluded.png, fetched_at = excluded.fetched_at
          `.pipe(Effect.orDie);
          return Option.some(png);
        });

      return Skins.of({
        sheet: (playerId, now) =>
          Effect.gen(function* () {
            const stored = yield* kept(playerId).pipe(Effect.orDie);
            if (Option.isSome(stored) && now - stored.value.fetchedAt < SKIN_KEPT_MS) {
              return Option.some(stored.value.png);
            }
            return yield* fetch(playerId, now).pipe(
              Effect.catchTag("MojangError", (error) =>
                Effect.logWarning("Could not fetch a skin from Mojang", error).pipe(
                  Effect.as(Option.map(stored, ({ png }) => png)),
                ),
              ),
            );
          }),
      });
    }),
  );
}
