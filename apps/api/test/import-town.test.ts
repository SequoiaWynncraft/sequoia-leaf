import { Database as Sqlite } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { playerId } from "@sequoia-leaf/core";
import { RAID } from "@sequoia-leaf/raid/game.ts";
import { decodeTown } from "@sequoia-leaf/town";
import { NEW_CAMP } from "@sequoia-leaf/town/camp.ts";
import { Effect, Layer } from "effect";

import { AppConfig } from "../src/config.ts";
import { Database } from "../src/db.ts";
import { importTown, masked, type Options } from "../tools/once/import-town.ts";
import { testConfig } from "./support.ts";

const alice = playerId("a11ce000-0000-4000-8000-000000000001");
const bob = playerId("b0b00000-0000-4000-8000-000000000002");
const carol = playerId("ca401000-0000-4000-8000-000000000003");
/** Wednesday 25 November 2026, 12:00 UTC. */
const T0 = Date.UTC(2026, 10, 25, 12);

let directory: string;
let db: Sqlite;

/** An old record as the town page kept it, with `more` set out besides a new camp. */
function record(more: readonly { id: string; x: number; y: number }[], tray: Record<string, number> = {}): string {
  return JSON.stringify({
    v: 1,
    sightings: 4,
    lastSeen: T0 - 3 * 3_600_000,
    cursor: 12,
    stay: false,
    camp: {
      first: "cat",
      placed: [...NEW_CAMP, ...more].map((p) => ({ id: p.id, x: p.x, y: p.y, t: 0, s: 0 })),
      tray,
      parcels: ["rock"],
      letters: [],
      greeted: 2,
      earned: [],
    },
  });
}
const slot = (player: string, text: string, guest = 0): void => {
  db.query("INSERT INTO saves (player_id, slot, version, data, updated_at, guest) VALUES (?, 'town', 3, ?, ?, ?)").run(
    player,
    JSON.stringify({ saved_at: T0 - 3_600_000, keys: { "town.save.v1": text } }),
    T0 - 3_600_000,
    guest,
  );
};

/** Runs the tool, and gives what it printed. */
function run(write: boolean, force = false): string[] {
  const said: string[] = [];
  const o: Options = { write, force, now: T0, seed: () => 7, say: (line) => said.push(line) };
  importTown(db, o);
  return said;
}
const everything = (): unknown =>
  ["play_state", "awards", "standings"].map((t) => db.query(`SELECT * FROM ${t} ORDER BY 1, 2`).all());

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), "leaf-import-"));
  const path = join(directory, "leaf.db");
  // A database set up as Leaf sets one up.
  await Effect.runPromise(
    Effect.void.pipe(
      Effect.provide(Database.pipe(Layer.provide(Layer.succeed(AppConfig)(testConfig({ databasePath: path }))))),
    ),
  );
  db = new Sqlite(path, { readwrite: true });
  // Alice kept a lived-in camp; Bob's holds a thing the catalogue does not have.
  slot(alice, record([{ id: "stump", x: 30, y: 33 }], { "log-seat": 2 }));
  slot(bob, record([{ id: "stump", x: 30, y: 33 }], { "golden-throne": 1 }));
  // Carol, a guest, already beat a boss in the raid on Leaf, and Leaf kept one of her awards before it awarded on Leaf.
  const table = RAID.create({ now: T0, player: { id: carol, guest: true }, seed: 1, room: 0, awards: [] });
  table.almanac.bosses[0] = ["oldbramble", "hoardmagpie"];
  db.query("INSERT INTO play_state (player_id, game, rev, state, updated_at) VALUES (?, 'raid', 4, ?, ?)").run(
    carol,
    RAID.encode(table),
    T0,
  );
  db.query("INSERT INTO awards (player_id, id, at) VALUES (?, 'trophy-oldbramble', 1)").run(carol);
  slot(carol, "not a record", 1);
});

afterEach(() => {
  db.close();
  rmSync(directory, { recursive: true });
});

describe("bringing the town over", () => {
  it("prints what each player kept, writing nothing, with every id masked but its first eight characters", () => {
    const before = everything();
    const said = run(false);
    expect(everything()).toEqual(before);
    expect(said.join("\n")).not.toContain(alice);
    expect(said).toContain(`${masked(alice)}:`);
    expect(masked(alice)).toBe("a11ce000****************************");
    expect(said).toContain("  set out 10: home 5, seats 4, lights 1");
    expect(said).toContain("  in the tray 2: seats 2");
    expect(said).toContain("  parcels 1, letters 0, pets cat, greeted 2, sightings 4");
    expect(said).toContain("  warning: golden-throne is not in the catalogue");
    expect(said).toContain("  nothing that reads as a town; left as it is");
    expect(said).toContain(`${masked(carol)} raid: awards would be written: trophy-hoardmagpie`);
  });

  it("writes each camp through adopt, holds back one a warning stands against, and fills awards and standings only where missing", () => {
    const said = run(true);
    expect(said).toContain("  held back: a warning stands (--force writes it)");
    const stored = db
      .query<{ player_id: string; state: string }, []>("SELECT player_id, state FROM play_state WHERE game = 'town'")
      .all();
    expect(stored.map((s) => s.player_id)).toEqual([alice]);
    const town = decodeTown(stored[0]?.state ?? "");
    expect(town?.camp.placed.map((p) => p.n)).toEqual(Array.from({ length: 10 }, (_, n) => n));
    expect([town?.seenAt, town?.visit, town?.camp.tray, town?.cursor, town?.stay]).toEqual([
      T0,
      null,
      { "log-seat": 2 },
      12,
      false,
    ]);
    // The award Leaf already held keeps its moment; the one it had not kept is added now.
    expect(db.query("SELECT id, at FROM awards WHERE player_id = ? ORDER BY id").all(carol)).toEqual([
      { id: "trophy-hoardmagpie", at: T0 },
      { id: "trophy-oldbramble", at: 1 },
    ]);
    expect(db.query("SELECT player_id, game, score, also, guest FROM standings ORDER BY player_id").all()).toEqual([
      { player_id: alice, game: "town", score: 10, also: JSON.stringify({ greeted: 2, sightings: 4 }), guest: 0 },
      { player_id: carol, game: "raid", score: 2, also: JSON.stringify({ runs: 0, room: 0 }), guest: 1 },
    ]);

    // Run again, nothing changes: Alice's town is on Leaf, and so are Carol's awards and standing.
    const after = everything();
    expect(run(true)).toContain("  has a town on Leaf already; left as it is");
    expect(everything()).toEqual(after);

    // Told to, it writes Bob's too, without the thing nobody can have.
    run(true, true);
    const bobs = db
      .query<{ state: string }, [string]>("SELECT state FROM play_state WHERE player_id = ? AND game = 'town'")
      .get(bob);
    expect(decodeTown(bobs?.state ?? "")?.camp.tray).toEqual({});
  });
});
