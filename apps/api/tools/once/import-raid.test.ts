import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { playerId } from "@sequoia-leaf/core";
import {
  newAlmanac,
  planRoom,
  playRoom,
  RAID,
  recordRun,
  type Run,
  saveAlmanac,
  SENSIBLE,
  startRun,
  summariseRun,
} from "@sequoia-leaf/raid";
import { type Effect, ManagedRuntime } from "effect";
import { SqlClient } from "effect/sql";

import { databaseAsItIs, databaseAt } from "../../src/db.ts";
import { type ImportOptions, importRaid } from "./import-raid.ts";

const good = playerId("20000000-0000-0000-0000-000000000001");
const greedy = playerId("20000000-0000-0000-0000-000000000002");
const garbled = playerId("20000000-0000-0000-0000-000000000003");
const returning = playerId("20000000-0000-0000-0000-000000000004");
const NOW = Date.UTC(2026, 10, 23, 9);

const directory = mkdtempSync(join(tmpdir(), "import-raid-"));
afterAll(() => rmSync(directory, { recursive: true, force: true }));
let file = "";
let made = 0;

/** Runs SQL against the temporary database, set up as Leaf sets it up. */
async function query<A>(statement: (sql: SqlClient.SqlClient) => Effect.Effect<ReadonlyArray<A>, unknown>) {
  const runtime = ManagedRuntime.make(databaseAt(file));
  try {
    return await runtime.runPromise(SqlClient.SqlClient.use(statement));
  } finally {
    await runtime.dispose();
  }
}

