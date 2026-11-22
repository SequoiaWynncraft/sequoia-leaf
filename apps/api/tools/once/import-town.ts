/**
 * Brings each player's town and camp over from the browser's old save to Leaf, once, by hand:
 *
 *   bun apps/api/tools/once/import-town.ts <database file> [--write] [--force]
 *
 * For every player with a `town` slot in `saves`, it prints what a person checks: the things set
 * out and in the tray by kind, the parcels, letters, pets, callers greeted and crab sightings, and
 * any warning. A warning is only for what play cannot reach: more than 300 set out, more than 999
 * of one thing, a thing the catalogue does not have. With `--write` it stores each as their `town`
 * state, read by the rules' `adopt` (every thing standing given an id, the callers and the stream
 * started afresh, last here now), unless they have a town on Leaf already, or a warning stands and
 * `--force` is not given; and the camp's standing, where it has none.
 *
 * It also fills in what each player's stored raid and Works states show and Leaf has not kept: their
 * awards (`Game.awards`) and where they stand (`Game.standing`), each only where the row is
 * missing (a standing as a guest's where the player's old saves were a guest's). Without `--write`
 * it says what it would write. Player ids are printed with all but their first eight characters
 * masked. It is deleted in the change after it has run.
 */
import { Database } from "bun:sqlite";

import type { Standing } from "@sequoia-leaf/core";
import { RAID } from "@sequoia-leaf/raid/game.ts";
import { adopt, TOWN } from "@sequoia-leaf/town";
import { MOST_OWNED, MOST_PLACED, petsOf } from "@sequoia-leaf/town/camp.ts";
import { isThing, KINDS, thingOf } from "@sequoia-leaf/town/things.ts";
import { WORKS } from "@sequoia-leaf/yard/game.ts";

export interface Options {
  readonly write: boolean;
  readonly force: boolean;
  /** Leaf's clock. */
  readonly now: number;
  /** A new stream's seed for each camp adopted. */
  readonly seed: () => number;
  readonly say: (line: string) => void;
}

/** A player id with all but its first eight characters masked. */
export const masked = (id: string): string => `${id.slice(0, 8)}${"*".repeat(Math.max(0, id.length - 8))}`;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const parsed = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** The old record (`town.save.v1`) out of a `town` slot, as text, or null. */
function recordIn(data: string): string | null {
  const save = parsed(data);
  const text = isRecord(save) && isRecord(save.keys) ? save.keys["town.save.v1"] : null;
  return typeof text === "string" ? text : null;
}

/** What play cannot reach in an old record, in a line each. */
export function warnings(text: string): string[] {
  const raw = parsed(text);
  const camp = isRecord(raw) && isRecord(raw.camp) ? raw.camp : {};
  const placed = list(camp.placed);
  const out: string[] = [];
  if (placed.length > MOST_PLACED) out.push(`${placed.length} set out; at most ${MOST_PLACED} can be`);
  const had = new Map<string, number>();
  const count = (id: unknown, n = 1): void => {
    const name = typeof id === "string" ? id : JSON.stringify(id);
    had.set(name, (had.get(name) ?? 0) + n);
  };
  for (const p of placed) count(isRecord(p) ? p.id : p);
  if (isRecord(camp.tray)) for (const [id, n] of Object.entries(camp.tray)) count(id, typeof n === "number" ? n : 0);
  for (const id of list(camp.parcels)) count(id);
  const unknown = new Set<string>();
  for (const [id, n] of had) {
    if (!isThing(id)) unknown.add(id);
    else if (n > MOST_OWNED) out.push(`${n} of ${id}; at most ${MOST_OWNED} can be had`);
  }
  for (const l of list(camp.letters)) if (isRecord(l) && l.gift !== "" && !isThing(l.gift)) unknown.add(String(l.gift));
  for (const id of list(camp.earned)) if (!isThing(id)) unknown.add(String(id));
  for (const id of unknown) out.push(`${id} is not in the catalogue`);
  return out;
}

/** Things by kind, as "lights 4, seats 2". */
function byKind(ids: readonly string[]): string {
  const n = new Map<string, number>();
  for (const id of ids) {
    const kind = thingOf(id)?.kind ?? "?";
    n.set(kind, (n.get(kind) ?? 0) + 1);
  }
  return KINDS.flatMap((k) => (n.has(k) ? [`${k} ${n.get(k) ?? 0}`] : [])).join(", ") || "none";
}

/** A game's stored state as the tool needs it: what it shows was won, and where it stands. */
interface Kept<S> {
  readonly decode: (text: string) => S | null;
  readonly awards?: (state: S) => readonly string[];
  readonly standing?: (state: S) => Standing;
}

