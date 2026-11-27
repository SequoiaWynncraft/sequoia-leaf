/**
 * What a piece keeps in a blueprint, a copy or an Undo, the parts every kind that has them keeps
 * alike: a colour, for one that has a line's colour, and a grade above the first, for one that has
 * a grade. A kind's own `keeps` adds what only it keeps (`pieces.ts`'s `keptOf` asks it).
 */
import type { Kept } from "../pieces.ts";
import type { Unchecked } from "./kind.ts";
import type { Kit } from "./kit.ts";

/** Whether a value is a whole number from 1 to `most`. */
export const upTo = (v: unknown, most: number): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= most;

/** A colour kept, 1 to `TINTS`; none for none. */
export const tintKept = (k: Kit, v: Unchecked): Pick<Kept, "tint"> => (upTo(v.tint, k.TINTS) ? { tint: v.tint } : {});
/** A grade kept, above the first; none for the first. */
export const gradeKept = (k: Kit, v: Unchecked): Pick<Kept, "grade"> =>
  upTo(v.grade, k.TOP) && v.grade > 1 ? { grade: v.grade } : {};
