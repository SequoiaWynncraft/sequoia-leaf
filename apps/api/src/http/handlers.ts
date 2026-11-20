import {
  currentQuests,
  DAY_MS,
  DEFAULT_RULES,
  levelForXp,
  nextDailyChargeAt,
  nextTimedWindowAt,
  openQuestBook,
  type PlayerId,
  type Quest,
  QUEST_SLOTS,
  type QuestSlot,
  refreshQuests,
  rerollCost,
  timedWindowAt,
} from "@sequoia-leaf/core";
import { Clock, Context, Duration, Effect, Layer, Redacted, Ref, Schedule, Stream } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { HttpApiBuilder, HttpApiError } from "effect/http-api";
import { SqlClient } from "effect/sql";

import { CurrentIdentity, LeafApi, RerollBodyErrors, Session, Unexpected } from "../api/api.ts";
import { IdentityUnavailable, InternalError, Invalid, NotAMember, Refused, Unauthorized } from "../api/errors.ts";
import type * as Body from "../api/schemas.ts";
import { Identities } from "../auth/session.ts";
import { syncOnDemand } from "../earning/run.ts";
import { eventJsonText, Events, type StoredEvent } from "../events/store.ts";
import { Ledger } from "../ledger/store.ts";
import { questJson } from "../quests/json.ts";
import { rerollQuestFor } from "../quests/reroll.ts";
import { Quests } from "../quests/store.ts";
import { ForestHandlers, GroveBodyErrorsLive, GroveHandlers } from "./grove.ts";

/** How far back the list of finished quests reaches. */
const RECENTLY_COMPLETED_MS = 2 * DAY_MS;
/** The most events one answer or one look by a stream returns. */
const EVENT_PAGE = 100;
/** How many events `GET /events` returns when the client does not say where it is. */
const LATEST_EVENTS = 50;

/** How the event stream paces itself. Tests shorten these. */
export interface StreamTuning {
  /** How often an open stream looks for new events. */
  readonly pollMs: number;
  /** A stream writes a comment this often, so proxies keep a quiet connection open. */
  readonly heartbeatMs: number;
  /** A stream is closed after this long. The client reconnects, which checks its session again. */
  readonly maxMs: number;
}

export const StreamTuning = Context.Reference<StreamTuning>("leaf/StreamTuning", {
  defaultValue: () => ({ pollMs: 2_000, heartbeatMs: 20_000, maxMs: 15 * 60_000 }),
});

/** What a member is told when Leaf refuses a reroll, by the refusal's code. */
const REFUSALS = {
  not_current: "That quest is no longer in its slot. Refresh your quests",
  not_rerollable: "That quest can't be rerolled",
  cost_changed: "Rerolling it costs something else now. Refresh your quests",
  insufficient_leaf: "You don't have enough Leaf to reroll it",
} as const;

/** A quest in progress as `/quests` sends it: with `reroll_leaf`, what rerolling it costs now, or null when it can't be. */
function questOnOffer(quest: Quest, rerollsToday: ReadonlyMap<QuestSlot, number>) {
  return {
    ...questJson(quest),
    reroll_leaf: rerollCost(quest, rerollsToday.get(quest.slot) ?? 0, DEFAULT_RULES.quests),
  };
}

/** Reads an event id sent by a client. Undefined means it sent none; null means it sent something that is not one. */
function eventId(value: string | undefined): number | null | undefined {
  if (value === undefined || value === "") {
    return undefined;
  }
  return /^\d{1,15}$/.test(value) ? Number(value) : null;
}

function iso(at: number): string {
  return new Date(at).toISOString();
}

/** Lets in current guild members with a Sequoia session, and provides who they are. */
export const SessionLive = Layer.effect(
  Session,
  Effect.gen(function* () {
    const identities = yield* Identities;
    return Session.of({
      bearer: Effect.fnUntraced(function* (httpEffect, { credential }) {
        const token = Redacted.value(credential);
        if (token === "") {
          return yield* new Unauthorized({ code: "unauthorized", message: "Sign in with your Sequoia account" });
        }
        const result = yield* identities.identify(token);
        if (result.status === "unauthorized") {
          return yield* new Unauthorized({ code: "unauthorized", message: "Your session has expired. Sign in again" });
        }
        if (result.status === "unavailable") {
          return yield* new IdentityUnavailable({
            code: "identity_unavailable",
            message: "Could not check your session. Try again shortly",
          });
        }
        if (result.identity.guildRank === null && !result.identity.admin) {
          return yield* new NotAMember({ code: "not_a_member", message: "Leaf is for current Sequoia members" });
        }
        return yield* Effect.provideService(httpEffect, CurrentIdentity, result.identity);
      }),
    });
  }),
);

