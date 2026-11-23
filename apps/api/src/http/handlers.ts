import {
  type Balances,
  currentQuests,
  DAY_MS,
  DEFAULT_RULES,
  gameId,
  levelForXp,
  nextDailyChargeAt,
  nextTimedWindowAt,
  openQuestBook,
  parsePlayerId,
  PERIODS,
  PURSE_HEADER,
  type Quest,
  QUEST_SLOTS,
  type QuestSlot,
  refreshQuests,
  type RequestKind,
  rerollCost,
  RULE_CHANGES,
  tallyBoard,
  timedWindowAt,
  utcDay,
} from "@sequoia-leaf/core";
import { BANNERS } from "@sequoia-leaf/pulls";
import { ByteSize, Clock, Duration, Effect, Layer, Option, Redacted, Ref, Schedule, Schema, Stream } from "effect";
import { HttpClient, HttpRouter, HttpServerError, HttpServerRequest, HttpServerResponse } from "effect/http";
import { HttpApiBuilder, HttpApiError, HttpApiSecurity } from "effect/http-api";
import { SqlClient } from "effect/sql";

import { whoIsAbout } from "../activity/about.ts";
import { ActivityReport } from "../activity/report.ts";
import { Visits } from "../activity/visits.ts";
import { rateCard } from "../announce/rate-card.ts";
import {
  BodyLimit,
  CurrentIdentity,
  type Identity,
  isGuest,
  LeafApi,
  PlayBodyErrors,
  Player,
  PresenceBodyErrors,
  RequestBodyErrors,
  RerollBodyErrors,
  Session,
  SessionCookie,
  Unexpected,
} from "../api/api.ts";
import {
  BadOrigin,
  BodyTooLarge,
  IdentityUnavailable,
  InternalError,
  Invalid,
  MembersOnly,
  Missing,
  NotAMember,
  NotYou,
  Refused,
  RequestRefused,
  RequestsUnavailable,
  RequestUnknown,
  SlowDown,
  StaffOnly,
  StateUnreadable,
  Unauthorized,
} from "../api/errors.ts";
import type * as Body from "../api/schemas.ts";
import { Identities } from "../auth/session.ts";
import { guildRequests, notEnoughLeaf } from "../backend/requests.ts";
import { AppConfig } from "../config.ts";
import { Credits } from "../earning/run.ts";
import { eventJsonText, Events } from "../events/store.ts";
import { GUILD_EVENT_TYPES, guildDay, type GuildEvent, guildEvents } from "../game/guild.ts";
import { knownAmong } from "../game/known.ts";
import { PlayerNames } from "../game/names.ts";
import { Skins } from "../game/skins.ts";
import { Ledger } from "../ledger/store.ts";
import { Coins } from "../play/coins.ts";
import { GAMES, type Played } from "../play/games.ts";
import { Play, type Playing } from "../play/service.ts";
import { PlayStore } from "../play/store.ts";
import { questJson } from "../quests/json.ts";
import { rerollQuestFor } from "../quests/reroll.ts";
import { Quests } from "../quests/store.ts";
import { Tallies } from "../tally/store.ts";
import { BackendLive, InternalHandlers, PurchaseBodyErrorsLive } from "./internal.ts";
import { GuildFeed, OpenStreams, sseFrame, StreamTuning } from "./streams.ts";

/** How far back the list of finished quests reaches. */
const RECENTLY_COMPLETED_MS = 2 * DAY_MS;
/** The most events one answer or one look by a stream returns. */
const EVENT_PAGE = 100;
/** How many events `GET /events` returns when the client does not say where it is. */
const LATEST_EVENTS = 50;
/** The largest body Leaf reads. */
const MAX_BODY = ByteSize.kibibytes(16);

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

/** A member's level as the API sends it. */
function levelJson(xp: number) {
  const level = levelForXp(xp, DEFAULT_RULES.levels);
  return { number: level.level, xp_into_level: level.xpIntoLevel, xp_for_next_level: level.xpForNextLevel };
}

/** Methods that change nothing. Only these may come from another site's page with the session cookie. */
const SAFE_METHODS: ReadonlySet<string> = new Set(["GET", "HEAD"]);

/**
 * How many session cookies a `Cookie` header carries. A browser sends two
 * when another `seqwawa.com` site has set one of its own beside the website's.
 */
function sessionCookies(header: string | undefined): number {
  return (header ?? "").split(/[;,]/).filter((pair) => pair.split("=", 1)[0]?.trim() === SessionCookie.key).length;
}

/**
 * Who a request's session belongs to, for both ways in: `Session`, which lets in only current
 * guild members, and `Player`, which lets in anyone signed in. The session comes as a Bearer
 * header, as the mod sends it, or as the website's cookie, as a browser sends it to Leaf's own
 * pages; both are checked with the backend in the same way. A write that came with the cookie must
 * also come from one of Leaf's pages, by its `Origin`.
 *
 * Effect tries the Bearer header, then the cookie, lets the request in on the first that admits it,
 * and answers with the last refusal. So the cookie's turn, which comes last, is the one that
 * refuses: alone, either way of signing in is checked there. The Bearer's turn only lets in a
 * request that came with both: a Bearer that would let it in on its own wins, and otherwise the
 * cookie decides. A request with two session cookies is refused on both turns.
 */
