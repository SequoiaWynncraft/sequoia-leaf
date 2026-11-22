/** The limits on Coins that hold whatever the game: what play may pay in, and the daily chest. */

/** The most a player's play may pay in, whatever the games: in any hour, and in a UTC day. */
export const EARNINGS = { hourly: 5000, daily: 20_000 } as const;

/** What the daily chest by the Treasury pays, once a UTC day. */
export const DAILY_CHEST = 3;
