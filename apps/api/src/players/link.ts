import { type MinecraftId, type PlayerId, playerId } from "@sequoia-leaf/core";
import { Effect, Option } from "effect";
import { SecureRandom } from "effect/crypto";
import { SqlClient } from "effect/sql";

import type { DiscordId } from "../wire.ts";
import { Logins } from "./logins.ts";
import { mergeInto } from "./merge.ts";

/** A version 4 UUID from 16 random bytes: the id of a player who comes with Discord alone. */
const newPlayerId = Effect.gen(function* () {
  const bytes = yield* (yield* SecureRandom.SecureRandom).randomBytes(16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return playerId(`${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`);
});

/** A new player for a Discord account: an id Leaf made, the account signing in as them, and their name. */
const newPlayer = (discord: DiscordId, name: string, now: number) =>
  Effect.gen(function* () {
    const logins = yield* Logins;
    const player = yield* newPlayerId;
    yield* logins.notOwnAccount(player, now, true);
    yield* logins.linkDiscord(discord, player, now);
    yield* nameDiscordPlayer(player, name, now);
    return player;
  });

/**
 * A Discord-only player's name, their Discord username as it is now: they have no Minecraft account
 * for Mojang to name them by, so it is written at each sign-in, a new username or a name long
 * unasked for brought back.
 */
const nameDiscordPlayer = (player: PlayerId, name: string, now: number) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`
      INSERT INTO player_names (player_id, username, updated_at, asked_at) VALUES (${player}, ${name}, ${now}, ${now})
      ON CONFLICT (player_id) DO UPDATE
      SET username = excluded.username, updated_at = excluded.updated_at, asked_at = excluded.asked_at
    `.pipe(Effect.orDie);
  });

/**
 * The player someone signing in with Discord alone is: the one their Discord account signs in as, or
 * a new one, named by their Discord username. Run it in a transaction.
 */
export const discordPlayer = Effect.fnUntraced(function* (discord: DiscordId, name: string, now: number) {
  const logins = yield* Logins;
  const known = yield* logins.discordPlayer(discord);
  if (Option.isNone(known)) {
    return yield* newPlayer(discord, name, now);
  }
  // A player with a Minecraft account linked is named by it, not by Discord.
  if (yield* logins.discordOnly(known.value)) {
    yield* nameDiscordPlayer(known.value, name, now);
  }
  return known.value;
});

/**
 * The player a Sequoia session on a member's primary Minecraft account signs in as, keeping their
 * Discord account and that account together. Run it in a transaction.
 *
 * - A Discord account Leaf does not know yet signs in as its account's player.
 * - A player who came with Discord alone, and now has linked this account, is taken into the
 *   account's player (`mergeInto`): the Leaf the guild paid it, their games, all in one place. While
 *   either is at a live raid table the merge waits: the session signs in as the account's player, the
 *   Discord account stays its own player for now, and the next sign-in tries again.
 * - An account whose player is somebody else's (another Discord account signs in as them) has gone
 *   to this member: it now signs in as the member's player, and the other keeps what they played.
 * - Otherwise (the member made another account their primary) the Discord account follows the
 *   account, as it always has.
 */
export const accountPlayer = Effect.fnUntraced(function* (
  discord: DiscordId,
  account: MinecraftId,
  name: string,
  now: number,
) {
  const logins = yield* Logins;
  const ofAccount = yield* logins.player(account);
  const ofDiscord = Option.getOrUndefined(yield* logins.discordPlayer(discord));
  if (ofDiscord === ofAccount) {
    return ofAccount;
  }
  if (yield* logins.claimedByOther(ofAccount, discord)) {
    const player = ofDiscord ?? (yield* newPlayer(discord, name, now));
    yield* logins.linkMinecraft(account, player, now);
    if (ofAccount === playerId(account)) {
      yield* logins.notOwnAccount(ofAccount, now, false);
    }
    return player;
  }
  if (ofDiscord !== undefined && (yield* logins.discordOnly(ofDiscord))) {
    if ((yield* mergeInto(ofDiscord, ofAccount, account, now)).status === "waits") return ofAccount;
  }
  yield* logins.linkDiscord(discord, ofAccount, now);
  return ofAccount;
});
