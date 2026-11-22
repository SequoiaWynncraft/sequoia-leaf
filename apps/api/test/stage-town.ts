/**
 * Staging a moment in Tester's town and camp, for the screenshot tours: what play does not reach by
 * itself quickly (a lived-in camp, a caller waiting, a time away, a full mailbox, Coins to shop
 * with). Only the play server on this machine (`play.ts`) serves it, at `POST /test/play/town`; the
 * guild's own Leaf has no such route.
 *
 * Each step: `{ fresh: true }` puts a new member's town in its place (the next visit is a first
 * one), its counter going on from the old one's so that no id or Coins key is made twice; `{ lived: true }`
 * sets out about forty things, puts some in the tray, and leaves three parcels by the trail and a
 * pet chosen; `{ caller: true }` has the next caller set out at the next look; `{ away: minutes }`
 * has the member last here that long ago, on another UTC day; `{ mailbox: "full" }` fills the
 * mailbox with letters that each hold a present; `{ coins: n }` puts n Coins in the purse.
 * `{ others: [n, ...] }` gives the nth of `others` a camp of their own with that many more things
 * set out (at most the thirty-one a lived-in camp has) and a pet, on the town's board.
 * `{ won: [award, ...] }` gives Tester awards as another game would have (`pull:thing:fountain`), and
 * `{ headliner: n }` makes the nth of `others` the person of the pull game's first banner.
 * `{ timed: true }`, between the guild's timed windows, hands Tester the next window's timed quest
 * now, open for a window's length, so the quest board has one of each kind at any hour; in a window
 * Tester has one already.
 */
