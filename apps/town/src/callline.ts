/**
 * The town in a Discord call, as Discord's small picture of it (around 400 by 225 and under): where
 * the member is, in one line (the kit's `callLine`). A game open over the town says its own.
 */
import { callLine } from "@sequoia-leaf/kit/call.ts";
import { scope } from "@sequoia-leaf/kit/scope.ts";

import { G } from "./game.ts";
import { visiting } from "./leaf.ts";
import type { Place } from "./screen.ts";

/** Where the member is, in a line: in town, in the Grove, at home, or in somebody's camp (`whose`, by name). */
export function whereLine(where: Place, whose: string | null): string {
  if (where === "grove") return "In the Grove";
  if (where === "town") return "In town";
  return whose === null ? "In your camp" : `In ${whose}'s camp`;
}

/** In a call, puts the town's line on the page for as long as it stands. */
export function openCallLine(): void {
  callLine(scope(), () => whereLine(G.where, visiting()?.name ?? null));
}
