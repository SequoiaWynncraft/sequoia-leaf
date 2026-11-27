import { Context, Layer } from "effect";

import type { Player } from "./player.ts";

/**
 * Every player Live holds, by their Leaf id, in the one map Live keeps them in (`held`: Live alone
 * adds to it and forgets from it, as `Player` says); and the way the rest of Leaf tells one of them
 * something of their own (`tell`), on every connection they have open now: their presence one, in
 * whatever room it is, and their listener. What is told so is a word that something they read has
 * changed (core's `Nudge`), never what it is: the page reads it, and is shown only what that shows
 * it. A player with no connection just now is told nothing, and reads again as their page connects
 * again. In memory, in this process, as Live's rooms are.
 */
export class LivePlayers extends Context.Service<
  LivePlayers,
  {
    /** Live's players, by Leaf id. Only Live changes it. */
    readonly held: Map<string, Player>;
    /** Says a frame to each of these players on every connection they have open; gives back how many players took it. */
    readonly tell: (players: Iterable<string>, frame: string) => number;
    /** How many frames have been told since Leaf started, each counted once however many took it. */
    readonly told: () => number;
  }
>()("leaf/LivePlayers") {
  static readonly layer = Layer.sync(LivePlayers, () => {
    const held = new Map<string, Player>();
    const count = { told: 0 };
    return LivePlayers.of({
      held,
      tell: (players, frame) => {
        let took = 0;
        for (const id of players) if (held.get(id)?.tell(frame) === true) took++;
        if (took > 0) count.told++;
        return took;
      },
      told: () => count.told,
    });
  });
}
