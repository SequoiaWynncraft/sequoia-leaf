import { DAY_MS, type PlayerId } from "@sequoia-leaf/core";
import { Cache, Clock, Context, Duration, Effect, Exit, Layer, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";

import { knownAmong, UNASKED_KEPT_MS } from "./known.ts";
import { MAX_SKIN_BYTES, Mojang, MojangError } from "./mojang.ts";
import { PlayerNames } from "./names.ts";

/** A skin sheet Mojang served this recently is served again without asking. */
export const SKIN_KEPT_MS = DAY_MS;
/** After Mojang had no skin for a player, or could not be asked, it is not asked about them again this soon. */
const MISS_REMEMBERED = Duration.hours(1);
/** A skin just fetched is shared this long by requests for it that were already on their way. */
const FETCH_SHARED = Duration.minutes(1);
/** When a kept skin was last asked for is written down at most this often, so serving it rarely writes. */
const ASKED_AT_STEP_MS = DAY_MS;

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

/** The four letters that name a PNG chunk, from where the chunk starts. */
function chunkType(bytes: Uint8Array, start: number): string {
  return String.fromCharCode(...bytes.subarray(start + 4, start + 8));
}

/**
 * A skin sheet as Leaf keeps it: a PNG whose header says it is 64 by 64
 * pixels, or 64 by 32 as older skins are, cut after its last chunk, `IEND`, so
 * nothing that follows the picture is kept or served. Undefined for anything else.
 */
export function skinSheet(bytes: Uint8Array): Uint8Array | undefined {
  if (bytes.length < 33 || !PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)) {
    return undefined;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // Each chunk is its length, its type, its data and a checksum. The first is
  // the header, IHDR, whose 13 bytes start with the width and the height.
  if (view.getUint32(8) !== 13 || chunkType(bytes, 8) !== "IHDR") {
    return undefined;
  }
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  if (width !== 64 || (height !== 64 && height !== 32)) {
    return undefined;
  }
  let start = 8;
  while (start + 12 <= bytes.length) {
    const end = start + 12 + view.getUint32(start);
    if (end > bytes.length) {
      return undefined;
    }
    if (chunkType(bytes, start) === "IEND") {
      return bytes.slice(0, end);
    }
    start = end;
  }
  return undefined;
}

const Kept = Schema.Struct({ png: Schema.Uint8Array, fetchedAt: Schema.Int, askedAt: Schema.Int });

/** What asking Mojang for a player's skin came to. */
type Fetched =
  /** Their sheet, now kept. */
  | { readonly status: "sheet"; readonly png: Uint8Array }
  /** They have none: Mojang knows no such player, or they wear a default skin. */
  | { readonly status: "none" }
  /** Mojang could not be asked, or served something that is not a skin sheet. */
  | { readonly status: "failed" };

const noSkin: Fetched = { status: "none" };
const failed: Fetched = { status: "failed" };

/**
 * Players' skin sheets, the 64 by 64 picture Minecraft wraps around a
 * character, for the game to draw members as themselves. Only players Leaf
 * knows have one (`knownAmong`), and the one asking. Each is fetched from
 * Mojang and kept in the database for a day; when Mojang can't be reached, the
 * last one it served is served instead, however old. Requests for one player
 * that arrive together share one fetch, and a player Mojang had no skin for,
 * or could not be asked about, is not asked about again for an hour. Skins
 * nobody asked for in 30 days are removed when a new one is kept. A database
 * failure is a defect.
 */
export class Skins extends Context.Service<
  Skins,
  {
    /**
     * A player's skin sheet as a PNG, asked for by `asker`, or none when they
     * have none Leaf can get, or Leaf does not know them.
     */
    readonly sheet: (playerId: PlayerId, asker: PlayerId, now: number) => Effect.Effect<Option.Option<Uint8Array>>;
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
        execute: (playerId) =>
          sql`SELECT png, fetched_at AS fetchedAt, asked_at AS askedAt FROM skins WHERE player_id = ${playerId}`,
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
            return noSkin;
          }
          const address = textureAddress(written);
          if (address === undefined) {
            return yield* new MojangError({ message: "The skin is not on Mojang's texture server" });
          }
          const fetched = yield* mojang.texture(address);
          const png = fetched.length > MAX_SKIN_BYTES ? undefined : skinSheet(fetched);
          if (png === undefined) {
            return yield* new MojangError({ message: "The skin is not a 64 by 64 or 64 by 32 PNG of at most 64 KiB" });
          }
          yield* sql`
            INSERT INTO skins (player_id, png, fetched_at, asked_at) VALUES (${playerId}, ${png}, ${now}, ${now})
            ON CONFLICT (player_id) DO UPDATE
            SET png = excluded.png, fetched_at = excluded.fetched_at, asked_at = excluded.asked_at
          `.pipe(Effect.orDie);
          yield* sql`DELETE FROM skins WHERE asked_at < ${now - UNASKED_KEPT_MS}`.pipe(Effect.orDie);
          const sheet: Fetched = { status: "sheet", png };
          return sheet;
        });

      // Requests for one player that arrive together share one fetch, and what
      // Mojang had no skin for, or could not answer, is remembered for an hour.
      const fetches = yield* Cache.makeWith(
        (playerId: PlayerId) =>
          Clock.currentTimeMillis.pipe(
            Effect.flatMap((now) => fetch(playerId, now)),
            Effect.catchTag("MojangError", (error) =>
              Effect.logWarning("Could not fetch a skin from Mojang", error).pipe(Effect.as(failed)),
            ),
          ),
        {
          capacity: 1000,
          timeToLive: (exit) =>
            Exit.isSuccess(exit) && exit.value.status === "sheet" ? FETCH_SHARED : MISS_REMEMBERED,
        },
      );

      return Skins.of({
        sheet: (playerId, asker, now) =>
          Effect.gen(function* () {
            if (playerId !== asker && !(yield* knownAmong(sql, [playerId], now)).has(playerId)) {
              return Option.none();
            }
            const stored = yield* kept(playerId).pipe(Effect.orDie);
            if (Option.isSome(stored) && now - stored.value.fetchedAt < SKIN_KEPT_MS) {
              return Option.some(stored.value.png);
            }
            const fetched = yield* Cache.get(fetches, playerId);
            if (fetched.status === "sheet") {
              return Option.some(fetched.png);
            }
            if (fetched.status === "none" || Option.isNone(stored)) {
              return Option.none();
            }
            // Mojang can't be asked: the kept one is served, however old, and is still being asked for.
            if (now - stored.value.askedAt >= ASKED_AT_STEP_MS) {
              yield* sql`UPDATE skins SET asked_at = ${now} WHERE player_id = ${playerId}`.pipe(Effect.orDie);
            }
            return Option.some(stored.value.png);
          }),
      });
    }),
  );
}
