/**
 * Brings named players' Little Raid over from the old saves to Leaf's play service, once, by hand:
 *
 *   bun apps/api/tools/once/import-raid.ts <database file> <player id>... [--write] [--force]
 *
 * For each player it reads their old `raid` slot (the run in progress and the almanac) and their
 * Coins from the old `purse` slot, with the loaders the battler had (`raid-old.ts`), and prints what
 * it found for a person to check: the trail, room, resolve, level and acorns, the figures and their
 * stars, the items, the almanac's counts, and the Coins: the purse's, and beside them any the Works
 * kept under its own old keys (in the `purse` or the `works` slot), which are printed and not
 * brought over. Anything play cannot reach (a figure above
 * three stars, more figures on the board than the level fields, more than 200 acorns, more than
 * 100,000 Coins) is printed as a warning, and that player is skipped unless `--force` is given too;
 * forced, a figure is brought to three stars and a figure too many goes to the bench, as printed.
 * A save that is not one is printed as such, and skipped.
 *
 * Nothing is written without `--write`. With it, each player's table is stored as their `raid`
 * play state, replacing a state only while it is untouched (`rev` 0), and their Coins as one ledger
 * entry keyed `import:<player>` that brings their balance to what the old purse held (in place of
 * the welcome, if they had it already). A player who has played on Leaf since is left alone. The
 * run's random stream is drawn afresh: the old one was in the browser, where it could be read.
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

import { databaseAt } from "../../src/db.ts";
import { WELCOME_COINS } from "../../src/play/coins.ts";
import { keysOf, OLD_KEYS, oldAlmanac, oldCoins, oldRun, oldWorksCoins, REACH } from "./raid-old.ts";

export interface ImportOptions {
  /** Store what was found. Without it nothing is written. */
  readonly write: boolean;
  /** Bring over a player whose save holds what play cannot reach. */
  readonly force: boolean;
  /** When it is written, for the rows. */
  readonly now: number;
  /** A fresh 32-bit number, for the run's new stream and the table's. */
  readonly dice: () => number;
}

const USAGE = "Usage: bun apps/api/tools/once/import-raid.ts <database file> <player id>... [--write] [--force]";

/** A whole number from the machine's own randomness. */
export const machineDice = (): number => crypto.getRandomValues(new Uint32Array(1))[0] ?? 0;

const Slot = Schema.Struct({ data: Schema.String });
const Rev = Schema.Struct({ rev: Schema.Int });
const Entry = Schema.Struct({ key: Schema.String, amount: Schema.Int });

const stars = (n: number): string => "*".repeat(n);
const figures = (pieces: readonly (Run["board"][number] | undefined)[]): string =>
  pieces.flatMap((p) => (p ? [`${FIGURES[p.kind].name} ${stars(p.stars)}`] : [])).join(", ") || "nobody";

/** The Coins the Works kept itself under its old keys, among a slot's texts. */
const worksCoinsIn = (slot: string, texts: Readonly<Record<string, string>>) =>
  oldWorksCoins(texts).map(({ key, coins }) => ({ slot, key, coins }));

/** The Coins the Works kept itself, found in a slot, as a line. */
const worksLine = (found: readonly { slot: string; key: string; coins: number }[]): string =>
  `  the Works' own: ${
    found.map((f) => `${f.coins.toLocaleString("en-GB")} (${f.key}, ${f.slot} slot)`).join("; ") || "none kept"
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
      `  run: ${TRAILS[run.trail]?.name ?? `trail ${run.trail}`}, room ${run.room + 1} of ${ROOM_COUNT} (${run.phase}), ` +
        `resolve ${run.resolve}, level ${run.level}, ${run.acorns} acorns`,
      `  board: ${figures(run.board)}`,
      `  bench: ${figures(run.bench)}`,
      `  items: ${run.items.join(", ") || "none"}; held: ${
        [...run.board, ...run.bench]
          .flatMap((p) => (p && p.items.length > 0 ? [`${FIGURES[p.kind].name} ${p.items.join("+")}`] : []))
          .join(", ") || "nothing"
      }`,
    );
  } else lines.push("  run: none laid out");
  lines.push(
    `  almanac: ${almanac.runs} runs, ${almanac.fielded.length} figures fielded, ${almanac.threeStars.length} at three stars, ` +
      `${almanac.forged.length} items forged, ${almanac.topped.length} traits topped; bosses ${almanac.bosses
        .map((b) => b.length)
        .join("/")}; furthest ${almanac.best.join("/")}`,
    `  coins: ${coins === null ? "none kept" : coins.toLocaleString("en-GB")} (the purse's: these are brought over)`,
    worksLine(works),
  );
  return lines;
}

