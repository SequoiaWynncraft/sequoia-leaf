/**
 * Brings named players' Little Raid and Coins over from the old saves to Leaf, once, by hand:
 *
 *   bun apps/api/tools/once/import-raid.ts <database file> <player id>... [--write] [--force]
 *
 * It opens the database as it is, running no migration, and does nothing if Leaf's play tables are
 * not there. For each player it reads their old `raid` slot (the run in progress and the almanac)
 * and their Coins from the old `purse` slot, with the loaders the battler had (`raid-old.ts`), and
 * prints what it found for a person to check: the trail, room, resolve, level and experience,
 * acorns, the figures with their stars and items, the item bench, the boons, the picks waiting, the
 * almanac, and the old Coins (beside them any the Works kept under its own old keys, which are not
 * brought over). Anything past what play reaches (`REACH`: Coins 20,000, acorns 150, a figure above
 * three stars, more figures than the level fields, more than three items on a figure, a room past
 * the fifteenth, more picks waiting than a room gives) is a warning line, and that part is not
 * written unless `--force` is given; forced, it is brought within reach as printed.
 *
 * Nothing drawn is trusted from an old save: the run keeps what the player has, and the stall, who
 * waits in the room, what the picks offer and every seed are drawn afresh from Leaf's dice. A run
 * saved mid-fight is back to planning that room.
 *
 * Nothing is written without `--write`. With it, the two parts go independently, each in its own
 * transaction:
 * - the Coins, as one ledger entry keyed `import:<player>`, added once whatever other entries the
 *   player has: the old Coins, less the welcome when Leaf gave it (it stands for the 300 the old
 *   purse opened with), and never taking the balance below nothing;
 * - the raid, as the player's `raid` play state, unless that state has been played on Leaf
 *   (`rev` above 0); `--force` writes over it even then.
 *
 * It takes players' ids, and has no "everyone". The play service never reads the old saves; this
 * tool and `raid-old.ts` are deleted in the change after they have run.
 */
