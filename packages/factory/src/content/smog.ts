/**
 * Smog (`smog.ts` runs it): what a plot clears, counted every `every` ticks, by its ground and by each
 * redwood standing on it; the most a plot holds; and the levels at which its machines lose ticks.
 */
export const SMOG = { every: 100, ground: 50, redwood: 20, most: 3000, steps: [1000, 2000, 3000] } as const;
