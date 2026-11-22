/**
 * Brings named players' yards over from the old saves to Leaf, once, by hand:
 *
 *   bun apps/api/tools/once/import-works.ts <database file> <player id>... [--write] [--force]
 *
 * It opens the database as it is, running no migration, and does nothing if Leaf's play tables are
 * not there. For each player it reads the yard their page kept (`works.save.v2`) in their old
 * `works` slot and prints what a person checks: the story orders done, the plots and plans owned,
 * the pieces standing by kind, the till, and what the depot has taken in. The yard is turned into
 * the text Leaf keeps (version 3): it stands at the moment it is brought over and keeps its tick
 * and its board as they stand, has no second shift, starts its story log at nothing and its count
 * of Coins changes at nothing too (or, over a yard already on Leaf, at that yard's count, so that
 * no Coins key is made twice), and gets a new seed from the machine's own randomness; then it is
 * read back with the Works' rules. A till over 30,000, or anything the rules dropped on reading it (pieces, plots or plans
 * that could not have come about by playing), is a warning line, and that yard is not written
 * unless `--force` is given.
 *
 * Nothing is written without `--write`. With it, the yard is stored as the player's `works` play
 * state, unless that state has been played on Leaf (`rev` above 0); `--force` writes over it even
 * then. It takes players' ids, and has no "everyone". The play service never reads the old saves;
 * this tool is deleted in the change after it has run.
 */
import { parsePlayerId, type PlayerId } from "@sequoia-leaf/core";
import { ITEMS, KINDS, STORY, WORKS, type World } from "@sequoia-leaf/yard";
import { Effect, ManagedRuntime, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";

import { databaseAsItIs } from "../../src/db.ts";

export interface ImportOptions {
  /** Store what was found. Without it nothing is written. */
  readonly write: boolean;
  /** Write a yard with a warning, and one over a yard played on Leaf since. */
  readonly force: boolean;
  /** The moment of Leaf's clock the yard is brought over at. */
  readonly now: number;
  /** A fresh 32-bit number from the machine's randomness, for the yard's new seed. */
  readonly dice: () => number;
}

const USAGE = "Usage: bun apps/api/tools/once/import-works.ts <database file> <player id>... [--write] [--force]";

/** The tables the tool reads and writes; without them Leaf's play service has not been set up on the file. */
const TABLES = ["saves", "play_state"] as const;
/** Where the page kept the yard, among the slot's texts. */
const OLD_KEY = "works.save.v2";
/** A till larger than this is more than play would have left waiting in it. */
const TILL_MOST = 30_000;

/** A whole number from the machine's own randomness. */
export const machineDice = (): number => crypto.getRandomValues(new Uint32Array(1))[0] ?? 0;

const Slot = Schema.Struct({ data: Schema.String });
const Stored = Schema.Struct({ rev: Schema.Int, state: Schema.String });
const Name = Schema.Struct({ name: Schema.String });

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const n = (v: number): string => v.toLocaleString("en-GB");
const parse = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};
const length = (v: unknown): number => (Array.isArray(v) ? v.length : 0);

/** The pieces standing in a yard, a tunnel counted once. */
const pieces = (w: World) =>
  w.cells.filter((b) => b !== null && b.kind !== "depot" && (b.kind !== "tunnel" || b.span > 0));

/** The old yard's text as the text Leaf keeps, or why it cannot be. */
function upgraded(text: string, options: ImportOptions): { yard: World; raw: Record<string, unknown> } | string {
  const raw = parse(text);
  if (!isRecord(raw) || raw.v !== 2) return "the yard is not one the page kept (version 2)";
  const { v: _v, seen: _seen, boostUntil: _shift, ...rest } = raw;
  const yard = WORKS.decode(JSON.stringify({ ...rest, v: 3, seed: options.dice(), at: options.now, bank: 0, told: 0 }));
  return yard ? { yard, raw } : "the rules cannot read the yard";
}

/** What a person checks of one player's yard, in a few lines. */
function summary(player: PlayerId, w: World): string[] {
  const kinds = KINDS.flatMap((kind) => {
    const count = pieces(w).filter((b) => b?.kind === kind).length;
    return count > 0 ? [`${kind} ${count}`] : [];
  });
  const depot = ITEMS.flatMap((item) => ((w.depot[item] ?? 0) > 0 ? [`${item} ${n(w.depot[item] ?? 0)}`] : []));
  return [
    `${player}:`,
    `  story: ${w.story} of ${STORY.length} orders done; ${n(w.done)} standing orders handed over; tick ${n(w.tick)}`,
    `  plots: ${w.plots.join(", ")}; plans: ${w.plans.join(", ") || "none"}`,
    `  standing: ${kinds.join(", ") || "nothing"}`,
    `  till: ${n(Math.floor(w.till))}; the depot took in: ${depot.join(", ") || "nothing"}`,
  ];
}

