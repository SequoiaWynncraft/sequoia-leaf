import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { playerId } from "@sequoia-leaf/core";
import {
  newAlmanac,
  planRoom,
  playRoom,
  RAID,
  recordRun,
  saveAlmanac,
  SENSIBLE,
  startRun,
  summariseRun,
} from "@sequoia-leaf/raid";
import { type Effect, ManagedRuntime } from "effect";
import { SqlClient } from "effect/sql";

import { databaseAt } from "../../src/db.ts";
import { type ImportOptions, importRaid } from "./import-raid.ts";

const good = playerId("20000000-0000-0000-0000-000000000001");
const greedy = playerId("20000000-0000-0000-0000-000000000002");
const garbled = playerId("20000000-0000-0000-0000-000000000003");
const welcomed = playerId("20000000-0000-0000-0000-000000000004");
const NOW = Date.UTC(2026, 10, 23, 9);

const directory = mkdtempSync(join(tmpdir(), "import-raid-"));
afterAll(() => rmSync(directory, { recursive: true, force: true }));
let file = "";
let made = 0;

/** Runs SQL against the temporary database, as the tool finds it. */
async function query<A>(statement: (sql: SqlClient.SqlClient) => Effect.Effect<ReadonlyArray<A>, unknown>) {
  const runtime = ManagedRuntime.make(databaseAt(file));
  try {
    return await runtime.runPromise(SqlClient.SqlClient.use(statement));
  } finally {
    await runtime.dispose();
  }
}

/** A run in progress as the battler saved it: version 1, which kept no fight. */
function oldRunText(change: (run: Record<string, unknown>) => void = () => undefined): string {
  const run = startRun(31, { trail: 0 });
  for (let i = 0; i < 3; i++) playRoom(run, SENSIBLE);
  planRoom(run, SENSIBLE);
  const raw: Record<string, unknown> = Object.fromEntries(Object.entries(structuredClone(run)));
  delete raw.fight;
  change(raw);
  return JSON.stringify({ game: "little-raid", v: 1, run: raw });
}
function oldAlmanacText(): string {
  const finished = startRun(5, { trail: 0 });
  for (let i = 0; i < 40 && finished.phase !== "over"; i++) playRoom(finished, SENSIBLE);
  return saveAlmanac(recordRun(newAlmanac(), summariseRun(finished)).almanac);
}
/** An old save slot, as the kit's cloud sent it. */
const slot = (keys: Record<string, string>) => JSON.stringify({ saved_at: NOW - 86_400_000, keys });

async function saved(player: string, name: "raid" | "purse" | "works", keys: Record<string, string>) {
  await query(
    (sql) => sql`
      INSERT INTO saves (player_id, slot, version, data, updated_at, guest)
      VALUES (${player}, ${name}, 4, ${slot(keys)}, ${NOW - 86_400_000}, 0)
    `,
  );
}

beforeEach(async () => {
  file = join(directory, `leaf-${++made}.db`);
  await saved(good, "raid", { "raid.run.v1": oldRunText(), "raid.almanac.v1": oldAlmanacText() });
  // The Works once kept Coins of its own too, under its own keys, which the page carried into the purse.
  await saved(good, "purse", { "town.purse.v1": '{"coins":1234}', "works.coins.v2": "120" });
  await saved(good, "works", {
    "works.save.v2": "{}",
    "works.save.v1": JSON.stringify({ cells: [], order: 0, coins: 40 }),
  });
  await saved(greedy, "raid", {
    "raid.run.v1": oldRunText((run) => {
      run.acorns = 500;
      const board = Array.isArray(run.board) ? run.board : [];
      const seat = board.findIndex((p) => p !== null);
      const piece: unknown = board[seat];
      if (typeof piece === "object" && piece !== null) board[seat] = { ...piece, stars: 4 };
    }),
  });
  await saved(greedy, "purse", { "town.purse.v1": '{"coins":250000}' });
  await saved(garbled, "raid", { "raid.run.v1": "{not json", "raid.almanac.v1": "{}" });
});

let dice = 0;
const options = (o: Partial<ImportOptions> = {}): ImportOptions => ({
  write: false,
  force: false,
  now: NOW,
  dice: () => (dice += 0x9e3779b1) >>> 0,
  ...o,
});

async function imported(ids: readonly string[], o: Partial<ImportOptions> = {}) {
  const lines: string[] = [];
  const skipped = await importRaid(file, ids, options(o), (line) => lines.push(line));
  return { skipped, out: lines.join("\n") };
}

const states = () => query((sql) => sql`SELECT player_id AS player, rev, state FROM play_state ORDER BY player_id`);
const coins = () => query((sql) => sql`SELECT player_id AS player, amount, key FROM coin_entries ORDER BY id`);
const balances = () => query((sql) => sql`SELECT player_id AS player, balance FROM coins ORDER BY player_id`);