import {
  DAY_MS,
  DEFAULT_RULES,
  nextTimedWindowAt,
  openQuestBook,
  type PlayerId,
  type Quest,
  timedTemplateFor,
  timedWindowAt,
} from "@sequoia-leaf/core";
import { TOWN, type Town } from "@sequoia-leaf/town";
import { freeSpot, PETS } from "@sequoia-leaf/town/camp.ts";
import { GIFTS } from "@sequoia-leaf/town/folk.ts";
import { BOX, letter } from "@sequoia-leaf/town/mail.ts";
import { Effect, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";

import { Quests } from "../src/quests/store.ts";
import type { Other } from "./stage-works.ts";

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const whole = (v: unknown, most: number): number | null =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= most ? v : null;

/** What a lived-in camp has set out, a few of each, round the fire and along the yard. */
const LIVED = [
  "lantern-post",
  "lantern-post",
  "paper-lantern",
  "candle-stump",
  "bench",
  "rocker",
  "picnic",
  "rug-woven",
  "flower-pot",
  "flower-pot",
  "potted-fern",
  "sunflower",
  "toadstool",
  "berry-bush",
  "pumpkin",
  "worm-pot",
  "barrel",
  "gnome",
  "gnome-fishing",
  "crab-statue",
  "wind-chime",
  "birdhouse",
  "bird-bath",
  "well",
  "pennant",
  "bunting",
  "weathervane",
  "picket",
  "picket",
  "log-fence",
  "stepping-stones",
] as const;

/** Sets the things of a lived-in camp out where each fits (the first `many` of them), from spots spread over the yard. */
function liveIn(s: Town, many: number = LIVED.length): void {
  LIVED.slice(0, many).forEach((id, i) => {
    const near = { x: 8 + ((i * 7) % 36), y: 17 + ((i * 5) % 18) };
    const spot = freeSpot(s.camp.placed, id, near);
    if (spot) s.camp.placed.push({ n: s.made++, id, x: spot.x, y: spot.y, t: 0, s: i % 3 === 0 ? 1 : 0 });
  });
  s.camp.tray = { cushion: 2, glowcap: 1, "rug-moss": 1 };
  s.camp.parcels = ["lantern-post", "toadstool", "sapling"];
  s.camp.first = "cat";
  s.camp.greeted = Math.max(s.camp.greeted, 2);
}

/** Does one staging step to a town. */
function step(s: Town, op: Record<string, unknown>, now: number): void {
  if (op.lived === true) liveIn(s);
  if (op.caller === true) s.nextCall = now;
  const away = whole(op.away, 30 * 24 * 60);
  if (away !== null) {
    s.seenAt = Math.max(1, now - away * 60_000);
    s.welcomedDay = Math.floor((now - DAY_MS) / DAY_MS);
  }
  if (op.mailbox === "full")
    for (let i = s.camp.letters.length; i < BOX; i++)
      s.camp.letters.push(
        letter(
          `stage-${now}-${i}`,
          "Pipwick",
          "Left this where the gnome couldn't get it.",
          GIFTS[i % GIFTS.length] ?? "pinecone",
        ),
      );
}

/** Hands a player the next timed window's quest now, if no window is open (`{ timed: true }`). */
const timedEarly = (playerId: PlayerId, now: number) =>
  Effect.gen(function* () {
    const rules = DEFAULT_RULES.quests;
    const timed = rules.timed;
    if (timed === undefined || timedWindowAt(now, timed) !== undefined) return;
    const template = timedTemplateFor(rules, Math.floor(nextTimedWindowAt(now, timed) / timed.everyMs));
    if (template === undefined) return;
    const quests = yield* Quests;
    const book = (yield* quests.book(playerId)) ?? openQuestBook(now);
    const quest: Quest = {
      slot: "timed",
      sequence: (book.latest.timed?.sequence ?? 0) + 1,
      templateId: template.id,
      goals: template.objectives.map((objective) => ({ objective, progress: 0 })),
      reward: template.reward,
      startedAt: now,
      expiresAt: now + timed.openMs,
      completedAt: null,
    };
    yield* quests.saveStep(playerId, { book, written: [quest], completed: [] }, now);
  });

/** Stages each step in order in Tester's town, as one change, and gives back what is waiting at the camp. */
export const stageTown = (playerId: PlayerId, ops: readonly unknown[], others: readonly Other[]) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const now = Date.now();
    for (const op of ops) {
      if (!isRecord(op) || !Array.isArray(op.others)) continue;
      for (const [i, other] of others.entries()) {
        const many = whole(op.others[i], LIVED.length);
        if (many === null) continue;
        const s = TOWN.create({ now, player: other, seed: 20_261_122 + i, room: 0, awards: [] });
        liveIn(s, many);
        s.camp.first = PETS[i % PETS.length] ?? "cat";
        const standing = TOWN.standing?.(s) ?? { score: 0, also: {} };
        yield* sql`INSERT OR REPLACE INTO play_state (player_id, game, rev, state, updated_at) VALUES (${other.id}, 'town', 1, ${TOWN.encode(s)}, ${now})`;
        yield* sql`
          INSERT OR REPLACE INTO standings (player_id, game, score, also, guest, updated_at)
          VALUES (${other.id}, 'town', ${standing.score}, ${JSON.stringify(standing.also)}, ${other.guest ? 1 : 0}, ${now})
        `;
      }
    }
    for (const op of ops) {
      if (!isRecord(op)) continue;
      for (const id of Array.isArray(op.won) ? op.won : []) {
        if (typeof id !== "string") continue;
        yield* sql`INSERT INTO awards (player_id, id, at) VALUES (${playerId}, ${id}, ${now}) ON CONFLICT DO NOTHING`;
      }
      if (op.timed === true) yield* timedEarly(playerId, now);
      const person = others[whole(op.headliner, others.length) ?? -1];
      if (person) {
        yield* sql`INSERT OR REPLACE INTO banner_people (banner, player_id) VALUES ('banner-1', ${person.id})`;
      }
    }
    for (const op of ops) {
      const coins = isRecord(op) ? whole(op.coins, 1e6) : null;
      if (coins === null || coins === 0) continue;
      // The account opened as Leaf opens one, with the welcome, if it was not already.
      yield* sql`INSERT OR IGNORE INTO coins (player_id, balance) VALUES (${playerId}, 0)`;
      yield* sql`
        INSERT INTO coin_entries (player_id, amount, reason, game, key, at, earned)
        VALUES (${playerId}, 300, 'Welcome to Guild Town', NULL, ${`welcome:${playerId}`}, ${now}, 0)
        ON CONFLICT (key) DO NOTHING
      `;
      yield* sql`
        INSERT INTO coin_entries (player_id, amount, reason, game, key, at, earned)
        VALUES (${playerId}, ${coins}, 'Staged for a tour', NULL, ${`stage:${playerId}:${now}:${coins}`}, ${now}, 0)
      `;
    }
    const stored = yield* SqlSchema.findOneOption({
      Request: Schema.String,
      Result: Schema.Struct({ rev: Schema.Int, state: Schema.String }),
      execute: (player) => sql`SELECT rev, state FROM play_state WHERE player_id = ${player} AND game = 'town'`,
    })(playerId);
    const kept = Option.isSome(stored) ? TOWN.decode(stored.value.state) : null;
    const created = (): Town => {
      const fresh = TOWN.create({ now, player: { id: playerId, guest: false }, seed: 20_261_122, room: 0, awards: [] });
      fresh.made = Math.max(fresh.made, kept?.made ?? 0);
      return fresh;
    };
    let s = kept ?? created();
    for (const op of ops) {
      if (!isRecord(op)) continue;
      if (op.fresh === true) s = created();
      step(s, op, now);
    }
    const text = TOWN.encode(s);
    if (Option.isSome(stored)) {
      yield* sql`UPDATE play_state SET rev = rev + 1, state = ${text}, updated_at = ${now} WHERE player_id = ${playerId} AND game = 'town'`;
    } else {
      yield* sql`INSERT INTO play_state (player_id, game, rev, state, updated_at) VALUES (${playerId}, 'town', 1, ${text}, ${now})`;
    }
    return { placed: s.camp.placed.length, parcels: s.camp.parcels.length, letters: s.camp.letters.length };
  });
