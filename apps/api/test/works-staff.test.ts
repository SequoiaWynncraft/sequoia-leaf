import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { playerId } from "@sequoia-leaf/core";
import * as F from "@sequoia-leaf/factory";
import { Effect, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";

import { parseCliArgs } from "../scripts/works-staff.ts";
import { readStaffEdit } from "../src/play/staff-edits.ts";
import { PlayStore } from "../src/play/store.ts";
import { editWorks, exportWorks, worksEdits } from "../src/play/works-staff.ts";
import { fakeBackend, sessionOf, testLeaf } from "./support.ts";

const alice = playerId("10000000-0000-0000-0000-000000000001");
const bob = playerId("10000000-0000-0000-0000-000000000002");
const dave = playerId("10000000-0000-0000-0000-000000000004");
const STAFF = { id: dave, name: "Dave" } as const;
const T0 = Date.UTC(2026, 10, 25, 12);

const clock = { now: T0 };
let services: ReturnType<typeof testLeaf>;
let app: ReturnType<(typeof services)["app"]>;

beforeEach(async () => {
  clock.now = T0;
  const fake = fakeBackend({
    "alice-token": () => Response.json(sessionOf(alice, "Alice", "CAPTAIN")),
    "bob-token": () => Response.json(sessionOf(bob, "Bob", "CAPTAIN")),
  });
  services = testLeaf(clock, fake.fetcher);
  app = services.app();
  // Open Alice's and Bob's Works yards so both exist in play_state.
  expect((await request("alice", "GET", "/v1/game/play/works")).status).toBe(200);
  expect((await request("bob", "GET", "/v1/game/play/works")).status).toBe(200);
});

afterEach(async () => {
  await app.dispose();
  await services.dispose();
});

function request(who: "alice" | "bob", method: string, path: string, body?: unknown) {
  return app.request(path, {
    method,
    headers: { Authorization: `Bearer ${who}-token`, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

const storedWorks = (player: typeof alice) =>
  services.run(
    Effect.gen(function* () {
      const store = yield* PlayStore;
      return Option.getOrNull(yield* store.read(player, "works"));
    }),
  );

const CountRow = Schema.Struct({ n: Schema.Int });

const countOf = (query: Effect.Effect<readonly unknown[], unknown>) =>
  SqlSchema.findOne({ Request: Schema.Void, Result: CountRow, execute: () => query })(undefined).pipe(
    Effect.map((row) => row.n),
    Effect.orDie,
  );

const countsInDb = (player: typeof alice) =>
  services.run(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return {
        activity: yield* countOf(sql`SELECT count(*) AS n FROM activity WHERE player_id = ${player}`),
        coins: yield* countOf(
          sql`SELECT count(*) AS n FROM coin_entries WHERE player_id = ${player} AND game = 'works'`,
        ),
        edits: yield* countOf(sql`SELECT count(*) AS n FROM play_staff_edits WHERE player_id = ${player}`),
      };
    }),
  );

describe("Works staff service", () => {
  it("applies learn and plots through Play, logs exact before-text, emits no player activity or coins, and undo restores cleanly", async () => {
    const beforeRow = await storedWorks(alice);
    expect(beforeRow).not.toBeNull();
    if (!beforeRow) return;

    // Apply learn=tooling3 through the play service.
    const learned = await services.run(editWorks(alice, { do: "learn", goals: ["tooling3"] }, STAFF, false));
    expect(learned.ok).toBe(true);
    expect(learned.dry).toBe(false);
    expect(learned.editId).toBe(1);
    expect(learned.goalsAdded).toEqual(["workshop", "tooling", "tooling3"]);
    expect(learned.cost).toBe(0);
    expect(learned.refused).toBeNull();

    // Check play_staff_edits row holds the exact yard text the command ran on.
    const logged = await services.run(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return Option.getOrNull(yield* readStaffEdit(sql, alice, "works", 1));
      }),
    );
    expect(logged).not.toBeNull();
    expect(logged?.before).toBe(beforeRow.state);
    expect(logged?.revBefore).toBe(beforeRow.rev);
    expect(learned.revAfter).toBe(logged?.revAfter ?? null);
    expect(logged?.by).toBe(dave);
    expect(logged?.command).toEqual({ do: "learn", goals: ["tooling3"] });

    // No player-visible activity or Works coin entries.
    expect(await countsInDb(alice)).toEqual({ activity: 0, coins: 0, edits: 1 });

    // Yard in play_state now has workshop/tooling/tooling3 done.
    const afterLearn = await storedWorks(alice);
    const decodedAfter = afterLearn ? F.decode(afterLearn.state) : null;
    expect(decodedAfter?.done).toContain(F.goal("tooling3"));

    // Undo restores the exact earlier yard.
    const undone = await services.run(editWorks(alice, { do: "undo", editId: 1, force: false }, STAFF, false));
    expect(undone.ok).toBe(true);
    expect(undone.editId).toBe(2);
    const afterUndo = await storedWorks(alice);
    expect(afterUndo?.state).toBe(beforeRow.state);
    expect(await countsInDb(alice)).toEqual({ activity: 0, coins: 0, edits: 2 });

    // Recent edits list returns newest first without huge payloads.
    const list = await services.run(worksEdits(alice));
    expect(list.edits.map((e) => e.id)).toEqual([2, 1]);
    expect(list.edits[0]?.command).toEqual({ do: "restore", undo: 1, force: false });
  });

  it("refuses undo after a later player command unless force is set", async () => {
    const first = await services.run(editWorks(alice, { do: "plots", plots: ["meadow"] }, STAFF, false));
    expect(first.ok).toBe(true);
    expect(first.editId).not.toBeNull();
    if (first.editId === null) return;

    // Alice sends a normal player command (build a belt) moving rev forward.
    const beforePlay = await storedWorks(alice);
    const yard = beforePlay ? F.decode(beforePlay.state) : null;
    expect(yard).not.toBeNull();
    if (!yard) return;
    const [dx, dy] = yard.land.depot;
    const playerCmd = await request("alice", "POST", "/v1/game/play/works", {
      player: alice,
      commands: [{ id: "p-1", tick: yard.tick, do: "build", kind: "belt", x: dx + 2, y: dy + 2, dir: 0 }],
    });
    expect(playerCmd.status).toBe(200);
    const afterPlayer = await storedWorks(alice);
    expect(afterPlayer?.rev).toBeGreaterThan(first.revAfter ?? 0);

    // Undo without force is refused.
    const blocked = await services.run(
      editWorks(alice, { do: "undo", editId: first.editId, force: false }, STAFF, false),
    );
    expect(blocked.ok).toBe(false);
    expect(blocked.refused).toBe("rev_moved");
    expect(blocked.editId).toBeNull();
    expect((await storedWorks(alice))?.rev).toBe(afterPlayer?.rev);

    // Undo with force succeeds and removes meadow.
    const forced = await services.run(
      editWorks(alice, { do: "undo", editId: first.editId, force: true }, STAFF, false),
    );
    expect(forced.ok).toBe(true);
    const restored = await storedWorks(alice);
    const decoded = restored ? F.decode(restored.state) : null;
    expect(decoded?.plots).not.toContain(F.plot("meadow"));
  });

  it("dry runs real rules and writes nothing to play_state or play_staff_edits", async () => {
    const before = await storedWorks(alice);
    const dryOk = await services.run(editWorks(alice, { do: "plots", plots: ["meadow", "workings"] }, STAFF, true));
    expect(dryOk.ok).toBe(true);
    expect(dryOk.dry).toBe(true);
    expect(dryOk.editId).toBeNull();
    expect(dryOk.plotsAdded).toEqual(["meadow", "workings"]);
    expect(dryOk.cost).toBeGreaterThan(0);

    const dryBad = await services.run(editWorks(alice, { do: "learn", goals: ["not_a_goal"] }, STAFF, true));
    expect(dryBad.ok).toBe(false);
    expect(dryBad.refused).toBe("unknown_goal");

    expect(await storedWorks(alice)).toEqual(before);
    expect(await countsInDb(alice)).toEqual({ activity: 0, coins: 0, edits: 0 });
  });

  it("supports code placement, copy from another player, and read-only export", async () => {
    // Place 2 belts into Bob's yard via blueprint code.
    const bobRow = await storedWorks(bob);
    const bobYard = bobRow ? F.decode(bobRow.state) : null;
    expect(bobYard).not.toBeNull();
    if (!bobYard) return;
    const [dx, dy] = bobYard.land.depot;
    const code = F.packedCode(
      F.packPrint(
        F.packPieces([
          { kind: F.BELT, x: 0, y: 0, dir: 0, span: 0 },
          { kind: F.BELT, x: 1, y: 0, dir: 0, span: 0 },
        ]),
      ),
    );
    const placed = await services.run(
      editWorks(bob, { do: "code", code, x: dx + 2, y: dy + 2, turn: 1, replace: false }, STAFF, false),
    );
    expect(placed.ok).toBe(true);
    expect(placed.piecesBefore).toBe(0);
    expect(placed.piecesAfter).toBe(2);

    // Export Bob's yard read-only.
    const exported = await services.run(exportWorks(bob));
    expect(exported.ok).toBe(true);
    if (exported.ok) {
      expect(exported.pieces).toBe(2);
      expect(exported.parts.length).toBe(1);
      expect(F.codePieces(exported.parts[0]?.code ?? "")?.length).toBe(2);
    }

    // Copy Bob's pieces into Alice's yard (replace mode).
    const copied = await services.run(editWorks(alice, { do: "copy", source: bob }, STAFF, false));
    expect(copied.ok).toBe(true);
    expect(copied.piecesBefore).toBe(0);
    expect(copied.piecesAfter).toBe(2);
    // Stored command summary in play_staff_edits must not embed the packed payload.
    const list = await services.run(worksEdits(alice));
    expect(list.edits[0]?.command).toEqual({ do: "pieces", copy: bob, replace: true, pieces: 2 });
  });

  it("rejects staff commands sent over the player HTTP play endpoint", async () => {
    const res = await request("alice", "POST", "/v1/game/play/works", {
      player: alice,
      commands: [{ id: "hack-1", tick: 0, do: "learn", goals: ["felling"], by: alice, name: "Alice" }],
    });
    expect(res.status).toBe(400);
    expect(await countsInDb(alice)).toEqual({ activity: 0, coins: 0, edits: 0 });
  });

  it("parses CLI arguments for every subcommand and rejects invalid invocations", () => {
    expect(parseCliArgs([alice, `by=${dave}`, "learn=felling,tooling3"])).toEqual({
      kind: "edit",
      player: alice,
      by: dave,
      dry: false,
      action: { do: "learn", goals: ["felling", "tooling3"] },
    });
    expect(parseCliArgs([alice, `by=${dave}`, "dry", "plots=meadow,workings"])).toEqual({
      kind: "edit",
      player: alice,
      by: dave,
      dry: true,
      action: { do: "plots", plots: ["meadow", "workings"] },
    });
    expect(parseCliArgs([alice, `by=${dave}`, `copy=${bob}`])).toEqual({
      kind: "edit",
      player: alice,
      by: dave,
      dry: false,
      action: { do: "copy", source: bob },
    });
    expect(parseCliArgs([alice, `by=${dave}`, "code=wb1.abc", "at=10,20", "turn=2", "replace"])).toEqual({
      kind: "edit",
      player: alice,
      by: dave,
      dry: false,
      action: { do: "code", code: "wb1.abc", x: 10, y: 20, turn: 2, replace: true },
    });
    expect(parseCliArgs([alice, `by=${dave}`, "undo=5", "force"])).toEqual({
      kind: "edit",
      player: alice,
      by: dave,
      dry: false,
      action: { do: "undo", editId: 5, force: true },
    });
    expect(parseCliArgs([alice, `by=${dave}`, "edits"])).toEqual({ kind: "edits", player: alice });
    expect(parseCliArgs([alice, "export"])).toEqual({ kind: "export", player: alice });
    // Invalid combinations rejected.
    expect(parseCliArgs([alice, "learn=felling"])).toBeNull();
    expect(parseCliArgs([alice, `by=${dave}`, "learn=felling", "plots=meadow"])).toBeNull();
    expect(parseCliArgs([alice, `by=${dave}`, "code=wb1.abc"])).toBeNull();
    expect(parseCliArgs([alice, `by=${dave}`, "undo=0"])).toBeNull();
  });
});