describe("bringing the raid over from the old saves", () => {
  it("prints what it found for a person to check, and without --write writes nothing", async () => {
    const { skipped, out } = await imported([good, greedy, garbled]);

    expect(out).toContain(`${good}:`);
    expect(out).toMatch(/run: The Easy Way, room 4 of 15 \(plan\), resolve \d+, level \d+, \d+ acorns/);
    expect(out).toMatch(/board: .+\*/);
    expect(out).toMatch(/almanac: 1 runs, \d+ figures fielded/);
    expect(out).toContain("coins: 1,234 (the purse's: these are brought over)");
    expect(out).toContain(
      "the Works' own: 120 (works.coins.v2, purse slot); 40 (works.save.v1, works slot); not brought over",
    );
    expect(out).toContain("would be brought over (nothing written: give --write to write it)");
    expect(out).toContain("WARNING: 500 acorns; play reaches about 200");
    expect(out).toContain("has 4 stars; play reaches 3");
    expect(out).toContain("WARNING: 250000 Coins; play reaches about 100000");
    expect(out).toContain(`${garbled}: nonsense: the run in progress does not read (it is not JSON); skipped`);
    expect(skipped).toBe(2);
    expect(await states()).toEqual([]);
    expect(await coins()).toEqual([]);
  });

  it("with --write stores the good one as its play state and its Coins as one entry, and skips the rest", async () => {
    const { skipped, out } = await imported([good, greedy, garbled], { write: true });

    expect(skipped).toBe(2);
    expect(out).toContain("  written");
    const [row, ...others] = await states();
    expect(others).toEqual([]);
    expect(row).toMatchObject({ player: good, rev: 1 });
    const table = RAID.decode(String(Object(row).state));
    expect(table?.run?.room).toBe(3);
    expect(table?.almanac.runs).toBe(1);
    expect(table?.runs).toBe(2);
    expect(table?.looks).toEqual({ cloth: "bare", lantern: "iron", bases: "plain", owned: [] });
    // The stream is drawn afresh: the old one was in the browser.
    const old: unknown = JSON.parse(oldRunText());
    expect(table?.run?.rng).not.toBe(Object(Object(old).run).rng);
    expect(await coins()).toEqual([{ player: good, amount: 1234, key: `import:${good}` }]);
    expect(await balances()).toEqual([{ player: good, balance: 1234 }]);
  });

  it("with --force too, brings over what play cannot reach, within reach where the rules could not hold it", async () => {
    const { skipped, out } = await imported([greedy], { write: true, force: true });

    expect(skipped).toBe(0);
    expect(out).toContain("brought within reach:");
    const [row] = await states();
    const table = RAID.decode(String(Object(row).state));
    expect(table?.run?.acorns).toBe(500);
    expect(table?.run?.board.some((p) => p !== null && p.stars === 3)).toBe(true);
    expect(await balances()).toEqual([{ player: greedy, balance: 250000 }]);
  });

  it("leaves alone a player who has played on Leaf since, and brings a welcomed one's balance to the old purse", async () => {
    await imported([good], { write: true });
    const again = await imported([good], { write: true });
    expect(again.out).toContain("not written: they have played on Leaf since (rev 1)");
    expect(again.skipped).toBe(1);
    expect(await coins()).toEqual([{ player: good, amount: 1234, key: `import:${good}` }]);

    // One who opened the game after the move, and so has the welcome and a new table nothing was done to.
    await saved(welcomed, "raid", { "raid.run.v1": oldRunText() });
    await saved(welcomed, "purse", { "town.purse.v1": '{"coins":80}' });
    await query(
      (sql) => sql`
        INSERT INTO play_state (player_id, game, rev, state, updated_at)
        VALUES (${welcomed}, 'raid', 0, ${RAID.encode(RAID.create({ now: NOW, player: { id: welcomed, guest: false }, seed: 1 }))}, ${NOW})
      `,
    );
    await query(
      (sql) => sql`
        INSERT INTO coin_entries (player_id, amount, reason, game, key, at)
        VALUES (${welcomed}, 300, 'Welcome to Guild Town', NULL, ${`welcome:${welcomed}`}, ${NOW})
      `,
    );
    const brought = await imported([welcomed], { write: true });
    expect(brought.skipped).toBe(0);
    expect((await balances()).find((b) => Object(b).player === welcomed)).toEqual({ player: welcomed, balance: 80 });
    expect((await states()).find((s) => Object(s).player === welcomed)).toMatchObject({ rev: 1 });
  });

  it("runs from the command line, for the players named and nobody else", async () => {
    const tool = join(import.meta.dir, "import-raid.ts");
    const usage = Bun.spawnSync(["bun", tool]);
    expect(usage.exitCode).toBe(2);
    expect(usage.stderr.toString()).toContain(
      "Usage: bun apps/api/tools/once/import-raid.ts <database file> <player id>...",
    );
    const dry = Bun.spawnSync(["bun", tool, file, good]);
    expect(dry.exitCode).toBe(0);
    expect(dry.stdout.toString()).toContain(`${good}:`);
    expect(dry.stdout.toString()).not.toContain(greedy);
    expect(await states()).toEqual([]);
  });
});
