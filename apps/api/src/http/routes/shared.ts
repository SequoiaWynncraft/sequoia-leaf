import { DAY_MS, DEFAULT_RULES, gameId, levelForXp, type Quest, type QuestSlot, rerollCost } from "@sequoia-leaf/core";
import { Effect, Schema, type Stream } from "effect";
import { HttpServerRequest, HttpServerResponse } from "effect/http";

import { CurrentIdentity, type Identity, isGuest } from "../../api/api.ts";
import { Invalid, MembersOnly, Missing, NotYou, StateUnreadable } from "../../api/errors.ts";
import type { Events } from "../../events/store.ts";
import { type GuildEvent } from "../../game/guild.ts";
import { GAMES, type Played } from "../../play/games.ts";
import { type Playing } from "../../play/service.ts";
import { questJson } from "../../quests/json.ts";
import type { OpenStreams } from "../streams.ts";

/** How far back the list of finished quests reaches. */
export const RECENTLY_COMPLETED_MS = 2 * DAY_MS;
/** The most events one answer or one look by a stream returns. */
export const EVENT_PAGE = 100;
/** How many events `GET /events` returns when the client does not say where it is. */
export const LATEST_EVENTS = 50;

/** What a member is told when Leaf refuses a reroll, by the refusal's code. */
export const REFUSALS = {
  not_current: "That quest is no longer in its slot. Refresh your quests",
  not_rerollable: "That quest can't be rerolled",
  cost_changed: "Rerolling it costs something else now. Refresh your quests",
  insufficient_leaf: "You don't have enough Leaf to reroll it",
} as const;

/** A quest in progress as `/quests` sends it: with `reroll_leaf`, what rerolling it costs now, or null when it can't be. */
export function questOnOffer(quest: Quest, rerollsToday: ReadonlyMap<QuestSlot, number>) {
  return {
    ...questJson(quest),
    reroll_leaf: rerollCost(quest, rerollsToday.get(quest.slot) ?? 0, DEFAULT_RULES.quests),
  };
}

/** Reads an event id sent by a client. Undefined means it sent none; null means it sent something that is not one. */
export function eventId(value: string | undefined): number | null | undefined {
  if (value === undefined || value === "") {
    return undefined;
  }
  return /^\d{1,15}$/.test(value) ? Number(value) : null;
}

export function iso(at: number): string {
  return new Date(at).toISOString();
}

/** A member's level as the API sends it. */
export function levelJson(xp: number) {
  const level = levelForXp(xp, DEFAULT_RULES.levels);
  return { number: level.level, xp_into_level: level.xpIntoLevel, xp_for_next_level: level.xpForNextLevel };
}

export const invalidAfter = new Invalid({ code: "invalid_after", message: "after must be an event id" });

/**
 * Answers a request for an event stream. A client that reconnects sends the
 * last id it saw as `Last-Event-ID` (browsers do this by themselves), or as
 * `?after=`, and gets what it missed; a client that sends none gets only what
 * happens from now on. `frames` are the stream's frames from a position. It is
 * counted among the member's open streams.
 */
export const eventStreamFrom = (
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

/**
 * A write from a page that believes it is another player than the session's, such as one left open
 * after someone else signed in: nothing is done.
 */
export const notYou = new NotYou({
  code: "not_you",
  message: "This page is signed in as someone else now. Load it again",
});

/** A player's stored state that does not read: nothing is done, and it is kept. */
export const unreadable = new StateUnreadable({
  code: "state_unreadable",
  message: "Your game could not be read. It has been kept; tell the guild",
});

/** Milliseconds as whole seconds. */
export const seconds = (ms: number): number => Math.floor(ms / 1000);

/** A row of `banner_people`: a banner, and the player who is its headliner. */
export const BannerPerson = Schema.Struct({ banner: Schema.String, playerId: Schema.String });
/** A row of `banner_called`: a banner, a seat of the four it calls, and the player in it. */
export const BannerCalled = Schema.Struct({ banner: Schema.String, seat: Schema.Number, playerId: Schema.String });

/** Who calls a game, as the play service needs to know them. */
export const playingOf = (identity: Identity): Playing => ({ playerId: identity.playerId, guest: isGuest(identity) });

/** The game a route names, if Leaf plays it. */
export const playedGame = (name: string): Effect.Effect<Played, Missing> => {
  const id = gameId(name);
  const played = id === undefined ? undefined : GAMES[id];
  return played === undefined
    ? Effect.fail(new Missing({ code: "no_such_game", message: "Leaf does not play that game" }))
    : Effect.succeed(played);
};

/** The guild's events as the answer's JSON, with whatever follows them in it. */
export const guildAnswer = (shown: readonly GuildEvent[], rest = "}") =>
  HttpServerResponse.text(`{"events":[${shown.map((event) => event.json).join(",")}]${rest}`, {
    contentType: "application/json",
  });

/** Refuses a guest what only the guild's members may see: the guild's news, with members' names. */
export const membersOnly = Effect.flatMap(CurrentIdentity, (identity) =>
  isGuest(identity)
    ? Effect.fail(new MembersOnly({ code: "members_only", message: "The guild's news is for Sequoia members" }))
    : Effect.void,
);

/** Who may buy the guild's requests: not a guest, whom the backend is never asked about. */
export const requestsFor = Effect.flatMap(CurrentIdentity, (identity) =>
  isGuest(identity)
    ? Effect.fail(new MembersOnly({ code: "members_only", message: "For guild members with 7 days in the guild." }))
    : Effect.succeed(identity),
);
