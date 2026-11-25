import { type MinecraftId, ownPlayer, parseMinecraftId, type PlayerId } from "@sequoia-leaf/core";
import { Context, Effect, Layer, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";

import { DiscordId, MinecraftUuid, PlayerUuid } from "../wire.ts";

/** How many ids one query asks about, well under SQLite's limit on bound values. */
const BATCH = 500;

const AccountRow = Schema.Struct({ account: MinecraftUuid, playerId: PlayerUuid });
const Ids = Schema.Array(Schema.String);

const chunks = <T>(items: readonly T[]): T[][] =>
  Array.from({ length: Math.ceil(items.length / BATCH) }, (_, k) => items.slice(k * BATCH, (k + 1) * BATCH));

/**
 * Which player each Minecraft account and Discord account signs in as. A Minecraft account is its
 * own player, the one with the account's UUID for an id, unless `logins` links it to another; every
 * account Leaf hears of from outside (a session, the guild's credits, Sierra's awards, the backend
 * asking about a purchase) comes through here to find its player. A player's name and skin come from
 * the Minecraft account linked to them last, or else from the account with their own id, unless
 * `leaf_ids` says their id is not their account's. A database failure is a defect.
 */
export class Logins extends Context.Service<
  Logins,
  {
    /** The player this Minecraft account signs in as. */
    readonly player: (account: MinecraftId) => Effect.Effect<PlayerId>;
    /** The player each of these accounts signs in as. */
    readonly players: (accounts: readonly MinecraftId[]) => Effect.Effect<ReadonlyMap<MinecraftId, PlayerId>>;
    /** The Minecraft account each of these players' names and skins come from, for those that have one. */
    readonly minecraftOf: (players: readonly PlayerId[]) => Effect.Effect<ReadonlyMap<PlayerId, MinecraftId>>;
    /** The player this Discord account signs in as, if it signs in as one. */
    readonly discordPlayer: (discord: DiscordId) => Effect.Effect<Option.Option<PlayerId>>;
    /** Makes this Discord account sign in as this player, from whichever it signed in as before. */
    readonly linkDiscord: (discord: DiscordId, player: PlayerId, now: number) => Effect.Effect<void>;
  }
>()("leaf/Logins") {
  static readonly layer = Layer.effect(
    Logins,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const linkedAccounts = SqlSchema.findAll({
        Request: Ids,
        Result: AccountRow,
        execute: (accounts) => sql`
          SELECT external_id AS account, player_id AS playerId FROM logins
          WHERE kind = 'minecraft' AND ${sql.in("external_id", accounts)}
        `,
      });
      const linkedTo = SqlSchema.findAll({
        Request: Ids,
        Result: AccountRow,
        // The newest link of each player's: a player linked to a second account shows as that one.
        execute: (players) => sql`
          SELECT player_id AS playerId, external_id AS account FROM logins AS l
          WHERE kind = 'minecraft' AND ${sql.in("player_id", players)}
            AND NOT EXISTS (
              SELECT 1 FROM logins AS n
              WHERE n.kind = 'minecraft' AND n.player_id = l.player_id
                AND (n.linked_at > l.linked_at OR (n.linked_at = l.linked_at AND n.external_id > l.external_id))
            )
        `,
      });
      const leafIds = SqlSchema.findAll({
        Request: Ids,
        Result: Schema.Struct({ playerId: PlayerUuid }),
        execute: (players) => sql`SELECT player_id AS playerId FROM leaf_ids WHERE ${sql.in("player_id", players)}`,
      });
      const discordRow = SqlSchema.findOneOption({
        Request: DiscordId,
        Result: Schema.Struct({ playerId: PlayerUuid }),
        execute: (discord) =>
          sql`SELECT player_id AS playerId FROM logins WHERE kind = 'discord' AND external_id = ${discord}`,
      });

      const players = (accounts: readonly MinecraftId[]) =>
        Effect.map(Effect.forEach(chunks([...new Set(accounts)]), linkedAccounts), (rows) => {
          const found = new Map<MinecraftId, PlayerId>(accounts.map((account) => [account, ownPlayer(account)]));
          for (const row of rows.flat()) found.set(row.account, row.playerId);
          return found;
        }).pipe(Effect.orDie);

      const minecraftOf = (wanted: readonly PlayerId[]) =>
        Effect.gen(function* () {
          const unique = chunks([...new Set(wanted)]);
          const linked = (yield* Effect.forEach(unique, linkedTo)).flat();
          const notOwn = new Set((yield* Effect.forEach(unique, leafIds)).flat().map((row) => row.playerId));
          const accounts = new Map<PlayerId, MinecraftId>();
          for (const player of wanted) {
            const own = notOwn.has(player) ? undefined : parseMinecraftId(player);
            if (own !== undefined) accounts.set(player, own);
          }
          for (const row of linked) accounts.set(row.playerId, row.account);
          return accounts;
        }).pipe(Effect.orDie);

      return Logins.of({
        player: (account) => Effect.map(players([account]), (found) => found.get(account) ?? ownPlayer(account)),
        players,
        minecraftOf,
        discordPlayer: (discord) =>
          Effect.map(
            discordRow(discord),
            Option.map((row) => row.playerId),
          ).pipe(Effect.orDie),
        linkDiscord: (discord, player, now) =>
          sql`
            INSERT INTO logins (kind, external_id, player_id, linked_at)
            VALUES ('discord', ${discord}, ${player}, ${now})
            ON CONFLICT (kind, external_id) DO UPDATE
            SET player_id = excluded.player_id, linked_at = excluded.linked_at
            WHERE player_id IS NOT excluded.player_id
          `.pipe(Effect.asVoid, Effect.orDie),
      });
    }),
  );
}
