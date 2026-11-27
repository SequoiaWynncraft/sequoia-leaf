import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { leaf, minecraftId, playerId } from "@sequoia-leaf/core";
import { RAID } from "@sequoia-leaf/raid";
import { Schema } from "effect";
import { SqlClient } from "effect/sql";

import { readHere } from "../src/activity/here.ts";
import { restandAll } from "../src/play/restand.ts";
import { discordOf, fakeBackend, sessionOf, testLeaf } from "./support.ts";

const Me = Schema.Struct({ player: Schema.Struct({ id: Schema.String }) });
/** A sitting opened, as its route answers: its id. */
const Opened = Schema.Struct({ id: Schema.String });
/** The player's id in an answer from `/v1/game/me`. */
const idOf = (body: unknown) => Schema.decodeUnknownSync(Me)(body).player.id;

/** Wednesday 25 November 2026, 12:00 UTC. */
const T0 = Date.UTC(2026, 10, 25, 12);
const ORIGIN = "https://leaf.seqwawa.com";
const NUSS_DISCORD = "100000000000000187";

let backend: ReturnType<typeof fakeBackend>["backend"];
let leafs: ReturnType<typeof testLeaf>;
let app: ReturnType<(typeof leafs)["app"]>;

beforeEach(() => {
  const fake = fakeBackend();
  backend = fake.backend;
  leafs = testLeaf({ now: T0 }, fake.fetcher);
  app = leafs.app();
});
afterEach(async () => {
  await app.dispose();
  await leafs.dispose();
});

/** The cookies a response sets, by name, with their attributes. */
function setCookies(response: Response): Map<string, string> {
  const cookies = new Map<string, string>();
  for (const line of response.headers.getSetCookie()) {
    const [pair = ""] = line.split(";");
    cookies.set(pair.slice(0, pair.indexOf("=")), line);
  }
  return cookies;
}
const valueOf = (line: string | undefined) => line?.split(";")[0]?.split("=")[1] ?? "";

/** A proof the backend would give for Nuss's Discord account, coming back to `returnTo`. */
function proof(returnTo: string, member: boolean | null = false, username = "nuss187") {
  return () =>
    Response.json({
      discord_id: NUSS_DISCORD,
      username,
      display_name: "Nuss",
      avatar: null,
      return_to: returnTo,
      sequoia_member: member,
    });
}

/** Begins a sign-in from the town, as the gate's button does: where it is sent, and its nonce. */
async function begin(): Promise<{ location: URL; nonce: string; returnTo: string }> {
  const started = await app.request("/v1/game/sign-in?to=%2Fplay%2Ftown%2F");
  expect(started.status).toBe(302);
  const location = new URL(started.headers.get("location") ?? "");
  const returnTo = location.searchParams.get("return_to") ?? "";
  const nonce = valueOf(setCookies(started).get("__Host-leaf_signin"));
  return { location, nonce, returnTo };
}

/** Comes back from Discord with a one-time code, as the backend sends an account with no Minecraft account. */
async function comeBack(code: string, returnTo: string, nonce: string) {
  const back = new URL(`${returnTo}&leaf_discord=${code}`);
  return app.request(`${back.pathname}${back.search}`, { headers: { Cookie: `__Host-leaf_signin=${nonce}` } });
}

/** Signs Nuss in with Discord alone: their Leaf session's token. */
async function signInNuss(member: boolean | null = false, username = "nuss187"): Promise<string> {
  const { nonce, returnTo } = await begin();
  backend.proofs["code-1"] = proof(returnTo, member, username);
  const response = await comeBack("code-1", returnTo, nonce);
  return valueOf(setCookies(response).get("__Host-leaf_session"));
}

const meWith = async (cookie: string) => {
  const response = await app.request("/v1/game/me", { headers: { Cookie: cookie } });
  const body: unknown = await response.json();
  return { status: response.status, body };
};

/** How many merges Leaf has recorded. */
const merges = () => leafs.query((sql) => sql`SELECT count(*) AS n FROM merges`);

