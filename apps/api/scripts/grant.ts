/**
 * Gives a player a pull prize from where Leaf runs, as the staff route does (`POST
 * /v1/game/admin/grants`), for whoever can run commands beside the server:
 *
 *     bun apps/api/scripts/grant.ts <player id> figure=<figure id> | banner=<banner id> by=<staff Leaf id> [copies=1] [dry]
 *
 * It is Leaf's own grant (`src/play/grant.ts`) on Leaf's own database (`DATABASE_PATH`), with the
 * running server: each write to a player's state is kept only over the `rev` it was made from, so
 * the two never write over each other. `by` is the staff member it is given as, logged with it.
 * Prints what it did, or with `dry` what it would do, as one line of JSON.
 */
import { BunRuntime } from "@effect/platform-bun";
import { parsePlayerId } from "@sequoia-leaf/core";
import { Clock, Effect } from "effect";

import { Services } from "../src/app.ts";
import { PlayerNames } from "../src/game/names.ts";
import { grantPrize, namedOf, prizeNamed } from "../src/play/grant.ts";

const args = process.argv.slice(2);
const option = (name: string): string | undefined => args.find((a) => a.startsWith(`${name}=`))?.slice(name.length + 1);
const usage = "bun apps/api/scripts/grant.ts <player id> figure=<id> | banner=<id> by=<staff Leaf id> [copies=1] [dry]";

const main = Effect.gen(function* () {
  const player = parsePlayerId(args.find((a) => !a.includes("=") && a !== "dry") ?? "");
  const by = parsePlayerId(option("by") ?? "");
  const named = namedOf({ figure: option("figure"), banner: option("banner") });
  const copies = Number(option("copies") ?? 1);
  if (player === undefined || by === undefined || named === null || !Number.isInteger(copies)) {
    return yield* Effect.die(new Error(usage));
  }
  const prize = prizeNamed(named);
  if (prize === null) return yield* Effect.die(new Error("No release has that prize."));
  const name = (yield* (yield* PlayerNames).of([by])).get(by) ?? "Leaf's staff";
  const made = yield* grantPrize(player, prize, copies, { id: by, name }, args.includes("dry"));
  const at = new Date(yield* Clock.currentTimeMillis).toISOString();
  console.log(JSON.stringify({ ...made, player, prize, copies, by: { id: by, name }, at }));
});

BunRuntime.runMain(main.pipe(Effect.provide(Services)));
