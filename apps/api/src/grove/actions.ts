import {
  announcesCone,
  bannerAt,
  type CareTool,
  type ConePull,
  type GroveRules,
  leaf,
  openCones,
  type PlayerId,
  rankOfSpirit,
  ROLL_RANGE,
  spendCharge,
} from "@sequoia-leaf/core";
import { Effect, Random } from "effect";
import { SqlClient } from "effect/sql";

import { Events } from "../events/store.ts";
import { Ledger } from "../ledger/store.ts";
import { Grove, type GroveMember, type StoredOpening } from "./store.ts";

// What members do in the Grove. Each action is one transaction, and each names the
// request it answers, so a request sent twice does what it does once.

/** Why the Grove refuses a request. Nothing is written when it does. */
export type GroveRefusal =
  /** The balance doesn't cover the cones. */
  | "insufficient_leaf"
  /** The request id was used before for a different request. */
  | "request_conflict"
  /** The member holds fewer cones than they asked to open. */
  | "not_enough_cones"
  /** No care charge is left; one comes back after a while. */
  | "no_charges"
  /** No banner is on, so no cone can be opened. */
  | "no_banner"
  /** The member has never opened that spirit. */
  | "not_owned";

export type Refused = { readonly status: "refused"; readonly reason: GroveRefusal };

const refused = (reason: GroveRefusal): Refused => ({ status: "refused", reason });

/** Who is in the Grove: their id and the name they signed in with. */
export interface Visitor {
  readonly playerId: PlayerId;
  readonly username: string;
}

/**
 * The member's Grove record, made the first time they come, which gives them
 * their spot in the Forest. A member already known under the same name needs
 * no write, which is every visit after the first.
 */
export const enterGrove = Effect.fn("enterGrove")(function* (visitor: Visitor, now: number) {
  const grove = yield* Grove;
  const known = yield* grove.member(visitor.playerId);
  if (known !== undefined && known.username === visitor.username) {
    return known;
  }
  const sql = yield* SqlClient.SqlClient;
  return yield* sql.withTransaction(grove.visit(visitor.playerId, visitor.username, now)).pipe(Effect.orDie);
});

/**
 * Gives the tree care with a tool: spends a charge and adds Bloom, which gives
 * a cone when it fills. A request sent again changes nothing, and answers
 * with the charges and Bloom as they are now.
 */
export const careForTree = Effect.fn("careForTree")(function* (
  visitor: Visitor,
  tool: CareTool,
  requestId: string,
  now: number,
  rules: GroveRules,
) {
  const sql = yield* SqlClient.SqlClient;
  const grove = yield* Grove;
  const events = yield* Events;
  return yield* sql
    .withTransaction(
      Effect.gen(function* () {
        const member = yield* grove.visit(visitor.playerId, visitor.username, now);
        const earlier = yield* grove.careFor(visitor.playerId, requestId);
        if (earlier !== undefined) {
          return earlier === tool ? { status: "repeated" as const, member } : refused("request_conflict");
        }
        const anchor = spendCharge(member.chargeAnchor, now, rules);
        if (anchor === null) {
          return refused("no_charges");
        }
        yield* grove.recordCare(visitor.playerId, requestId, tool, anchor, now);
        const cycles = yield* grove.addBloom(
          visitor.playerId,
          `care:${visitor.playerId}:${requestId}`,
          "care",
          rules.careBloom,
          now,
          rules,
        );
        for (const cycle of cycles) {
          yield* events.insert(visitor.playerId, { type: "grove.bloomed", data: { source: "care", cycle } }, now);
        }
        return { status: "cared" as const, member: { ...member, chargeAnchor: anchor }, bloomed: cycles.length };
      }),
    )
    .pipe(Effect.orDie);
});

/**
 * Buys cones for Leaf, through the ledger, keyed by the member's request. A
 * request sent again spends nothing more and grants no more cones.
 */
