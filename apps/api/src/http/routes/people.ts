import { parsePlayerId } from "@sequoia-leaf/core";
import { BANNERS } from "@sequoia-leaf/pulls";
import { Clock, Effect, Option, Schema } from "effect";
import { HttpServerResponse } from "effect/http";
import { HttpApiBuilder } from "effect/http-api";
import { SqlClient } from "effect/sql";

import { Visits } from "../../activity/visits.ts";
import { CurrentIdentity, isGuest, LeafApi } from "../../api/api.ts";
import { Invalid, Missing } from "../../api/errors.ts";
import { Events } from "../../events/store.ts";
import { GUILD_EVENT_TYPES, guildDay, guildEvents } from "../../game/guild.ts";
import { knownAmong } from "../../game/known.ts";
import { PlayerNames } from "../../game/names.ts";
import { Skins } from "../../game/skins.ts";
import { Ledger } from "../../ledger/store.ts";
import { Coins } from "../../play/coins.ts";
import { PlayStore } from "../../play/store.ts";
import { GuildFeed, OpenStreams } from "../streams.ts";
import {
  BannerPerson,
  eventId,
  eventStreamFrom,
  guildAnswer,
  invalidAfter,
  iso,
  LATEST_EVENTS,
  levelJson,
  membersOnly,
  seconds,
} from "./shared.ts";

/** `GET /v1/game/me`: who is signed in, with their Leaf, Coins and level, and how they signed in. */
const gameMe = ({
  coins,
  names,
  events,
  ledger,
}: {
  readonly coins: Coins["Service"];
  readonly names: PlayerNames["Service"];
  readonly events: Events["Service"];
  readonly ledger: Ledger["Service"];
}) =>
  Effect.gen(function* () {
    const identity = yield* CurrentIdentity;
    // Read only: a player with no Coins account yet is shown the welcome it will open with.
    if (isGuest(identity)) {
      // A guest has their Leaf, to spend on what is for everyone: what they earned as a
      // member, or the staff gave them. They have no XP or news of the guild's.
      const { leaf, coins: held, version } = yield* coins.balances(identity.playerId);
      return {
        player: { id: identity.playerId, username: identity.username },
        rank: null,
        guest: true,
        leaf,
        xp: 0,
        level: levelJson(0),
        event_cursor: 0,
        coins: held,
        version,
        signed_in_with: identity.via,
        ask_link: identity.askLink,
      };
    }
    // The backend vouches for the name, so the guild's news can show it.
    yield* names.remember(identity.playerId, identity.username, yield* Clock.currentTimeMillis);
    // The cursor first: an event is written in the transaction that pays it, so the account
    // read after it holds everything up to the cursor. Something paid in between is in the
    // balance and after the cursor, and the game asks again for nothing; read the other way
    // round, it would be under the cursor and missing from the balance, and never asked for.
    const cursor = yield* events.latestIdOf(identity.playerId);
    const { xp } = yield* ledger.account(identity.playerId);
    const { leaf, coins: held, version } = yield* coins.balances(identity.playerId);
    return {
      player: { id: identity.playerId, username: identity.username },
      rank: identity.guildRank,
      guest: false,
      leaf,
      xp,
      level: levelJson(xp),
      event_cursor: cursor,
      coins: held,
      version,
      signed_in_with: identity.via,
      ask_link: identity.askLink,
    };
  });

