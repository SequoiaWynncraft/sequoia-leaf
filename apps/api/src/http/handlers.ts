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
import { Clock, Context, Duration, Effect, Layer, Schedule, Stream, type Types } from "effect";
import { HttpRouter, HttpServerError, HttpServerRequest, HttpServerResponse } from "effect/http";
import { HttpApiBuilder, HttpApiError } from "effect/http-api";

import { CurrentIdentity, LeafApi, RerollBodyErrors, Session } from "../api/api.ts";
import {
  CostChanged,
  IdentityUnavailable,
  InsufficientLeaf,
  InvalidAfter,
  InvalidCost,
  InvalidQuest,
  NotAMember,
  NotCurrent,
  NotRerollable,
  Unauthorized,
} from "../api/errors.ts";
import { Identities, sessionToken } from "../auth/session.ts";
import { Db } from "../db.ts";
import { syncOnDemand } from "../earning/run.ts";
import { eventJsonText, latestEventId, listEventsAfter, listLatestEvents, type StoredEvent } from "../events/store.ts";
import { getAccount } from "../ledger/store.ts";
import { questJson } from "../quests/json.ts";
import { rerollQuestFor, rerollsOnDay } from "../quests/reroll.ts";
import { listCompletedSince, loadQuestBook } from "../quests/store.ts";

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

/** Why Leaf refused a reroll, as the error each reason answers with. */
const REROLL_REFUSED = {
  not_current: () => new NotCurrent({ message: "That quest is no longer in its slot. Refresh your quests" }),
  not_rerollable: () => new NotRerollable({ message: "That quest can't be rerolled" }),
  cost_changed: () => new CostChanged({ message: "Rerolling it costs something else now. Refresh your quests" }),
  insufficient_leaf: () => new InsufficientLeaf({ message: "You don't have enough Leaf to reroll it" }),
};

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
    return (httpEffect) =>
      Effect.gen(function* () {
        const token = sessionToken(yield* HttpServerRequest.HttpServerRequest);
        if (token === undefined) {
          return yield* new Unauthorized({ message: "Sign in with your Sequoia account" });
        }
        const result = yield* identities.identify(token);
        if (result.status === "unauthorized") {
          return yield* new Unauthorized({ message: "Your session has expired. Sign in again" });
        }
        if (result.status === "unavailable") {
          return yield* new IdentityUnavailable({ message: "Could not check your session. Try again shortly" });
        }
        if (result.identity.guildRank === null && !result.identity.admin) {
          return yield* new NotAMember({ message: "Leaf is for current Sequoia members" });
        }
        return yield* Effect.provideService(httpEffect, CurrentIdentity, result.identity);
      });
  }),
);

/** A reroll whose body is not `{ "leaf": n }`, JSON or not, gets `invalid_cost`. */
export const RerollBodyErrorsLive = Layer.succeed(RerollBodyErrors)((httpEffect) => {
  const invalid = new InvalidCost({ message: 'Send the cost you agreed to as { "leaf": n }' });
  return httpEffect.pipe(
    Effect.catch((error): Effect.Effect<never, InvalidCost | Types.unhandled> =>
      HttpApiError.HttpApiSchemaError.is(error) && (error.kind === "Payload" || error.kind === "Body")
        ? Effect.fail(invalid)
        : Effect.fail(error),
    ),
    Effect.flatMap((response) => (response.status === 415 ? Effect.fail(invalid) : Effect.succeed(response))),
  );
});

const SystemHandlers = HttpApiBuilder.group(LeafApi, "system", (handlers) =>
  handlers.handle("healthz", () =>
    Effect.gen(function* () {
      // Healthy means the database answers, since nothing works without it.
      (yield* Db).query("SELECT 1").get();
      return { status: "ok" as const };
    }),
  ),
);

