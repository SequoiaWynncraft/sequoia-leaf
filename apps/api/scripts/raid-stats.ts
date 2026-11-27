/**
 * A report on the Little Raid's fights as Leaf keeps them (`raid_fights`, `src/play/logs.ts`): how
 * often each comp, figure, figure at its stars, item, item on each figure and boon wins, beside how
 * often everybody wins the same rooms (a room on its trail), with a 95% interval and the fights each
 * line rests on:
 *
 *     bun apps/api/scripts/raid-stats.ts <copy of leaf.db | fights.jsonl> [way=main|own|all] [rules=<version>,...] [least=30] [export=<file.jsonl>]
 *
 * It reads a copy of Leaf's database, read-only (never the live file: `src/backup/vacuum.ts` makes a
 * copy), or JSON lines, one fight each, as `export` writes them from a database and the raid's
 * `review/balance.ts rows=<file>` writes the bot's. It counts the main way's fights only unless
 * `way` says otherwise, of every version of the rules unless `rules` names some, and leaves out a
 * line resting on fewer than `least` fights. A comp is the traits switched on, each at the count its
 * step takes ("Crab 4 + Fang 2").
 */
import { BunRuntime, BunServices } from "@effect/platform-bun";
import { SqliteClient } from "@effect/sql-sqlite-bun";
import { boonIn } from "@sequoia-leaf/raid/content/boons.ts";
import { catalogAt } from "@sequoia-leaf/raid/content/catalog.ts";
import { specOf, type UnitKind } from "@sequoia-leaf/raid/content/figures.ts";
import { itemName } from "@sequoia-leaf/raid/content/items.ts";
import { LAST_ERA } from "@sequoia-leaf/raid/content/releases.ts";
import { TRAIT_IDS, traitIn } from "@sequoia-leaf/raid/content/traits.ts";
import { type FightRecord, type FoughtSide, readFight } from "@sequoia-leaf/raid/fought.ts";
import { placeOf, Tally } from "@sequoia-leaf/raid/rates.ts";
import { Effect, FileSystem, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";

/** The raid's catalogue with every release open: it names whatever any kept fight fielded. */
const NAMES = catalogAt(LAST_ERA);

const args = process.argv.slice(2);
const option = (name: string): string | undefined => args.find((a) => a.startsWith(`${name}=`))?.slice(name.length + 1);
const source = args.find((a) => !a.includes("="));
const way = option("way") ?? "main";
const rulesAsked = option("rules")?.split(",");
const least = Number(option("least") ?? 30);
const exportTo = option("export");

/** A fight as the report reads it: when, whose, by which rules, and its record. */
interface Row {
  readonly at: number;
  readonly player: string;
  readonly rules: string;
  readonly fight: FightRecord;
}
const Who = Schema.Struct({ at: Schema.Int, player: Schema.String, rules: Schema.String });
const json = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown));
/** A JSON line read back, its record checked as the raid reads one; null for one that does not read. */
function rowOf(line: string): Row | null {
  const raw = json(line);
  const who = Option.flatMap(raw, Schema.decodeUnknownOption(Who));
  const fight = Option.isSome(raw) ? readFight(raw.value) : null;
  return Option.isSome(who) && fight !== null ? { ...who.value, fight } : null;
}

/** Each fight in a database file, oldest first, as a JSON line: the row with its party and the party against it as JSON. */
const linesOf = (file: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const all = SqlSchema.findAll({
      Request: Schema.Void,
      Result: Schema.Struct({ line: Schema.String }),
      execute: () => sql`
        SELECT json_object('at', at, 'player', player_id, 'rules', rules, 'run', run, 'way', way, 'trail', trail,
          'room', room, 'kind', kind, 'across', across, 'result', result, 'margin', margin, 'seconds', seconds,
          'resolve', resolve, 'level', level, 'acorns', acorns, 'party', json(party), 'against', json(against)) AS line
        FROM raid_fights ORDER BY id
      `,
    });
    return (yield* all(undefined)).map((row) => row.line);
  }).pipe(Effect.provide(SqliteClient.layer({ filename: file, readonly: true })));