export const GamePeopleHandlers = HttpApiBuilder.group(LeafApi, "gamePeople", (handlers) =>
  Effect.gen(function* () {
    const ledger = yield* Ledger;
    const events = yield* Events;
    const skins = yield* Skins;
    const names = yield* PlayerNames;
    const visits = yield* Visits;
    const guild = yield* GuildFeed;
    const streams = yield* OpenStreams;
    const store = yield* PlayStore;
    const coins = yield* Coins;
    const sql = yield* SqlClient.SqlClient;

    return (
      handlers
        .handle("me", () => gameMe({ coins, names, events, ledger }))
        .handle("skin", ({ params }) =>
          Effect.gen(function* () {
            const playerId = parsePlayerId(params.uuid);
            if (playerId === undefined) {
              return yield* new Invalid({ code: "invalid_uuid", message: "That is not a Minecraft UUID" });
            }
            const { playerId: asker } = yield* CurrentIdentity;
            const sheet = yield* skins.sheet(playerId, asker, yield* Clock.currentTimeMillis);
            if (Option.isNone(sheet)) {
              return yield* new Missing({ code: "no_skin", message: "No skin for that player" });
            }
            return HttpServerResponse.uint8Array(sheet.value, {
              contentType: "image/png",
              headers: { "cache-control": "private, max-age=86400" },
            });
          }),
        )
        .handle("guildEvents", ({ query }) =>
          Effect.gen(function* () {
            yield* membersOnly;
            const after = eventId(query.after);
            if (after === null) {
              return yield* invalidAfter;
            }
            if (after !== undefined) {
              return guildAnswer((yield* guild.after(after)).shown);
            }
            // The newest events and the day as of one moment, so that whatever is in neither is heard after them.
            const [found, day] = yield* sql
              .withTransaction(
                Effect.all([
                  events.everyoneLatest(GUILD_EVENT_TYPES, LATEST_EVENTS),
                  guildDay(yield* Clock.currentTimeMillis),
                ]),
              )
              .pipe(Effect.orDie);
            return guildAnswer(guildEvents(found, yield* names.of(found.map((event) => event.playerId))), `,${day}`);
          }),
        )
        .handle("guildStream", ({ query }) =>
          Effect.andThen(membersOnly, eventStreamFrom(events, streams, query.after, guild.frames)),
        )
        // Somebody Leaf knows, or the caller (as for a skin), named as the board names them, where they
        // stand in each game, how long they have played each and been in it AFK (`Visits`), and the
        // Coins each has taken.
        .handle("person", ({ params }) =>
          Effect.gen(function* () {
            const player = parsePlayerId(params.player);
            const { playerId: asker } = yield* CurrentIdentity;
            const known =
              player === asker ||
              (player !== undefined && (yield* knownAmong(sql, [player], yield* Clock.currentTimeMillis)).has(player));
            if (player === undefined || !known) {
              return yield* new Missing({ code: "no_such_player", message: "Leaf does not know that player" });
            }
            const named = yield* names.of([player]);
            const standings = yield* store.standingsOf(player);
            const times = yield* visits.timeOf(player);
            const spent = yield* coins.spentOf(player);
            // A game they have been in for less than a second shows nothing, as one never opened.
            const timed = [...times]
              .filter(([, time]) => seconds(time.played) > 0 || seconds(time.afk) > 0)
              .map(([game]) => game);
            const games = [...new Set([...standings.keys(), ...timed])].toSorted();
            const all = (of: "played" | "afk") => seconds([...times.values()].reduce((sum, time) => sum + time[of], 0));
            return {
              id: player,
              name: named.get(player) ?? "Someone",
              games: Object.fromEntries(
                games.map((game) => [
                  game,
                  {
                    ...standings.get(game),
                    played: seconds(times.get(game)?.played ?? 0),
                    afk: seconds(times.get(game)?.afk ?? 0),
                    spent: spent.get(game) ?? 0,
                  },
                ]),
              ),
              played: all("played"),
              afk: all("afk"),
            };
          }),
        )
        // Every pull banner and its headliner, named as the boards name players.
        .handle("banners", () =>
          Effect.gen(function* () {
            const rows = yield* sql`SELECT banner, player_id AS playerId FROM banner_people`.pipe(
              Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(BannerPerson))),
              Effect.orDie,
            );
            // Put in by hand: a row whose id is not a player's names nobody.
            const people = new Map(
              rows.flatMap(({ banner, playerId }) => {
                const id = parsePlayerId(playerId);
                return id === undefined ? [] : [[banner, id] as const];
              }),
            );
            const named = yield* names.of([...people.values()]);
            return {
              banners: BANNERS.map(({ id, from, until }) => {
                const person = people.get(id);
                return {
                  id,
                  from: iso(from),
                  until: iso(until),
                  headliner: person === undefined ? null : { id: person, name: named.get(person) ?? "Someone" },
                };
              }),
            };
          }),
        )
    );
  }),
);
