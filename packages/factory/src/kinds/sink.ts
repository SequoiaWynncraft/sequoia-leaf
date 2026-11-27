/** What every sink shares (the depot, a cart stop): it takes anything, always has room, and each thing reaches the depot. */
import type { Yard } from "../yard.ts";
import type { Kit } from "./kit.ts";

export { anything } from "./line.ts";
export const always = (): boolean => true;
/** A thing handed to a sink has reached the depot. */
export const sell = (k: Kit, y: Yard, _i: number, n: number): void => k.deliver(y, n, 1);
