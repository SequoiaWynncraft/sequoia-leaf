/**
 * Leaf's raid fights (`raid_fights`, `src/play/logs.ts`) as JSON lines, one a fight: as the fight
 * report (`raid-stats.ts`) exports them from a copy of the database, and as it reads them back, from
 * a database or a file of them (the raid's `review/balance.ts rows=<file>` writes the bot's).
 */
import { type FightRecord, readFight } from "@sequoia-leaf/raid/fought.ts";
import { Effect, Option, Schema } from "effect";
import type { SqlClient } from "effect/sql";

/** A fight as the report reads it: when, whose, by which rules, and its record. */
export interface Row {
  readonly at: number;
  readonly player: string;
  readonly rules: string;
  readonly fight: FightRecord;
}

/** The columns of `raid_fights` kept only since a later migration (0047, 0048): a copy of the database from before has none of them. */
const LATER = ["course", "pool", "era", "setup"] as const;
type Later = (typeof LATER)[number];

/** The columns of `raid_fights` in a database, for `fightLines` on a copy that may be older than this Leaf. */
export const fightColumns = (sql: SqlClient.SqlClient) =>
  sql<{ readonly name: string }>`SELECT name FROM pragma_table_info('raid_fights')`.pipe(
    Effect.map((rows) => new Set(rows.map((row) => row.name))),
  );

/**
 * Each fight in the database, oldest first, as a JSON line (`line`): the row, with its party, the
 * party against it and its setup as JSON. A row's empty `course`, `pool` and `era` (one kept before
 * there were any, or written by an older Leaf) are `null`, read back as its `way` and `at` say
 * (`rowOf`); its empty `setup` is `null`, a fight that cannot be played again. A copy of the
 * database older than a column (`has`, from `fightColumns`) reads it as `null` in every row.
 */
export const fightLines = (sql: SqlClient.SqlClient, has: ReadonlySet<string> = new Set(LATER)) => {
  const later = (name: Later) => sql.literal(has.has(name) ? (name === "setup" ? "json(setup)" : name) : "NULL");
  return sql`
  SELECT json_object('at', at, 'player', player_id, 'rules', rules, 'run', run, 'way', way, 'course', ${later("course")},
    'trail', trail, 'pool', ${later("pool")}, 'era', ${later("era")}, 'room', room, 'kind', kind, 'across', across, 'result', result,
    'margin', margin, 'seconds', seconds, 'resolve', resolve, 'level', level, 'acorns', acorns,
    'party', json(party), 'against', json(against), 'setup', ${later("setup")}) AS line
  FROM raid_fights ORDER BY id
`;
};

const Who = Schema.Struct({ at: Schema.Int, player: Schema.String, rules: Schema.String });
const json = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown));
/** A JSON line read back, its record checked as the raid reads one, of its row's moment; null for one that does not read. */
export function rowOf(line: string): Row | null {
  const raw = json(line);
  const who = Option.flatMap(raw, Schema.decodeUnknownOption(Who));
  if (Option.isNone(raw) || Option.isNone(who)) return null;
  const fight = readFight(raw.value, who.value.at);
  return fight === null ? null : { ...who.value, fight };
}
