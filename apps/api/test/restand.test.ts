import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { type Ctx, playerId } from "@sequoia-leaf/core";
import { RAID, recordRun, type RunSummary, type Table } from "@sequoia-leaf/raid";
import { Schema } from "effect";

import { restandAll } from "../src/play/restand.ts";
import { PlayStore } from "../src/play/store.ts";
import { type LogLine, noNetwork, testLeaf } from "./support.ts";

const alice = playerId("10000000-0000-0000-0000-000000000001");
const bob = playerId("10000000-0000-0000-0000-000000000002");
/** Wednesday 25 November 2026, 12:00 UTC. */
const T0 = Date.UTC(2026, 10, 25, 12);
const HOUR = 3_600_000;
const ctx: Ctx = { now: T0, player: { id: alice, guest: false }, seed: 1, room: 0, awards: [], postcards: {} };

/** A table whose almanac has the same three bosses beaten on each of the first `trails` trails. */
function beaten(trails: number): Table {
  const table = RAID.create(ctx);
  for (let trail = 0; trail < trails; trail++) {
    const run: RunSummary = {
      trail,
      ending: "won",
      cleared: 12,
      reached: 12,
      bosses: ["oldbramble", "hoardmagpie", "bigcrab"],
      fielded: [],
      threeStars: [],
      forged: [],
      topped: [],
    };
    table.almanac = recordRun(table.almanac, run).almanac;
  }
  return table;
}

const Stood = Schema.Struct({ score: Schema.Number, also: Schema.String, updatedAt: Schema.Number });
const Marked = Schema.Struct({ rev: Schema.Number, stood: Schema.NullOr(Schema.Number) });

let clock = { now: T0 };
let leaf = testLeaf(clock, noNetwork);
let logged: LogLine[] = [];
beforeEach(() => {
  clock = { now: T0 };
  logged = [];
  leaf = testLeaf(clock, noNetwork, {}, { logged });
});
afterEach(() => leaf.dispose());

/** Keeps a state and where it stands, as a Leaf whose rules summed each trail's bosses wrote them at `at`. */
async function keptBefore(player: string, rev: number, state: string, score: number, at: number) {
  await leaf.query(
    (sql) => sql`
      INSERT INTO play_state (player_id, game, rev, state, updated_at, born, due_at)
      VALUES (${player}, 'raid', ${rev}, ${state}, ${at}, ${at}, NULL)
      ON CONFLICT (player_id, game) DO UPDATE SET rev = excluded.rev, state = excluded.state, updated_at = excluded.updated_at
    `,
  );
  await leaf.query(
    (sql) => sql`
      INSERT INTO standings (player_id, game, score, also, guest, updated_at)
      VALUES (${player}, 'raid', ${score}, '{"runs":0,"room":0}', 0, ${at})
      ON CONFLICT (player_id, game) DO UPDATE SET
        score = excluded.score,
        updated_at = CASE WHEN score = excluded.score THEN updated_at ELSE excluded.updated_at END
    `,
  );
}
const standing = async (player: string) =>
  Schema.decodeUnknownSync(Schema.Array(Stood))(
    await leaf.query(
      (sql) => sql`
        SELECT score, also, updated_at AS updatedAt FROM standings WHERE player_id = ${player} AND game = 'raid'
      `,
    ),
  );
const marked = async (player: string, game = "raid") =>
  Schema.decodeUnknownSync(Schema.Array(Marked))(
    await leaf.query((sql) => sql`SELECT rev, stood FROM play_state WHERE player_id = ${player} AND game = ${game}`),
  );
const restand = () => leaf.run(restandAll);