/** Warnings for one player's yard: a till past what play leaves, and whatever the rules dropped. */
function warnings(raw: Record<string, unknown>, w: World): string[] {
  const out: string[] = [];
  if (w.till > TILL_MOST) out.push(`a till of ${n(Math.floor(w.till))}; play leaves about ${n(TILL_MOST)} at most`);
  const kept = w.cells.filter((b) => b !== null && b.kind !== "depot").length;
  const dropped = [
    [length(raw.cells) - kept, "piece"],
    [length(raw.plots) - w.plots.length, "plot"],
    [length(raw.plans) - w.plans.length, "plan"],
  ] as const;
  for (const [count, what] of dropped)
    if (count > 0) out.push(`${count} ${what}${count === 1 ? "" : "s"} the rules dropped on reading it`);
  return out;
}

type Outcome = "written" | "dry" | "skipped";

/**
 * Brings the named players' yards over, printing what it finds for each. Gives back how many were
 * not brought over (or, without `write`, would not be).
 */
export async function importWorks(
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
          Request: Schema.String,
          Result: Slot,
          execute: (playerId) => sql`SELECT data FROM saves WHERE player_id = ${playerId} AND slot = 'works'`,
        });
        const storedOf = SqlSchema.findOneOption({
          Request: Schema.String,
          Result: Stored,
          execute: (playerId) =>
            sql`SELECT rev, state FROM play_state WHERE player_id = ${playerId} AND game = 'works'`,
        });

        /**
         * Writes one player's yard, unless it has been played on Leaf since and it is not forced. Over
         * a yard on Leaf, it counts its Coins on from that yard's, so that no Coins key is made twice.
         */
        const writeYard = (player: PlayerId, yard: World) =>
          sql.withTransaction(
            Effect.gen(function* () {
              const stored = yield* storedOf(player);
              if (Option.isNone(stored)) {
                yield* sql`
                  INSERT INTO play_state (player_id, game, rev, state, updated_at)
                  VALUES (${player}, 'works', 1, ${WORKS.encode(yard)}, ${options.now})
                `;
                return "yard written";
              }
              const was = stored.value.rev;
              if (was > 0 && !options.force) {
                return `yard not written: they have played on Leaf since (rev ${was}); --force writes over it`;
              }
              const text = WORKS.encode({ ...yard, bank: WORKS.decode(stored.value.state)?.bank ?? 0 });
              yield* sql`
                UPDATE play_state SET rev = ${was + 1}, state = ${text}, updated_at = ${options.now}
                WHERE player_id = ${player} AND game = 'works' AND rev = ${was}
              `;
              return was > 0 ? `yard written over rev ${was}` : "yard written";
            }),
          );

        const one = (id: string) =>
          Effect.gen(function* () {
            const player = parsePlayerId(id);
            if (player === undefined) {
              print(`${id}: not a player id; skipped`);
              return "skipped" satisfies Outcome;
            }
            const slot = yield* slotOf(player);
            const saved = Option.isSome(slot) ? parse(slot.value.data) : null;
            const text = isRecord(saved) && isRecord(saved.keys) ? saved.keys[OLD_KEY] : undefined;
            if (Option.isNone(slot) || typeof text !== "string") {
              print(`${player}: no yard saved; skipped`);
              return "skipped" satisfies Outcome;
            }
            const read = upgraded(text, options);
            if (typeof read === "string") {
              print(`${player}: nonsense: ${read}; skipped`);
              return "skipped" satisfies Outcome;
            }
            for (const line of summary(player, read.yard)) print(line);
            const warned = warnings(read.raw, read.yard);
            for (const warning of warned) print(`  WARNING: ${warning}`);
            const held = warned.length > 0 && !options.force;
            if (held) print("  yard held back: --force brings it over as shown");
            if (!options.write) {
              print("  nothing written: give --write to write it");
              return held ? ("skipped" satisfies Outcome) : ("dry" satisfies Outcome);
            }
            if (held) return "skipped" satisfies Outcome;
            const written = yield* writeYard(player, read.yard);
            print(`  ${written}`);
            return written.startsWith("yard written") ? ("written" satisfies Outcome) : ("skipped" satisfies Outcome);
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
  const skipped = await importWorks(
    file,
    ids,
    { write: flags.has("--write"), force: flags.has("--force"), now: Date.now(), dice: machineDice },
    (line) => console.log(line),
  );
  process.exit(skipped > 0 ? 1 : 0);
}