export const sessionChecks = Effect.gen(function* () {
  const identities = yield* Identities;
  const { publicOrigin } = yield* AppConfig;
  const bearerToken = HttpApiBuilder.securityDecode(HttpApiSecurity.bearer);
  const cookieToken = HttpApiBuilder.securityDecode(SessionCookie);

  // With two session cookies a browser could be signed in as someone another
  // site chose, so neither is believed, and neither is sent to the backend.
  const oneSessionCookie = Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    if (sessionCookies(request.headers["cookie"]) > 1) {
      return yield* new Unauthorized({
        code: "unauthorized",
        message: "Your browser sent two Sequoia sessions. Sign in again",
      });
    }
  });

  /** Who a session belongs to, as the backend vouches. */
  const admit = Effect.fnUntraced(function* (token: string) {
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
    return result.identity;
  });

  return {
    /** The Bearer's turn: only a request that also came with the cookie. */
    bearer: Effect.fnUntraced(function* (credential: Redacted.Redacted) {
      yield* oneSessionCookie;
      if (Redacted.value(yield* cookieToken) === "") {
        return yield* new Unauthorized({ code: "unauthorized", message: "Sign in with your Sequoia account" });
      }
      return yield* admit(Redacted.value(credential));
    }),
    /**
     * For a request that opens a live connection (`/v1/game/live`), which is a GET: the cookie, or
     * the Bearer when there is no cookie. A page on another site can open a WebSocket to Leaf, and
     * the browser sends the cookie with it, so with the cookie it must come from Leaf's own pages.
     */
    upgrade: Effect.gen(function* () {
      yield* oneSessionCookie;
      const cookie = Redacted.value(yield* cookieToken);
      if (cookie === "") {
        return yield* admit(Redacted.value(yield* bearerToken));
      }
      const request = yield* HttpServerRequest.HttpServerRequest;
      if (request.headers["origin"] !== publicOrigin) {
        return yield* new BadOrigin({ code: "bad_origin", message: "Leaf takes this only from its own pages" });
      }
      return yield* admit(cookie);
    }),
    /** The cookie's turn: the cookie, or the Bearer when there is no cookie. */
    cookie: Effect.fnUntraced(function* (credential: Redacted.Redacted) {
      yield* oneSessionCookie;
      const cookie = Redacted.value(credential);
      if (cookie === "") {
        return yield* admit(Redacted.value(yield* bearerToken));
      }
      // Another site's page can make a browser send the cookie, but not with Leaf's own origin.
      const request = yield* HttpServerRequest.HttpServerRequest;
      if (!SAFE_METHODS.has(request.method) && request.headers["origin"] !== publicOrigin) {
        return yield* new BadOrigin({ code: "bad_origin", message: "Leaf takes this only from its own pages" });
      }
      return yield* admit(cookie);
    }),
  };
});

/** Lets a member through, and refuses anyone else; website admins count as members. */
const memberOnly = (identity: Identity) =>
  isGuest(identity)
    ? Effect.fail(new NotAMember({ code: "not_a_member", message: "Leaf is for current Sequoia members" }))
    : Effect.succeed(identity);

/** Lets in current guild members (and website admins) with a Sequoia session, and provides who they are. */
export const SessionLive = Layer.effect(
  Session,
  Effect.gen(function* () {
    const checks = yield* sessionChecks;
    return Session.of({
      bearer: (httpEffect, { credential }) =>
        checks.bearer(credential).pipe(
          Effect.flatMap(memberOnly),
          Effect.flatMap((identity) => Effect.provideService(httpEffect, CurrentIdentity, identity)),
        ),
      cookie: (httpEffect, { credential }) =>
        checks.cookie(credential).pipe(
          Effect.flatMap(memberOnly),
          Effect.flatMap((identity) => Effect.provideService(httpEffect, CurrentIdentity, identity)),
        ),
    });
  }),
);

