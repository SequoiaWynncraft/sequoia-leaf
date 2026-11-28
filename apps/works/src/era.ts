/**
 * The yard's era, by the highest tier open (SPEC-2 section 7): Timber to tier 2, Brass in tiers 3
 * and 4, Spark in tiers 5 and 6. The depot is drawn by it, and the light of its wires.
 */
import type { Yard } from "@sequoia-leaf/factory";

/** The first tier of the Spark era: brick, copper, tarred timber and a cold cream light. */
export const SPARK = 5;

/** Whether a yard is in the Spark era or later. */
export const isSpark = (y: Yard): boolean => y.open.tier >= SPARK;
