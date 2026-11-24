/**
 * The missing crab's stretches of hiding: a module of its own, so that the town's rules (`game.ts`,
 * which counts one sighting a stretch) need nothing of where it hides (`clock.ts`, and the map).
 */

/** How long the missing crab hides in one place, in milliseconds. */
export const STRETCH = 60_000;
/** Which stretch of the missing crab's hiding a moment is in: a member's sighting counts once in each. */
export const stretchOf = (now: number): number => Math.floor(now / STRETCH);
