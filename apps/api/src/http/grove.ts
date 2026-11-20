import {
  bannerAt,
  bloomFrom,
  bondOf,
  CARE_TOOLS,
  chargesAt,
  type ConePull,
  DEFAULT_RULES,
  type GroveRules,
  ODDS_SCALE,
  rankOfSpirit,
  rateCard,
  treeOf,
} from "@sequoia-leaf/core";
import { Clock, Effect, Layer } from "effect";
import { HttpServerResponse } from "effect/http";
import { HttpApiBuilder, HttpApiError } from "effect/http-api";

import { CurrentIdentity, GroveBodyErrors, LeafApi } from "../api/api.ts";
import { GroveInvalid, GroveRefused } from "../api/errors.ts";
import type * as Body from "../api/schemas.ts";
import {
  buyCones,
  careForTree,
  chooseCompanion,
  enterGrove,
  type GroveRefusal,
  openConesFor,
  type Refused,
} from "../grove/actions.ts";
import { Grove, type GroveMember } from "../grove/store.ts";
import { Ledger } from "../ledger/store.ts";

const rules: GroveRules = DEFAULT_RULES.grove;

/** What a member is told when the Grove refuses a request, by the refusal's code. */
const REFUSALS: Record<GroveRefusal, string> = {
  insufficient_leaf: "You don't have enough Leaf for that",
  request_conflict: "That request id was already used for something else. Send a new one",
  not_enough_cones: "You don't have enough cones to open",
  no_charges: "Your tree has had all the care it can take for now. A charge comes back soon",
  no_banner: "No banner is on, so cones can't be opened yet",
  not_owned: "You haven't found that spirit yet",
};

const refusal = ({ reason }: Refused) => new GroveRefused({ code: reason, message: REFUSALS[reason] });

const invalidCount = new GroveInvalid({
  code: "invalid_request",
  message: `count must be one of ${rules.coneBatches.join(", ")}`,
});

/** A Grove request whose body does not decode gets `invalid_request`. */
export const GroveBodyErrorsLive = Layer.succeed(GroveBodyErrors)((httpEffect) =>
  Effect.catchIf(
    httpEffect,
    (error) => HttpApiError.HttpApiSchemaError.is(error) && error.kind === "Payload",
    () =>
      Effect.fail(
        new GroveInvalid({
          code: "invalid_request",
          message: "That body isn't what this route takes (see /openapi.json)",
        }),
      ),
  ),
);

function iso(at: number): string {
  return new Date(at).toISOString();
}

function chargesJson(member: GroveMember, now: number) {
  const { charges, nextAt } = chargesAt(member.chargeAnchor, now, rules);
  return { count: charges, max: rules.chargeMax, next_at: nextAt === null ? null : iso(nextAt) };
}

function bloomJson(gained: number) {
  return { value: bloomFrom(gained, rules).bloom, max: rules.bloomMax };
}

function pityJson(count: number) {
  return { count, cones: rules.pity.cones, rank: rules.pity.rank };
}

function pullJson(pull: ConePull) {
  return {
    spirit: pull.spirit,
    rank: pull.rank,
    verdant: pull.verdant,
    guaranteed: pull.guaranteed,
    featured: pull.featured,
    copy: pull.copy,
    bond: bondOf(pull.copy, rules),
  };
}

// Handlers answer with their JSON themselves, checked against the schemas when the
// code compiles (see handlers.ts).

