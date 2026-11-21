import {
  checkSave,
  currentQuests,
  DAY_MS,
  DEFAULT_RULES,
  levelForXp,
  MAX_SAVE_BYTES,
  nextDailyChargeAt,
  nextTimedWindowAt,
  openQuestBook,
  parsePlayerId,
  type Quest,
  QUEST_SLOTS,
  type QuestSlot,
  refreshQuests,
  rerollCost,
  saveSlot,
  timedWindowAt,
} from "@sequoia-leaf/core";
import { ByteSize, Clock, Duration, Effect, Layer, Option, Redacted, Ref, Schedule, Stream } from "effect";
import { HttpRouter, HttpServerError, HttpServerRequest, HttpServerResponse } from "effect/http";
import { HttpApiBuilder, HttpApiError, HttpApiSecurity } from "effect/http-api";
import { SqlClient } from "effect/sql";

import {
  BodyLimit,
  CurrentIdentity,
  type Identity,
  isGuest,
  LeafApi,
  Player,
  PresenceBodyErrors,
  RerollBodyErrors,
  SaveBodyErrors,
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
  SaveTooLarge,
  SlowDown,
  Unauthorized,
  VersionConflict,
} from "../api/errors.ts";
import type * as Body from "../api/schemas.ts";
import { Identities } from "../auth/session.ts";
import { AppConfig } from "../config.ts";
import { syncOnDemand } from "../earning/run.ts";
import { eventJsonText, Events } from "../events/store.ts";
import { GUILD_EVENT_TYPES, guildEvents } from "../game/guild.ts";
import { PlayerNames } from "../game/names.ts";
import { Presence } from "../game/presence.ts";
import { Saves } from "../game/saves.ts";
import { Skins } from "../game/skins.ts";
import { Ledger } from "../ledger/store.ts";
import { questJson } from "../quests/json.ts";
import { rerollQuestFor } from "../quests/reroll.ts";
import { Quests } from "../quests/store.ts";
import { GuildFeed, OpenStreams, sseFrame, StreamTuning } from "./streams.ts";

