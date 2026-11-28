import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { leaf, playerId } from "@sequoia-leaf/core";
import { eraAt } from "@sequoia-leaf/raid";
import { Redacted } from "effect";

import { asPage, fakeBackend, sessionOf, testLeaf } from "./support.ts";

/**
 * Leaf in a Discord call plays as on the website: its pages' commands come from Discord's proxy for
 * Leaf (the `Origin` below), and Leaf's spending works there as anywhere, but a draw is made only
 * on the website. (Which cookie the page in Discord's frame has is `activity.test.ts`'s; here the
 * player's session is the website's, sent from either place.)
 */

const alice = playerId("10000000-0000-0000-0000-000000000001");
/** Wednesday 25 November 2026, 12:00 UTC. */
const T0 = Date.UTC(2026, 10, 25, 12);
const ORIGIN = "https://leaf.seqwawa.com";
const CLIENT = "1576204968619417712";
/** Where Discord serves Leaf in a call, proxying it. */
const FRAME = `https://${CLIENT}.discordsays.com`;

const clock = { now: T0 };
let leafs: ReturnType<typeof testLeaf>;
let app: ReturnType<(typeof leafs)["app"]>;

beforeEach(() => {
  clock.now = T0;
  const { fetcher } = fakeBackend({ "alice-token": () => Response.json(sessionOf(alice, "Alice", "CAPTAIN")) });
  const activity = { clientId: CLIENT, clientSecret: Redacted.make("s"), botToken: undefined, origin: FRAME };
  leafs = testLeaf(clock, fetcher, { gameLeafSpending: true, activity });
  app = leafs.app();
});
afterEach(async () => {
  await app.dispose();
  await leafs.dispose();
});

/** A batch of commands to a game, as its page sends it from `origin`; Leaf's answer, and its body. */
async function play(game: string, commands: readonly object[], origin: string) {
  clock.now += 1000;
  const path = `/v1/game/play/${game}`;
  const response = await app.request(path, {
    method: "POST",
    headers: { Cookie: "seq_session=alice-token", Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify(asPage(path, { player: alice, commands })),
  });
  const body: unknown = await response.json();
  return { status: response.status, body };
}

/** Alice's Leaf: earned in a raid, and what is left. */
const raided = (amount: number) =>
  leafs.post(
    { kind: "earn", playerId: alice, amount: leaf(amount), source: "raid", idempotencyKey: `raid:${alice}` },
    clock.now,
  );
const balance = async () => (await leafs.account(alice)).balance;

describe("Leaf in a Discord call", () => {
  it("buys a Table look with Leaf, as the website does", async () => {
    await raided(30_000);

    const bought = await play("raid", [{ id: "c-1", do: "buyLook", kind: "cloth", look: "plum" }], FRAME);

    expect(bought).toMatchObject({
      status: 200,
      body: { results: [{ id: "c-1", notes: [{ t: "look", kind: "cloth", id: "plum" }] }] },
    });
    expect(await balance()).toBe(2000);
  });

  it("makes no draw, all of the batch undone, and takes no Leaf; the website's draw is made", async () => {
    await raided(25_000);
    const ten = { id: "p-1", do: "pull", pool: "grove", n: 10, with: "leaf", era: eraAt(T0) };

    expect(await play("pulls", [{ id: "e-1", do: "exchange", prize: "none" }, ten], FRAME)).toEqual({
      status: 403,
      body: { code: "bad_origin", message: "Pulls are made on Leaf's website" },
    });
    expect(await balance()).toBe(25_000);

    const atLeaf = await play("pulls", [ten], ORIGIN);
    expect(atLeaf).toMatchObject({ status: 200, body: { results: [{ id: "p-1", notes: expect.any(Array) }] } });
    expect(await balance()).toBe(15_000);
  });

  it("takes the Grove's commands that are not a draw", async () => {
    const exchange = await play("pulls", [{ id: "e-1", do: "exchange", prize: "none" }], FRAME);

    expect(exchange.status).toBe(200);
  });
});