/** A run in progress as the battler saved it: version 1, which kept no fight. */
function oldRunOf(change: (run: Record<string, unknown>) => void = () => undefined): Record<string, unknown> {
  const run = startRun(31, { trail: 0 });
  for (let i = 0; i < 3; i++) playRoom(run, SENSIBLE);
  planRoom(run, SENSIBLE);
  const raw: Record<string, unknown> = Object.fromEntries(Object.entries(structuredClone(run)));
  delete raw.fight;
  change(raw);
  return raw;
}
const oldRunText = (change?: (run: Record<string, unknown>) => void): string =>
  JSON.stringify({ game: "little-raid", v: 1, run: oldRunOf(change) });
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
/** A ledger entry, as Leaf would have written one since the deploy. */
async function entry(player: string, amount: number, key: string) {
  await query(
    (sql) => sql`
      INSERT INTO coin_entries (player_id, amount, reason, game, key, at)
      VALUES (${player}, ${amount}, 'since', NULL, ${key}, ${NOW})
    `,
  );
}
/** A raid state on Leaf, played `rev` times. */
async function played(player: string, rev: number) {
  const table = RAID.create({ now: NOW, player: { id: player, guest: false }, seed: 1, room: 0 });
  await query(
    (sql) => sql`
      INSERT INTO play_state (player_id, game, rev, state, updated_at)
      VALUES (${player}, 'raid', ${rev}, ${RAID.encode(table)}, ${NOW})
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
      run.room = 20;
      const board = Array.isArray(run.board) ? run.board : [];
      const seat = board.findIndex((p) => p !== null);
      const piece: unknown = board[seat];
      if (typeof piece === "object" && piece !== null) {
        board[seat] = { ...piece, stars: 4, items: ["blackthorn", "wasptail", "glowthorn", "thorn"] };
      }
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
/** The run a player's stored table holds. */
async function runOf(player: string): Promise<Run | null> {
  const row = (await states()).find((s) => Object(s).player === player);
  return RAID.decode(String(Object(row).state))?.run ?? null;
}

describe("bringing the raid over from the old saves", () => {
  it("prints what it found for a person to check, with a warning for anything past play's reach, and without --write writes nothing", async () => {
    const { skipped, out } = await imported([good, greedy, garbled]);

    expect(out).toContain(`${good}:`);
    expect(out).toMatch(/run: The Easy Way, room 4 of 15, resolve \d+, level \d+ \(\d+ xp\), \d+ acorns/);
    expect(out).toMatch(/board: .+\*/);
    expect(out).toMatch(/item bench: .+; boons: .+/);
    expect(out).toContain("drawn afresh: the stall, who waits in the room, picks waiting");
    expect(out).toMatch(/almanac: 1 runs, \d+ figures fielded/);
    expect(out).toContain("old Coins: 1,234 (the purse's)");
    expect(out).toContain(
      "the Works' own: 120 (works.coins.v2, purse slot); 40 (works.save.v1, works slot); not brought over",
    );
    expect(out).toContain("nothing written: give --write to write it");
    expect(out).toContain("WARNING: 500 acorns; play reaches about 150");
    expect(out).toContain("has 4 stars; play reaches 3");
    expect(out).toContain("holds 4 items; a figure holds 3");
    expect(out).toContain("WARNING: room 21; a raid has 15");
    expect(out).toContain("WARNING: 250,000 Coins; play reaches about 20,000");
    expect(out).toContain(`${garbled}: nonsense: the run in progress does not read (it is not JSON); skipped`);
    expect(skipped).toBe(2);
    expect(await states()).toEqual([]);
    expect(await coins()).toEqual([]);
  });

  it("with --write stores the raid with nothing drawn kept from the save, and the Coins as one entry", async () => {
    const { skipped, out } = await imported([good, greedy, garbled], { write: true });

    expect(skipped).toBe(2);
    expect(out).toContain("  raid written");
    const [row, ...others] = await states();
    expect(others).toEqual([]);
    expect(row).toMatchObject({ player: good, rev: 1 });
    const table = RAID.decode(String(Object(row).state));
    expect(table?.almanac.runs).toBe(1);
    expect(table?.runs).toBe(2);
    expect(table?.looks).toEqual({ cloth: "bare", lantern: "iron", bases: "plain", owned: [] });
    // What the player has is kept; what was drawn is drawn again.
    const old = oldRunOf();
    const run = table?.run;
    const kept = ["trail", "room", "resolve", "level", "xp", "acorns", "board", "bench", "items", "boons"] as const;
    expect(Object.fromEntries(kept.map((k) => [k, old[k]]))).toEqual(
      Object.fromEntries(kept.map((k) => [k, run?.[k]])),
    );
    expect(run?.phase).toBe("plan");
    expect(run?.seed).not.toBe(old.seed);
    expect(run?.rng).not.toBe(old.rng);
    expect(run?.stall).not.toEqual(old.stall);
    expect(run?.foe).not.toEqual(old.foe);
    expect(await coins()).toEqual([{ player: good, amount: 1234, key: `import:${good}` }]);
    expect(await balances()).toEqual([{ player: good, balance: 1234 }]);
  });

  it("puts a run saved in the middle of a fight back to planning that room, with a foe of Leaf's drawing", async () => {
    const old = oldRunOf((run) => (run.phase = "fight"));
    await saved(returning, "raid", { "raid.run.v1": JSON.stringify({ game: "little-raid", v: 1, run: old }) });
    expect((await imported([returning], { write: true })).skipped).toBe(0);
    const run = await runOf(returning);
    expect(run?.phase).toBe("plan");
    expect(run?.fight).toBeNull();
    expect({ room: old.room }).toEqual({ room: run?.room });
    expect(run?.foe).not.toEqual(old.foe);
  });

  it("with --force too, brings over what play cannot reach, within reach where the rules could not hold it", async () => {
    const { skipped, out } = await imported([greedy], { write: true, force: true });

    expect(skipped).toBe(0);
    expect(out).toContain("brought within reach:");
    const run = await runOf(greedy);
    expect(run?.acorns).toBe(500);
    expect(run?.room).toBe(14);
    expect(run?.board.some((p) => p !== null && p.stars === 3 && p.items.length === 3)).toBe(true);
    expect(run?.items).toContain("thorn");
    expect(await balances()).toEqual([{ player: greedy, balance: 250_000 }]);
  });

  it("brings a returning player's Coins and raid over whatever they have done on Leaf since, the raid unless they have played it", async () => {
    // Opened the town after the deploy: the welcome, the daily chest, and a table nothing was done to.
    await saved(returning, "raid", { "raid.run.v1": oldRunText() });
    await saved(returning, "purse", { "town.purse.v1": '{"coins":800}' });
    await entry(returning, 300, `welcome:${returning}`);
    await entry(returning, 3, `page:${returning}:daily_chest:20780`);
    await played(returning, 0);
    const brought = await imported([returning], { write: true });
    expect(brought.skipped).toBe(0);
    expect(brought.out).toContain("Coins added: 500 (800 less the welcome), balance 803");
    expect((await balances()).find((b) => Object(b).player === returning)).toEqual({ player: returning, balance: 803 });
    expect((await states()).find((s) => Object(s).player === returning)).toMatchObject({ rev: 1 });
    // Once: run again, nothing more is added, and the raid, played now, is left alone.
    const again = await imported([returning], { write: true });
    expect(again.out).toContain("Coins already added");
    expect(again.out).toContain("raid not written: they have played on Leaf since (rev 1); --force writes over it");
    expect(again.skipped).toBe(1);
    expect((await coins()).filter((c) => Object(c).key === `import:${returning}`)).toHaveLength(1);
  });

  it("leaves a raid played on Leaf alone but still adds the Coins; --force writes the raid over it", async () => {
    await played(good, 5);
    await entry(good, 300, `welcome:${good}`);
    const first = await imported([good], { write: true });
    expect(first.out).toContain("raid not written: they have played on Leaf since (rev 5)");
    expect(first.skipped).toBe(1);
    expect(await balances()).toEqual([{ player: good, balance: 1234 }]);
    expect((await states())[0]).toMatchObject({ rev: 5 });
    const forced = await imported([good], { write: true, force: true });
    expect(forced.out).toContain("raid written over rev 5");
    expect(forced.skipped).toBe(0);
    expect((await states())[0]).toMatchObject({ rev: 6 });
    expect((await runOf(good))?.room).toBe(3);
    expect(await balances()).toEqual([{ player: good, balance: 1234 }]);
  });

  it("never takes a balance below nothing: Coins spent since the welcome are not taken back", async () => {
    await saved(returning, "purse", { "town.purse.v1": '{"coins":80}' });
    await entry(returning, 300, `welcome:${returning}`);
    await entry(returning, -250, `page:${returning}:t-1`);
    expect((await imported([returning], { write: true })).out).toContain("Coins added: -50");
    expect((await balances()).find((b) => Object(b).player === returning)).toEqual({ player: returning, balance: 0 });
  });

  it("runs no migration: on a file without Leaf's play tables, or no file at all, it does nothing", async () => {
    const bare = join(directory, `bare-${++made}.db`);
    // A database from before the play service: it has the old saves and nothing else of Leaf's.
    await Bun.write(bare, "");
    const opened = ManagedRuntime.make(databaseAsItIs(bare));
    await opened.runPromise(
      SqlClient.SqlClient.use((sql) => sql`CREATE TABLE saves (player_id TEXT, slot TEXT, data TEXT)`),
    );
    await opened.dispose();
    const lines: string[] = [];
    expect(await importRaid(bare, [good], options({ write: true }), (line) => lines.push(line))).toBe(1);
    expect(lines.join("\n")).toContain("no play_state, coins, coin_entries: Leaf's play service is not set up on it");
    const after = ManagedRuntime.make(databaseAsItIs(bare));
    const tables = await after.runPromise(
      SqlClient.SqlClient.use((sql) => sql`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`),
    );
    await after.dispose();
    expect(tables).toEqual([{ name: "saves" }]);
    const nowhere = join(directory, "nowhere.db");
    expect(await importRaid(nowhere, [good], options({ write: true }), () => undefined)).toBe(1);
    expect(existsSync(nowhere)).toBe(false);
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
