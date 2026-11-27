/**
 * Words the page says the same way wherever it says them: what sort of trait a trait is (an origin,
 * a class, or one figure's own), and what Greg has eaten.
 */
import { type TraitId, traitNumber, TRAITS } from "@sequoia-leaf/raid";

const SORTS = { kin: "Origin", calling: "Class", own: "Its own" } as const;
/** What sort of trait it is, as a card's label says it: "Origin", "Class" or "Its own". */
export const sortWord = (t: TraitId): string => SORTS[TRAITS[t].sort];

/** What Greg has gained from eating, in percent of his health, and the most he can: "Fed: +18% health (40% at most)". */
export const fedLine = (fed: number): string => `Fed: +${fed}% health (${traitNumber("greg", "most", 1)}% at most)`;
