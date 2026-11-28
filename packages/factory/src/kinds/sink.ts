/**
 * What every sink shares (the depot, a cart stop): it takes anything the town buys (not a thing it
 * does not, `ItemInfo.unsold`: slag), always has room, and each thing reaches the depot.
 */
import type { Yard } from "../yard.ts";
import type { Kit } from "./kit.ts";

/** Whether a sink takes the thing `n`: one the town buys. */
export const sold = (k: Kit, _y: Yard, _i: number, n: number): boolean => k.ITEM_INFO[n]?.unsold !== true;
export const always = (): boolean => true;
/** A thing handed to a sink has reached the depot. */
export const sell = (k: Kit, y: Yard, _i: number, n: number): void => k.deliver(y, n, 1);
