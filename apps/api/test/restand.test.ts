import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { type Ctx, playerId } from "@sequoia-leaf/core";
import { FACTORY } from "@sequoia-leaf/factory/game.ts";
import { staged } from "@sequoia-leaf/factory/test/yards.ts";
import { RAID, recordRun, type RunSummary, type Table } from "@sequoia-leaf/raid";
import { Schema } from "effect";

import { GAMES } from "../src/play/games.ts";
import { restandAll } from "../src/play/restand.ts";
import { Play } from "../src/play/service.ts";
import { PlayStore } from "../src/play/store.ts";
import { type LogLine, noNetwork, testLeaf } from "./support.ts";

const alice = playerId("10000000-0000-0000-0000-000000000001");
const bob = playerId("10000000-0000-0000-0000-000000000002");
/** Wednesday 25 November 2026, 12:00 UTC. */
const T0 = Date.UTC(2026, 10, 25, 12);
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** When the tables kept as before were made: a week before. */
const MADE = T0 - 7 * DAY;
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
      VALUES (${player}, 'raid', ${rev}, ${state}, ${at}, ${MADE}, NULL)
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

/** Keeps the trophies of the three bosses as first won by a player at `at`, as a batch that beat them would have. */
const wonAt = (player: string, at: number) =>
  leaf.run(
    PlayStore.use((store) =>
      store.award(playerId(player), ["trophy-oldbramble", "trophy-hoardmagpie", "trophy-bigcrab"], at),
    ),
  );
/** Who is on the Little Raid's board, in order, and when each reached their score. */
async function board() {
  const { top } = await leaf.run(PlayStore.use((store) => store.board("raid", alice)));
  const reached = await Promise.all(top.map(async ({ playerId: id }) => (await standing(id))[0]?.updatedAt));
  return top.map(({ playerId: id, score }, i) => ({ id, score, at: reached[i] }));
}
/** Monday, Tuesday and Wednesday, 23 to 25 November 2026, at noon. */
const [MONDAY, TUESDAY, WEDNESDAY] = [T0 - 2 * DAY, T0 - DAY, T0];

/**
 * Alice beats the three bosses on the first trail on Monday, Bob on Tuesday, and Alice beats them again on
 * the second trail on Wednesday, as a Leaf whose rules summed each trail's stood them: Alice's 6 was reached on Wednesday.
 */
