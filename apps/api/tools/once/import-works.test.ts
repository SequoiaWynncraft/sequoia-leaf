import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { playerId } from "@sequoia-leaf/core";
import { WORKS } from "@sequoia-leaf/yard";
import mid from "@sequoia-leaf/yard/yards/mid.json";
import { type Effect, ManagedRuntime } from "effect";
import { SqlClient } from "effect/sql";

import { databaseAsItIs, databaseAt } from "../../src/db.ts";
import { type ImportOptions, importWorks } from "./import-works.ts";

const good = playerId("20000000-0000-0000-0000-000000000001");
const rich = playerId("20000000-0000-0000-0000-000000000002");
const odd = playerId("20000000-0000-0000-0000-000000000003");
const garbled = playerId("20000000-0000-0000-0000-000000000004");
const nobody = playerId("20000000-0000-0000-0000-000000000005");
const NOW = Date.UTC(2026, 10, 23, 9);
const DAY = 86_400_000;

const directory = mkdtempSync(join(tmpdir(), "import-works-"));
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

/** A kept yard as the page saved it, version 2, with the wall clock's moment and a second shift. */
function oldYard(change: (raw: Record<string, unknown>) => void = () => undefined): string {
  const { v: _v, at: _at, bank: _bank, told: _told, ...rest } = mid;
  const raw: Record<string, unknown> = { ...rest, v: 2, seen: NOW - DAY, boostUntil: NOW - DAY + 60_000 };
  change(raw);
  return JSON.stringify(raw);
}
async function saved(player: string, keys: Record<string, string>) {
  const data = JSON.stringify({ saved_at: NOW - DAY, keys });
  await query(
    (sql) => sql`
      INSERT INTO saves (player_id, slot, version, data, updated_at, guest)
      VALUES (${player}, 'works', 4, ${data}, ${NOW - DAY}, 0)
    `,
  );
}
/** A yard on Leaf, played `rev` times, having made a Coins change for each. */
async function played(player: string, rev: number) {
  const yard = WORKS.create({ now: NOW, player: { id: player, guest: false }, seed: 1, room: 0 });
  yard.bank = rev;
  await query(
    (sql) => sql`
      INSERT INTO play_state (player_id, game, rev, state, updated_at)
      VALUES (${player}, 'works', ${rev}, ${WORKS.encode(yard)}, ${NOW})
    `,
  );
}

beforeEach(async () => {
  file = join(directory, `leaf-${++made}.db`);
  await saved(good, { "works.save.v2": oldYard(), "works.screen.v1": '{"taught":[],"zoom":0}' });
  await saved(rich, { "works.save.v2": oldYard((raw) => (raw.till = 50_000)) });
  // A belt on land the yard does not own, and a plan there is no such of.
  await saved(odd, {
    "works.save.v2": oldYard((raw) => {
      raw.cells = [...(Array.isArray(raw.cells) ? raw.cells : []), { i: 0, k: "belt", d: 0 }];
      raw.plans = [...(Array.isArray(raw.plans) ? raw.plans : []), "thirdtier"];
    }),
  });
  await saved(garbled, { "works.save.v2": "{not json" });
});

const options = (o: Partial<ImportOptions> = {}): ImportOptions => ({
  write: false,
  force: false,
  now: NOW,
  dice: () => 4242,
  ...o,
});

async function imported(ids: readonly string[], o: Partial<ImportOptions> = {}) {
  const lines: string[] = [];
  const skipped = await importWorks(file, ids, options(o), (line) => lines.push(line));
  return { skipped, out: lines.join("\n") };
}

const states = () => query((sql) => sql`SELECT player_id AS player, rev, state FROM play_state ORDER BY player_id`);
/** The yard a player's stored state holds. */
async function yardOf(player: string) {
  const row = (await states()).find((s) => Object(s).player === player);
  return WORKS.decode(String(Object(row).state));
}

