declare const playerIdBrand: unique symbol;

declare const minecraftIdBrand: unique symbol;

/**
 * Leaf's id for a player, a UUID in lowercase dashed form. A player who first came with a
 * Minecraft account (everyone from before Discord sign-in, and every account the guild's feeds name)
 * has that account's UUID; one who first came with Discord alone has a random one. Which Minecraft
 * and Discord accounts sign in as a player is Leaf's `logins` table: names are attributes, never keys.
 */
export type PlayerId = string & { readonly [playerIdBrand]: true };

/**
 * A Minecraft account's UUID in lowercase dashed form, as sequoia-backend and Mojang name it. Not a
 * player: Leaf's `logins` say which player an account belongs to.
 */
export type MinecraftId = string & { readonly [minecraftIdBrand]: true };

const DASHED = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const UNDASHED = /^[0-9a-f]{32}$/;

function isCanonical(value: string): value is PlayerId {
  return DASHED.test(value);
}

function isMinecraft(value: string): value is MinecraftId {
  return DASHED.test(value);
}

/** A UUID in any case, dashed or not, in lowercase dashed form; undefined for anything else. */
function canonical(input: string): string | undefined {
  const value = input.toLowerCase();
  if (DASHED.test(value)) {
    return value;
  }
  if (UNDASHED.test(value)) {
    return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
  }
  return undefined;
}

/** Accepts a dashed or undashed UUID in any case; returns undefined for anything else. */
export function parsePlayerId(input: string): PlayerId | undefined {
  const value = canonical(input);
  return value !== undefined && isCanonical(value) ? value : undefined;
}

/** Accepts a Minecraft account's UUID, dashed or undashed, in any case; undefined for anything else. */
export function parseMinecraftId(input: string): MinecraftId | undefined {
  const value = canonical(input);
  return value !== undefined && isMinecraft(value) ? value : undefined;
}

/**
 * The player a Minecraft account is when no other player has taken it in: the one with the
 * account's own UUID. Only `logins` decides that; this is how it names such a player.
 */
export function ownPlayer(account: MinecraftId): PlayerId {
  return playerId(account);
}

/** Like `parsePlayerId`, for input that is already known to be a UUID. Throws when it is not. */
export function playerId(input: string): PlayerId {
  const parsed = parsePlayerId(input);
  if (parsed === undefined) {
    throw new TypeError(`Not a UUID: ${input}`);
  }
  return parsed;
}

/** Like `parseMinecraftId`, for input that is already known to be a UUID. Throws when it is not. */
export function minecraftId(input: string): MinecraftId {
  const parsed = parseMinecraftId(input);
  if (parsed === undefined) {
    throw new TypeError(`Not a Minecraft UUID: ${input}`);
  }
  return parsed;
}
