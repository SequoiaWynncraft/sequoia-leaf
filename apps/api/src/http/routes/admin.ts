import { DAY_MS, parsePlayerId, utcDay } from "@sequoia-leaf/core";
import { Clock, Effect } from "effect";
import { HttpApiBuilder } from "effect/http-api";

import { ActivityReport } from "../../activity/report.ts";
import { CurrentIdentity, LeafApi } from "../../api/api.ts";
import { GrantRefused, Invalid, Missing, SlowDown, StaffOnly } from "../../api/errors.ts";
import type { GrantBody } from "../../api/schemas.ts";
import { PlayerNames } from "../../game/names.ts";
import { grantPrize, namedOf, type NotGranted, prizeNamed } from "../../play/grant.ts";
import { iso, unreadable } from "./shared.ts";

/** How many UTC days the staff's report covers when not told, and at most. */
const REPORT_DAYS = 7;
const REPORT_MOST_DAYS = 90;

/** The UTC day a time falls on, as `2026-11-25`. */
const dayName = (at: number) => iso(at).slice(0, 10);

/** A UTC day as staff read it: `8 December`, with the year when it is not this one. */
function dayWords(at: number, now: number): string {
  const sameYear = new Date(at).getUTCFullYear() === new Date(now).getUTCFullYear();
  return new Date(at).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    ...(sameYear ? {} : { year: "numeric" }),
    timeZone: "UTC",
  });
}

const staffOnly = new StaffOnly({ code: "staff_only", message: "This is for the guild's staff" });
const invalidGrant = (message: string) => new Invalid({ code: "invalid_grant", message });

/** A grant not made, as its answer. */
function notGranted(no: NotGranted, now: number) {
  switch (no.why) {
    case "no_such_player":
      return new Missing({ code: "no_such_player", message: "Leaf does not know that player" });
    case "no_such_prize":
      return new GrantRefused({ code: "no_such_prize", message: "No release has that prize." });
    case "not_released":
      return new GrantRefused({ code: "not_released", message: `Not released until ${dayWords(no.opens, now)}.` });
    case "unreadable":
      return unreadable;
    case "slow":
      return new SlowDown({
        code: "slow_down",
        message: "Their commands are coming faster than Leaf takes them. Ask again in a moment",
      });
  }
}

/** A grant asked for by the staff (`POST /v1/game/admin/grants`), and what it did or would do. */
const granting = (payload: typeof GrantBody.Type) =>
  Effect.gen(function* () {
    const identity = yield* CurrentIdentity;
    if (!identity.admin) return yield* staffOnly;
    const player = parsePlayerId(payload.player);
    if (player === undefined) return yield* invalidGrant("player must be a Leaf id");
    const named = namedOf(payload);
    if (named === null) {
      return yield* invalidGrant('Name one prize: "figure" with a figure\'s id, or "banner" for its headliner');
    }
    const prize = prizeNamed(named);
    if (prize === null)
      return yield* new GrantRefused({ code: "no_such_prize", message: "No release has that prize." });
    const copies = payload.copies ?? 1;
    const dry = payload.dry ?? false;
    const by = { id: identity.playerId, name: identity.username };
    const made = yield* grantPrize(player, prize, copies, by, dry);
    if ("why" in made) return yield* notGranted(made, yield* Clock.currentTimeMillis);
    const name = made.name ?? (yield* (yield* PlayerNames).of([player])).get(player) ?? "Someone";
    const { rarity, had, have, awards } = made;
    return { dry, player: { id: player, name }, prize, rarity, copies, had, have, awards, by, at: iso(made.at) };
  });

export const GameAdminHandlers = HttpApiBuilder.group(LeafApi, "gameAdmin", (handlers) =>
  Effect.gen(function* () {
    const reports = yield* ActivityReport;
    return (
      handlers
        .handle("activity", ({ query }) =>
          Effect.gen(function* () {
            const identity = yield* CurrentIdentity;
            if (!identity.admin) {
              return yield* staffOnly;
            }
            const asked =
              query.days === undefined ? REPORT_DAYS : /^\d{1,9}$/.test(query.days) ? Number(query.days) : 0;
            if (asked < 1) {
              return yield* new Invalid({
                code: "invalid_days",
                message: "days must be a whole number of days, 1 or more",
              });
            }
            const days = Math.min(asked, REPORT_MOST_DAYS);
            const now = yield* Clock.currentTimeMillis;
            const r = yield* reports.report((utcDay(now) - days + 1) * DAY_MS, now);
            return {
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
            };
          }),
        )
        // A pull prize given by hand, as a pull gives it (`grantPrize`), or with `dry` what that would do.
        .handle("grant", ({ payload }) => granting(payload))
    );
  }),
);