export const GroveHandlers = HttpApiBuilder.group(LeafApi, "grove", (handlers) =>
  Effect.gen(function* () {
    const grove = yield* Grove;
    const ledger = yield* Ledger;
    return handlers
      .handle("grove", () =>
        Effect.gen(function* () {
          const identity = yield* CurrentIdentity;
          const now = yield* Clock.currentTimeMillis;
          const member = yield* enterGrove(identity, now);
          const account = yield* ledger.account(identity.playerId);
          const tree = treeOf(identity.playerId, account.xp, DEFAULT_RULES.levels, rules);
          const banner = bannerAt(now, rules);
          const collection = yield* grove.collection(identity.playerId);
          return HttpServerResponse.jsonUnsafe({
            player: { id: identity.playerId, username: identity.username },
            leaf: account.balance,
            tree: { level: tree.level, variant: tree.variant, spot: member.spot },
            bloom: bloomJson(yield* grove.bloomGained(identity.playerId)),
            charges: chargesJson(member, now),
            cones: yield* grove.cones(identity.playerId),
            pity: pityJson(yield* grove.pity(identity.playerId)),
            banner: banner === undefined ? null : { id: banner.id, title: banner.title, featured: banner.featured },
            collection: collection.flatMap((found) => {
              const rank = rankOfSpirit(found.spirit, rules);
              return rank === undefined ? [] : [{ ...found, rank, bond: bondOf(found.copies, rules) }];
            }),
            companion: member.companion,
          } satisfies typeof Body.GroveMe.Type);
        }),
      )
      .handle("care", ({ payload }) =>
        Effect.gen(function* () {
          const identity = yield* CurrentIdentity;
          const now = yield* Clock.currentTimeMillis;
          const result = yield* careForTree(identity, payload.tool, payload.request_id, now, rules);
          if (result.status === "refused") {
            return yield* refusal(result);
          }
          return HttpServerResponse.jsonUnsafe({
            charges: chargesJson(result.member, now),
            bloom: bloomJson(yield* grove.bloomGained(identity.playerId)),
            cones: yield* grove.cones(identity.playerId),
            bloomed: result.status === "cared" ? result.bloomed : 0,
          } satisfies typeof Body.Cared.Type);
        }),
      )
      .handle("buy", ({ payload }) =>
        Effect.gen(function* () {
          if (!rules.coneBatches.includes(payload.count)) {
            return yield* invalidCount;
          }
          const identity = yield* CurrentIdentity;
          const now = yield* Clock.currentTimeMillis;
          const result = yield* buyCones(identity, payload.count, payload.request_id, now, rules);
          if (result.status === "refused") {
            return yield* refusal(result);
          }
          return HttpServerResponse.jsonUnsafe({
            leaf: result.balance,
            spent: result.spent,
            cones: result.cones,
          } satisfies typeof Body.ConesBought.Type);
        }),
      )
      .handle("open", ({ payload }) =>
        Effect.gen(function* () {
          if (!rules.coneBatches.includes(payload.count)) {
            return yield* invalidCount;
          }
          const identity = yield* CurrentIdentity;
          const now = yield* Clock.currentTimeMillis;
          const result = yield* openConesFor(identity, payload.count, payload.request_id, now, rules);
          if (result.status === "refused") {
            return yield* refusal(result);
          }
          return HttpServerResponse.jsonUnsafe({
            banner: result.banner,
            opened: result.pulls.map(pullJson),
            pity: pityJson(result.pulls.at(-1)?.pityAfter ?? 0),
            cones: result.cones,
          } satisfies typeof Body.ConesOpened.Type);
        }),
      )
      .handle("companion", ({ payload }) =>
        Effect.gen(function* () {
          const identity = yield* CurrentIdentity;
          const now = yield* Clock.currentTimeMillis;
          const result = yield* chooseCompanion(identity, payload.spirit, now, rules);
          if (result.status === "refused") {
            return yield* refusal(result);
          }
          return HttpServerResponse.jsonUnsafe({
            companion: result.member.companion,
          } satisfies typeof Body.Companion.Type);
        }),
      );
  }),
);

export const ForestHandlers = HttpApiBuilder.group(LeafApi, "forest", (handlers) =>
  Effect.gen(function* () {
    const grove = yield* Grove;
    return handlers
      .handle("rates", () =>
        Effect.gen(function* () {
          const banner = bannerAt(yield* Clock.currentTimeMillis, rules);
          const card = rateCard(banner, rules);
          return HttpServerResponse.jsonUnsafe({
            banner:
              banner === undefined
                ? null
                : {
                    id: banner.id,
                    title: banner.title,
                    featured: banner.featured,
                    featured_share: banner.featuredShare / ODDS_SCALE,
                    starts_at: iso(banner.from),
                  },
            cone_price: rules.conePrice,
            batches: rules.coneBatches,
            ranks: card.ranks.map((rank) => ({
              rank: rank.rank,
              name: rank.name,
              chance: rank.chance,
              spirits: rank.spirits.map((spirit) => ({ id: spirit.spirit, chance: spirit.chance })),
            })),
            pity: { cones: card.pity.cones, rank: card.pity.rank },
            verdant: card.verdant,
            bloom: { max: rules.bloomMax, per_raid: rules.raidBloom, per_care: rules.careBloom },
            care: { charge_seconds: rules.chargeSeconds, charge_max: rules.chargeMax, tools: CARE_TOOLS },
          } satisfies typeof Body.Rates.Type);
        }),
      )
      .handle("forest", () =>
        Effect.gen(function* () {
          const trees = yield* grove.forest;
          return HttpServerResponse.jsonUnsafe({
            trees: trees.map((tree) => {
              const { level, variant } = treeOf(tree.playerId, tree.xp, DEFAULT_RULES.levels, rules);
              return {
                player_id: tree.playerId,
                name: tree.username,
                level,
                variant,
                spot: tree.spot,
                companion: tree.companion,
              };
            }),
          } satisfies typeof Body.Forest.Type);
        }),
      );
  }),
);