describe("where a state stands, worked out again", () => {
  it("counts each boss once for a table stood by the rules that summed each trail's, whether or not its player comes back, and keeps when it was reached", async () => {
    // Alice beat the three bosses on two trails, Bob on one, as Leaf stood them before.
    await keptBefore(alice, 5, RAID.encode(beaten(2)), 6, T0 - 2 * HOUR);
    await keptBefore(bob, 3, RAID.encode(beaten(1)), 3, T0 - HOUR);
    expect(await restand()).toBe("done");
    expect(await standing(alice)).toEqual([{ score: 3, also: '{"runs":2,"room":12}', updatedAt: T0 - 2 * HOUR }]);
    expect(await standing(bob)).toEqual([{ score: 3, also: '{"runs":1,"room":12}', updatedAt: T0 - HOUR }]);
    expect([await marked(alice), await marked(bob)]).toEqual([[{ rev: 5, stood: 5 }], [{ rev: 3, stood: 3 }]]);
    // Worked out once: the next run has nothing to do.
    expect(await restand()).toBe("idle");
  });

  it("works out again what a Leaf from before writes beside this one in a deploy, after this one did", async () => {
    await keptBefore(alice, 5, RAID.encode(beaten(2)), 6, T0 - 2 * HOUR);
    await restand();
    // The Leaf still running beside it keeps a batch of Alice's: the table at rev 6, where it stands by its rules.
    clock.now = T0 + 30_000;
    await keptBefore(alice, 6, RAID.encode(beaten(3)), 9, clock.now);
    expect(await standing(alice)).toEqual([{ score: 9, also: '{"runs":2,"room":12}', updatedAt: clock.now }]);
    expect(await restand()).toBe("done");
    expect(await standing(alice)).toEqual([{ score: 3, also: '{"runs":3,"room":12}', updatedAt: clock.now }]);
    expect(await marked(alice)).toEqual([{ rev: 6, stood: 6 }]);
  });

  it("is not needed for a state this Leaf writes: it stands as of its rev, made or written", async () => {
    await leaf.run(PlayStore.use((store) => store.create(alice, "raid", RAID.encode(beaten(0)), false, T0, null)));
    expect(await marked(alice)).toEqual([{ rev: 0, stood: 0 }]);
    await leaf.run(PlayStore.use((store) => store.write(alice, "raid", RAID.encode(beaten(1)), false, T0, null)));
    expect(await marked(alice)).toEqual([{ rev: 1, stood: 1 }]);
    expect(await restand()).toBe("idle");
  });

  it("is written for a state only while it is at the rev it was worked out from", async () => {
    await keptBefore(alice, 5, RAID.encode(beaten(2)), 6, T0);
    // A batch wrote rev 6 and its own standing meanwhile.
    await leaf.run(PlayStore.use((store) => store.write(alice, "raid", RAID.encode(beaten(2)), false, T0, null)));
    await leaf.run(PlayStore.use((store) => store.restand(alice, "raid", 5, { score: 1, also: {} })));
    expect((await standing(alice))[0]?.score).toBe(6);
  });

  it("stands nowhere new for a state never written, one that does not read (logged), or one of a game Leaf does not play", async () => {
    await leaf.query(
      (sql) => sql`
        INSERT INTO play_state (player_id, game, rev, state, updated_at, born) VALUES
          (${alice}, 'raid', 0, ${RAID.encode(beaten(1))}, ${T0}, ${T0}),
          (${bob}, 'raid', 2, '{}', ${T0}, ${T0}),
          (${bob}, 'chess', 4, '{}', ${T0}, ${T0})
      `,
    );
    expect(await restand()).toBe("done");
    expect([await marked(alice), await marked(bob), await marked(bob, "chess")]).toEqual([
      [{ rev: 0, stood: 0 }],
      [{ rev: 2, stood: 2 }],
      [{ rev: 4, stood: 4 }],
    ]);
    expect([await standing(alice), await standing(bob)]).toEqual([[], []]);
    expect(logged.map((line) => line.message)).toEqual([
      `The raid state stored for ${bob} does not read; it stands nowhere new`,
    ]);
    expect(await restand()).toBe("idle");
  });
});