async function aliceThenBob() {
  await wonAt(alice, MONDAY);
  await wonAt(bob, TUESDAY);
  await keptBefore(bob, 3, RAID.encode(beaten(1)), 3, TUESDAY);
  await keptBefore(alice, 5, RAID.encode(beaten(2)), 6, WEDNESDAY);
}

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

  it("of a boss beaten again on a later trail is reached when the last different boss was first beaten", async () => {
    await aliceThenBob();
    await restand();
    expect(await board()).toEqual([
      { id: alice, score: 3, at: MONDAY },
      { id: bob, score: 3, at: TUESDAY },
    ]);
  });

  it("of a boss beaten again on a later trail is reached as the sweep has it when a command is first to work it out", async () => {
    await aliceThenBob();
    // Alice sets out again on Thursday before the sweep has worked out where her table stands.
    clock.now = WEDNESDAY + DAY;
    const done = await leaf.run(
      Play.use((play) =>
        play.send({ playerId: alice, guest: false }, GAMES.raid, [{ id: "c-1", do: "start", trail: 0 }]),
      ),
    );
    expect(done).toMatchObject({ status: "done", rev: 6, results: [{ id: "c-1" }] });
    expect(await board()).toEqual([
      { id: alice, score: 3, at: MONDAY },
      { id: bob, score: 3, at: TUESDAY },
    ]);
    // Bob's is worked out by the sweep, and Alice's needs it no more.
    await restand();
    expect(await board()).toEqual([
      { id: alice, score: 3, at: MONDAY },
      { id: bob, score: 3, at: TUESDAY },
    ]);
  });

  it("of a boss beaten again is reached as stored where Leaf kept no time for a trophy since the table was made, and never later", async () => {
    const carol = playerId("10000000-0000-0000-0000-000000000003");
    // Alice's last trophy was never kept (won before Leaf kept awards, her table not changed since).
    await leaf.run(PlayStore.use((store) => store.award(alice, ["trophy-oldbramble", "trophy-hoardmagpie"], MONDAY)));
    await keptBefore(alice, 5, RAID.encode(beaten(2)), 6, WEDNESDAY);
    // Bob's were kept as first won at a later change of his table than when he beat them.
    await wonAt(bob, WEDNESDAY + DAY);
    await keptBefore(bob, 3, RAID.encode(beaten(1)), 3, TUESDAY);
    // Carol's were won by a table before this one, made again since.
    await wonAt(carol, MADE - DAY);
    await keptBefore(carol, 4, RAID.encode(beaten(2)), 6, WEDNESDAY);
    await restand();
    expect([await standing(alice), await standing(bob), await standing(carol)].map((s) => s[0]?.updatedAt)).toEqual([
      WEDNESDAY,
      TUESDAY,
      WEDNESDAY,
    ]);
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

  it("makes no standing, and leaves one be for a state that does not read (logged) or of a game Leaf does not play", async () => {
    const carol = playerId("10000000-0000-0000-0000-000000000003");
    await leaf.query(
      (sql) => sql`
        INSERT INTO play_state (player_id, game, rev, state, updated_at, born) VALUES
          (${alice}, 'raid', 0, ${RAID.encode(beaten(1))}, ${T0}, ${T0}),
          (${carol}, 'raid', 3, ${RAID.encode(beaten(1))}, ${T0}, ${T0}),
          (${bob}, 'chess', 4, '{}', ${T0}, ${T0})
      `,
    );
    // Bob's table, stood at 6 by the rules before, does not read.
    await keptBefore(bob, 2, "{}", 6, T0);
    expect(await restand()).toBe("done");
    expect([await marked(alice), await marked(carol), await marked(bob), await marked(bob, "chess")]).toEqual([
      [{ rev: 0, stood: 0 }],
      [{ rev: 3, stood: 3 }],
      [{ rev: 2, stood: 2 }],
      [{ rev: 4, stood: 4 }],
    ]);
    expect([await standing(alice), await standing(carol), (await standing(bob))[0]?.score]).toEqual([[], [], 6]);
    expect(logged.map((line) => line.message)).toEqual([
      `The raid state stored for ${bob} does not read; it stands as it stood`,
    ]);
    expect(await restand()).toBe("idle");
  });
  for (const asked of ["collect", "open"] as const)
    it(`puts a yard a Leaf from before wrote right to what was stored, so Coins made since it was read are reached now (${asked})`, async () => {
      const yard = staged("mid");
      yard.at = clock.now;
      const score = FACTORY.standing?.(yard)?.score;
      if (score === undefined) throw new Error("the Works keeps no standing");
      // Kept at revision 4 by a Leaf from before, which leaves its standing marked as of revision 3.
      await leaf.query(
        (sql) => sql`
          INSERT INTO play_state (player_id, game, rev, stood, state, updated_at, born, due_at)
          VALUES (${alice}, 'works', 4, 3, ${FACTORY.encode(yard)}, ${clock.now}, ${MADE}, ${clock.now})
        `,
      );
      await leaf.query(
        (sql) => sql`
          INSERT INTO standings (player_id, game, score, also, guest, updated_at)
          VALUES (${alice}, 'works', ${score}, '{}', 0, ${clock.now})
        `,
      );
      // Ten minutes on, the yard has made more Coins by the time its owner collects or opens it.
      clock.now += 10 * 60_000;
      const who = { playerId: alice, guest: false };
      if (asked === "collect")
        await leaf.run(
          Play.use((p) => p.send(who, GAMES.works, [{ id: "collect-1", do: "collect", tick: yard.tick }])),
        );
      else await leaf.run(Play.use((p) => p.open(who, GAMES.works)));
      const [now] = Schema.decodeUnknownSync(Schema.Array(Stood))(
        await leaf.query(
          (sql) =>
            sql`SELECT score, also, updated_at AS updatedAt FROM standings WHERE player_id = ${alice} AND game = 'works'`,
        ),
      );
      expect(now?.score).toBeGreaterThan(score);
      expect(now?.updatedAt).toBe(clock.now);
    });
});
