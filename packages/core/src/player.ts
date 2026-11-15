declare const playerIdBrand: unique symbol;

/**
 * A player's Minecraft UUID in lowercase dashed form.
 *
 * This is the identity sequoia-backend keys players on, so it is the one
 * identifier every Sequoia service agrees about. Usernames and Discord IDs are
 * attributes of a player, never keys.
 */
export type PlayerId = string & { readonly [playerIdBrand]: true };

const DASHED = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const UNDASHED = /^[0-9a-f]{32}$/;

function isCanonical(value: string): value is PlayerId {
  return DASHED.test(value);
}

/** Accepts a dashed or undashed UUID in any case; returns undefined for anything else. */
export function parsePlayerId(input: string): PlayerId | undefined {
  const value = input.toLowerCase();
  if (isCanonical(value)) {
    return value;
  }
  if (UNDASHED.test(value)) {
    const dashed = `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
    return isCanonical(dashed) ? dashed : undefined;
  }
  return undefined;
}

/** Like `parsePlayerId`, for input that is already known to be a UUID. Throws when it is not. */
export function playerId(input: string): PlayerId {
  const parsed = parsePlayerId(input);
  if (parsed === undefined) {
    throw new TypeError(`Not a Minecraft UUID: ${input}`);
  }
  return parsed;
}
