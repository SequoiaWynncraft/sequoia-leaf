import {
  currentQuests,
  DAY_MS,
  DEFAULT_RULES,
  levelForXp,
  nextDailyChargeAt,
  nextTimedWindowAt,
  openQuestBook,
  type Quest,
  QUEST_SLOTS,
  type QuestSlot,
  refreshQuests,
  rerollCost,
  timedWindowAt,
} from "@sequoia-leaf/core";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";

import { identify, type Identity, sessionToken } from "../auth/session.ts";
import { syncOnDemand } from "../earning/run.ts";
import { eventJsonText, latestEventId, listEventsAfter, listLatestEvents } from "../events/store.ts";
import { getAccount } from "../ledger/store.ts";
import { questJson } from "../quests/json.ts";
import { rerollQuestFor, rerollsOnDay } from "../quests/reroll.ts";
import { listCompletedSince, loadQuestBook } from "../quests/store.ts";
import type { Services } from "../services.ts";

/** How far back the list of finished quests reaches. */
const RECENTLY_COMPLETED_MS = 2 * DAY_MS;

/** How the event stream paces itself. Tests shorten these. */
export interface StreamTuning {
  /** How often an open stream looks for new events. */
  readonly pollMs: number;
  /** A stream with nothing to send writes a comment this often, so proxies keep the connection open. */
  readonly heartbeatMs: number;
  /** A stream is closed after this long. The client reconnects, which checks its session again. */
  readonly maxMs: number;
}

export const DEFAULT_STREAM_TUNING: StreamTuning = { pollMs: 2_000, heartbeatMs: 20_000, maxMs: 15 * 60_000 };

/** The most events one answer or one look by a stream returns. */
const EVENT_PAGE = 100;
/** How many events `GET /events` returns when the client does not say where it is. */
const LATEST_EVENTS = 50;

/** A quest in progress as `/quests` sends it: with `reroll_leaf`, what rerolling it costs now, or null when it can't be. */
function questOnOffer(quest: Quest, rerollsToday: ReadonlyMap<QuestSlot, number>) {
  return Object.assign(questJson(quest), {
    reroll_leaf: rerollCost(quest, rerollsToday.get(quest.slot) ?? 0, DEFAULT_RULES.quests),
  });
}

const REROLL_REFUSALS = {
  not_current: "That quest is no longer in its slot. Refresh your quests",
  not_rerollable: "That quest can't be rerolled",
  cost_changed: "Rerolling it costs something else now. Refresh your quests",
  insufficient_leaf: "You don't have enough Leaf to reroll it",
} as const;

/** A field of a parsed JSON body, or undefined when the body is not an object or lacks it. */
function field(body: unknown, key: string): unknown {
  return typeof body === "object" && body !== null ? Object.getOwnPropertyDescriptor(body, key)?.value : undefined;
}

/** Reads an event id sent by a client. Undefined means it sent none; null means it sent something that is not one. */
function eventId(value: string | undefined): number | null | undefined {
  if (value === undefined || value === "") {
    return undefined;
  }
  return /^\d{1,15}$/.test(value) ? Number(value) : null;
}