/** How far back the list of finished quests reaches. */
const RECENTLY_COMPLETED_MS = 2 * DAY_MS;
/** The most events one answer or one look by a stream returns. */
const EVENT_PAGE = 100;
/** How many events `GET /events` returns when the client does not say where it is. */
const LATEST_EVENTS = 50;
/** The largest body Leaf reads, but for a save's. */
const MAX_BODY = ByteSize.kibibytes(16);
/** The largest save body Leaf reads at all. The save itself is checked against `MAX_SAVE_BYTES`. */
const MAX_SAVE_BODY = ByteSize.bytes(2 * MAX_SAVE_BYTES);

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
const sessionChecks = Effect.gen(function* () {
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

/**
 * A body is read only up to 16 KiB: one larger gets `body_too_large` unread.
 * Saves read up to their own limit, which `SaveBodyErrorsLive` sets inside this one.
 */
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

/**
 * A save body is read only up to twice what a save may hold: one larger gets
 * `save_too_large` unread. One that does not decode as `{ "version", "data" }` gets `invalid_save`.
 */
export const SaveBodyErrorsLive = Layer.succeed(SaveBodyErrors)((httpEffect) =>
  httpEffect.pipe(
    Effect.provideService(HttpServerRequest.MaxBodySize, MAX_SAVE_BODY),
    Effect.catchIf(isPayloadError, () =>
      Effect.fail(
        new Invalid({
          code: "invalid_save",
          message: 'Send the save as { "player": "<your id>", "version": n, "data": { ... } }',
        }),
      ),
    ),
    Effect.catchDefect((defect) =>
      isBodyTooLarge(defect)
        ? Effect.fail(new SaveTooLarge({ code: "save_too_large", message: "A save holds at most 256 KiB" }))
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
        message: 'Send where you are as { "place": "town" }, or camp, works or table, and "stay" as true or false',
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

const invalidAfter = new Invalid({ code: "invalid_after", message: "after must be an event id" });

const MeHandlers = HttpApiBuilder.group(LeafApi, "me", (handlers) =>
  Effect.gen(function* () {
    const ledger = yield* Ledger;
    const quests = yield* Quests;
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

const invalidSlot = new Invalid({ code: "invalid_slot", message: "That is not a save slot" });

/** Refuses a guest what only the guild's members may see: the guild's news, with members' names. */
const membersOnly = Effect.flatMap(CurrentIdentity, (identity) =>
  isGuest(identity)
    ? Effect.fail(new MembersOnly({ code: "members_only", message: "The guild's news is for Sequoia members" }))
    : Effect.void,
);

const GameHandlers = HttpApiBuilder.group(LeafApi, "game", (handlers) =>
  Effect.gen(function* () {
    const ledger = yield* Ledger;
    const events = yield* Events;
    const saves = yield* Saves;
    const skins = yield* Skins;
    const names = yield* PlayerNames;
    const presence = yield* Presence;
    const guild = yield* GuildFeed;
    const streams = yield* OpenStreams;

    return (
      handlers
        .handle("me", () =>
          Effect.gen(function* () {
            const identity = yield* CurrentIdentity;
            if (isGuest(identity)) {
              // A guest has no Leaf, XP or news of the guild's, and nothing is read for them: a
              // former member's ledger is theirs again only when they are a member again.
              return HttpServerResponse.jsonUnsafe({
                player: { id: identity.playerId, username: identity.username },
                rank: null,
                guest: true,
                leaf: 0,
                xp: 0,
                level: levelJson(0),
                event_cursor: 0,
              } satisfies typeof Body.GameMe.Type);
            }
            // The backend vouches for the name, so the guild's news can show it.
            yield* names.remember(identity.playerId, identity.username, yield* Clock.currentTimeMillis);
            // The cursor first: an event is written in the transaction that pays it, so the account
            // read after it holds everything up to the cursor. Something paid in between is in the
            // balance and after the cursor, and the game asks again for nothing; read the other way
            // round, it would be under the cursor and missing from the balance, and never asked for.
            const cursor = yield* events.latestIdOf(identity.playerId);
            const account = yield* ledger.account(identity.playerId);
            return HttpServerResponse.jsonUnsafe({
              player: { id: identity.playerId, username: identity.username },
              rank: identity.guildRank,
              guest: false,
              leaf: account.balance,
              xp: account.xp,
              level: levelJson(account.xp),
              event_cursor: cursor,
            } satisfies typeof Body.GameMe.Type);
          }),
        )
        .handle("saves", () =>
          Effect.gen(function* () {
            const { playerId } = yield* CurrentIdentity;
            const stored = yield* saves.list(playerId);
            return HttpServerResponse.jsonUnsafe({
              saves: stored.map((save) => ({
                slot: save.slot,
                version: save.version,
                updated_at: iso(save.updatedAt),
              })),
            } satisfies typeof Body.SaveList.Type);
          }),
        )
        .handle("save", ({ params }) =>
          Effect.gen(function* () {
            const slot = saveSlot(params.slot);
            if (slot === undefined) {
              return yield* invalidSlot;
            }
            const { playerId } = yield* CurrentIdentity;
            const stored = yield* saves.get(playerId, slot);
            if (Option.isNone(stored)) {
              return yield* new Missing({ code: "no_save", message: "Nothing is saved in that slot" });
            }
            const { version, updatedAt, data } = stored.value;
            // The save is stored as the JSON text it is sent as, so it is spliced in, not parsed.
            const head = JSON.stringify({ slot, version, updated_at: iso(updatedAt) });
            return HttpServerResponse.text(`${head.slice(0, -1)},"data":${data}}`, { contentType: "application/json" });
          }),
        )
        // Writes over the version the game last read, so a game with an older copy, such as
        // one open in another tab, never overwrites a newer save; and only for the member the
        // page believes it is, so a page left open after someone else signed in writes nothing.
        .handle("write", ({ params, payload }) =>
          Effect.gen(function* () {
            const checked = checkSave(params.slot, payload.data);
            if (!checked.ok) {
              if (checked.reason === "invalid_slot") {
                return yield* invalidSlot;
              }
              if (checked.reason === "invalid_save") {
                return yield* new Invalid({ code: "invalid_save", message: "A save's data must be a JSON object" });
              }
              return yield* new SaveTooLarge({ code: "save_too_large", message: "A save holds at most 256 KiB" });
            }
            const identity = yield* CurrentIdentity;
            const { playerId } = identity;
            if (payload.player !== playerId) {
              return yield* new NotYou({
                code: "not_you",
                message: "This page is signed in as someone else now. Load it again",
              });
            }
            const now = yield* Clock.currentTimeMillis;
            const written = yield* saves.put(
              playerId,
              checked.slot,
              payload.version,
              checked.text,
              isGuest(identity),
              now,
            );
            if (written.status === "conflict") {
              return yield* new VersionConflict({
                code: "version_conflict",
                message: "The save changed since it was read. Read it again",
              });
            }
            if (written.status === "slow") {
              return yield* new SlowDown({
                code: "slow_down",
                message: "That slot was saved a moment ago. Send it again in a few seconds",
              });
            }
            return HttpServerResponse.jsonUnsafe({
              version: written.version,
              updated_at: iso(written.updatedAt),
            } satisfies typeof Body.Saved.Type);
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
            const shown =
              after === undefined
                ? yield* events
                    .everyoneLatest(GUILD_EVENT_TYPES, LATEST_EVENTS)
                    .pipe(
                      Effect.flatMap((found) =>
                        Effect.map(names.of(found.map((event) => event.playerId)), (named) =>
                          guildEvents(found, named),
                        ),
                      ),
                    )
                : (yield* guild.after(after)).shown;
            return HttpServerResponse.text(`{"events":[${shown.map((event) => event.json).join(",")}]}`, {
              contentType: "application/json",
            });
          }),
        )
        .handle("guildStream", ({ query }) =>
          Effect.andThen(membersOnly, eventStreamFrom(events, streams, query.after, guild.frames)),
        )
        .handle("presence", ({ payload }) =>
          Effect.gen(function* () {
            const identity = yield* CurrentIdentity;
            const now = yield* Clock.currentTimeMillis;
            const here = yield* presence.arrive(
              identity.playerId,
              identity.username,
              payload.place,
              payload.stay ?? true,
              isGuest(identity),
              now,
            );
            return HttpServerResponse.jsonUnsafe({
              present: here.present.map((player) => ({
                id: player.playerId,
                username: player.username,
                place: player.place,
                guest: player.guest,
              })),
              resting: here.resting.map((player) => ({
                id: player.playerId,
                username: player.username,
                place: player.place,
                guest: player.guest,
                seen_at: iso(player.seenAt),
              })),
            } satisfies typeof Body.Present.Type);
          }),
        )
    );
  }),
);

/** The API's routes and the implementations of its middleware. */
export const ApiRoutes = HttpApiBuilder.layer(LeafApi, { openapiPath: "/openapi.json" }).pipe(
  Layer.provide([SystemHandlers, MeHandlers, GameHelloHandlers, GameHandlers]),
  Layer.provide([OpenStreams.layer, GuildFeed.layer]),
  Layer.provide([
    SessionLive,
    PlayerLive,
    BodyLimitLive,
    RerollBodyErrorsLive,
    SaveBodyErrorsLive,
    PresenceBodyErrorsLive,
    UnexpectedLive,
  ]),
);

/** Any request no route takes, answered in the same `{ "code", "message" }` shape as every other error. */
export const NotFound = HttpRouter.add(
  "*",
  "/*",
  HttpServerResponse.jsonUnsafe({ code: "not_found", message: "No such route" }, { status: 404 }),
);
