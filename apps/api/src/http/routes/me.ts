import {
  currentQuests,
  DEFAULT_RULES,
  nextDailyChargeAt,
  nextTimedWindowAt,
  openQuestBook,
  PURSE_HEADER,
  QUEST_SLOTS,
  type QuestSlot,
  refreshQuests,
  timedWindowAt,
} from "@sequoia-leaf/core";
import { Clock, Effect } from "effect";
import { HttpServerResponse } from "effect/http";
import { HttpApiBuilder, HttpApiSchema } from "effect/http-api";

import { CurrentIdentity, LeafApi } from "../../api/api.ts";
import { Invalid, Refused } from "../../api/errors.ts";
import { Credits } from "../../earning/run.ts";
import { eventJsonText, Events } from "../../events/store.ts";
import { Ledger } from "../../ledger/store.ts";
import { Coins } from "../../play/coins.ts";
import { questJson } from "../../quests/json.ts";
import { rerollQuestFor } from "../../quests/reroll.ts";
import { Quests } from "../../quests/store.ts";
import { OpenStreams, sseFrame, StreamTuning } from "../streams.ts";
import {
  EVENT_PAGE,
  eventId,
  eventStreamFrom,
  invalidAfter,
  iso,
  LATEST_EVENTS,
  levelJson,
  polled,
  questOnOffer,
  RECENTLY_COMPLETED_MS,
  REFUSALS,
} from "./shared.ts";

export const MeHandlers = HttpApiBuilder.group(LeafApi, "me", (handlers) =>
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
            return {
              player: { id: identity.playerId, username: identity.username },
              leaf: account.balance,
              xp: account.xp,
              level: levelJson(account.xp),
            };
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
                return HttpApiSchema.withHeaders({
                  body: {
                    leaf: result.balance,
                    spent: result.spent,
                    quest: questOnOffer(result.quest, yield* quests.rerollsOnDay(playerId, now)),
                  },
                  headers: { [PURSE_HEADER]: yield* coins.balances(playerId) },
                });
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