/** Routes about the signed-in player. Every one needs a Sequoia session of a current guild member. */
export function meRoutes(
  services: Services,
  tuning: StreamTuning = DEFAULT_STREAM_TUNING,
): Hono<{ Variables: { identity: Identity } }> {
  const { db } = services;
  const me = new Hono<{ Variables: { identity: Identity } }>();

  me.use(async (c, next) => {
    const token = sessionToken(c.req.raw.headers);
    if (token === undefined) {
      return c.json({ code: "unauthorized", message: "Sign in with your Sequoia account" }, 401);
    }
    const result = await identify(services.fetcher, services.backend.url, token, services.now());
    if (result.status === "unauthorized") {
      return c.json({ code: "unauthorized", message: "Your session has expired. Sign in again" }, 401);
    }
    if (result.status === "unavailable") {
      return c.json({ code: "identity_unavailable", message: "Could not check your session. Try again shortly" }, 503);
    }
    if (result.identity.guildRank === null && !result.identity.admin) {
      return c.json({ code: "not_a_member", message: "Leaf is for current Sequoia members" }, 403);
    }
    c.set("identity", result.identity);
    return next();
  });

  me.get("/", (c) => {
    const identity = c.var.identity;
    const account = getAccount(db, identity.playerId);
    const level = levelForXp(account.xp, DEFAULT_RULES.levels);
    return c.json({
      player: { id: identity.playerId, username: identity.username },
      leaf: account.balance,
      xp: account.xp,
      level: {
        number: level.level,
        xp_into_level: level.xpIntoLevel,
        xp_for_next_level: level.xpForNextLevel,
      },
    });
  });

  me.get("/quests", async (c) => {
    const identity = c.var.identity;
    if (c.req.query("sync") === "1") {
      await syncOnDemand(services);
    }
    const now = services.now();
    const stored = loadQuestBook(db, identity.playerId);
    const completed = listCompletedSince(db, identity.playerId, now - RECENTLY_COMPLETED_MS);
    // The stored book is as of the player's last activity or reroll. Bringing it
    // up to now is a pure calculation; only the credit sync and rerolls write quests.
    const { book } = refreshQuests(stored ?? openQuestBook(now), identity.playerId, now, DEFAULT_RULES.quests);
    const nextCharge = nextDailyChargeAt(book, DEFAULT_RULES.quests);
    const timedRules = DEFAULT_RULES.quests.timed;
    const window = timedRules === undefined ? undefined : timedWindowAt(now, timedRules);
    const rerolls = rerollsOnDay(db, identity.playerId, now);
    return c.json({
      daily: {
        charges: book.dailyCharges,
        charge_cap: DEFAULT_RULES.quests.dailyChargeCap,
        next_charge_at: nextCharge === null ? null : iso(nextCharge),
      },
      // When the open timed quest ends (null between windows) and when the next one opens.
      timed:
        timedRules === undefined
          ? null
          : {
              ends_at: window === undefined ? null : iso(window.end),
              next_at: iso(nextTimedWindowAt(now, timedRules)),
            },
      quests: currentQuests(book, now).map((quest) => questOnOffer(quest, rerolls)),
      recently_completed: completed.map(questJson),
    });
  });

  // Swaps a quest in progress for another. The id is the one `/quests` gave,
  // so a request sent twice swaps once.
  me.post("/quests/:id/reroll", async (c) => {
    const id = /^([a-z]+):(\d{1,9})$/.exec(c.req.param("id"));
    const slot = QUEST_SLOTS.find((each): each is QuestSlot => each === id?.[1]);
    if (id === null || slot === undefined) {
      return c.json({ code: "invalid_quest", message: "That is not a quest id" }, 400);
    }
    // The cost the member was shown and agreed to: Leaf charges that or nothing.
    const agreed = field(await c.req.json().catch(() => undefined), "leaf");
    if (typeof agreed !== "number" || !Number.isSafeInteger(agreed) || agreed < 0) {
      return c.json({ code: "invalid_cost", message: 'Send the cost you agreed to as { "leaf": n }' }, 400);
    }
    const identity = c.var.identity;
    // A quest just finished is paid rather than swapped away.
    await syncOnDemand(services);
    const result = rerollQuestFor(
      db,
      identity.playerId,
      slot,
      Number(id[2]),
      agreed,
      services.now(),
      DEFAULT_RULES.quests,
    );
    if (result.status === "refused") {
      return c.json({ code: result.reason, message: REROLL_REFUSALS[result.reason] }, 409);
    }
    return c.json({
      leaf: result.balance,
      spent: result.spent,
      quest: questOnOffer(result.quest, rerollsOnDay(db, identity.playerId, services.now())),
    });
  });

  me.get("/events", (c) => {
    const after = eventId(c.req.query("after"));
    if (after === null) {
      return c.json({ code: "invalid_after", message: "after must be an event id" }, 400);
    }
    const playerId = c.var.identity.playerId;
    const events =
      after === undefined
        ? listLatestEvents(db, playerId, LATEST_EVENTS)
        : listEventsAfter(db, playerId, after, EVENT_PAGE);
    return c.body(`{"events":[${events.map(eventJsonText).join(",")}]}`, 200, {
      "Content-Type": "application/json",
    });
  });

  // Server-sent events. A client that reconnects sends the last id it saw as
  // `Last-Event-ID` (browsers do this by themselves) and gets what it missed;
  // a client that sends none gets only what happens from now on.
  me.get("/events/stream", (c) => {
    const resumeFrom = eventId(c.req.header("Last-Event-ID") ?? c.req.query("after"));
    if (resumeFrom === null) {
      return c.json({ code: "invalid_after", message: "after must be an event id" }, 400);
    }
    const playerId = c.var.identity.playerId;
    let after = resumeFrom ?? latestEventId(db);
    return streamSSE(c, async (stream) => {
      // The stream finds new events by looking in the database, not by being
      // told, so it also sees events written by another process: during a
      // deploy the old and the new container run side by side.
      /* oxlint-disable no-await-in-loop -- each write and each wait must finish before the next */
      // The first frame carries the starting position as its id, so a client
      // whose stream ends before any event arrives still reconnects from here
      // and gets what happened in between.
      await stream.write(`id: ${after}\nretry: 3000\n\n`);
      let quietMs = 0;
      for (let openMs = 0; openMs < tuning.maxMs && !stream.aborted; openMs += tuning.pollMs) {
        const events = listEventsAfter(db, playerId, after, EVENT_PAGE);
        for (const event of events) {
          await stream.writeSSE({ id: String(event.id), event: event.type, data: eventJsonText(event) });
          after = event.id;
        }
        if (events.length > 0) {
          quietMs = 0;
        } else if (quietMs >= tuning.heartbeatMs) {
          await stream.write(": keep-alive\n\n");
          quietMs = 0;
        }
        await stream.sleep(tuning.pollMs);
        quietMs += tuning.pollMs;
      }
      /* oxlint-enable no-await-in-loop */
    });
  });

  return me;
}

function iso(at: number): string {
  return new Date(at).toISOString();
}