/** Where a sign-in begun for `to` says it will come back to. */
async function comesBackTo(to: string): Promise<string | null> {
  const started = await app.request(`/v1/game/sign-in?to=${encodeURIComponent(to)}`);
  const returnTo = new URL(started.headers.get("location") ?? "").searchParams.get("return_to") ?? "";
  return new URL(returnTo).searchParams.get("to");
}

describe("signing in with Discord", () => {
  it("sends the browser to the guild's sign-in, letting a Discord account with no Minecraft account through", async () => {
    const { location, nonce, returnTo } = await begin();

    expect(`${location.origin}${location.pathname}`).toBe("https://api.seqwawa.com/auth/web/start");
    expect(location.searchParams.get("allow_unlinked")).toBe("true");
    expect(nonce).not.toBe("");
    expect(returnTo).toBe(`${ORIGIN}/v1/game/sign-in/back?to=%2Fplay%2Ftown%2F&n=${nonce}`);
  });

  it("comes back to one of the game's pages, and only those", async () => {
    const elsewhere = await app.request("/v1/game/sign-in?to=https%3A%2F%2Fevil.example%2F");
    const returnTo = new URL(elsewhere.headers.get("location") ?? "").searchParams.get("return_to") ?? "";

    expect(new URL(returnTo).searchParams.get("to")).toBe("/play/town/");
  });

  it("makes a player of a Discord account with no Minecraft account, named by its username, as a guest", async () => {
    const token = await signInNuss();

    const me = await meWith(`__Host-leaf_session=${token}`);

    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({
      player: { username: "nuss187" },
      guest: true,
      rank: null,
      signed_in_with: "discord",
      ask_link: false,
    });
    const id = idOf(me.body);
    expect(id).not.toBe(NUSS_DISCORD);
    expect(await leafs.query((sql) => sql`SELECT player_id AS id FROM leaf_ids`)).toEqual([{ id }]);
  });

  it("names a returning Discord player by their Discord username as it is now, even once Leaf forgot it", async () => {
    const first = await meWith(`__Host-leaf_session=${await signInNuss()}`);
    await leafs.query((sql) => sql`DELETE FROM player_names`);

    await signInNuss(false, "nuss_the_second");

    expect(await leafs.query((sql) => sql`SELECT player_id AS id, username FROM player_names`)).toEqual([
      { id: idOf(first.body), username: "nuss_the_second" },
    ]);
  });

  it("signs the same Discord account in as the same player next time", async () => {
    const first = await meWith(`__Host-leaf_session=${await signInNuss()}`);
    const second = await meWith(`__Host-leaf_session=${await signInNuss()}`);

    expect(idOf(second.body)).toBe(idOf(first.body));
  });

  it("asks a member of the guild's Discord with no account linked to link one", async () => {
    const me = await meWith(`__Host-leaf_session=${await signInNuss(true)}`);

    expect(me.body).toMatchObject({ ask_link: true, guest: true });
  });

  it("keeps no session when the browser coming back is not the one that began it", async () => {
    const { returnTo } = await begin();
    backend.proofs["code-2"] = proof(returnTo);

    const response = await comeBack("code-2", returnTo, "someone-elses-nonce");

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/play/town/");
    expect(setCookies(response).get("__Host-leaf_session")).toBeUndefined();
    expect(await leafs.query((sql) => sql`SELECT count(*) AS n FROM sign_ins`)).toEqual([{ n: 0 }]);
  });

  it("goes back to the page with nothing to redeem when the website signed the member in itself", async () => {
    const { returnTo, nonce } = await begin();
    const back = new URL(returnTo);

    const response = await app.request(`${back.pathname}${back.search}`, {
      headers: { Cookie: `leaf_signin=${nonce}` },
    });

    expect(response.headers.get("location")).toBe("/play/town/");
    expect(backend.calls.some((path) => path.startsWith("/internal/leaf/"))).toBe(false);
  });

  it("comes back to the page with its query, and to the town for anywhere but the game's pages", async () => {
    expect(await comesBackTo("/play/works/?of=someone")).toBe("/play/works/?of=someone");
    expect(await comesBackTo("//evil.example/play/")).toBe("/play/town/");
    expect(await comesBackTo("/play/../admin")).toBe("/play/town/");
  });

  it("signs a Leaf session in as whoever its Discord account is now", async () => {
    const token = await signInNuss();
    const other = playerId("00000000-0000-4000-8000-0000000000c1");
    await leafs.query(
      (sql) => sql`UPDATE logins SET player_id = ${other} WHERE kind = 'discord' AND external_id = ${NUSS_DISCORD}`,
    );

    expect(idOf((await meWith(`__Host-leaf_session=${token}`)).body)).toBe(other);
  });

  it("lets a Leaf session in beside a website session the website has ended", async () => {
    const token = await signInNuss();

    const me = await meWith(`seq_session=ended-elsewhere; __Host-leaf_session=${token}`);

    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({ signed_in_with: "discord" });
  });

  it("ends the session on signing out from Leaf's own page", async () => {
    const token = await signInNuss();

    const out = await app.request("/v1/game/sign-out", {
      method: "POST",
      headers: { Cookie: `__Host-leaf_session=${token}`, Origin: ORIGIN },
    });

    expect(out.status).toBe(204);
    expect((await meWith(`__Host-leaf_session=${token}`)).status).toBe(401);
  });
});