export function importTown(db: Database, o: Options): void {
  const towns = db
    .query<{ player_id: string; data: string }, []>(
      "SELECT player_id, data FROM saves WHERE slot = 'town' ORDER BY player_id",
    )
    .all();
  const onLeaf = (player: string, game: string): boolean =>
    db.query("SELECT 1 FROM play_state WHERE player_id = ? AND game = ?").get(player, game) !== null;
  const guestOf = (player: string): boolean =>
    (db.query<{ g: number | null }, [string]>("SELECT max(guest) AS g FROM saves WHERE player_id = ?").get(player)?.g ??
      0) === 1;
  const write = (sql: string, ...values: (string | number)[]): void => {
    if (o.write) db.query(sql).run(...values);
  };
  const will = o.write ? "" : "would be ";

  /** Where a state stands, written where the player has no standing in the game yet. */
  function stand(player: string, game: string, standing: Standing | undefined): void {
    if (!standing) return;
    if (db.query("SELECT 1 FROM standings WHERE player_id = ? AND game = ?").get(player, game) !== null) return;
    o.say(`  ${game} standing ${will}written: ${standing.score} ${JSON.stringify(standing.also)}`);
    write(
      "INSERT INTO standings (player_id, game, score, also, guest, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING",
      player,
      game,
      standing.score,
      JSON.stringify(standing.also),
      guestOf(player) ? 1 : 0,
      o.now,
    );
  }

  /** What a raid or Works state shows was won and where it stands, written where Leaf has not kept it. */
  function kept<S>(player: string, game: string, state: string, g: Kept<S>): void {
    const s = g.decode(state);
    if (s === null) {
      o.say(`${masked(player)} ${game}: does not read; left as it is`);
      return;
    }
    const held = new Set(
      db
        .query<{ id: string }, [string]>("SELECT id FROM awards WHERE player_id = ?")
        .all(player)
        .map((a) => a.id),
    );
    const won = (g.awards?.(s) ?? []).filter((id) => !held.has(id));
    o.say(
      `${masked(player)} ${game}: ${won.length === 0 ? "no awards missing" : `awards ${will}written: ${won.join(", ")}`}`,
    );
    for (const id of won)
      write("INSERT INTO awards (player_id, id, at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING", player, id, o.now);
    stand(player, game, g.standing?.(s));
  }

  const run = db.transaction(() => {
    o.say(`${towns.length} kept a town in the browser.`);
    for (const { player_id: player, data } of towns) {
      o.say(`${masked(player)}:`);
      const text = recordIn(data);
      const town = text === null ? null : adopt(text, { now: o.now, seed: o.seed() });
      if (text === null || town === null) {
        o.say("  nothing that reads as a town; left as it is");
        continue;
      }
      const { camp } = town;
      const tray = Object.entries(camp.tray).flatMap(([id, n]) => Array.from({ length: n }, () => id));
      o.say(`  set out ${camp.placed.length}: ${byKind(camp.placed.map((p) => p.id))}`);
      o.say(`  in the tray ${tray.length}: ${byKind(tray)}`);
      o.say(
        `  parcels ${camp.parcels.length}, letters ${camp.letters.length}, pets ${petsOf(camp).join(", ") || "none"}, greeted ${camp.greeted}, sightings ${town.sightings}`,
      );
      const warned = warnings(text);
      for (const w of warned) o.say(`  warning: ${w}`);
      if (onLeaf(player, "town")) {
        o.say("  has a town on Leaf already; left as it is");
        continue;
      }
      if (warned.length > 0 && !o.force) {
        o.say("  held back: a warning stands (--force writes it)");
        continue;
      }
      o.say(`  ${will}written`);
      write(
        "INSERT INTO play_state (player_id, game, rev, state, updated_at) VALUES (?, 'town', 1, ?, ?)",
        player,
        TOWN.encode(town),
        o.now,
      );
      stand(player, "town", TOWN.standing?.(town));
    }

    const others = db
      .query<{ player_id: string; game: string; state: string }, []>(
        "SELECT player_id, game, state FROM play_state WHERE game IN ('raid', 'works') ORDER BY player_id, game",
      )
      .all();
    o.say(`${others.length} raid and Works states on Leaf.`);
    for (const { player_id: player, game, state } of others) {
      if (game === "raid") kept(player, game, state, RAID);
      else kept(player, game, state, WORKS);
    }
  });
  run();
}

if (import.meta.main) {
  const [path, ...flags] = process.argv.slice(2);
  if (path === undefined || flags.some((f) => f !== "--write" && f !== "--force")) {
    console.error("Usage: bun apps/api/tools/once/import-town.ts <database file> [--write] [--force]");
    process.exit(2);
  }
  const db = new Database(path, { readwrite: true, create: false });
  importTown(db, {
    write: flags.includes("--write"),
    force: flags.includes("--force"),
    now: Date.now(),
    seed: () => crypto.getRandomValues(new Uint32Array(1))[0] ?? 1,
    say: (line) => {
      console.log(line);
    },
  });
  db.close();
}