import { parsePlayerId, type PlayerId } from "@sequoia-leaf/core";
import {
  type Almanac,
  FIGURES,
  type Looks,
  newAlmanac,
  newLooks,
  RAID,
  ROOM_COUNT,
  type Run,
  type Table,
  trailOpen,
  TRAILS,
} from "@sequoia-leaf/raid";
import { Effect, ManagedRuntime, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";

import { databaseAsItIs } from "../../src/db.ts";
import { WELCOME_COINS } from "../../src/play/coins.ts";
import { keysOf, OLD_KEYS, oldAlmanac, oldCoins, oldRun, oldWorksCoins, REACH } from "./raid-old.ts";

export interface ImportOptions {
  /** Store what was found. Without it nothing is written. */
  readonly write: boolean;
  /** Write a part that holds what play cannot reach, and a raid over one played on Leaf since. */
  readonly force: boolean;
  /** When it is written, for the rows. */
  readonly now: number;
  /** A fresh 32-bit number from Leaf's dice, for each seed and stream drawn afresh. */
  readonly dice: () => number;
}

const USAGE = "Usage: bun apps/api/tools/once/import-raid.ts <database file> <player id>... [--write] [--force]";

/** The tables the tool reads and writes; without them Leaf's play service has not been set up on the file. */
const TABLES = ["saves", "play_state", "coins", "coin_entries"] as const;

/** A whole number from the machine's own randomness. */
export const machineDice = (): number => crypto.getRandomValues(new Uint32Array(1))[0] ?? 0;

const Slot = Schema.Struct({ data: Schema.String });
const Rev = Schema.Struct({ rev: Schema.Int });
const Balance = Schema.Struct({ balance: Schema.Int });
const Name = Schema.Struct({ name: Schema.String });

const n = (v: number): string => v.toLocaleString("en-GB");
const stars = (count: number): string => "*".repeat(count);
const figures = (pieces: readonly (Run["board"][number] | undefined)[]): string =>
  pieces
    .flatMap((p) =>
      p ? [`${FIGURES[p.kind].name} ${stars(p.stars)}${p.items.length > 0 ? ` (${p.items.join("+")})` : ""}`] : [],
    )
    .join(", ") || "nobody";

/** The Coins the Works kept itself under its old keys, among a slot's texts. */
const worksCoinsIn = (slot: string, texts: Readonly<Record<string, string>>) =>
  oldWorksCoins(texts).map(({ key, coins }) => ({ slot, key, coins }));

/** The Coins the Works kept itself, found in a slot, as a line. */
const worksLine = (found: readonly { slot: string; key: string; coins: number }[]): string =>
  `  the Works' own: ${
    found.map((f) => `${n(f.coins)} (${f.key}, ${f.slot} slot)`).join("; ") || "none kept"
  }; not brought over`;

/** What a person checks: one player's table and Coins, in a few lines. */
function summary(
  player: PlayerId,
  run: Run | null,
  almanac: Almanac,
  coins: number | null,
  works: readonly { slot: string; key: string; coins: number }[],
): string[] {
  const lines = [`${player}:`];
  if (run) {
    lines.push(
      `  run: ${TRAILS[run.trail]?.name ?? `trail ${run.trail}`}, room ${run.room + 1} of ${ROOM_COUNT}, ` +
        `resolve ${run.resolve}, level ${run.level} (${run.xp} xp), ${run.acorns} acorns`,
      `  board: ${figures(run.board)}`,
      `  bench: ${figures(run.bench)}`,
      `  item bench: ${run.items.join(", ") || "none"}; boons: ${run.boons.join(", ") || "none"}`,
      `  drawn afresh: the stall, who waits in the room, picks waiting (${
        run.choices.map((c) => c.kind).join(", ") || "none"
      })`,
    );
  } else lines.push("  run: none laid out");
  lines.push(
    `  almanac: ${almanac.runs} runs, ${almanac.fielded.length} figures fielded, ${almanac.threeStars.length} at three stars, ` +
      `${almanac.forged.length} items forged, ${almanac.topped.length} traits topped; bosses ${almanac.bosses
        .map((b) => b.length)
        .join("/")}; furthest ${almanac.best.join("/")}`,
    `  old Coins: ${coins === null ? "none kept" : n(coins)} (the purse's)`,
    worksLine(works),
  );
  return lines;
}

type Outcome = "written" | "dry" | "skipped";

/**
 * Brings the named players over, printing what it finds for each. Gives back how many were not
 * brought over whole (or, without `write`, would not be).
 */
export async function importRaid(
  file: string,
  ids: readonly string[],
  options: ImportOptions,
  print: (line: string) => void,
): Promise<number> {
  if (!(await Bun.file(file).exists())) {
    print(`${file}: no such database file. Nothing done.`);
    return ids.length;
  }
  const runtime = ManagedRuntime.make(databaseAsItIs(file));
  try {
    const outcomes = await runtime.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const tables = yield* SqlSchema.findAll({
          Request: Schema.Void,
          Result: Name,
          execute: () => sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ${sql.in(TABLES)}`,
        })(undefined);
        const missing = TABLES.filter((table) => !tables.some((t) => t.name === table));
        if (missing.length > 0) {
          print(`${file}: no ${missing.join(", ")}: Leaf's play service is not set up on it. Nothing done.`);
          return ids.map((): Outcome => "skipped");
        }
        const slotOf = SqlSchema.findOneOption({
          Request: Schema.Struct({ playerId: Schema.String, slot: Schema.String }),
          Result: Slot,
          execute: ({ playerId, slot }) => sql`SELECT data FROM saves WHERE player_id = ${playerId} AND slot = ${slot}`,
        });
        const revOf = SqlSchema.findOneOption({
          Request: Schema.String,
          Result: Rev,
          execute: (playerId) => sql`SELECT rev FROM play_state WHERE player_id = ${playerId} AND game = 'raid'`,
        });
        const balanceOf = SqlSchema.findOneOption({
          Request: Schema.String,
          Result: Balance,
          execute: (playerId) => sql`SELECT balance FROM coins WHERE player_id = ${playerId}`,
        });
        const postedOf = SqlSchema.findAll({
          Request: Schema.String,
          Result: Schema.Struct({ key: Schema.String }),
          execute: (key) => sql`SELECT key FROM coin_entries WHERE key = ${key}`,
        });

        /** Writes one player's table, unless it has been played on Leaf since and it is not forced. */
        const writeRaid = (player: PlayerId, table: Table) =>
          sql.withTransaction(
            Effect.gen(function* () {
              const text = RAID.encode(table);
              if (RAID.decode(text) === null) return "raid not written: the table it made does not read back";
              const rev = yield* revOf(player);
              if (Option.isNone(rev)) {
                yield* sql`
                  INSERT INTO play_state (player_id, game, rev, state, updated_at)
                  VALUES (${player}, 'raid', 1, ${text}, ${options.now})
                `;
                return "raid written";
              }
              const was = rev.value.rev;
              if (was > 0 && !options.force) {
                return `raid not written: they have played on Leaf since (rev ${was}); --force writes over it`;
              }
              yield* sql`
                UPDATE play_state SET rev = ${was + 1}, state = ${text}, updated_at = ${options.now}
                WHERE player_id = ${player} AND game = 'raid' AND rev = ${was}
              `;
              return was > 0 ? `raid written over rev ${was}` : "raid written";
            }),
          );

        /** Adds one player's old Coins, once, whatever other entries they have. */
        const addCoins = (player: PlayerId, coins: number) =>
          sql.withTransaction(
            Effect.gen(function* () {
              const key = `import:${player}`;
              if ((yield* postedOf(key)).length > 0) return "Coins already added";
              const welcomed = (yield* postedOf(`welcome:${player}`)).length > 0;
              const balance = Option.match(yield* balanceOf(player), { onNone: () => 0, onSome: (b) => b.balance });
              // The welcome stands for the 300 the old purse opened with; the balance never goes below nothing.
              const amount = Math.max(coins - (welcomed ? WELCOME_COINS : 0), -balance);
              yield* sql`
                INSERT INTO coin_entries (player_id, amount, reason, game, key, at)
                VALUES (${player}, ${amount}, 'Coins brought over from the old purse', NULL, ${key}, ${options.now})
              `;
              return `Coins added: ${n(amount)}${welcomed ? ` (${n(coins)} less the welcome)` : ""}, balance ${n(balance + amount)}`;
            }),
          );

        const one = (id: string) =>
          Effect.gen(function* () {
            const player = parsePlayerId(id);
            if (player === undefined) {
              print(`${id}: not a player id; skipped`);
              return "skipped" satisfies Outcome;
            }
            const raid = yield* slotOf({ playerId: player, slot: "raid" });
            const purse = yield* slotOf({ playerId: player, slot: "purse" });
            const yard = yield* slotOf({ playerId: player, slot: "works" });
            const keys = Option.isSome(raid) ? keysOf(raid.value.data) : {};
            const purseKeys = Option.isSome(purse) ? keysOf(purse.value.data) : {};
            const worksKeys = Option.isSome(yard) ? (keysOf(yard.value.data) ?? {}) : {};
            // Wherever the Works kept Coins of its own: printed beside the purse's, never brought over.
            const works = [...worksCoinsIn("purse", purseKeys ?? {}), ...worksCoinsIn("works", worksKeys)];
            if (Option.isNone(raid) && Option.isNone(purse)) {
              print(`${player}: nothing saved; skipped`);
              if (works.length > 0) print(worksLine(works));
              return "skipped" satisfies Outcome;
            }
            if (keys === null || purseKeys === null) {
              print(`${player}: nonsense: a slot that is not a save; skipped`);
              return "skipped" satisfies Outcome;
            }
            const raidWarnings: string[] = [];
            const changed: string[] = [];
            let run: Run | null = null;
            const runText = keys[OLD_KEYS.run];
            if (runText !== undefined) {
              const read = oldRun(runText, options.dice());
              if (!read.ok) {
                print(`${player}: nonsense: the run in progress does not read (${read.why}); skipped`);
                return "skipped" satisfies Outcome;
              }
              raidWarnings.push(...read.warnings);
              changed.push(...read.changed);
              // The battler let go of a run that was over.
              run = read.run.phase === "over" ? null : read.run;
            }
            const almanacText = keys[OLD_KEYS.almanac];
            const almanac = almanacText === undefined ? newAlmanac() : oldAlmanac(almanacText);
            if (almanac === null) {
              print(`${player}: nonsense: the almanac does not read; skipped`);
              return "skipped" satisfies Outcome;
            }
            if (run && !trailOpen(almanac, run.trail)) raidWarnings.push("a run on a trail the almanac has not opened");
            const purseText = purseKeys[OLD_KEYS.purse];
            const coins = purseText === undefined ? null : oldCoins(purseText);
            const coinWarnings =
              coins !== null && coins > REACH.coins ? [`${n(coins)} Coins; play reaches about ${n(REACH.coins)}`] : [];
            for (const line of summary(player, run, almanac, coins, works)) print(line);
            for (const warning of [...raidWarnings, ...coinWarnings]) print(`  WARNING: ${warning}`);
            for (const change of changed) print(`  brought within reach: ${change}`);
            const hasRaid = runText !== undefined || almanacText !== undefined;
            const raidHeld = raidWarnings.length > 0 && !options.force;
            const coinsHeld = coinWarnings.length > 0 && !options.force;
            if (raidHeld) print("  raid held back: it holds what play cannot reach; --force brings it over as shown");
            if (coinsHeld) print("  Coins held back: more than play reaches; --force adds them");
            if (!options.write) {
              print("  nothing written: give --write to write it");
              return raidHeld || coinsHeld ? ("skipped" satisfies Outcome) : ("dry" satisfies Outcome);
            }
            let whole = !raidHeld && !coinsHeld;
            if (coins !== null && !coinsHeld) print(`  ${yield* addCoins(player, coins)}`);
            if (hasRaid && !raidHeld) {
              const looks: Looks = newLooks();
              const table: Table = {
                rng: options.dice(),
                runs: almanac.runs + (run ? 1 : 0),
                run,
                almanac,
                trail: run && trailOpen(almanac, run.trail) ? run.trail : 0,
                looks,
              };
              const written = yield* writeRaid(player, table);
              print(`  ${written}`);
              if (!written.startsWith("raid written")) whole = false;
            }
            return whole ? ("written" satisfies Outcome) : ("skipped" satisfies Outcome);
          });

        const each: Outcome[] = [];
        for (const id of ids) each.push(yield* one(id));
        return each;
      }),
    );
    return outcomes.filter((o) => o === "skipped").length;
  } finally {
    await runtime.dispose();
  }
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const flags = new Set(args.filter((a) => a.startsWith("--")));
  const [file, ...ids] = args.filter((a) => !a.startsWith("--"));
  const known = new Set(["--write", "--force"]);
  if (file === undefined || ids.length === 0 || [...flags].some((f) => !known.has(f))) {
    console.error(USAGE);
    process.exit(2);
  }
  const skipped = await importRaid(
    file,
    ids,
    { write: flags.has("--write"), force: flags.has("--force"), now: Date.now(), dice: machineDice },
    (line) => console.log(line),
  );
  process.exit(skipped > 0 ? 1 : 0);
}
