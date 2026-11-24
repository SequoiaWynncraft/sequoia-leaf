import { DAY_MS, utcDay } from "@sequoia-leaf/core";
import { Clock, Effect } from "effect";
import { HttpApiBuilder } from "effect/http-api";

import { ActivityReport } from "../../activity/report.ts";
import { CurrentIdentity, LeafApi } from "../../api/api.ts";
import { Invalid, StaffOnly } from "../../api/errors.ts";
import { iso } from "./shared.ts";

/** How many UTC days the staff's report covers when not told, and at most. */
const REPORT_DAYS = 7;
const REPORT_MOST_DAYS = 90;

/** The UTC day a time falls on, as `2026-11-25`. */
const dayName = (at: number) => iso(at).slice(0, 10);

export const GameAdminHandlers = HttpApiBuilder.group(LeafApi, "gameAdmin", (handlers) =>
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
    );
  }),
);
