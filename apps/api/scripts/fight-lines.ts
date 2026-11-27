/**
 * Leaf's raid fights (`raid_fights`, `src/play/logs.ts`) as JSON lines, one a fight: as the fight
 * report (`raid-stats.ts`) exports them from a copy of the database, and as it reads them back, from
 * a database or a file of them (the raid's `review/balance.ts rows=<file>` writes the bot's).
 */
import { type FightRecord, readFight } from "@sequoia-leaf/raid/fought.ts";
import { Option, Schema } from "effect";
import type { SqlClient } from "effect/sql";

/** A fight as the report reads it: when, whose, by which rules, and its record. */
export interface Row {
  readonly at: number;
  readonly player: string;
  readonly rules: string;
  readonly fight: FightRecord;
}

/**
 * Each fight in the database, oldest first, as a JSON line (`line`): the row, with its party, the
 * party against it and its setup as JSON. A row's empty `course`, `pool` and `era` (one kept before
 * there were any, or written by an older Leaf) are `null`, read back as its `way` and `at` say
 * (`rowOf`); its empty `setup` is `null`, a fight that cannot be played again.
 */
export const fightLines = (sql: SqlClient.SqlClient) => sql`
  SELECT json_object('at', at, 'player', player_id, 'rules', rules, 'run', run, 'way', way, 'course', course,
    'trail', trail, 'pool', pool, 'era', era, 'room', room, 'kind', kind, 'across', across, 'result', result,
    'margin', margin, 'seconds', seconds, 'resolve', resolve, 'level', level, 'acorns', acorns,
    'party', json(party), 'against', json(against), 'setup', json(setup)) AS line
  FROM raid_fights ORDER BY id
`;

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
