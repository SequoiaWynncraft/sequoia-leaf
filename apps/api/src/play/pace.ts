/**
 * How fast a player may play, across everything Leaf plays for them: the play service's games and
 * the raid's tables take from the same allowances.
 */
import { Context, Layer } from "effect";

import { Allowances } from "../allowance.ts";

/** How often a player may send a batch of commands: ten a second, bursts of twenty. */
export const BATCHES = { rate: 10, burst: 20 } as const;
/** How many commands a player may have done, across all games: ten a second, bursts of forty. */
export const COMMANDS = { rate: 10, burst: 40 } as const;
/** How many players' allowances are kept before those filled up again are let go. */
const ALLOWANCES_KEPT = 1000;

/** Each player's allowances of batches and of commands (`BATCHES`, `COMMANDS`), taken as `[batches, commands]`. */
export class PlayPace extends Context.Service<PlayPace, Allowances>()("leaf/PlayPace") {
  static readonly layer = Layer.sync(PlayPace, () => new Allowances([BATCHES, COMMANDS], ALLOWANCES_KEPT));
}