/** A reroll whose body does not decode as `{ "leaf": n }` gets `invalid_cost`. */
export const RerollBodyErrorsLive = Layer.succeed(RerollBodyErrors)((httpEffect) =>
  Effect.catchIf(
    httpEffect,
    (error) => HttpApiError.HttpApiSchemaError.is(error) && error.kind === "Payload",
    () => Effect.fail(new Invalid({ code: "invalid_cost", message: 'Send the cost you agreed to as { "leaf": n }' })),
  ),
);

/** Logs a defect, anything thrown rather than failed with a declared error, and answers `internal_error`. */
export const UnexpectedLive = Layer.succeed(Unexpected)((httpEffect) =>
  Effect.catchDefect(httpEffect, (defect) =>
    Effect.logError("An unexpected error answered 500", defect).pipe(
      Effect.andThen(Effect.fail(new InternalError({ code: "internal_error", message: "Something went wrong" }))),
    ),
  ),
);

// Handlers answer with their JSON themselves. `satisfies` checks each body against
// the endpoint's schema when the code compiles, so it is not checked again, field
// by field, on every request. The schemas still describe the API in `/openapi.json`.
// The services they use are looked up once, when the handlers are built.

const SystemHandlers = HttpApiBuilder.group(LeafApi, "system", (handlers) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    // Healthy means the database answers, since nothing works without it.
    const healthy = sql`SELECT 1`.pipe(
      Effect.orDie,
      Effect.as(HttpServerResponse.jsonUnsafe({ status: "ok" } satisfies typeof Body.Health.Type)),
    );
    return handlers.handle("healthz", () => healthy);
  }),
);

const invalidAfter = new Invalid({ code: "invalid_after", message: "after must be an event id" });

const MeHandlers = HttpApiBuilder.group(LeafApi, "me", (handlers) =>
  Effect.gen(function* () {
    const ledger = yield* Ledger;
    const quests = yield* Quests;
    const events = yield* Events;
    return (
      handlers
        .handle("account", () =>
          Effect.gen(function* () {
            const identity = yield* CurrentIdentity;
            const account = yield* ledger.account(identity.playerId);
            const level = levelForXp(account.xp, DEFAULT_RULES.levels);
            return HttpServerResponse.jsonUnsafe({
              player: { id: identity.playerId, username: identity.username },
              leaf: account.balance,
              xp: account.xp,
              level: { number: level.level, xp_into_level: level.xpIntoLevel, xp_for_next_level: level.xpForNextLevel },
            } satisfies typeof Body.Me.Type);
          }),
        )
        .handle("quests", ({ query }) =>
          Effect.gen(function* () {
            const { playerId } = yield* CurrentIdentity;
            if (query.sync === "1") {
              yield* syncOnDemand;
            }
            const now = yield* Clock.currentTimeMillis;
            const stored = yield* quests.book(playerId);
            const completed = yield* quests.completedSince(playerId, now - RECENTLY_COMPLETED_MS);
            const rerolls = yield* quests.rerollsOnDay(playerId, now);
            // The stored book is as of the player's last activity or reroll. Bringing it
            // up to now is a pure calculation; only the credit sync and rerolls write quests.
            const { book } = refreshQuests(stored ?? openQuestBook(now), playerId, now, DEFAULT_RULES.quests);
            const nextCharge = nextDailyChargeAt(book, DEFAULT_RULES.quests);
            const timedRules = DEFAULT_RULES.quests.timed;
            const window = timedRules === undefined ? undefined : timedWindowAt(now, timedRules);
            return HttpServerResponse.jsonUnsafe({
              daily: {
                charges: book.dailyCharges,
                charge_cap: DEFAULT_RULES.quests.dailyChargeCap,
                next_charge_at: nextCharge === null ? null : iso(nextCharge),
              },
              timed:
                timedRules === undefined
                  ? null
                  : {
                      ends_at: window === undefined ? null : iso(window.end),
                      next_at: iso(nextTimedWindowAt(now, timedRules)),
                    },
              quests: currentQuests(book, now).map((quest) => questOnOffer(quest, rerolls)),
              recently_completed: completed.map(questJson),
            } satisfies typeof Body.Quests.Type);
          }),
        )
        // Swaps a quest in progress for another. The id is the one `/quests` gave,
        // so a request sent twice swaps once.
        .handle("reroll", ({ params, payload }) =>
          Effect.gen(function* () {
            const id = /^([a-z]+):(\d{1,9})$/.exec(params.id);
            const slot = QUEST_SLOTS.find((each): each is QuestSlot => each === id?.[1]);
            if (id === null || slot === undefined) {
              return yield* new Invalid({ code: "invalid_quest", message: "That is not a quest id" });
            }
            const { playerId } = yield* CurrentIdentity;
            // A quest just finished is paid rather than swapped away.
            yield* syncOnDemand;
            const now = yield* Clock.currentTimeMillis;
            const result = yield* rerollQuestFor(
              playerId,
              slot,
              Number(id[2]),
              payload.leaf,
              now,
              DEFAULT_RULES.quests,
            );
            if (result.status === "refused") {
              return yield* new Refused({ code: result.reason, message: REFUSALS[result.reason] });
            }
            return HttpServerResponse.jsonUnsafe({
              leaf: result.balance,
              spent: result.spent,
              quest: questOnOffer(result.quest, yield* quests.rerollsOnDay(playerId, now)),
            } satisfies typeof Body.Rerolled.Type);
          }),
        )
        .handle("events", ({ query }) =>
          Effect.gen(function* () {
            const after = eventId(query.after);
            if (after === null) {
              return yield* invalidAfter;
            }
            const { playerId } = yield* CurrentIdentity;
            const found =
              after === undefined
                ? yield* events.latest(playerId, LATEST_EVENTS)
                : yield* events.after(playerId, after, EVENT_PAGE);
            // Each event's details are stored as the JSON text they are sent as, so they are spliced in, not parsed.
            return HttpServerResponse.text(`{"events":[${found.map(eventJsonText).join(",")}]}`, {
              contentType: "application/json",
            });
          }),
        )
        // Server-sent events. A client that reconnects sends the last id it saw as
        // `Last-Event-ID` (browsers do this by themselves) and gets what it missed;
        // a client that sends none gets only what happens from now on.
        .handle("stream", ({ query }) =>
          Effect.gen(function* () {
            const request = yield* HttpServerRequest.HttpServerRequest;
            const resumeFrom = eventId(request.headers["last-event-id"] ?? query.after);
            if (resumeFrom === null) {
              return yield* invalidAfter;
            }
            const { playerId } = yield* CurrentIdentity;
            const from = resumeFrom ?? (yield* events.latestId);
            return HttpServerResponse.stream(eventStream(events, playerId, from, yield* StreamTuning), {
              contentType: "text/event-stream",
              headers: { "cache-control": "no-cache", connection: "keep-alive" },
            });
          }),
        )
    );
  }),
);

