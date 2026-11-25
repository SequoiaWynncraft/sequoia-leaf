import { afterEach, describe, expect, test } from "bun:test";

import { accountRows, signOut } from "./account.ts";
import { type Member, readMember } from "./live.ts";
import { GUEST, HELLO, type Reply, type Standin, standin, TESTER } from "./standin.ts";

let world: Standin | null = null;
afterEach(() => {
  world?.done();
  world = null;
});

const SIGN_IN = HELLO.body.sign_in;

function memberOf(body: unknown): Member {
  const me = readMember(body);
  if (!me) throw new Error("not a member");
  return me;
}
/** A member signed in on the guild's website, and somebody signed in with Discord alone. */
const linked = (): Member => memberOf({ ...TESTER, signed_in_with: "sequoia", ask_link: false });
const discord = (): Member => memberOf({ ...GUEST, signed_in_with: "discord", ask_link: true });

/** Leaf ending its session: no body. */
const ended = (): Reply => new Response(null, { status: 204 });

describe("the Account tab's rows", () => {
  test("signed in on the guild's website: Sequoia, and a Wynncraft account linked, with nothing to press", () => {
    expect(accountRows(linked(), SIGN_IN)).toEqual([
      { name: "Signed in with", value: "Sequoia" },
      { name: "Wynncraft account", value: "Linked" },
    ]);
  });

  test("signed in with Discord: no Wynncraft account linked, and Link account goes to the guild's sign-in and back to this page", () => {
    world = standin({});
    const rows = accountRows(discord(), SIGN_IN);
    expect(rows.map((r) => [r.name, r.value, r.act?.word])).toEqual([
      ["Signed in with", "Discord", undefined],
      ["Wynncraft account", "Not linked", "Link account"],
    ]);
    rows[1]?.act?.go();
    expect(world.went).toEqual([
      `https://api.example/auth/web/start?return_to=${encodeURIComponent("https://leaf.example/play/town/?x=1")}`,
    ]);
  });

  test("in a game in the town's frame, Link account takes the whole window and comes back to the town", () => {
    world = standin({}, { top: false, href: "https://leaf.example/play/works/" });
    accountRows(discord(), SIGN_IN)[1]?.act?.go();
    expect(world.went).toEqual([
      `https://api.example/auth/web/start?return_to=${encodeURIComponent("https://leaf.example/play/town/")}`,
    ]);
  });
});

describe("signing out", () => {
  test("with Discord alone: Leaf ends its session, and the page is loaded again", async () => {
    world = standin({ "POST /v1/game/sign-out": ended });
    expect(await signOut(discord(), SIGN_IN)).toBe(true);
    expect(world.sent.map((s) => `${s.method} ${s.path}`)).toEqual(["POST /v1/game/sign-out"]);
    expect([world.reloaded.count, world.went]).toEqual([1, []]);
  });

  test("with Discord alone, in the town's frame: the whole window goes to the town", async () => {
    world = standin({ "POST /v1/game/sign-out": ended }, { top: false, href: "https://leaf.example/play/works/" });
    expect(await signOut(discord(), SIGN_IN)).toBe(true);
    expect([world.reloaded.count, world.went]).toEqual([0, ["https://leaf.example/play/town/"]]);
  });

  test("with Discord alone and no answer from Leaf: still signed in, so nothing goes anywhere", async () => {
    world = standin({ "POST /v1/game/sign-out": "offline" });
    expect(await signOut(discord(), SIGN_IN)).toBe(false);
    expect([world.reloaded.count, world.went]).toEqual([0, []]);
  });

  test("on the guild's website: Leaf is told, then the website signs out and comes back to the town", async () => {
    world = standin({ "POST /v1/game/sign-out": ended }, { href: "https://leaf.example/play/works/?of=someone" });
    expect(await signOut(linked(), SIGN_IN)).toBe(true);
    expect(world.sent.map((s) => `${s.method} ${s.path}`)).toEqual(["POST /v1/game/sign-out"]);
    expect(world.went).toEqual([
      `https://api.example/auth/web/logout?return_to=${encodeURIComponent("https://leaf.example/play/town/")}`,
    ]);
    expect(world.reloaded.count).toBe(0);
  });
});