/** A comp as players name one: the traits switched on, each at the count its step takes, the biggest first. */
function compOf(traits: FoughtSide["traits"]): string {
  const on = TRAIT_IDS.flatMap((id) => {
    const count = traitIn(NAMES, id).steps[(traits[id] ?? 0) - 1];
    return count === undefined ? [] : [{ name: traitIn(NAMES, id).name, count }];
  });
  const named = on.toSorted((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  return named.map((t) => `${t.name} ${t.count}`).join(" + ") || "No trait on";
}

const pct = (n: number): string => `${Math.round(n * 100)}%`;
const signed = (n: number): string => `${n >= 0 ? "+" : ""}${Math.round(n * 100)}`;
const named = (kind: UnitKind): string => specOf(NAMES, kind).name;

/** The tables, each with the lines a fight's party counts toward in it, each once a fight. */
const TABLES: readonly { title: string; mostPlayed?: true; lines: (party: FoughtSide) => string[] }[] = [
  { title: "Comps, the most played first", mostPlayed: true, lines: (party) => [compOf(party.traits)] },
  { title: "Figures fielded", lines: (party) => party.figures.map((p) => named(p.kind)) },
  {
    title: "Figures at their stars",
    lines: (party) => party.figures.map((p) => `${named(p.kind)} at ${p.stars} star${p.stars === 1 ? "" : "s"}`),
  },
  { title: "Items held", lines: (party) => party.figures.flatMap((p) => p.items.map((item) => itemName(NAMES, item))) },
  {
    title: "Items on each figure",
    lines: (party) =>
      party.figures.flatMap((p) => p.items.map((item) => `${itemName(NAMES, item)} on ${named(p.kind)}`)),
  },
  { title: "Boons", lines: (party) => party.boons.map((b) => boonIn(NAMES, b).name) },
];

/** A table: how often each line's fights were won, beside the same rooms, and on how many fights. */
function print(title: string, lines: ReadonlyMap<string, Tally>, rates: readonly number[], mostPlayed = false): void {
  const lean = (t: Tally): number => t.rate - t.expected(rates);
  const shown = [...lines].filter(([, t]) => t.tried >= least);
  const order = mostPlayed ? (t: Tally) => t.tried : lean;
  const width = Math.max(24, ...shown.map(([label]) => label.length));
  console.log(
    `${title}: ${shown.length} lines, and ${lines.size - shown.length} on fewer than ${least} fights left out.`,
  );
  console.log(`  ${"".padEnd(width)}  won  same rooms  points    95% interval  fights`);
  for (const [label, t] of shown.toSorted((a, b) => order(b[1]) - order(a[1]))) {
    const [low, high] = t.interval;
    console.log(
      `  ${label.padEnd(width)} ${pct(t.rate).padStart(4)} ${pct(t.expected(rates)).padStart(11)} ${signed(lean(t)).padStart(7)}` +
        `  ${`${pct(low)} to ${pct(high)}`.padStart(14)} ${String(t.tried).padStart(7)}`,
    );
  }
  console.log("");
}

function report(rows: readonly Row[], unread: number): void {
  console.log(`${rows.length} fights read from ${source}${unread > 0 ? `; ${unread} lines did not read` : ""}.`);
  const versions = new Map<string, number>();
  for (const row of rows) versions.set(row.rules, (versions.get(row.rules) ?? 0) + 1);
  console.log(`Rules: ${[...versions].map(([v, n]) => `${v} (${n} fights)`).join(", ") || "none"}.`);
  const counted = rows.filter(
    (row) => (way === "all" || row.fight.way === way) && (rulesAsked === undefined || rulesAsked.includes(row.rules)),
  );
  const all = new Tally();
  const tables = TABLES.map((table) => ({ table, tallies: new Map<string, Tally>() }));
  for (const { fight } of counted) {
    const win = fight.result === "win";
    const place = placeOf(fight.trail, fight.room);
    all.add(win, place);
    for (const { table, tallies } of tables) {
      for (const line of new Set(table.lines(fight.party))) {
        const t = tallies.get(line) ?? new Tally();
        t.add(win, place);
        tallies.set(line, t);
      }
    }
  }
  const rules = rulesAsked ? `rules ${rulesAsked.join(", ")}` : "every version of the rules";
  console.log(
    `${way === "all" ? "Both ways" : `The ${way} way`}, ${rules}: ${all.tried} fights, ${pct(all.rate)} won.\n`,
  );
  for (const { table, tallies } of tables) print(table.title, tallies, all.rates, table.mostPlayed);
}

if (source === undefined) {
  console.error(
    "Usage: bun raid-stats.ts <copy of leaf.db | fights.jsonl> [way=main|own|all] [rules=<version>,...] [least=30] [export=<file.jsonl>]",
  );
  process.exit(2);
}
BunRuntime.runMain(
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const lines = source.endsWith(".jsonl")
      ? (yield* fs.readFileString(source)).split("\n").filter((line) => line !== "")
      : yield* linesOf(source);
    if (exportTo !== undefined) yield* fs.writeFileString(exportTo, lines.map((line) => `${line}\n`).join(""));
    const rows = lines.flatMap((line) => rowOf(line) ?? []);
    report(rows, lines.length - rows.length);
  }).pipe(Effect.provide(BunServices.layer), Effect.orDie),
);