type Outcome = "written" | "dry" | "skipped";

/**
 * Brings the named players over, printing what it finds for each. Gives back how many were not
 * brought over (or, without `write`, would not be).
 */
export async function importRaid(
  file: string,
  ids: readonly string[],
  options: ImportOptions,
  print: (line: string) => void,
): Promise<number> {
  const runtime = ManagedRuntime.make(databaseAt(file));
  try {
    const outcomes = await runtime.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
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
        const entriesOf = SqlSchema.findAll({
          Request: Schema.String,
          Result: Entry,
          execute: (playerId) => sql`SELECT key, amount FROM coin_entries WHERE player_id = ${playerId}`,
        });

        /** Writes one player's table and Coins, in one transaction. */
        const write = (player: PlayerId, table: Table, coins: number | null) =>
          sql.withTransaction(
            Effect.gen(function* () {
              const rev = yield* revOf(player);
              if (Option.isSome(rev) && rev.value.rev > 0) {
                return `not written: they have played on Leaf since (rev ${rev.value.rev})`;
              }
              const entries = yield* entriesOf(player);
              const others = entries.filter((e) => e.key !== `welcome:${player}`);
              if (others.length > 0) return `not written: their Coins have changed on Leaf since (${others[0]?.key})`;
              const text = RAID.encode(table);
              if (RAID.decode(text) === null) return "not written: the table it made does not read back";
              if (Option.isSome(rev)) {
                yield* sql`
                  UPDATE play_state SET rev = 1, state = ${text}, updated_at = ${options.now}
                  WHERE player_id = ${player} AND game = 'raid' AND rev = 0
                `;
              } else {
                yield* sql`
                  INSERT INTO play_state (player_id, game, rev, state, updated_at)
                  VALUES (${player}, 'raid', 1, ${text}, ${options.now})
                `;
              }
              if (coins !== null) {
                // The old purse's Coins in place of the welcome: the balance comes to what it held.
                const welcomed = entries.length > 0 ? WELCOME_COINS : 0;
                yield* sql`
                  INSERT INTO coin_entries (player_id, amount, reason, game, key, at)
                  VALUES (${player}, ${coins - welcomed}, 'Coins brought over from the old purse', NULL,
                          ${`import:${player}`}, ${options.now})
                `;
              }
              return "written";
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
            const warnings: string[] = [];
            const changed: string[] = [];
            let run: Run | null = null;
            const runText = keys[OLD_KEYS.run];
            if (runText !== undefined) {
              const read = oldRun(runText);
              if (!read.ok) {
                print(`${player}: nonsense: the run in progress does not read (${read.why}); skipped`);
                return "skipped" satisfies Outcome;
              }
              warnings.push(...read.warnings);
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
            const purseText = purseKeys[OLD_KEYS.purse];
            const coins = purseText === undefined ? null : oldCoins(purseText);
            if (coins !== null && coins > REACH.coins)
              warnings.push(`${coins} Coins; play reaches about ${REACH.coins}`);
            if (run && !trailOpen(almanac, run.trail)) warnings.push(`a run on a trail the almanac has not opened`);
            for (const line of summary(player, run, almanac, coins, works)) print(line);
            for (const warning of warnings) print(`  WARNING: ${warning}`);
            if (warnings.length > 0 && !options.force) {
              print("  skipped: it holds what play cannot reach. With --force it is brought over as shown above.");
              return "skipped" satisfies Outcome;
            }
            for (const change of changed) print(`  brought within reach: ${change}`);
            const looks: Looks = newLooks();
            if (run) run.rng = options.dice();
            const table: Table = {
              rng: options.dice(),
              runs: almanac.runs + (run ? 1 : 0),
              run,
              almanac,
              trail: run && trailOpen(almanac, run.trail) ? run.trail : 0,
              looks,
            };
            if (!options.write) {
              print("  would be brought over (nothing written: give --write to write it)");
              return "dry" satisfies Outcome;
            }
            const written = yield* write(player, table, coins);
            print(`  ${written}`);
            return written === "written" ? ("written" satisfies Outcome) : ("skipped" satisfies Outcome);
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
