import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { leaf, playerId } from "@sequoia-leaf/core";
import { eraAt } from "@sequoia-leaf/raid";
import { Redacted } from "effect";

import { DISCORD_API } from "../src/config.ts";
import { asPage, discordOf, fakeBackend, type Fetcher, sessionOf, testLeaf } from "./support.ts";

/**
 * Leaf in a Discord call plays as on the website, signed in by Discord (`/v1/activity/sign-in`): a
 * member is the member their website session would be, with their rank, quests and the guild's news;
 * Leaf's spending works as anywhere; but no draw is made for a session signed in inside a call,
 * wherever its requests come from.
 */

const alice = playerId("10000000-0000-0000-0000-000000000001");
/** Wednesday 25 November 2026, 12:00 UTC. */
const T0 = Date.UTC(2026, 10, 25, 12);
const ORIGIN = "https://leaf.seqwawa.com";
const CLIENT = "1576258873759760577";
/** Where Discord serves Leaf in a call, proxying it. */
const FRAME = `https://${CLIENT}.discordsays.com`;
/** A Discord account Leaf has no player for: a guest's. */
const STRANGER = "290000000000000009";

/** The Minecraft accounts the backend was asked about, in order. */
let standingsAsked: string[];

/**
 * Discord and the backend, standing in. Discord's code `code-<id>` signs its account `<id>` in; the
 * backend says Alice's Minecraft account is a captain's, and any other no member's.
 */
const standIn =
  (backend: Fetcher): Fetcher =>
  async (url, init) => {
    const request = new Request(url, init);
    if (url === `${DISCORD_API}/oauth2/token`) {
      const code = new URLSearchParams(await request.text()).get("code") ?? "";
      return Response.json({ access_token: `token-${code.slice("code-".length)}` });
    }
    if (url === `${DISCORD_API}/users/@me`) {
      const id = (request.headers.get("Authorization") ?? "").slice("Bearer token-".length);
      return Response.json({ id, username: id === STRANGER ? "stranger" : "alice" });
    }
    const account = /^\/internal\/leaf\/members\/([^/]+)$/.exec(new URL(url).pathname)?.[1];
    if (account === undefined || request.headers.get("Authorization") !== "Bearer internal-token")
      return backend(url, init);
    standingsAsked.push(account);
    return Response.json({ guild_rank: account === alice ? "CAPTAIN" : null, website_admin: false });
  };

const clock = { now: T0 };
let leafs: ReturnType<typeof testLeaf>;
let app: ReturnType<(typeof leafs)["app"]>;

beforeEach(() => {
  clock.now = T0;
  standingsAsked = [];
  const { fetcher } = fakeBackend({ "alice-token": () => Response.json(sessionOf(alice, "Alice", "CAPTAIN")) });
  const activity = { clientId: CLIENT, clientSecret: Redacted.make("s"), botToken: undefined, origin: FRAME };
  leafs = testLeaf(clock, standIn(fetcher), { gameLeafSpending: true, activity });
  app = leafs.app();
});
afterEach(async () => {
  await app.dispose();
  await leafs.dispose();
});

const WEBSITE = "seq_session=alice-token";

/** Signs the Discord account `discord` in inside a call: the `Cookie` its session goes with. */
async function inCall(discord: string): Promise<string> {
  const answer = await app.request("/v1/activity/sign-in", {
    method: "POST",
    headers: { Origin: FRAME, "Content-Type": "application/json" },
    body: JSON.stringify({ code: `code-${discord}` }),
  });
  expect(answer.status).toBe(200);
  return answer.headers.getSetCookie()[0]?.split(";")[0] ?? "";
}

/** Alice, signed in inside a call: her Discord account is her player's, as her website session made it. */
async function aliceInCall(): Promise<string> {
  expect((await app.request("/v1/game/me", { headers: { Cookie: WEBSITE } })).status).toBe(200);
  return inCall(discordOf(alice));
}

/** A request with a session (`cookie`), from `origin`: its status and body. */
async function sent(path: string, cookie: string, origin = FRAME, body?: unknown) {
  clock.now += 1000;
  const response = await app.request(path, {
    method: body === undefined ? "GET" : "POST",
    headers: { Cookie: cookie, Origin: origin, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(asPage(path, body)) }),
  });
  const said: unknown = await response.json();
  return { status: response.status, body: said };
}

/** Alice's Leaf: earned in a raid, and what is left. */
const raided = (amount: number) =>
  leafs.post(
    { kind: "earn", playerId: alice, amount: leaf(amount), source: "raid", idempotencyKey: `raid:${alice}` },
    clock.now,
  );
const balance = async () => (await leafs.account(alice)).balance;
const ten = { id: "p-1", do: "pull", pool: "grove", n: 10, with: "leaf", era: eraAt(T0) };

describe("a member signed in inside a call", () => {
  it("is the member their website session is: their rank, their quests and the guild's news", async () => {
    const call = await aliceInCall();

    expect(await sent("/v1/game/me", call)).toMatchObject({
      status: 200,
      body: { player: { id: alice }, rank: "CAPTAIN", guest: false },
    });
    expect((await sent("/v1/me/quests", call)).status).toBe(200);
    expect((await sent("/v1/game/guild/events", call)).status).toBe(200);
    expect(standingsAsked).toContain(alice);
  });

  it("is a guest with no Minecraft account linked, and the backend is not asked about them", async () => {
    const call = await inCall(STRANGER);

    expect(await sent("/v1/game/me", call)).toMatchObject({ status: 200, body: { rank: null, guest: true } });
    expect((await sent("/v1/me/quests", call)).status).toBe(403);
    expect((await sent("/v1/game/guild/events", call)).status).toBe(403);
    expect(standingsAsked).toEqual([]);
  });
});

describe("Leaf in a Discord call", () => {
  it("buys a Table look with Leaf, as the website does", async () => {
    const call = await aliceInCall();
    await raided(30_000);

    const bought = await sent("/v1/game/play/raid", call, FRAME, {
      player: alice,
      commands: [{ id: "c-1", do: "buyLook", kind: "cloth", look: "plum" }],
    });

    expect(bought).toMatchObject({
      status: 200,
      body: { results: [{ id: "c-1", notes: [{ t: "look", kind: "cloth", id: "plum" }] }] },
    });
    expect(await balance()).toBe(2000);
  });

  it("makes no draw for a session signed in inside a call, all of the batch undone, from Discord or the website alike", async () => {
    const call = await aliceInCall();
    await raided(25_000);
    const refused = { status: 403, body: { code: "bad_origin", message: "Pulls are made on Leaf's website" } };
    const batch = { player: alice, commands: [{ id: "e-1", do: "exchange", prize: "none" }, ten] };

    expect(await sent("/v1/game/play/pulls", call, FRAME, batch)).toEqual(refused);
    // The session says where it was signed in, not the request: sent from the website's address, refused all the same.
    expect(await sent("/v1/game/play/pulls", call, ORIGIN, batch)).toEqual(refused);
    expect(await balance()).toBe(25_000);

    const atLeaf = await sent("/v1/game/play/pulls", WEBSITE, ORIGIN, { player: alice, commands: [ten] });
    expect(atLeaf).toMatchObject({ status: 200, body: { results: [{ id: "p-1", notes: expect.any(Array) }] } });
    expect(await balance()).toBe(15_000);
  });

  it("takes the Grove's commands that are not a draw", async () => {
    const call = await aliceInCall();
    const exchange = { player: alice, commands: [{ id: "e-1", do: "exchange", prize: "none" }] };

    expect((await sent("/v1/game/play/pulls", call, FRAME, exchange)).status).toBe(200);
  });
});
