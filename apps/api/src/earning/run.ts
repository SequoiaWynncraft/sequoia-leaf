import { DEFAULT_RULES } from "@sequoia-leaf/core";
import { Clock, Context, Effect, Layer, Semaphore } from "effect";
import type { HttpClient } from "effect/http";
import { SqlClient } from "effect/sql";

import { readCredits } from "../backend/credits.ts";
import { AppConfig } from "../config.ts";
import type { Events } from "../events/store.ts";
import type { FeedError } from "../feeds.ts";
import type { Ledger } from "../ledger/store.ts";
import type { Logins } from "../players/logins.ts";
import type { Quests } from "../quests/store.ts";
import { syncCredits, type SyncMode, type SyncResult } from "./sync.ts";

/** A player asking for fresh quests triggers a sync at most this often. */
const ON_DEMAND_INTERVAL_MS = 15_000;

/**
 * Reads the backend's credit feed and pays what it lists. Answers undefined,
 * and does nothing, when the backend token is not configured.
 */
const syncOnce = Effect.fnUntraced(function* (mode: SyncMode) {
  const { backendUrl, backendToken } = yield* AppConfig;
  if (backendToken === undefined) {
    return undefined;
  }
  const feed = { baseUrl: backendUrl, token: backendToken };
  return yield* syncCredits(
    (from, to) => readCredits(feed, from, to),
    DEFAULT_RULES,
    yield* Clock.currentTimeMillis,
    mode,
  );
});

/**
 * A sync on a player's request, so a raid they just finished shows up without
 * waiting for the next scheduled run. Requests share one allowance: whoever
 * asks first in a 15 second span starts a sync, and everyone else is answered
 * from what is stored. A failure is logged rather than shown to the player,
 * and still uses up the allowance; the scheduled run will catch up.
 */
const onDemand = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const now = yield* Clock.currentTimeMillis;
  const claim = yield* sql`
    UPDATE sync_state SET on_demand_at = ${now}
    WHERE name = 'credits' AND on_demand_at <= ${now - ON_DEMAND_INTERVAL_MS}
    RETURNING name
  `;
  if (claim.length > 0) {
    yield* syncOnce("recent");
  }
}).pipe(Effect.catchCause((cause) => Effect.logError("The on-demand credit sync failed", cause)));

type Needs = AppConfig | SqlClient.SqlClient | HttpClient.HttpClient | Ledger | Quests | Events | Logins;

/**
 * The credit sync and what must not happen in the middle of one, one at a time
 * in this Leaf. A run reads the feed and then writes what it read; a reroll in
 * between would swap away the quest a fetched raid finished, and the raid would
 * then meet the quest that replaced it. So a reroll takes its turn in the same
 * line, after bringing the feed in, and a player who asks for fresh quests
 * while a run is under way waits for it and is answered with what it paid.
 *
 * Two Leafs side by side during a deploy each have their own line; the feed's
 * lease in `sync_state` still lets only one of them sync at a time.
 */
export class Credits extends Context.Service<
  Credits,
  {
    /** One run of the sync in this mode, once any under way is done (the scheduled runs). */
    readonly sync: (mode: SyncMode) => Effect.Effect<SyncResult | undefined, FeedError>;
    /**
     * Brings in what the feed has on a player's request (see `onDemand`), and then does `then`
     * before any other run starts.
     */
    readonly fresh: <A, E, R>(then: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>;
  }
>()("leaf/Credits") {
  static readonly layer = Layer.effect(
    Credits,
    Effect.gen(function* () {
      const needs = yield* Effect.context<Needs>();
      const line = yield* Semaphore.make(1);
      return {
        sync: (mode) => line.withPermit(syncOnce(mode).pipe(Effect.provideContext(needs))),
        fresh: (then) => line.withPermit(onDemand.pipe(Effect.provideContext(needs), Effect.andThen(then))),
      };
    }),
  );
}

/** One run of the credit sync, in its turn, as the scheduled job runs it. */
export const runCreditSync = (mode: SyncMode) => Credits.use((credits) => credits.sync(mode));
