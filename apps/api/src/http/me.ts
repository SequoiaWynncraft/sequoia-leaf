import {
  currentQuests,
  DAY_MS,
  DEFAULT_RULES,
  levelForXp,
  nextDailyChargeAt,
  openQuestBook,
  type Quest,
  questTitle,
  refreshQuests,
} from "@sequoia-leaf/core";
import { Hono } from "hono";

import { identify, type Identity, sessionToken } from "../auth/session.ts";
import { syncOnDemand } from "../earning/run.ts";
import { getAccount } from "../ledger/store.ts";
import { listCompletedSince, loadQuestBook } from "../quests/store.ts";
import type { Services } from "../services.ts";

/** How far back the list of finished quests reaches. */
const RECENTLY_COMPLETED_MS = 2 * DAY_MS;

/** Routes about the signed-in player. Every one needs a Sequoia session of a current guild member. */
export function meRoutes(services: Services): Hono<{ Variables: { identity: Identity } }> {
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
    // The stored book is as of the player's last activity. Bringing it up to now
    // is a pure calculation; only the credit sync writes quests.
    const { book } = refreshQuests(stored ?? openQuestBook(now), identity.playerId, now, DEFAULT_RULES.quests);
    const nextCharge = nextDailyChargeAt(book, DEFAULT_RULES.quests);
    return c.json({
      daily: {
        charges: book.dailyCharges,
        charge_cap: DEFAULT_RULES.quests.dailyChargeCap,
        next_charge_at: nextCharge === null ? null : iso(nextCharge),
      },
      quests: currentQuests(book, now).map(questJson),
      recently_completed: completed.map(questJson),
    });
  });

  return me;
}

function questJson(quest: Quest) {
  return {
    id: `${quest.slot}:${quest.sequence}`,
    slot: quest.slot,
    title: questTitle(quest.objective),
    objective: {
      type: quest.objective.type,
      raid: quest.objective.type === "raids" ? (quest.objective.raid ?? null) : null,
    },
    progress: quest.progress,
    target: quest.objective.count,
    reward: { leaf: quest.reward.leaf, xp: quest.reward.xp },
    started_at: iso(quest.startedAt),
    expires_at: quest.expiresAt === null ? null : iso(quest.expiresAt),
    completed_at: quest.completedAt === null ? null : iso(quest.completedAt),
  };
}

function iso(at: number): string {
  return new Date(at).toISOString();
}