export const buyCones = Effect.fn("buyCones")(function* (
  visitor: Visitor,
  count: number,
  requestId: string,
  now: number,
  rules: GroveRules,
) {
  const sql = yield* SqlClient.SqlClient;
  const grove = yield* Grove;
  const ledger = yield* Ledger;
  return yield* sql
    .withTransaction(
      Effect.gen(function* () {
        yield* grove.visit(visitor.playerId, visitor.username, now);
        const spent = count * rules.conePrice;
        const posted = yield* ledger.post(
          {
            kind: "spend",
            playerId: visitor.playerId,
            amount: leaf(spent),
            sink: "cone",
            idempotencyKey: `cone:${visitor.playerId}:${requestId}`,
            memo: `${count} cone${count === 1 ? "" : "s"}`,
          },
          now,
        );
        if (posted.status === "rejected") {
          return refused(posted.reason === "insufficient_leaf" ? "insufficient_leaf" : "request_conflict");
        }
        if (posted.status === "posted") {
          yield* grove.grantCones(visitor.playerId, `buy:${visitor.playerId}:${requestId}`, "bought", count, now);
        }
        return {
          status: "bought" as const,
          spent,
          balance: (yield* ledger.account(visitor.playerId)).balance,
          cones: yield* grove.cones(visitor.playerId),
        };
      }),
    )
    .pipe(Effect.orDie);
});

export type Opened = {
  readonly status: "opened";
  readonly banner: string;
  readonly pulls: readonly ConePull[];
  readonly cones: number;
};

/**
 * Opens cones the member holds on the banner that is on. The server rolls
 * each cone, and pity carries over from the member's last cone, whichever
 * banner it was on. Every cone is stored with its roll under the request, so
 * the same request sent again answers with the same cones and opens no more.
 * A cone of the announced ranks is told to the Forest as an event.
 */
export const openConesFor = Effect.fn("openConesFor")(function* (
  visitor: Visitor,
  count: number,
  requestId: string,
  now: number,
  rules: GroveRules,
): Effect.fn.Return<Opened | Refused, never, SqlClient.SqlClient | Grove | Events> {
  const sql = yield* SqlClient.SqlClient;
  const grove = yield* Grove;
  const events = yield* Events;
  const playerId = visitor.playerId;
  return yield* sql
    .withTransaction(
      Effect.gen(function* () {
        yield* grove.visit(playerId, visitor.username, now);
        const earlier = yield* grove.openings(playerId, requestId);
        if (earlier.length > 0) {
          return earlier.length === count ? opened(earlier, yield* grove.cones(playerId)) : refused("request_conflict");
        }
        const banner = bannerAt(now, rules);
        if (banner === undefined) {
          return refused("no_banner");
        }
        const held = yield* grove.cones(playerId);
        if (held < count) {
          return refused("not_enough_cones");
        }
        const rolls: number[] = [];
        for (let cone = 0; cone < count; cone += 1) {
          rolls.push(yield* Random.nextIntBetween(0, ROLL_RANGE, { halfOpen: true }));
        }
        const copies = new Map(
          (yield* grove.collection(playerId)).map((found) => [found.spirit, found.copies] as const),
        );
        const pulls = openCones(yield* grove.pity(playerId), rolls, copies, banner, rules);
        yield* grove.recordOpenings(playerId, requestId, banner.id, pulls, now);
        for (const pull of pulls.filter((each) => announcesCone(each.rank, rules))) {
          yield* events.insert(
            playerId,
            {
              type: "grove.cone_opened",
              data: { banner: banner.id, spirit: pull.spirit, rank: pull.rank, verdant: pull.verdant, copy: pull.copy },
            },
            now,
          );
        }
        return { status: "opened", banner: banner.id, pulls, cones: held - count } satisfies Opened;
      }),
    )
    .pipe(Effect.orDie);
});

function opened(stored: readonly StoredOpening[], cones: number): Opened {
  return { status: "opened", banner: stored[0]?.banner ?? "", pulls: stored, cones };
}

/** Chooses the spirit that follows the member, one they have opened, or none. */
export const chooseCompanion = Effect.fn("chooseCompanion")(function* (
  visitor: Visitor,
  spirit: string | null,
  now: number,
  rules: GroveRules,
) {
  const sql = yield* SqlClient.SqlClient;
  const grove = yield* Grove;
  return yield* sql
    .withTransaction(
      Effect.gen(function* () {
        const member: GroveMember = yield* grove.visit(visitor.playerId, visitor.username, now);
        if (spirit !== null) {
          const owned = (yield* grove.collection(visitor.playerId)).some((found) => found.spirit === spirit);
          if (rankOfSpirit(spirit, rules) === undefined || !owned) {
            return refused("not_owned");
          }
        }
        yield* grove.setCompanion(visitor.playerId, spirit);
        return { status: "chosen" as const, member: { ...member, companion: spirit } };
      }),
    )
    .pipe(Effect.orDie);
});
