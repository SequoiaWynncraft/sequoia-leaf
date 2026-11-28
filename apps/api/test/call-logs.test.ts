import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Redacted } from "effect";

import { DISCORD_API } from "../src/config.ts";
import { fakeBackend, type LogLine, testLeaf } from "./support.ts";

/**
 * Each step of a launch of Leaf in a Discord call is one info line in Leaf's log, so a launch that
 * fails on a phone shows how far it got: Discord's `/` (`call_entry`), each page served in the call
 * (`call_page`), the sign-in (`call_sign_in`) and a seat at the call's table (`call_seat`). None says
 * the launch, a code Discord gave or a token.
 */

const CLIENT = "1576258873759760577";
const FRAME = `https://${CLIENT}.discordsays.com`;
const BOT = "the-bot-token";
const INSTANCE = "i-1503012345678901234-gc-1386049999999999999-1386050000000000000";
const LAUNCH = `?instance_id=${INSTANCE}&location_id=gc-1-2&launch_id=1503012345678901235&frame_id=f-9&platform=mobile`;

/** Discord standing in: the code `code-<name>` is the account `<name>`, and only Ann is in the call. */
const discord = (backend: ReturnType<typeof fakeBackend>["fetcher"]) => async (url: string, init?: RequestInit) => {
  if (!url.startsWith(`${DISCORD_API}/`)) return backend(url, init);
  const request = new Request(url, init);
  if (url.endsWith("/oauth2/token")) {
    const code = new URLSearchParams(await request.text()).get("code") ?? "";
    return code.startsWith("code-")
      ? Response.json({ access_token: `token-${code.slice(5)}` })
      : Response.json({ error: "invalid_grant" }, { status: 400 });
  }
  if (url.endsWith("/users/@me")) {
    const name = /^Bearer token-(.+)$/.exec(request.headers.get("Authorization") ?? "")?.[1] ?? "";
    return Response.json({ id: name === "ann" ? "200000000000000001" : "200000000000000002", username: name });
  }
  return Response.json({ instance_id: INSTANCE, users: ["200000000000000001"] });
};

let publicDir: string;
beforeAll(() => {
  publicDir = mkdtempSync(join(tmpdir(), "leaf-call-pages-"));
  mkdirSync(join(publicDir, "town"));
  writeFileSync(join(publicDir, "town", "index.html"), "<!doctype html><title>Town</title>");
});
afterAll(() => {
  rmSync(publicDir, { recursive: true, force: true });
});

let logged: LogLine[];
let leafs: ReturnType<typeof testLeaf>;
let app: ReturnType<(typeof leafs)["app"]>;
beforeEach(() => {
  logged = [];
  const activity = { clientId: CLIENT, clientSecret: Redacted.make("s"), botToken: Redacted.make(BOT), origin: FRAME };
  leafs = testLeaf(
    { now: Date.now() },
    discord(fakeBackend().fetcher),
    { publicDir, activity },
    {
      logged,
      logLevel: "Info",
    },
  );
  app = leafs.app();
});
afterEach(async () => {
  await app.dispose();
  await leafs.dispose();
});

/** The lines of a launch's steps, each its message and what it said. */
const steps = () =>
  logged
    .filter((line) => typeof line.message === "string" && line.message.startsWith("call_"))
    .map((line) => [line.message, line.annotations]);

/** Signs in from the page Discord frames with a code for `name`: the session's cookie, if any. */
async function signIn(name: string): Promise<string> {
  const answer = await app.request("/v1/activity/sign-in", {
    method: "POST",
    headers: { Origin: FRAME, "Content-Type": "application/json" },
    body: JSON.stringify({ code: `code-${name}` }),
  });
  return answer.headers.getSetCookie()[0]?.split(";")[0] ?? "";
}

/** Asks for a seat at the call's table, as the raid's page does. */
async function seat(cookie: string): Promise<void> {
  const me: unknown = await (await app.request("/v1/game/me", { headers: { Cookie: cookie } })).json();
  const player = typeof me === "object" && me !== null && "player" in me ? me.player : null;
  const id = typeof player === "object" && player !== null && "id" in player ? player.id : "";
  await app.request("/v1/game/sittings/call", {
    method: "POST",
    headers: { Cookie: cookie, Origin: FRAME, "Content-Type": "application/json" },
    body: JSON.stringify({ player: id, instance: INSTANCE }),
  });
}

describe("a launch of Leaf in a Discord call, in Leaf's log", () => {
  it("is a line for each step: Discord's /, the pages, the sign-in and the seat, with how each went", async () => {
    await app.request(`/${LAUNCH}`);
    await app.request(`/play/town/${LAUNCH}`);
    await app.request("/play/town/");
    const ann = await signIn("ann");
    await app.request("/v1/activity/sign-in", {
      method: "POST",
      headers: { Origin: FRAME, "Content-Type": "application/json" },
      body: JSON.stringify({ code: "not-a-code" }),
    });
    await seat(ann);
    await seat(await signIn("bo"));

    expect(steps()).toEqual([
      [
        "call_entry",
        {
          launched: true,
          words: "frame_id,instance_id,platform,location_id,launch_id",
          platform: "mobile",
        },
      ],
      ["call_page", { page: "/play/town/", status: 200 }],
      ["call_sign_in", { outcome: "ok", player: expect.any(String) }],
      ["call_sign_in", { outcome: "discord_refused" }],
      ["call_seat", { player: expect.any(String), outcome: "seated" }],
      ["call_sign_in", { outcome: "ok", player: expect.any(String) }],
      ["call_seat", { player: expect.any(String), outcome: "not_in_call" }],
    ]);
  });

  it("says nothing of the launch, the code Discord gave or a token", async () => {
    await app.request(`/${LAUNCH}`);
    await app.request(`/play/town/${LAUNCH}`);
    await seat(await signIn("ann"));

    const said = JSON.stringify(steps());
    for (const secret of [INSTANCE, "1503012345678901235", "f-9", "gc-1-2", "code-ann", "token-ann"])
      expect(said).not.toContain(secret);
  });

  it("is said for a launch that came without all of its words, and not for the website's /", async () => {
    await app.request("/?frame_id=f-9&platform=ios");
    await app.request("/");

    expect(steps()).toEqual([["call_entry", { launched: false, words: "frame_id,platform", platform: "other" }]]);
  });
});