/**
 * The frames of one event stream. It finds new events by looking in the
 * database every `pollMs`, not by being told, so it also sees events written by
 * another process: during a deploy the old and the new container run side by side.
 */
const eventStream = (events: Events["Service"], playerId: PlayerId, from: number, tuning: StreamTuning) =>
  Stream.unwrap(
    Effect.gen(function* () {
      const position = yield* Ref.make(from);
      const look = Effect.gen(function* () {
        const found = yield* events.after(playerId, yield* Ref.get(position), EVENT_PAGE);
        const last = found.at(-1);
        if (last !== undefined) {
          yield* Ref.set(position, last.id);
        }
        return found.map(sseFrame).join("");
      });
      const fresh = Stream.fromEffectSchedule(look, Schedule.spaced(Duration.millis(tuning.pollMs))).pipe(
        Stream.filter((frames) => frames !== ""),
      );
      // Clients ignore comments; proxies see traffic and keep a quiet connection open.
      const keepAlive = Stream.tick(Duration.millis(tuning.heartbeatMs)).pipe(
        Stream.drop(1),
        Stream.as(": keep-alive\n\n"),
      );
      // The first frame carries the starting position as its id, so a client whose
      // stream ends before any event arrives still reconnects from here and gets
      // what happened in between.
      return Stream.make(`id: ${from}\nretry: 3000\n\n`).pipe(
        Stream.concat(Stream.merge(fresh, keepAlive)),
        Stream.interruptWhen(Effect.sleep(Duration.millis(tuning.maxMs))),
        Stream.encodeText,
      );
    }),
  );

function sseFrame(event: StoredEvent): string {
  return `event: ${event.type}\ndata: ${eventJsonText(event)}\nid: ${event.id}\n\n`;
}

/** The API's routes and the implementations of its middleware. */
export const ApiRoutes = HttpApiBuilder.layer(LeafApi, { openapiPath: "/openapi.json" }).pipe(
  Layer.provide([SystemHandlers, MeHandlers, GroveHandlers, ForestHandlers]),
  Layer.provide([SessionLive, RerollBodyErrorsLive, GroveBodyErrorsLive, UnexpectedLive]),
);

/** Any request no route takes, answered in the same `{ "code", "message" }` shape as every other error. */
export const NotFound = HttpRouter.add(
  "*",
  "/*",
  HttpServerResponse.jsonUnsafe({ code: "not_found", message: "No such route" }, { status: 404 }),
);