/** A Sequoia session for Nuss's Discord account, on `minecraft` as their primary account. */
function sequoiaSession(token: string, minecraft: string, name: string, discord = NUSS_DISCORD) {
  backend.sessions[token] = () =>
    Response.json({ ...sessionOf(minecraft, name, "RECRUIT"), discord_id: discord, primary_account: true });
}

describe("linking a Wynncraft account later", () => {
  const account = minecraftId("b0b0b0b0-0000-4000-8000-000000000187");

  it("takes what the Discord player played into the account's player, with the Leaf the guild paid it", async () => {
    const token = await signInNuss(true);
    const guestId = idOf((await meWith(`__Host-leaf_session=${token}`)).body);
    await leafs.query(
      (sql) => sql`
        INSERT INTO play_state (player_id, game, rev, state, updated_at) VALUES (${guestId}, 'works', 4, '{}', ${T0})
      `,
    );
    // The guild paid the account before Nuss ever linked it.
    await leafs.post(
      { kind: "earn", playerId: playerId(account), amount: leaf(12_400), source: "raid", idempotencyKey: "raid:1" },
      T0 - 1000,
    );
    sequoiaSession("nuss-sequoia", account, "Nuss187");

    const me = await meWith(`seq_session=nuss-sequoia; __Host-leaf_session=${token}`);

    expect(me.body).toMatchObject({
      player: { id: account, username: "Nuss187" },
      leaf: 12_400,
      signed_in_with: "sequoia",
      ask_link: false,
    });
    expect(await leafs.query((sql) => sql`SELECT player_id AS id, game FROM play_state`)).toEqual([
      { id: account, game: "works" },
    ]);
    expect(await leafs.query((sql) => sql`SELECT from_id AS "from", into_id AS "into", account FROM merges`)).toEqual([
      { from: guestId, into: account, account },
    ]);
    // Their Discord account now signs in as the account's player, with Leaf's own session too.
    expect((await meWith(`__Host-leaf_session=${token}`)).body).toMatchObject({ player: { id: account } });
  });

  it("brings the Discord player's Coins along, and leaves both players' open visits as they are", async () => {
    const token = await signInNuss();
    const guestId = idOf((await meWith(`__Host-leaf_session=${token}`)).body);
    await leafs.query(
      (sql) => sql`
        INSERT INTO coin_entries (player_id, amount, reason, game, key, at, earned)
        VALUES (${guestId}, 300, 'welcome', NULL, ${`welcome:${guestId}`}, ${T0}, 1)
      `,
    );
    for (const player of [guestId, account]) {
      // oxlint-disable-next-line no-await-in-loop -- one after the other, so the ids follow
      await leafs.query(
        (sql) => sql`
          INSERT INTO players_seen (player_id, name, guest, first_seen_at, last_seen_at)
          VALUES (${player}, 'Nuss', 0, ${T0}, ${T0});
        `,
      );
      // oxlint-disable-next-line no-await-in-loop -- one after the other, so the ids follow
      await leafs.query(
        (sql) => sql`
          INSERT INTO sessions (player_id, guest, started_at) VALUES (${player}, 0, ${T0});
        `,
      );
      // oxlint-disable-next-line no-await-in-loop -- one after the other, so the ids follow
      await leafs.query(
        (sql) => sql`
          INSERT INTO visits (session_id, player_id, guest, place, source, entered_at, heard_at, instance)
          SELECT max(id), ${player}, 0, 'town', 'room', ${T0}, ${T0 + 1000}, 'here' FROM sessions
        `,
      );
    }
    sequoiaSession("nuss-sequoia", account, "Nuss187");

    const me = await meWith(`seq_session=nuss-sequoia`);

    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({ coins: 300 });
    expect(
      await leafs.query((sql) => sql`SELECT player_id AS id FROM visits WHERE left_at IS NULL ORDER BY id`),
    ).toEqual([{ id: account }, { id: guestId }].toSorted((a, b) => a.id.localeCompare(b.id)));
    // Nobody sees them twice in town, though their visit is still open on record.
    const here = await leafs.run(SqlClient.SqlClient.use((sql) => readHere(sql)(T0 + 2000)));
    expect([...here.present, ...here.resting, ...here.gone].map((seen) => seen.playerId)).toEqual([account]);
  });

  it("keeps the like given last when somebody liked one camp and unliked the other", async () => {
    const token = await signInNuss();
    const guestId = idOf((await meWith(`__Host-leaf_session=${token}`)).body);
    const friend = "00000000-0000-4000-8000-0000000000f1";
    await leafs.query(
      (sql) => sql`
        INSERT INTO camp_likes (liker_id, owner_id, first_at, at, liked) VALUES
          (${friend}, ${account}, ${T0 - 5000}, ${T0 - 4000}, 0),
          (${friend}, ${guestId}, ${T0 - 3000}, ${T0 - 2000}, 1)
      `,
    );
    sequoiaSession("nuss-sequoia", account, "Nuss187");

    await meWith(`seq_session=nuss-sequoia`);

    expect(
      await leafs.query((sql) => sql`SELECT liker_id AS liker, owner_id AS owner, first_at, at, liked FROM camp_likes`),
    ).toEqual([{ liker: friend, owner: account, first_at: T0 - 5000, at: T0 - 2000, liked: 1 }]);
  });

  it("does not welcome a Discord player who spent every Coin a second time", async () => {
    const token = await signInNuss();
    const guestId = idOf((await meWith(`__Host-leaf_session=${token}`)).body);
    await leafs.query(
      (sql) => sql`
        INSERT INTO coin_entries (player_id, amount, reason, game, key, at, earned) VALUES
          (${guestId}, 300, 'welcome', NULL, ${`welcome:${guestId}`}, ${T0}, 1),
          (${guestId}, -300, 'shop', 'works', ${`spent:${guestId}`}, ${T0}, 1)
      `,
    );
    sequoiaSession("nuss-sequoia", account, "Nuss187");

    expect((await meWith(`seq_session=nuss-sequoia`)).body).toMatchObject({ coins: 0 });
  });

  it("keeps the newer of two states of one game, and the other in save history", async () => {
    const token = await signInNuss();
    const guestId = idOf((await meWith(`__Host-leaf_session=${token}`)).body);
    await leafs.query(
      (sql) => sql`
        INSERT INTO play_state (player_id, game, rev, state, updated_at) VALUES
          (${guestId}, 'works', 9, '{"newer":true}', ${T0}),
          (${account}, 'works', 2, '{"older":true}', ${T0 - 86_400_000})
      `,
    );
    sequoiaSession("nuss-sequoia", account, "Nuss187");

    await meWith(`seq_session=nuss-sequoia`);

    // Past both revisions, so no copy of either is taken for it.
    expect(await leafs.query((sql) => sql`SELECT player_id AS id, rev, state FROM play_state`)).toEqual([
      { id: account, rev: 10, state: '{"newer":true}' },
    ]);
    expect(await leafs.query((sql) => sql`SELECT player_id AS id, slot, data FROM save_history`)).toEqual([
      { id: account, slot: "play:works", data: '{"older":true}' },
    ]);
  });

  it("moves a camp nothing was done to as it is: standing nowhere, and nothing for Leaf to work out again", async () => {
    const token = await signInNuss();
    // Nuss opens the town and goes before reading the welcome letter: the camp is made, and nothing is done to it.
    const opened = await app.request("/v1/game/play/town", { headers: { Cookie: `__Host-leaf_session=${token}` } });
    expect(opened.status).toBe(200);
    const marked = () => leafs.query((sql) => sql`SELECT player_id AS id, rev, stood FROM play_state`);
    const guestId = idOf((await meWith(`__Host-leaf_session=${token}`)).body);
    expect(await marked()).toEqual([{ id: guestId, rev: 0, stood: 0 }]);
    sequoiaSession("nuss-sequoia", account, "Nuss187");

    await meWith(`seq_session=nuss-sequoia; __Host-leaf_session=${token}`);

    expect(await marked()).toEqual([{ id: account, rev: 1, stood: 1 }]);
    expect(await leafs.run(restandAll)).toBe("idle");
    expect(await leafs.query((sql) => sql`SELECT * FROM standings`)).toEqual([]);
  });

  it("moves a state whose standing is still to be worked out again as it is, for Leaf to work out after", async () => {
    const token = await signInNuss();
    const guestId = idOf((await meWith(`__Host-leaf_session=${token}`)).body);
    // A table a Leaf from before stood by its rules, at 6, which this one has yet to work out again.
    const table = RAID.encode(
      RAID.create({ now: T0, player: { id: guestId, guest: true }, seed: 1, room: 0, awards: [], postcards: {} }),
    );
    await leafs.query(
      (sql) => sql`
        INSERT INTO play_state (player_id, game, rev, state, updated_at, born) VALUES (${guestId}, 'raid', 3, ${table}, ${T0}, ${T0})
      `,
    );
    await leafs.query(
      (sql) => sql`
        INSERT INTO standings (player_id, game, score, also, guest, updated_at) VALUES (${guestId}, 'raid', 6, '{}', 1, ${T0 - 1000})
      `,
    );
    sequoiaSession("nuss-sequoia", account, "Nuss187");

    await meWith(`seq_session=nuss-sequoia; __Host-leaf_session=${token}`);

    expect(await leafs.query((sql) => sql`SELECT player_id AS id, rev, stood FROM play_state`)).toEqual([
      { id: account, rev: 4, stood: null },
    ]);
    expect(await leafs.run(restandAll)).toBe("done");
    expect(
      await leafs.query(
        (sql) => sql`SELECT player_id AS id, score, updated_at AS at FROM standings WHERE game = 'raid'`,
      ),
    ).toEqual([{ id: account, score: 0, at: T0 - 1000 }]);
  });

  it("leaves a state moved by a Leaf from before stand as it stood, though Leaf works it out again", async () => {
    const token = await signInNuss();
    await app.request("/v1/game/play/town", { headers: { Cookie: `__Host-leaf_session=${token}` } });
    // A Leaf from before, beside this one in a deploy, moves the camp to the account's player, its `rev` past both.
    await leafs.query((sql) => sql`UPDATE play_state SET player_id = ${account}, rev = rev + 1`);

    expect(await leafs.run(restandAll)).toBe("done");

    expect(await leafs.query((sql) => sql`SELECT rev, stood FROM play_state`)).toEqual([{ rev: 1, stood: 1 }]);
    expect(await leafs.query((sql) => sql`SELECT * FROM standings`)).toEqual([]);
  });

  it("leaves another person's player theirs when the account has gone over to this Discord account", async () => {
    // Pat played on the account first, signed in with his own Discord account.
    const pat = "200000000000000007";
    sequoiaSession("pat-sequoia", account, "SirVladimirPutin", pat);
    await meWith(`seq_session=pat-sequoia`);
    await leafs.query(
      (sql) => sql`
        INSERT INTO play_state (player_id, game, rev, state, updated_at) VALUES (${account}, 'works', 4, '{}', ${T0})
      `,
    );
    // The account is Nuss's now.
    sequoiaSession("nuss-sequoia", account, "Nuss187");

    const me = await meWith(`seq_session=nuss-sequoia`);

    const nussId = idOf(me.body);
    expect(nussId).not.toBe(account);
    expect(await leafs.query((sql) => sql`SELECT player_id AS id FROM play_state`)).toEqual([{ id: account }]);
    expect(await leafs.query((sql) => sql`SELECT player_id AS id FROM leaf_ids ORDER BY id`)).toEqual(
      [{ id: account }, { id: nussId }].toSorted((a, b) => a.id.localeCompare(b.id)),
    );
    // What the account earns from now on is Nuss's.
    expect(
      await leafs.query(
        (sql) => sql`SELECT player_id AS id FROM logins WHERE kind = 'minecraft' AND external_id = ${account}`,
      ),
    ).toEqual([{ id: nussId }]);
  });

  it("keeps a player whose account went to someone else apart when its person makes another account their main", async () => {
    // Pat plays on account A, which goes to Nuss; then Pat makes account B his main.
    const pat = "200000000000000007";
    const b = playerId("00000000-0000-4000-8000-0000000000b2");
    sequoiaSession("pat-on-a", account, "PatA", pat);
    await meWith(`seq_session=pat-on-a`);
    await leafs.query(
      (sql) => sql`
        INSERT INTO play_state (player_id, game, rev, state, updated_at) VALUES (${account}, 'works', 4, '{}', ${T0})
      `,
    );
    sequoiaSession("nuss-on-a", account, "Nuss187");
    await meWith(`seq_session=nuss-on-a`);
    sequoiaSession("pat-on-b", b, "PatB", pat);

    const me = await meWith(`seq_session=pat-on-b`);

    expect(idOf(me.body)).toBe(b);
    expect(await leafs.query((sql) => sql`SELECT count(*) AS n FROM merges`)).toEqual([{ n: 0 }]);
    expect(await leafs.query((sql) => sql`SELECT player_id AS id FROM play_state`)).toEqual([{ id: account }]);
  });

  /** Nuss signed in with Discord alone, with a Sequoia session on the account ready: their Leaf session's token and Discord player. */
  async function nussBeforeLinking(): Promise<{ token: string; guestId: string }> {
    const token = await signInNuss();
    const guestId = idOf((await meWith(`__Host-leaf_session=${token}`)).body);
    sequoiaSession("nuss-sequoia", account, "Nuss187");
    return { token, guestId };
  }

  it("takes the Discord player's places at the raid's tables along, the better where both finished the same one", async () => {
    const { guestId } = await nussBeforeLinking();
    for (const [sitting, player, place] of [
      ["s1", guestId, 3],
      ["s2", guestId, 6],
      ["s2", account, 2],
      ["s3", account, 8],
      ["s4", guestId, 1],
      ["s4", account, 5],
    ] as const) {
      // oxlint-disable-next-line no-await-in-loop -- one after another
      await leafs.query(
        (sql) => sql`
          INSERT INTO raid_sitting_places (sitting, player_id, place, seats, ended)
          VALUES (${sitting}, ${player}, ${place}, 8, ${T0})
        `,
      );
    }

    await meWith("seq_session=nuss-sequoia");

    expect(
      await leafs.query(
        (sql) => sql`SELECT sitting, player_id AS player, place FROM raid_sitting_places ORDER BY sitting, player_id`,
      ),
    ).toEqual([
      { sitting: "s1", player: account, place: 3 },
      { sitting: "s2", player: account, place: 2 },
      { sitting: "s3", player: account, place: 8 },
      { sitting: "s4", player: account, place: 1 },
    ]);
    const record = await app.request("/v1/game/sittings/record", { headers: { Cookie: "seq_session=nuss-sequoia" } });
    expect(await record.json()).toEqual({ played: 4, won: 1, top_four: 3 });
  });

  it("takes the answers to the Discord player's commands at tables along, but one whose id the account used too", async () => {
    const { guestId } = await nussBeforeLinking();
    for (const [player, id, result] of [
      [guestId, "g-1", '{"notes":[]}'],
      [guestId, "both", '{"refused":"seated","why":"You are at that table already."}'],
      [account, "both", '{"notes":[]}'],
    ] as const) {
      // oxlint-disable-next-line no-await-in-loop -- one after another
      await leafs.query(
        (sql) => sql`
          INSERT INTO play_commands (player_id, game, command_id, rev, result) VALUES (${player}, 'sittings', ${id}, 1, ${result})
        `,
      );
    }

    await meWith("seq_session=nuss-sequoia");

    expect(
      await leafs.query(
        (sql) => sql`
          SELECT player_id AS player, command_id AS id, result FROM play_commands WHERE game = 'sittings' ORDER BY command_id
        `,
      ),
    ).toEqual([
      { player: account, id: "both", result: '{"notes":[]}' },
      { player: account, id: "g-1", result: '{"notes":[]}' },
    ]);
  });

  it("keeps the place of a Discord player out of a table early as the account's, once taken in before the table ends", async () => {
    const { token, guestId } = await nussBeforeLinking();
    const bob = playerId("00000000-0000-4000-8000-0000000000b0");
    backend.sessions["bob"] = () => Response.json(sessionOf(bob, "Bob", "RECRUIT"));
    const play = async (cookie: string, path: string, body: unknown) => {
      const response = await app.request(path, {
        method: "POST",
        headers: { Cookie: cookie, Origin: ORIGIN, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      expect(response.status).toBe(200);
      return response.json();
    };
    const guest = `__Host-leaf_session=${token}`;
    const id = Schema.decodeUnknownSync(Opened)(await play(guest, "/v1/game/sittings", { player: guestId })).id;
    const at = `/v1/game/sittings/${id}`;
    await play("seq_session=bob", at, { player: bob, commands: [{ id: "b-1", do: "sit" }] });
    await play(guest, at, { player: guestId, commands: [{ id: "g-1", do: "start" }] });
    const places = () =>
      leafs.query(
        (sql) =>
          sql`SELECT player_id AS player, place FROM raid_sitting_places WHERE sitting = ${id} ORDER BY place DESC`,
      );

    // Out first, the Discord player has their place at once: last of the eight.
    await play(guest, at, { player: guestId, commands: [{ id: "g-2", do: "leave" }] });
    expect(await places()).toEqual([{ player: guestId, place: 8 }]);
    // Taken into the account's player while the table goes on, and their place with them.
    await meWith("seq_session=nuss-sequoia");
    expect(await merges()).toEqual([{ n: 1 }]);
    expect(await places()).toEqual([{ player: account, place: 8 }]);
    // Bob gets up too: the regulars play it to its end, and the place stays the account's.
    await play("seq_session=bob", at, { player: bob, commands: [{ id: "b-2", do: "leave" }] });
    expect(await leafs.query((sql) => sql`SELECT stage FROM raid_sittings WHERE id = ${id}`)).toEqual([
      { stage: "over" },
    ]);
    expect(await places()).toEqual([
      { player: account, place: 8 },
      { player: bob, place: 7 },
    ]);
    const record = await app.request("/v1/game/sittings/record", { headers: { Cookie: "seq_session=nuss-sequoia" } });
    expect(await record.json()).toEqual({ played: 1, won: 0, top_four: 0 });
  });

  for (const whose of ["Discord", "account"] as const) {
    it(`waits to take the Discord player in while the ${whose} player is at a live table, and does it once the table is over`, async () => {
      const { token, guestId } = await nussBeforeLinking();
      const seated = whose === "Discord" ? guestId : account;
      await leafs.query(
        (sql) => sql`
          INSERT INTO play_state (player_id, game, rev, state, updated_at) VALUES (${guestId}, 'works', 4, '{}', ${T0})
        `,
      );
      await leafs.query(
        (sql) => sql`
          INSERT INTO raid_sittings (id, state, rev, opened_by, opened_at, stage, due_at)
          VALUES ('live', '{"a":"sitting"}', 3, ${seated}, ${T0}, 'plan', ${T0 + 60_000})
        `,
      );
      await leafs.query(
        (sql) => sql`INSERT INTO raid_sitting_seats (player_id, sitting, since) VALUES (${seated}, 'live', ${T0})`,
      );

      expect((await meWith("seq_session=nuss-sequoia")).body).toMatchObject({ player: { id: account } });

      // Nothing taken in or linked, and the table as it was; the Discord account plays on as its own player.
      expect(await merges()).toEqual([{ n: 0 }]);
      expect(await leafs.query((sql) => sql`SELECT player_id AS id FROM play_state`)).toEqual([{ id: guestId }]);
      expect(await leafs.query((sql) => sql`SELECT state, rev FROM raid_sittings`)).toEqual([
        { state: '{"a":"sitting"}', rev: 3 },
      ]);
      expect(await leafs.query((sql) => sql`SELECT player_id AS id FROM raid_sitting_seats`)).toEqual([{ id: seated }]);
      expect(idOf((await meWith(`__Host-leaf_session=${token}`)).body)).toBe(guestId);

      // The table over, the next sign-in takes them in.
      await leafs.query((sql) => sql`DELETE FROM raid_sitting_seats`);
      sequoiaSession("nuss-sequoia-again", account, "Nuss187");
      await meWith("seq_session=nuss-sequoia-again");
      expect(await merges()).toEqual([{ n: 1 }]);
      expect(await leafs.query((sql) => sql`SELECT player_id AS id FROM play_state`)).toEqual([{ id: account }]);
      expect(idOf((await meWith(`__Host-leaf_session=${token}`)).body)).toBe(account);
    });
  }

  it("stops asking another browser to link once the account is linked", async () => {
    const token = await signInNuss(true);
    sequoiaSession("nuss-sequoia", account, "Nuss187");
    await meWith(`seq_session=nuss-sequoia`);

    expect((await meWith(`__Host-leaf_session=${token}`)).body).toMatchObject({ linked: true, ask_link: false });
  });

  it("follows a member's new primary account, as Leaf always has, without taking one account's player into another's", async () => {
    const main = playerId("00000000-0000-4000-8000-00000000000a");
    const other = playerId("00000000-0000-4000-8000-0000000000a2");
    const discord = discordOf(main);
    sequoiaSession("main", main, "Main", discord);
    sequoiaSession("other", other, "Other", discord);
    await leafs.post(
      { kind: "earn", playerId: other, amount: leaf(500), source: "raid", idempotencyKey: "raid:2" },
      T0 - 1000,
    );

    await meWith("seq_session=main");
    const switched = await meWith("seq_session=other");

    expect(switched.body).toMatchObject({ player: { id: other }, leaf: 500 });
    expect(await leafs.query((sql) => sql`SELECT count(*) AS n FROM merges`)).toEqual([{ n: 0 }]);
  });
});
