/**
 * Whether a yard as kept is a newer Leaf's (`keptLater`): kept by a version after this one, on more
 * land than this Leaf's (`keptBeyond`), or naming a kind this Leaf does not know anywhere in it
 * (`keptUnknown`), as a newer Leaf runs beside this one in a deploy, or kept before a rollback. None
 * reads (`decode`), and Leaf leaves such a yard exactly as it is, never written, rested or worked
 * out, for the Leaf that reads it.
 */
import { newerThan } from "@sequoia-leaf/core";

import { keptUnknown, VERSION } from "./codec.ts";
import { keptBeyond } from "./keptland.ts";
import { LAND, type Land } from "./land.ts";

export function keptLater(text: string, land: Land = LAND): boolean {
  if (newerThan(text, VERSION)) return true;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return false;
  }
  return typeof raw === "object" && raw !== null && (keptBeyond(raw, land) || keptUnknown(raw, land));
}