/** Lets in anyone with a Sequoia session, member or guest, and provides who they are. */
export const PlayerLive = Layer.effect(
  Player,
  Effect.gen(function* () {
    const checks = yield* sessionChecks;
    return Player.of({
      bearer: (httpEffect, { credential }) =>
        checks
          .bearer(credential)
          .pipe(Effect.flatMap((identity) => Effect.provideService(httpEffect, CurrentIdentity, identity))),
      cookie: (httpEffect, { credential }) =>
        checks
          .cookie(credential)
          .pipe(Effect.flatMap((identity) => Effect.provideService(httpEffect, CurrentIdentity, identity))),
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

const isPayloadError = (error: unknown) => HttpApiError.HttpApiSchemaError.is(error) && error.kind === "Payload";

/** A body longer than the limit it was read under. Reading it is a defect, as every failure to read a body is. */
const isBodyTooLarge = (defect: unknown) =>
  HttpServerError.isHttpServerError(defect) &&
  defect.reason instanceof HttpServerError.RequestParseError &&
  defect.reason.reason === "BodyTooLarge";

/** A body is read only up to 16 KiB: one larger gets `body_too_large` unread. */
export const BodyLimitLive = Layer.succeed(BodyLimit)((httpEffect) =>
  httpEffect.pipe(
    Effect.provideService(HttpServerRequest.MaxBodySize, MAX_BODY),
    Effect.catchDefect((defect) =>
      isBodyTooLarge(defect)
        ? Effect.fail(new BodyTooLarge({ code: "body_too_large", message: "Leaf reads a body of at most 16 KiB" }))
        : Effect.die(defect),
    ),
  ),
);

/** A presence whose body is not `{ "place" }` (with one of the game's places, and `stay` true or false if any) gets `invalid_place`. */
export const PresenceBodyErrorsLive = Layer.succeed(PresenceBodyErrors)((httpEffect) =>
  Effect.catchIf(httpEffect, isPayloadError, () =>
    Effect.fail(
      new Invalid({
        code: "invalid_place",
        message:
          'Send where you are as { "place": "town" }, or camp, works or table, "stay" as true or false, and "device" as phone or desktop',
      }),
    ),
  ),
);

/** A guild request whose body is not `{ "type": "aspect" or "tome" }` (with `reason` a string if any) gets `invalid_request`. */
export const RequestBodyErrorsLive = Layer.succeed(RequestBodyErrors)((httpEffect) =>
  Effect.catchIf(httpEffect, isPayloadError, () =>
    Effect.fail(
      new Invalid({
        code: "invalid_request",
        message: 'Send a request as { "type": "aspect" }, or { "type": "tome", "reason": "<what it is for>" }',
      }),
    ),
  ),
);

/** A batch whose body is not `{ "commands": [...] }` gets `invalid_command`. */
export const PlayBodyErrorsLive = Layer.succeed(PlayBodyErrors)((httpEffect) =>
  Effect.catchIf(httpEffect, isPayloadError, () =>
    Effect.fail(
      new Invalid({
        code: "invalid_command",
        message: 'Send commands as { "player": "<your id>", "commands": [{ "id": "<yours>", ... }] }',
      }),
    ),
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

/** The rate card as the website reads it: the same words as Discord's, kept for five minutes. */
const RatesHandlers = HttpApiBuilder.group(LeafApi, "rates", (handlers) => {
  const card = rateCard(DEFAULT_RULES, RULE_CHANGES);
  const rates = HttpServerResponse.jsonUnsafe(
    {
      title: card.title,
      description: card.description,
      sections: card.fields.map((field) => ({ name: field.name, text: field.value })),
      changed_at: card.timestamp ?? null,
    } satisfies typeof Body.Rates.Type,
    { headers: { "cache-control": "public, max-age=300" } },
  );
  return Effect.succeed(handlers.handle("rates", () => Effect.succeed(rates)));
});

const invalidAfter = new Invalid({ code: "invalid_after", message: "after must be an event id" });

const MeHandlers = HttpApiBuilder.group(LeafApi, "me", (handlers) =>
  Effect.gen(function* () {
    const ledger = yield* Ledger;
    const coins = yield* Coins;
    const quests = yield* Quests;
    const credits = yield* Credits;
    const events = yield* Events;
    const streams = yield* OpenStreams;
    const { pollMs } = yield* StreamTuning;
    return (
      handlers
        .handle("account", () =>
          Effect.gen(function* () {
            const identity = yield* CurrentIdentity;
            const account = yield* ledger.account(identity.playerId);
            return HttpServerResponse.jsonUnsafe({
              player: { id: identity.playerId, username: identity.username },
              leaf: account.balance,
              xp: account.xp,
              level: levelJson(account.xp),
            } satisfies typeof Body.Me.Type);
          }),
        )
        .handle("quests", ({ query }) =>
          Effect.gen(function* () {
            const { playerId } = yield* CurrentIdentity;
            if (query.sync === "1") {
              yield* credits.fresh(Effect.void);
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
            // A quest just finished is paid rather than swapped away: the feed is brought in first,
            // and no sync writes what it fetched in between.
            return yield* credits.fresh(
              Effect.gen(function* () {
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
                return HttpServerResponse.jsonUnsafe(
                  {
                    leaf: result.balance,
                    spent: result.spent,
                    quest: questOnOffer(result.quest, yield* quests.rerollsOnDay(playerId, now)),
                  } satisfies typeof Body.Rerolled.Type,
                  purseBeside(yield* coins.balances(playerId)),
                );
              }),
            );
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
          Effect.flatMap(CurrentIdentity, ({ playerId }) =>
            eventStreamFrom(events, streams, query.after, (from) =>
              polled(
                (after) =>
                  events.after(playerId, after, EVENT_PAGE).pipe(
                    Effect.map((found) => ({
                      frames: found.map((event) => sseFrame(event.id, event.type, eventJsonText(event))).join(""),
                      position: found.at(-1)?.id ?? after,
                    })),
                  ),
                from,
                pollMs,
              ),
            ),
          ),
        )
    );
  }),
);

/** One look for what happened after a position: the frames to send, and the position to look from next. */
interface Look {
  readonly frames: string;
  readonly position: number;
}

/**
 * The frames found by looking for what happened after a position every
 * `pollMs`, starting at once. It looks in the database rather than being told,
 * so it also sees events written by another process: during a deploy the old
 * and the new container run side by side.
 */
const polled = (look: (after: number) => Effect.Effect<Look>, from: number, pollMs: number) =>
  Stream.unwrap(
    Effect.gen(function* () {
      const position = yield* Ref.make(from);
      const next = Effect.gen(function* () {
        const found = yield* look(yield* Ref.get(position));
        yield* Ref.set(position, found.position);
        return found.frames;
      });
      return Stream.fromEffectSchedule(next, Schedule.spaced(Duration.millis(pollMs))).pipe(
        Stream.filter((frames) => frames !== ""),
      );
    }),
  );

/**
 * Answers a request for an event stream. A client that reconnects sends the
 * last id it saw as `Last-Event-ID` (browsers do this by themselves), or as
 * `?after=`, and gets what it missed; a client that sends none gets only what
 * happens from now on. `frames` are the stream's frames from a position. It is
 * counted among the member's open streams.
 */
const eventStreamFrom = (
  events: Events["Service"],
  streams: OpenStreams["Service"],
  after: string | undefined,
  frames: (from: number) => Stream.Stream<string>,
) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const resumeFrom = eventId(request.headers["last-event-id"] ?? after);
    if (resumeFrom === null) {
      return yield* invalidAfter;
    }
    const from = resumeFrom ?? (yield* events.latestId);
    const { playerId } = yield* CurrentIdentity;
    return HttpServerResponse.stream(streams.open(playerId, from, frames(from)), {
      contentType: "text/event-stream",
      headers: { "cache-control": "no-cache", connection: "keep-alive" },
    });
  });

const GameHelloHandlers = HttpApiBuilder.group(LeafApi, "gameHello", (handlers) =>
  Effect.gen(function* () {
    const { gameSignInUrl, gameLeafSpending } = yield* AppConfig;
    const hello = HttpServerResponse.jsonUnsafe({
      sign_in: gameSignInUrl,
      leaf_spending: gameLeafSpending,
    } satisfies typeof Body.Hello.Type);
    return handlers.handle("hello", () => Effect.succeed(hello));
  }),
);

/** Who is about, as the presence routes answer it. */
/**
 * A write from a page that believes it is another player than the session's, such as one left open
 * after someone else signed in: nothing is done.
 */
const notYou = new NotYou({ code: "not_you", message: "This page is signed in as someone else now. Load it again" });

/** A player's stored state that does not read: nothing is done, and it is kept. */
const unreadable = new StateUnreadable({
  code: "state_unreadable",
  message: "Your game could not be read. It has been kept; tell the guild",
});

/** Milliseconds as whole seconds. */
const seconds = (ms: number): number => Math.floor(ms / 1000);

/** A row of `banner_people`: a banner, and the player who is its headliner. */
const BannerPerson = Schema.Struct({ banner: Schema.String, playerId: Schema.String });

/**
 * Leaf's word on the player's balances beside an answer that moved their Leaf outside the play
 * service (`PURSE_HEADER`), read after it: the page's purse takes it as newer than anything asked
 * before, so an answer on its way from before the spend cannot take it back.
 */
const purseBeside = (purse: Balances) => ({ headers: { [PURSE_HEADER.toLowerCase()]: JSON.stringify(purse) } });

/** Who calls a game, as the play service needs to know them. */
const playingOf = (identity: Identity): Playing => ({ playerId: identity.playerId, guest: isGuest(identity) });

/** The game a route names, if Leaf plays it. */
const playedGame = (name: string): Effect.Effect<Played, Missing> => {
  const id = gameId(name);
  const played = id === undefined ? undefined : GAMES[id];
  return played === undefined
    ? Effect.fail(new Missing({ code: "no_such_game", message: "Leaf does not play that game" }))
    : Effect.succeed(played);
};

/** The guild's events as the answer's JSON, with whatever follows them in it. */
const guildAnswer = (shown: readonly GuildEvent[], rest = "}") =>
  HttpServerResponse.text(`{"events":[${shown.map((event) => event.json).join(",")}]${rest}`, {
    contentType: "application/json",
  });

/** Refuses a guest what only the guild's members may see: the guild's news, with members' names. */
const membersOnly = Effect.flatMap(CurrentIdentity, (identity) =>
  isGuest(identity)
    ? Effect.fail(new MembersOnly({ code: "members_only", message: "The guild's news is for Sequoia members" }))
    : Effect.void,
);

/** Who may buy the guild's requests: not a guest, whom the backend is never asked about. */
const requestsFor = Effect.flatMap(CurrentIdentity, (identity) =>
  isGuest(identity)
    ? Effect.fail(new MembersOnly({ code: "members_only", message: "For guild members with 7 days in the guild." }))
    : Effect.succeed(identity),
);

const GameHandlers = HttpApiBuilder.group(LeafApi, "game", (handlers) =>
  Effect.gen(function* () {
    const ledger = yield* Ledger;
    const events = yield* Events;
    const skins = yield* Skins;
    const names = yield* PlayerNames;
    const visits = yield* Visits;
    const guild = yield* GuildFeed;
    const streams = yield* OpenStreams;
    const play = yield* Play;
    const store = yield* PlayStore;
    const coins = yield* Coins;
    const tallies = yield* Tallies;
    const sql = yield* SqlClient.SqlClient;
    const requests = guildRequests(yield* HttpClient.HttpClient, (yield* AppConfig).backendUrl);

    return (
      handlers
        .handle("me", () =>
          Effect.gen(function* () {
            const identity = yield* CurrentIdentity;
            // Read only: a player with no Coins account yet is shown the welcome it will open with.
            if (isGuest(identity)) {
              // A guest has their Leaf, to spend on what is for everyone: what they earned as a
              // member, or the staff gave them. They have no XP or news of the guild's.
              const { leaf, coins: held, version } = yield* coins.balances(identity.playerId);
              return HttpServerResponse.jsonUnsafe({
                player: { id: identity.playerId, username: identity.username },
                rank: null,
                guest: true,
                leaf,
                xp: 0,
                level: levelJson(0),
                event_cursor: 0,
                coins: held,
                version,
              } satisfies typeof Body.GameMe.Type);
            }
            // The backend vouches for the name, so the guild's news can show it.
            yield* names.remember(identity.playerId, identity.username, yield* Clock.currentTimeMillis);
            // The cursor first: an event is written in the transaction that pays it, so the account
            // read after it holds everything up to the cursor. Something paid in between is in the
            // balance and after the cursor, and the game asks again for nothing; read the other way
            // round, it would be under the cursor and missing from the balance, and never asked for.
            const cursor = yield* events.latestIdOf(identity.playerId);
            const { xp } = yield* ledger.account(identity.playerId);
            const { leaf, coins: held, version } = yield* coins.balances(identity.playerId);
            return HttpServerResponse.jsonUnsafe({
              player: { id: identity.playerId, username: identity.username },
              rank: identity.guildRank,
              guest: false,
              leaf,
              xp,
              level: levelJson(xp),
              event_cursor: cursor,
              coins: held,
              version,
            } satisfies typeof Body.GameMe.Type);
          }),
        )
        .handle("skin", ({ params }) =>
          Effect.gen(function* () {
            const playerId = parsePlayerId(params.uuid);
            if (playerId === undefined) {
              return yield* new Invalid({ code: "invalid_uuid", message: "That is not a Minecraft UUID" });
            }
            const { playerId: asker } = yield* CurrentIdentity;
            const sheet = yield* skins.sheet(playerId, asker, yield* Clock.currentTimeMillis);
            if (Option.isNone(sheet)) {
              return yield* new Missing({ code: "no_skin", message: "No skin for that player" });
            }
            return HttpServerResponse.uint8Array(sheet.value, {
              contentType: "image/png",
              headers: { "cache-control": "private, max-age=86400" },
            });
          }),
        )
        .handle("guildEvents", ({ query }) =>
          Effect.gen(function* () {
            yield* membersOnly;
            const after = eventId(query.after);
            if (after === null) {
              return yield* invalidAfter;
            }
            if (after !== undefined) {
              return guildAnswer((yield* guild.after(after)).shown);
            }
            // The newest events and the day as of one moment, so that whatever is in neither is heard after them.
            const [found, day] = yield* sql
              .withTransaction(
                Effect.all([
                  events.everyoneLatest(GUILD_EVENT_TYPES, LATEST_EVENTS),
                  guildDay(yield* Clock.currentTimeMillis),
                ]),
              )
              .pipe(Effect.orDie);
            return guildAnswer(guildEvents(found, yield* names.of(found.map((event) => event.playerId))), `,${day}`);
          }),
        )
        .handle("guildStream", ({ query }) =>
          Effect.andThen(membersOnly, eventStreamFrom(events, streams, query.after, guild.frames)),
        )
        .handle("presence", ({ payload }) =>
          Effect.gen(function* () {
            const identity = yield* CurrentIdentity;
            const now = yield* Clock.currentTimeMillis;
            const guest = isGuest(identity);
            yield* visits.called(
              { playerId: identity.playerId, username: identity.username, guest, device: payload.device ?? null },
              payload.place,
              payload.stay ?? null,
              now,
            );
            return HttpServerResponse.jsonUnsafe(yield* whoIsAbout(now));
          }),
        )
        // The same lists, writing nothing: for a page in a live room, where the room keeps the player's place.
        .handle("whoIsAbout", () =>
          Effect.gen(function* () {
            return HttpServerResponse.jsonUnsafe(yield* whoIsAbout(yield* Clock.currentTimeMillis));
          }),
        )
        .handle("oldSave", () => Effect.fail(notYou))
        .handle("oldCoins", () => Effect.fail(notYou))
        .handle("play", ({ params, query }) =>
          Effect.gen(function* () {
            const played = yield* playedGame(params.game);
            const identity = yield* CurrentIdentity;
            // A page whose copy turned out not to be Leaf's says at which tick as it asks for the state.
            const differs = /^\d{1,13}$/.test(query.differs ?? "") ? Number(query.differs) : undefined;
            const shown = yield* play.open(playingOf(identity), played, differs);
            if (shown.status === "unreadable") {
              return yield* unreadable;
            }
            return HttpServerResponse.jsonUnsafe({
              rev: shown.rev,
              now: iso(shown.now),
              state: shown.view,
              purse: shown.purse,
              rules: played.rules,
            } satisfies typeof Body.PlayShown.Type);
          }),
        )
        // Commands, done in order in one transaction. A command whose id was seen before answers as
        // it did then, so a page that sends a batch again after losing the answer changes nothing.
        .handle("command", ({ params, payload }) =>
          Effect.gen(function* () {
            const played = yield* playedGame(params.game);
            const identity = yield* CurrentIdentity;
            if (payload.player !== identity.playerId) {
              return yield* notYou;
            }
            const batch = yield* play.send(playingOf(identity), played, payload.commands);
            if (batch.status === "invalid") {
              return yield* new Invalid({ code: "invalid_command", message: batch.why });
            }
            if (batch.status === "unreadable") {
              return yield* unreadable;
            }
            if (batch.status === "slow") {
              return yield* new SlowDown({
                code: "slow_down",
                message: "Commands are coming faster than Leaf takes them. Send them again in a moment",
              });
            }
            // In a batch Leaf took, anything but what the page sends by itself is the player at the keys, done or refused.
            if (payload.commands.some((command) => !played.chore(command))) {
              yield* visits.acted(identity.playerId, yield* Clock.currentTimeMillis);
            }
            return HttpServerResponse.jsonUnsafe({
              rev: batch.rev,
              now: iso(batch.now),
              results: batch.results,
              state: batch.view,
              purse: batch.purse,
              rules: played.rules,
            } satisfies typeof Body.Played.Type);
          }),
        )
        // Somebody's state as a visitor is given it: brought to now, and kept so as any job keeps a
        // state it ran on; nothing of the visitor's is written.
        .handle("visit", ({ params }) =>
          Effect.gen(function* () {
            const played = yield* playedGame(params.game);
            const identity = yield* CurrentIdentity;
            const player = parsePlayerId(params.player);
            const shown = player === undefined ? null : yield* play.visit(player, played, playingOf(identity));
            // A camp read again while the visitor stays in it counts toward the Tally's visits.
            if (player !== undefined && played.id === "town" && shown?.status === "open") {
              yield* tallies.visited(identity.playerId, player, yield* Clock.currentTimeMillis);
            }
            if (shown === null || shown.status === "nothing") {
              return yield* new Missing({
                code: "nothing_to_visit",
                message: "There is nothing of theirs to visit there",
              });
            }
            if (shown.status === "unreadable") {
              return yield* unreadable;
            }
            if (shown.status === "slow") {
              return yield* new SlowDown({
                code: "slow_down",
                message: "Visits are coming faster than Leaf takes them. Ask again in a moment",
              });
            }
            return HttpServerResponse.jsonUnsafe({
              rev: shown.rev,
              now: iso(shown.now),
              state: shown.view,
              purse: shown.purse,
              rules: played.rules,
            } satisfies typeof Body.PlayShown.Type);
          }),
        )
        // Somebody Leaf knows, or the caller (as for a skin), named as the board names them, where they
        // stand in each game, how long they have played each and been in it AFK (`Visits`), and the
        // Coins each has taken.
        .handle("person", ({ params }) =>
          Effect.gen(function* () {
            const player = parsePlayerId(params.player);
            const { playerId: asker } = yield* CurrentIdentity;
            const known =
              player === asker ||
              (player !== undefined && (yield* knownAmong(sql, [player], yield* Clock.currentTimeMillis)).has(player));
            if (player === undefined || !known) {
              return yield* new Missing({ code: "no_such_player", message: "Leaf does not know that player" });
            }
            const named = yield* names.of([player]);
            const standings = yield* store.standingsOf(player);
            const times = yield* visits.timeOf(player);
            const spent = yield* coins.spentOf(player);
            // A game they have been in for less than a second shows nothing, as one never opened.
            const timed = [...times]
              .filter(([, time]) => seconds(time.played) > 0 || seconds(time.afk) > 0)
              .map(([game]) => game);
            const games = [...new Set([...standings.keys(), ...timed])].toSorted();
            const all = (of: "played" | "afk") => seconds([...times.values()].reduce((sum, time) => sum + time[of], 0));
            return HttpServerResponse.jsonUnsafe({
              id: player,
              name: named.get(player) ?? "Someone",
              games: Object.fromEntries(
                games.map((game) => [
                  game,
                  {
                    ...standings.get(game),
                    played: seconds(times.get(game)?.played ?? 0),
                    afk: seconds(times.get(game)?.afk ?? 0),
                    spent: spent.get(game) ?? 0,
                  },
                ]),
              ),
              played: all("played"),
              afk: all("afk"),
            } satisfies typeof Body.Person.Type);
          }),
        )
        // Every pull banner and its headliner, named as the boards name players.
        .handle("banners", () =>
          Effect.gen(function* () {
            const rows = yield* sql`SELECT banner, player_id AS playerId FROM banner_people`.pipe(
              Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(BannerPerson))),
              Effect.orDie,
            );
            // Put in by hand: a row whose id is not a player's names nobody.
            const people = new Map(
              rows.flatMap(({ banner, playerId }) => {
                const id = parsePlayerId(playerId);
                return id === undefined ? [] : [[banner, id] as const];
              }),
            );
            const named = yield* names.of([...people.values()]);
            return HttpServerResponse.jsonUnsafe({
              banners: BANNERS.map(({ id, from, until }) => {
                const person = people.get(id);
                return {
                  id,
                  from: iso(from),
                  until: iso(until),
                  headliner: person === undefined ? null : { id: person, name: named.get(person) ?? "Someone" },
                };
              }),
            } satisfies typeof Body.Banners.Type);
          }),
        )
        // What the Treasury sells, as the backend answers the member, with what they lack for each.
        .handle("requests", () =>
          Effect.gen(function* () {
            const identity = yield* requestsFor;
            const looked = yield* requests.look(identity.session);
            if (looked.status === "unavailable") {
              return yield* new RequestsUnavailable({
                code: "requests_unavailable",
                message: "The guild's requests could not be reached. Try again in a moment.",
              });
            }
            if (looked.status === "refused") {
              return yield* new RequestRefused({ code: "request_refused", message: looked.message });
            }
            const { balance } = yield* ledger.account(identity.playerId);
            const offer = (kind: RequestKind) => {
              const price = looked.prices[kind];
              return {
                price,
                why_not: looked.whyNot ?? (balance < price ? notEnoughLeaf(kind, price, balance) : null),
              };
            };
            return HttpServerResponse.jsonUnsafe({
              aspect: offer("aspect"),
              tome: offer("tome"),
            } satisfies typeof Body.Requests.Type);
          }),
        )
        // One bought with the member's Leaf. The backend charges it through Leaf's own purchase route
        // before it answers, so nothing here holds the database while it waits.
        .handle("request", ({ payload }) =>
          Effect.gen(function* () {
            const identity = yield* requestsFor;
            const reason = payload.type === "tome" ? (payload.reason ?? "").trim() : null;
            if (reason !== null && (reason === "" || reason.length > 1000)) {
              return yield* new Invalid({
                code: "invalid_reason",
                message: "A tome request needs what the tome is for, 1 to 1,000 characters",
              });
            }
            const made = yield* requests.make(identity.session, payload.type, reason);
            if (made.status === "unknown") {
              return yield* new RequestUnknown({
                code: "request_unknown",
                message:
                  "Could not tell whether the request went through. Check the queue in Discord before trying again.",
              });
            }
            if (made.status === "refused") {
              return yield* new RequestRefused({ code: "request_refused", message: made.message });
            }
            if (made.status === "busy") {
              return yield* new RequestsUnavailable({ code: "requests_unavailable", message: made.message });
            }
            const purse = yield* coins.balances(identity.playerId);
            return HttpServerResponse.jsonUnsafe(
              {
                type: payload.type,
                position: made.position,
                leaf_paid: made.paid,
                leaf: purse.leaf,
              } satisfies typeof Body.RequestMade.Type,
              purseBeside(purse),
            );
          }),
        )
        // A board of the Tally, as the caller is shown it.
        .handle("tally", ({ params }) =>
          Effect.gen(function* () {
            const board = tallyBoard(params.board);
            const period = PERIODS.find((p) => p === params.period);
            if (board === undefined || period === undefined || (period === "week" && !board.week)) {
              return yield* new Missing({ code: "no_such_board", message: "The Tally keeps no such board" });
            }
            const { playerId } = yield* CurrentIdentity;
            const shown = yield* tallies.board(board, period, playerId);
            return HttpServerResponse.jsonUnsafe({
              board: board.id,
              period,
              from: shown.from === null ? null : iso(shown.from),
              top: shown.top.map((row) => ({
                place: row.place,
                id: row.playerId,
                name: row.name,
                guest: row.guest,
                score: row.score,
                you: row.playerId === playerId,
              })),
              you: shown.you,
            } satisfies typeof Body.Tally.Type);
          }),
        )
        // A game's board, its players named as the guild's news names them.
        .handle("standings", ({ params }) =>
          Effect.gen(function* () {
            const played = yield* playedGame(params.game);
            const { playerId } = yield* CurrentIdentity;
            const board = yield* store.board(played.id, playerId);
            const named = yield* names.of(board.top.map((row) => row.playerId));
            return HttpServerResponse.jsonUnsafe({
              top: board.top.map((row) => ({
                place: row.place,
                id: row.playerId,
                name: named.get(row.playerId) ?? "Someone",
                guest: row.guest,
                score: row.score,
                also: row.also,
                you: row.playerId === playerId,
              })),
              you: Option.getOrNull(board.you),
            } satisfies typeof Body.Standings.Type);
          }),
        )
    );
  }),
);

/** How many UTC days the staff's report covers when not told, and at most. */
const REPORT_DAYS = 7;
const REPORT_MOST_DAYS = 90;

/** The UTC day a time falls on, as `2026-11-25`. */
const dayName = (at: number) => iso(at).slice(0, 10);

const GameAdminHandlers = HttpApiBuilder.group(LeafApi, "gameAdmin", (handlers) =>
  Effect.gen(function* () {
    const reports = yield* ActivityReport;
    return handlers.handle("activity", ({ query }) =>
      Effect.gen(function* () {
        const identity = yield* CurrentIdentity;
        if (!identity.admin) {
          return yield* new StaffOnly({ code: "staff_only", message: "This is for the guild's staff" });
        }
        const asked = query.days === undefined ? REPORT_DAYS : /^\d{1,9}$/.test(query.days) ? Number(query.days) : 0;
        if (asked < 1) {
          return yield* new Invalid({
            code: "invalid_days",
            message: "days must be a whole number of days, 1 or more",
          });
        }
        const days = Math.min(asked, REPORT_MOST_DAYS);
        const now = yield* Clock.currentTimeMillis;
        const r = yield* reports.report((utcDay(now) - days + 1) * DAY_MS, now);
        return HttpServerResponse.jsonUnsafe({
          now: iso(r.now),
          here: r.here.map((h) => ({
            id: h.playerId,
            name: h.name,
            guest: h.guest,
            place: h.place,
            since: iso(h.since),
          })),
          players: r.players.map((p) => ({
            id: p.playerId,
            name: p.name,
            guest: p.guest,
            first_seen_at: iso(p.firstSeenAt),
            last_seen_at: iso(p.lastSeenAt),
            seconds_total: p.secondsTotal,
            sessions: p.sessions,
            seconds: p.seconds,
            places: p.places,
            done: p.done.map((d) => ({ at: iso(d.at), game: d.game, kind: d.kind, data: d.data })),
          })),
          days: r.days.map((d) => ({
            day: dayName(d.day),
            players: d.players,
            new_players: d.newPlayers,
            sessions: d.sessions,
            hours: d.hours,
            places: d.places,
          })),
          raid: {
            began: r.raid.began,
            runs: r.raid.byRoomsWon.map((b) => ({ rooms_won: b.roomsWon, runs: b.runs })),
          },
          works: {
            began: r.works.began,
            players: r.works.byStoryOrders.map((b) => ({ story_orders: b.storyOrders, players: b.players })),
          },
          odd: r.odd.map((o) => ({ id: o.playerId, name: o.name, rule: o.kind, at: iso(o.at), value: o.value })),
        } satisfies typeof Body.ActivityReport.Type);
      }),
    );
  }),
);

/**
 * The API's routes and the implementations of its middleware, with the event streams they hold open,
 * which Leaf's farewell ends when it stops.
 */
export const ApiRoutes = HttpApiBuilder.layer(LeafApi, { openapiPath: "/openapi.json" }).pipe(
  Layer.provide([
    SystemHandlers,
    RatesHandlers,
    MeHandlers,
    GameHelloHandlers,
    GameHandlers,
    GameAdminHandlers,
    InternalHandlers,
  ]),
  Layer.provide(GuildFeed.layer),
  Layer.provideMerge(OpenStreams.layer),
  Layer.provide([
    SessionLive,
    PlayerLive,
    BodyLimitLive,
    RerollBodyErrorsLive,
    PresenceBodyErrorsLive,
    PlayBodyErrorsLive,
    RequestBodyErrorsLive,
    BackendLive,
    PurchaseBodyErrorsLive,
    UnexpectedLive,
  ]),
);

/** Any request no route takes, answered in the same `{ "code", "message" }` shape as every other error. */
export const NotFound = HttpRouter.add(
  "*",
  "/*",
  HttpServerResponse.jsonUnsafe({ code: "not_found", message: "No such route" }, { status: 404 }),
);
