import { Clock, Effect, Layer } from "effect";
import { HttpApiBuilder } from "effect/http-api";

import { Visits } from "../../activity/visits.ts";
import { CurrentIdentity, type Identity, LeafApi, SittingBodyErrors } from "../../api/api.ts";
import { Invalid, SlowDown } from "../../api/errors.ts";
import { SittingMissing, SittingRefused, SittingUpdating } from "../../api/sittings.ts";
import { type Caller, type Shown, Sittings } from "../../sittings/service.ts";
import { payloadError } from "./middleware.ts";
import { iso, notYou, unreadable } from "./shared.ts";

/** Who calls a sitting, as the sittings service needs to know them. */
const callerOf = (identity: Identity): Caller => ({ playerId: identity.playerId, username: identity.username });

/** A sitting as an answer sends it. */
const shownJson = ({ id, rev, now, view, purse }: Shown) => ({ id, rev, now: iso(now), state: view, purse });

const missing = new SittingMissing({ code: "no_such_sitting", message: "There is no such table" });
/** A table a newer Leaf stored, beside this one in a deploy: the page asks again. */
const updating = new SittingUpdating({
  code: "sitting_updating",
  message: "This table is being updated. Try again in a moment.",
});
const slow = new SlowDown({
  code: "slow_down",
  message: "Commands are coming faster than Leaf takes them. Send them again in a moment",
});

/** The `rev` a page says it has, if it says one that is one. */
const revOf = (rev: string | undefined): number | undefined => (/^\d{1,12}$/.test(rev ?? "") ? Number(rev) : undefined);

/** An opening of a sitting whose body is not `{ "player" }` gets `invalid_command`. */
export const SittingBodyErrorsLive = Layer.succeed(SittingBodyErrors)(
  payloadError(new Invalid({ code: "invalid_command", message: 'Send { "player": "<your id>" } to open a table' })),
);

export const GameSittingsHandlers = HttpApiBuilder.group(LeafApi, "gameSittings", (handlers) =>
  Effect.gen(function* () {
    const sittings = yield* Sittings;
    const visits = yield* Visits;
    return (
      handlers
        .handle("sittings", () =>
          Effect.gen(function* () {
            const { playerId } = yield* CurrentIdentity;
            const { now, open, yours } = yield* sittings.list(playerId);
            const listed = open.map(({ id, by, sat, closes }) => ({ id, by, sat, closes: iso(closes) }));
            return { now: iso(now), open: listed, yours };
          }),
        )
        .handle("openSitting", ({ payload }) =>
          Effect.gen(function* () {
            const identity = yield* CurrentIdentity;
            if (payload.player !== identity.playerId) return yield* notYou;
            const opened = yield* sittings.open(callerOf(identity));
            switch (opened.status) {
              case "shown":
                yield* visits.acted(identity.playerId, yield* Clock.currentTimeMillis);
                return shownJson(opened);
              case "seated_elsewhere":
                return yield* new SittingRefused({ code: "seated_elsewhere", message: "You are at another table." });
              case "full":
                return yield* new SittingRefused({
                  code: "sittings_full",
                  message: "As many tables are going as there may be. Try again in a while",
                });
              case "too_soon":
                return yield* new SlowDown({
                  code: "slow_down",
                  message: "You opened a table a moment ago. Wait a minute",
                });
              case "slow":
                return yield* slow;
            }
          }),
        )
        .handle("sittingRecord", () =>
          Effect.gen(function* () {
            const { playerId } = yield* CurrentIdentity;
            const { played, won, four } = yield* sittings.record(playerId);
            return { played, won, top_four: four };
          }),
        )
        // Brought to Leaf's clock first; with the `rev` the page has and nothing since, answered unchanged.
        .handle("sitting", ({ params, query }) =>
          Effect.gen(function* () {
            const { playerId } = yield* CurrentIdentity;
            const read = yield* sittings.read(params.id, playerId, revOf(query.rev));
            switch (read.status) {
              case "shown":
                return shownJson(read);
              case "unchanged":
                return { id: read.id, rev: read.rev, now: iso(read.now), unchanged: true as const };
              case "missing":
                return yield* missing;
              case "unreadable":
                return yield* unreadable;
              case "updating":
                return yield* updating;
            }
          }),
        )
        // Commands, done in order in one transaction; one whose id was seen before answers as it did then.
        .handle("sittingCommand", ({ params, payload }) =>
          Effect.gen(function* () {
            const identity = yield* CurrentIdentity;
            if (payload.player !== identity.playerId) return yield* notYou;
            const sent = yield* sittings.send(params.id, callerOf(identity), payload.commands);
            switch (sent.status) {
              case "done":
                yield* visits.acted(identity.playerId, yield* Clock.currentTimeMillis);
                return { ...shownJson(sent), results: sent.results };
              case "invalid":
                return yield* new Invalid({ code: "invalid_command", message: sent.why });
              case "missing":
                return yield* missing;
              case "unreadable":
                return yield* unreadable;
              case "updating":
                return yield* updating;
              case "slow":
                return yield* slow;
            }
          }),
        )
    );
  }),
);