describe("bringing the Works over from the old saves", () => {
  it("prints what it found for a person to check, with a warning for anything out of line, and without --write writes nothing", async () => {
    const { skipped, out } = await imported([good, rich, odd, garbled, nobody, "not-an-id"]);

    expect(out).toContain(`${good}:`);
    expect(out).toContain(`  story: ${mid.story} of 20 orders done; ${mid.done} standing orders handed over; tick`);
    expect(out).toContain(`  plots: ${mid.plots.join(", ")}; plans: ${mid.plans.join(", ")}`);
    expect(out).toMatch(/ {2}standing: belt \d+, gatherer \d+, .*mill \d+/);
    expect(out).toMatch(/ {2}till: \d+; the depot took in: plank [\d,]+/);
    expect(out).toContain("nothing written: give --write to write it");
    expect(out).toContain("WARNING: a till of 50,000; play leaves about 30,000 at most");
    expect(out).toContain("WARNING: 1 piece the rules dropped on reading it");
    expect(out).toContain("WARNING: 1 plan the rules dropped on reading it");
    expect(out).toContain("yard held back: --force brings it over as shown");
    expect(out).toContain(`${garbled}: nonsense: the yard is not one the page kept (version 2); skipped`);
    expect(out).toContain(`${nobody}: no yard saved; skipped`);
    expect(out).toContain("not-an-id: not a player id; skipped");
    expect(skipped).toBe(5);
    expect(await states()).toEqual([]);
  });

  it("with --write stores the yard as it stood, at Leaf's clock now, with a new seed and no second shift", async () => {
    const { skipped, out } = await imported([good, rich, odd], { write: true });

    expect(skipped).toBe(2);
    expect(out).toContain("  yard written");
    expect((await states()).map((s) => [Object(s).player, Object(s).rev])).toEqual([[good, 1]]);
    const yard = await yardOf(good);
    expect(yard).toMatchObject({ tick: mid.tick, at: NOW, bank: 0, told: 0, story: mid.story, seed: 4242 });
    expect(yard?.seed).not.toBe(mid.seed);
    expect(yard?.board.map((o) => o.id)).toEqual(mid.board.map((o) => o.id));
    expect(yard?.cells.filter((b) => b !== null && b.kind !== "depot")).toHaveLength(mid.cells.length);
    expect(String(Object((await states())[0]).state)).not.toContain("boostUntil");
  });

  it("with --force too, brings over a yard with a warning, as shown", async () => {
    const { skipped } = await imported([rich, odd], { write: true, force: true });

    expect(skipped).toBe(0);
    expect((await yardOf(rich))?.till).toBe(50_000);
    expect((await yardOf(odd))?.plans.join()).toBe(mid.plans.join());
  });

  it("leaves a yard played on Leaf alone; --force writes over it", async () => {
    await played(good, 3);
    const first = await imported([good], { write: true });
    expect(first.out).toContain("yard not written: they have played on Leaf since (rev 3); --force writes over it");
    expect(first.skipped).toBe(1);
    expect((await yardOf(good))?.story).toBe(0);
    const forced = await imported([good], { write: true, force: true });
    expect(forced.out).toContain("yard written over rev 3");
    expect((await states())[0]).toMatchObject({ rev: 4 });
    // Its Coins are counted on from the yard it replaced, so no key is made twice.
    expect(await yardOf(good)).toMatchObject({ story: mid.story, bank: 3 });
    // A yard nothing has been done to on Leaf is written over without being forced.
    await played(rich, 0);
    expect((await imported([rich], { write: true, force: true })).out).toContain("  yard written");
  });

  it("runs no migration: on a file without Leaf's play tables, or no file at all, it does nothing", async () => {
    const bare = join(directory, `bare-${++made}.db`);
    await Bun.write(bare, "");
    const opened = ManagedRuntime.make(databaseAsItIs(bare));
    await opened.runPromise(
      SqlClient.SqlClient.use((sql) => sql`CREATE TABLE saves (player_id TEXT, slot TEXT, data TEXT)`),
    );
    await opened.dispose();
    const lines: string[] = [];
    expect(await importWorks(bare, [good], options({ write: true }), (line) => lines.push(line))).toBe(1);
    expect(lines.join("\n")).toContain("no play_state: Leaf's play service is not set up on it");
    const after = ManagedRuntime.make(databaseAsItIs(bare));
    const tables = await after.runPromise(
      SqlClient.SqlClient.use((sql) => sql`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`),
    );
    await after.dispose();
    expect(tables).toEqual([{ name: "saves" }]);
    const nowhere = join(directory, "nowhere.db");
    expect(await importWorks(nowhere, [good], options({ write: true }), () => undefined)).toBe(1);
    expect(existsSync(nowhere)).toBe(false);
  });

  it("runs from the command line, for the players named and nobody else", async () => {
    const tool = join(import.meta.dir, "import-works.ts");
    const usage = Bun.spawnSync(["bun", tool]);
    expect(usage.exitCode).toBe(2);
    expect(usage.stderr.toString()).toContain(
      "Usage: bun apps/api/tools/once/import-works.ts <database file> <player id>...",
    );
    const dry = Bun.spawnSync(["bun", tool, file, good]);
    expect(dry.exitCode).toBe(0);
    expect(dry.stdout.toString()).toContain(`${good}:`);
    expect(dry.stdout.toString()).not.toContain(rich);
    expect(await states()).toEqual([]);
  });
});
