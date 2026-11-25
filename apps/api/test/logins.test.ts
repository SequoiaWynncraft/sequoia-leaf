import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { DEFAULT_RULES, leaf, minecraftId, playerId, type ReportedAward } from "@sequoia-leaf/core";
import { Effect, Option } from "effect";

import { syncAchievements } from "../src/achievements/sync.ts";
import { syncCredits } from "../src/earning/sync.ts";
import { Logins } from "../src/players/logins.ts";
import { DiscordId } from "../src/wire.ts";
import { discordOf, fakeBackend, feed, raid, sessionOf, testLeaf } from "./support.ts";

/** Wednesday 25 November 2026, 12:00 UTC. */
const T0 = Date.UTC(2026, 10, 25, 12);
const MINUTE = 60_000;
/** The internal token the test Leaf is set up with (`testConfig`). */
const TOKEN = "internal-token";

/** A player who first came with Discord alone: an id that is no Minecraft account's. */
const nuss = playerId("6e3a1c2e-7f00-4c4a-9d8e-1f2b3c4d5e6f");
/** The Minecraft account Nuss linked later, which earned in the guild before he did. */
const nussAccount = minecraftId("b0b0b0b0-0000-4000-8000-000000000187");
const alice = playerId("00000000-0000-4000-8000-00000000000a");
const aliceAccount = minecraftId(alice);

let backend: ReturnType<typeof fakeBackend>;
let leafs: ReturnType<typeof testLeaf>;

beforeEach(() => {
  backend = fakeBackend({ "alice-token": () => Response.json(sessionOf(alice, "Alice")) });
  leafs = testLeaf({ now: T0 }, backend.fetcher);
});
afterEach(() => leafs.dispose());

/** Links a Minecraft account to a player as linking will: a row in `logins`. */
const link = (account: string, player: string) =>
  leafs.query(
    (sql) => sql`
      INSERT INTO logins (kind, external_id, player_id, linked_at) VALUES ('minecraft', ${account}, ${player}, ${T0})
    `,
  );

const logins = <A>(use: (service: Logins["Service"]) => Effect.Effect<A>) => leafs.run(Logins.use(use));

describe("who a Minecraft account signs in as", () => {
  it("is its own player, with the account's UUID, until it is linked to another", async () => {
    expect(await logins((l) => l.player(aliceAccount))).toBe(alice);

    await link(nussAccount, nuss);

    expect(await logins((l) => l.player(nussAccount))).toBe(nuss);
    expect([...(await logins((l) => l.players([aliceAccount, nussAccount])))]).toEqual([
      [aliceAccount, alice],
      [nussAccount, nuss],
    ]);
  });

  it("gives each player the account their name and skin come from: the one linked last, or their own", async () => {
    const second = minecraftId("b0b0b0b0-0000-4000-8000-000000000188");
    await link(nussAccount, nuss);
    await leafs.query(
      (sql) => sql`
        INSERT INTO logins (kind, external_id, player_id, linked_at) VALUES ('minecraft', ${second}, ${nuss}, ${T0 + 1})
      `,
    );
    const stranger = playerId("6e3a1c2e-7f00-4c4a-9d8e-000000000001");
    await leafs.query((sql) => sql`INSERT INTO leaf_ids (player_id, made_at) VALUES (${stranger}, ${T0})`);

    const accounts = await logins((l) => l.minecraftOf([alice, nuss, stranger]));

    expect(accounts.get(alice)).toBe(aliceAccount);
    expect(accounts.get(nuss)).toBe(second);
    expect(accounts.has(stranger)).toBe(false);
  });
});

describe("what the guild pays a Minecraft account", () => {
  it("goes to the player the account is linked to, keyed by the account so it is paid once", async () => {
    await link(nussAccount, nuss);
    const source = feed([raid(1, playerId(nussAccount), T0 + MINUTE)]);

    await leafs.run(syncCredits(source, DEFAULT_RULES, T0, "recent"));
    await leafs.run(syncCredits(source, DEFAULT_RULES, T0 + 5 * MINUTE, "recent"));
    await leafs.run(syncCredits(source, DEFAULT_RULES, T0 + 6 * MINUTE, "recent"));

    expect((await leafs.account(nuss)).balance).toBeGreaterThan(0);
    expect((await leafs.account(playerId(nussAccount))).balance).toBe(0);
    expect(await leafs.query((sql) => sql`SELECT player_id AS player, source_key AS key FROM activities`)).toEqual([
      { player: nuss, key: `raid:1:${nussAccount}` },
    ]);
  });

  it("goes to that player for an achievement too", async () => {
    await link(nussAccount, nuss);
    const award: ReportedAward = {
      awardId: `${nussAccount}:raid:TNA:diamond`,
      account: nussAccount,
      ladder: "raid:TNA",
      milestoneId: "diamond",
      tier: "diamond",
      threshold: 1000,
      label: "Diamond",
      earnedAt: T0 + MINUTE,
    };
    const source = (from: number, to: number) =>
      Effect.succeed([award].filter((one) => one.earnedAt >= from && one.earnedAt < to));

    await leafs.run(syncAchievements(source, DEFAULT_RULES, T0, "recent"));
    await leafs.run(syncAchievements(source, DEFAULT_RULES, T0 + 5 * MINUTE, "recent"));

    expect((await leafs.account(nuss)).balance).toBeGreaterThan(0);
  });

  it("is read and spent from that player when the backend asks by the account", async () => {
    await link(nussAccount, nuss);
    await leafs.post(
      { kind: "earn", playerId: nuss, amount: leaf(5000), source: "raid", idempotencyKey: "raid:9:nuss" },
      T0 - 1000,
    );
    const app = leafs.app();
    const headers = { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };

    const read = await app.request(`/internal/v1/players/${nussAccount}/leaf`, { headers });
    const bought = await app.request("/internal/v1/purchases/req-1", {
      method: "PUT",
      headers,
      body: JSON.stringify({ player_id: nussAccount, kind: "tome", leaf: 3000 }),
    });
    const left = (await leafs.account(nuss)).balance;
    await app.dispose();

    expect(await read.json()).toEqual({ player_id: nussAccount, balance: 5000 });
    expect(await bought.json()).toMatchObject({ status: "paid", balance: 2000 });
    expect(left).toBe(2000);
  });
});

describe("a Sequoia session", () => {
  it("on an alternate account, as the mod's may be, leaves whom the Discord account signs in as alone", async () => {
    const alt = playerId("00000000-0000-4000-8000-0000000000a2");
    // Alice's own Discord account, in the mod on her alternate.
    backend.backend.sessions["alt-token"] = () =>
      Response.json({ ...sessionOf(alt, "AliceAlt"), discord_id: discordOf(alice), primary_account: false });
    const app = leafs.app();

    await app.request("/v1/me", { headers: { Cookie: "seq_session=alice-token" } });
    const after = await app.request("/v1/me", { headers: { Cookie: "seq_session=alt-token" } });
    const signsInAs = await logins((l) => l.discordPlayer(DiscordId.make(discordOf(alice))));
    await app.dispose();

    expect(after.status).toBe(200);
    expect(Option.getOrUndefined(signsInAs)).toBe(alice);
  });

  it("signs in as its account's player, and makes its Discord account sign in as the same", async () => {
    const app = leafs.app();

    const response = await app.request("/v1/me", { headers: { Cookie: "seq_session=alice-token" } });
    const discord = DiscordId.make(discordOf(alice));
    const signsInAs = await logins((l) => l.discordPlayer(discord));
    await app.dispose();

    expect(response.status).toBe(200);
    expect(Option.getOrUndefined(signsInAs)).toBe(alice);
  });
});