const MeHandlers = HttpApiBuilder.group(LeafApi, "me", (handlers) =>
  handlers
    .handle("account", () =>
      Effect.gen(function* () {
        const identity = yield* CurrentIdentity;
        const account = getAccount(yield* Db, identity.playerId);
        const level = levelForXp(account.xp, DEFAULT_RULES.levels);
        return {
          player: { id: identity.playerId, username: identity.username },
          leaf: account.balance,
          xp: account.xp,
          level: { number: level.level, xp_into_level: level.xpIntoLevel, xp_for_next_level: level.xpForNextLevel },
        };
      }),
    )
    .handle("quests", ({ query }) =>
      Effect.gen(function* () {
        const identity = yield* CurrentIdentity;
        if (query.sync === "1") {
          yield* syncOnDemand;
        }
        const db = yield* Db;
        const now = yield* Clock.currentTimeMillis;
        const stored = loadQuestBook(db, identity.playerId);
        const completed = listCompletedSince(db, identity.playerId, now - RECENTLY_COMPLETED_MS);
        // The stored book is as of the player's last activity or reroll. Bringing it
        // up to now is a pure calculation; only the credit sync and rerolls write quests.
        const { book } = refreshQuests(stored ?? openQuestBook(now), identity.playerId, now, DEFAULT_RULES.quests);
        const nextCharge = nextDailyChargeAt(book, DEFAULT_RULES.quests);
        const timedRules = DEFAULT_RULES.quests.timed;
        const window = timedRules === undefined ? undefined : timedWindowAt(now, timedRules);
        const rerolls = rerollsOnDay(db, identity.playerId, now);
        return {
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
        };
      }),
    )
    // Swaps a quest in progress for another. The id is the one `/quests` gave,
    // so a request sent twice swaps once.
    .handle("reroll", ({ params, payload }) =>
      Effect.gen(function* () {
        const id = /^([a-z]+):(\d{1,9})$/.exec(params.id);
        const slot = QUEST_SLOTS.find((each): each is QuestSlot => each === id?.[1]);
        if (id === null || slot === undefined) {
          return yield* new InvalidQuest({ message: "That is not a quest id" });
        }
        const identity = yield* CurrentIdentity;
        // A quest just finished is paid rather than swapped away.
        yield* syncOnDemand;
        const db = yield* Db;
        const now = yield* Clock.currentTimeMillis;
        const result = rerollQuestFor(
          db,
          identity.playerId,
          slot,
          Number(id[2]),
          payload.leaf,
          now,
          DEFAULT_RULES.quests,
        );
        if (result.status === "refused") {
          return yield* REROLL_REFUSED[result.reason]();
        }
        return {
          leaf: result.balance,
          spent: result.spent,
          quest: questOnOffer(result.quest, rerollsOnDay(db, identity.playerId, now)),
        };
      }),
    )
    .handle("events", ({ query }) =>
      Effect.gen(function* () {
        const after = eventId(query.after);
        if (after === null) {
          return yield* new InvalidAfter({ message: "after must be an event id" });
        }
        const identity = yield* CurrentIdentity;
        const db = yield* Db;
        const events =
          after === undefined
            ? listLatestEvents(db, identity.playerId, LATEST_EVENTS)
            : listEventsAfter(db, identity.playerId, after, EVENT_PAGE);
        return {
          events: events.map((event) => ({
            id: event.id,
            type: event.type,
            created_at: iso(event.createdAt),
            data: JSON.parse(event.data) as unknown,
          })),
        };
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
          return yield* new InvalidAfter({ message: "after must be an event id" });
        }
        const identity = yield* CurrentIdentity;
        const db = yield* Db;
        const tuning = yield* StreamTuning;
        return HttpServerResponse.stream(eventStream(db, identity.playerId, resumeFrom ?? latestEventId(db), tuning), {
          contentType: "text/event-stream",
          headers: { "cache-control": "no-cache", connection: "keep-alive" },
        });
      }),
    ),
);

/**
 * The frames of one event stream. It finds new events by looking in the
 * database every `pollMs`, not by being told, so it also sees events written by
 * another process: during a deploy the old and the new container run side by side.
 */
function eventStream(db: Db["Service"], playerId: PlayerId, from: number, tuning: StreamTuning) {
  let after = from;
  const look = Effect.sync(() => {
    const events = listEventsAfter(db, playerId, after, EVENT_PAGE);
    after = events.at(-1)?.id ?? after;
    return events.map(sseFrame).join("");
  });
  const events = Stream.fromEffectSchedule(look, Schedule.spaced(Duration.millis(tuning.pollMs))).pipe(
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
    Stream.concat(Stream.merge(events, keepAlive)),
    Stream.interruptWhen(Effect.sleep(Duration.millis(tuning.maxMs))),
    Stream.encodeText,
  );
}

function sseFrame(event: StoredEvent): string {
  return `event: ${event.type}\ndata: ${eventJsonText(event)}\nid: ${event.id}\n\n`;
}

/** The API's routes and the implementations of its middleware. */
export const ApiRoutes = HttpApiBuilder.layer(LeafApi, { openapiPath: "/openapi.json" }).pipe(
  Layer.provide([SystemHandlers, MeHandlers]),
  Layer.provide([SessionLive, RerollBodyErrorsLive]),
);

const NOT_FOUND = HttpServerResponse.jsonUnsafe({ code: "not_found", message: "No such route" }, { status: 404 });
const INTERNAL = HttpServerResponse.jsonUnsafe(
  { code: "internal_error", message: "Something went wrong" },
  { status: 500 },
);

/**
 * Every error answer has the same shape, `{ "code", "message" }`: a route that
 * does not exist is `not_found`, and anything unexpected is logged and answered
 * `internal_error`. Global, so it also sees requests no route matched.
 */
export const JsonFallbacks = HttpRouter.middleware(
  (httpEffect) =>
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the typings refuse to let a middleware answer `unhandled` errors, which is its whole job here
    Effect.catchCause(httpEffect, (cause) =>
      Effect.gen(function* () {
        const [response] = yield* HttpServerError.causeResponse(cause);
        if (response.status === 404) {
          return NOT_FOUND;
        }
        if (response.status >= 500 && response.status !== 503) {
          yield* Effect.logError("An unexpected error answered 500", cause);
          return INTERNAL;
        }
        return response;
      }),
    ) as Effect.Effect<HttpServerResponse.HttpServerResponse, Types.unhandled>,
  { global: true },
);
